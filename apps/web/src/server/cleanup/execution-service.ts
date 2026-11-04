import {Long,type MongoClient,type Db,type ClientSession} from 'mongodb';
import {databaseTransaction} from '../db/transactions';
import type {GenerationRun} from '../generation/contracts';
import {executorLocation,type Execution} from '../generation/executor-contracts';
import type {Row} from '../planning/service';
import {CleanupFault} from './contracts';
import {sourceRecordHash} from './source-contracts';
import type {ExecutionCleaner,ExecutionSource,ExecutionInventory} from './execution-files';
import {requireProjectId} from '../projects/contracts';
import {artifactOwner,workspaceOwner} from '../../../../../src/pipeline/execution-owner';
const fail=()=>new CleanupFault('EXECUTION_CLEANUP_UNAVAILABLE');
export type ExecutionCleanupTask={_id:string;workspaceId:string;projectId:string;runId:string;sourceHash:string;rootHash:string;source:ExecutionSource;inventory:ExecutionInventory;
  state:'pending'|'retry'|'cleaned';revision:Long;createdAt:Date;updatedAt:Date;cleanedAt:Date|null;error:'EXECUTION_REMOVAL_FAILED'|null};
export class ExecutionCleanupService{
  private location:ReturnType<typeof executorLocation>;
  constructor(private client:MongoClient,private name:string,root:string,private files:ExecutionCleaner,private now=()=>new Date()){this.location=executorLocation(root);if(files.rootHash!==this.location.rootHash)throw fail();}
  private async proof(db:Db,session:ClientSession,id:string){
    const execution=await db.collection<Execution>('generation_executors').findOne({_id:id,state:'stopped'},{session});
    if(!execution?.stoppedAt||!execution.payloadSealedAt||execution.exitCode===null||execution.protocol!=='windows-job-v1'||execution.rootHash!==this.location.rootHash||execution.hostHash!==this.location.hostHash)throw fail();
    const closedAt=new Date(Math.max(execution.stoppedAt.getTime(),execution.payloadSealedAt.getTime()));if(this.now().getTime()-closedAt.getTime()<24*3600000)throw fail();
    const run=await db.collection<GenerationRun>('generation_runs').findOne({_id:execution.runId,workspaceId:execution.workspaceId,projectId:execution.projectId,inputHash:execution.inputHash,rendererBuildHash:execution.rendererBuildHash,owner:null,leaseUntil:null,state:{$in:['failed','cancelled','rendered_local']}},{session});
    if(!run?.finishedAt||!run.leaseEpoch?.equals(execution.leaseEpoch))throw fail();
    if(await db.collection('generation_executors').findOne({runId:run._id,state:{$ne:'stopped'}},{session,projection:{_id:1}})||await db.collection('asset_refs').findOne({},{session,projection:{_id:1}})||await db.collection('publishing_payloads').findOne({},{session,projection:{_id:1}})||await db.collection('publishing_intents').findOne({workspaceId:run.workspaceId,projectId:run.projectId},{session,projection:{_id:1}}))throw fail();
    const project=await db.collection<Row>('projects').findOne({_id:run.projectId,workspaceId:run.workspaceId},{session});if(!project)throw fail();
    const includeArtifact=execution.stage==='render'&&execution.artifactId!==null&&run.state!=='rendered_local';
    if(includeArtifact&&(run.artifactId||await db.collection<Row>('generation_local_artifacts').findOne({$or:[{_id:execution.artifactId!},{runId:run._id}]},{session,projection:{_id:1}})||await db.collection('generation_storage_bundles').findOne({runId:run._id},{session,projection:{_id:1}})||await db.collection('ready_videos').findOne({runId:run._id},{session,projection:{_id:1}})||await db.collection('video_assets').findOne({$or:[{videoId:execution.artifactId},{bundleId:execution.artifactId}]},{session,projection:{_id:1}})))throw fail();
    const source:ExecutionSource={executionId:id,runId:run._id,artifactId:execution.artifactId,includeArtifact,stoppedAt:closedAt,workOwnerHash:workspaceOwner(id,run._id,run.inputHash,run.rendererBuildHash).sha256,artifactOwnerHash:includeArtifact?artifactOwner(id,run._id,execution.artifactId!,run.inputHash,run.rendererBuildHash).sha256:null};
    return {execution,project,source,sourceHash:sourceRecordHash(execution)};
  }
  private async fence(db:Db,session:ClientSession,project:Row){
    if(!Long.isLong(project.guardRevision)||project.guardRevision.greaterThanOrEqual(Long.fromNumber(Number.MAX_SAFE_INTEGER)))throw fail();
    if(!(await db.collection<Row>('projects').updateOne({_id:project._id,workspaceId:project.workspaceId,guardRevision:project.guardRevision},{$inc:{guardRevision:Long.ONE}},{session})).matchedCount)throw fail();
  }
  async clean(id:string){
    requireProjectId(id);
    const initial=await databaseTransaction(this.client,this.name,async(db,session)=>({...await this.proof(db,session,id),prior:await db.collection<ExecutionCleanupTask>('execution_cleanup_tasks').findOne({_id:id},{session})}));
    const matches=(task:ExecutionCleanupTask)=>task.sourceHash===initial.sourceHash&&task.rootHash===this.files.rootHash&&sourceRecordHash(task.source)===sourceRecordHash(initial.source)&&task.workspaceId===initial.execution.workspaceId&&task.projectId===initial.execution.projectId&&task.runId===initial.execution.runId;
    if(initial.prior&&!matches(initial.prior))throw fail();
    if(initial.prior?.state==='cleaned'){if((await this.files.inspect(initial.source)).files.length)throw fail();return false;}
    const inventory=initial.prior?.inventory??await this.files.inspect(initial.source);
    const task=await databaseTransaction(this.client,this.name,async(db,session)=>{
      const proof=await this.proof(db,session,id);if(proof.sourceHash!==initial.sourceHash)throw fail();
      const prior=await db.collection<ExecutionCleanupTask>('execution_cleanup_tasks').findOne({_id:id},{session});if(prior&&(!matches(prior)||sourceRecordHash(prior.inventory)!==sourceRecordHash(inventory)))throw fail();if(prior?.state==='cleaned')return null;
      const now=this.now(),task:ExecutionCleanupTask={_id:id,workspaceId:proof.execution.workspaceId,projectId:proof.execution.projectId,runId:proof.execution.runId,sourceHash:proof.sourceHash,rootHash:this.files.rootHash,source:proof.source,inventory,
        state:'pending',revision:prior?prior.revision.add(Long.ONE):Long.ONE,createdAt:prior?.createdAt??now,updatedAt:now,cleanedAt:null,error:null};
      await this.fence(db,session,proof.project);if(prior)await db.collection<ExecutionCleanupTask>('execution_cleanup_tasks').replaceOne({_id:id,revision:prior.revision},task,{session});else await db.collection<ExecutionCleanupTask>('execution_cleanup_tasks').insertOne(task,{session});return task;
    });if(!task)return false;
    try{await this.files.remove(task.source,task.inventory);}catch{await this.client.db(this.name).collection<ExecutionCleanupTask>('execution_cleanup_tasks').updateOne({_id:id,revision:task.revision,state:'pending'},{$set:{state:'retry',error:'EXECUTION_REMOVAL_FAILED',updatedAt:this.now()}});throw new CleanupFault('EXECUTION_REMOVAL_FAILED');}
    return databaseTransaction(this.client,this.name,async(db,session)=>{
      const proof=await this.proof(db,session,id);if(proof.sourceHash!==task.sourceHash)throw fail();await this.fence(db,session,proof.project);
      const current=await db.collection<ExecutionCleanupTask>('execution_cleanup_tasks').findOne({_id:id,revision:task.revision,state:'pending'},{session});if(!current)return false;if(sourceRecordHash(current)!==sourceRecordHash(task))throw fail();
      return !!(await db.collection<ExecutionCleanupTask>('execution_cleanup_tasks').updateOne({_id:id,revision:task.revision,state:'pending'},{$set:{state:'cleaned',error:null,cleanedAt:this.now(),updatedAt:this.now()}},{session})).matchedCount;
    });
  }
  async next(projectId:string){requireProjectId(projectId);const [row]=await this.client.db(this.name).collection<Execution>('generation_executors').aggregate<Execution>([
    {$match:{projectId,state:'stopped',rootHash:this.location.rootHash,hostHash:this.location.hostHash,stoppedAt:{$lte:new Date(this.now().getTime()-24*3600000)},payloadSealedAt:{$type:'date',$lte:new Date(this.now().getTime()-24*3600000)}}},
    {$lookup:{from:'generation_runs',localField:'runId',foreignField:'_id',as:'run'}},{$match:{'run.0.state':{$in:['failed','cancelled','rendered_local']},'run.0.owner':null,'run.0.leaseUntil':null}},
    {$lookup:{from:'execution_cleanup_tasks',localField:'_id',foreignField:'_id',as:'cleanup'}},{$match:{'cleanup.0.state':{$ne:'cleaned'}}},{$sort:{createdAt:1,_id:1}},{$limit:1}
  ]).toArray();if(!row)return false;await this.clean(row._id);return true;}
}
