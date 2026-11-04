import {Long,type Db,type ClientSession,type MongoClient} from 'mongodb';
import type {StorageBundle,StorageKind,ArtifactReader} from '../storage/contracts';
import {storageKinds,storageFiles} from '../storage/contracts';
import type {GenerationRun,LocalArtifact,Approval} from '../generation/contracts';
import type {ProjectRecord} from '../projects/service';
import type {Row} from '../planning/service';
import {inspectDeletionWork} from '../projects/deletion-work';
import {requireProjectId} from '../projects/contracts';
import {databaseTransaction} from '../db/transactions';
import {CleanupFault,type CleanupStore} from './contracts';
import {sourceRecordHash} from './source-contracts';
import {validateRenderPlan,generationHash} from '../rendering/contract';
import {verifyObject,sha256} from '../storage/r2';
export type UnpromotedTask={_id:string;workspaceId:string;projectId:string;runId:string;sourceHash:string;configHash:string;bucket:string;objects:StorageBundle['objects'];removedKinds:StorageKind[];
  state:'pending'|'retry'|'deleted';revision:Long;createdAt:Date;updatedAt:Date;deletedAt:Date|null;error:'UNPROMOTED_REMOVAL_FAILED'|null};
const fail=()=>new CleanupFault('UNPROMOTED_CLEANUP_UNAVAILABLE');
/** Only completed epoch-one storage, never unresolved/retried PUTs. */
export async function unpromotedProof(db:Db,session:ClientSession,bundle:StorageBundle,requireDeleted=false){
  if(bundle.state!=='stored'||bundle.owner!==null||bundle.leaseUntil!==null||!bundle.storedAt||!Long.isLong(bundle.epoch)||!bundle.epoch.equals(Long.ONE)||bundle._id!==bundle.artifactId||bundle.objects.length!==5||new Set(bundle.objects.map(o=>o.kind)).size!==5)throw fail();
  const scope={workspaceId:bundle.workspaceId,projectId:bundle.projectId},project=await db.collection<ProjectRecord>('projects').findOne({_id:bundle.projectId,workspaceId:bundle.workspaceId,deletedAt:{$type:'date'}},{session});if(!project?.deletionReceipt)throw fail();
  const work=await inspectDeletionWork(db,session,project);if(!work.impact.canDelete||work.planning.length||work.generation.length)throw fail();
  const run=await db.collection<GenerationRun>('generation_runs').findOne({_id:bundle.runId,...scope,state:'rendered_local',artifactId:bundle.artifactId,approvalId:bundle.approvalId,inputHash:bundle.inputHash,rendererBuildHash:bundle.rendererBuildHash,owner:null,leaseUntil:null},{session});
  const artifact=await db.collection<LocalArtifact>('generation_local_artifacts').findOne({_id:bundle.artifactId,runId:bundle.runId,workspaceId:bundle.workspaceId,approvalId:bundle.approvalId,inputHash:bundle.inputHash,rendererBuildHash:bundle.rendererBuildHash,manifestHash:bundle.manifestHash},{session});if(!run?.finishedAt||!artifact)throw fail();
  const approval=await db.collection<Approval>('approvals').findOne({_id:run.approvalId,...scope,inputHash:run.inputHash,planVersionId:run.planVersionId},{session});if(!approval)throw fail();try{if(generationHash(validateRenderPlan(JSON.parse(approval.inputCanonical)))!==run.inputHash)throw fail();}catch{throw fail();}
  for(const object of bundle.objects){const file=storageFiles[object.kind];if(!file||object.key!==`workspaces/${bundle.workspaceId}/projects/${bundle.projectId}/runs/${bundle.runId}/bundles/${bundle.artifactId}/${file.name}`||object.mime!==file.mime||!Number.isSafeInteger(object.size)||object.size<1||object.size>file.max||!/^[a-f0-9]{64}$/.test(object.sha256))throw fail();}
  if(await db.collection('ready_videos').findOne({$or:[{runId:run._id},{bundleId:bundle._id}]},{session,projection:{_id:1}})||await db.collection('video_assets').findOne({$or:[{bundleId:bundle._id},{videoId:bundle._id},{bucket:bundle.bucket,'object.key':{$in:bundle.objects.map(o=>o.key)}}]},{session,projection:{_id:1}})
    ||await db.collection<StorageBundle>('generation_storage_bundles').findOne({_id:{$ne:bundle._id},bucket:bundle.bucket,'objects.key':{$in:bundle.objects.map(o=>o.key)}},{session,projection:{_id:1}})||await db.collection('asset_refs').findOne({},{session,projection:{_id:1}})||await db.collection('publishing_payloads').findOne({},{session,projection:{_id:1}}))throw fail();
  const sourceHash=sourceRecordHash(bundle),task=await db.collection<UnpromotedTask>('unpromoted_cleanup_tasks').findOne({_id:bundle._id},{session});
  if(task&&(task.sourceHash!==sourceHash||task.workspaceId!==bundle.workspaceId||task.projectId!==bundle.projectId||task.runId!==bundle.runId||task.configHash!==bundle.configHash||task.bucket!==bundle.bucket||sourceRecordHash(task.objects)!==sourceRecordHash(bundle.objects)))throw fail();
  if(requireDeleted&&(!task||task.state!=='deleted'||storageKinds.some(kind=>!task.removedKinds.includes(kind))))throw fail();
  return {project,run,artifact,approval,sourceHash,task};
}
export class UnpromotedCleanupService{
  constructor(private client:MongoClient,private name:string,private store:CleanupStore,private reader?:ArtifactReader){}
  private async proof(db:Db,session:ClientSession,id:string){const bundle=await db.collection<StorageBundle>('generation_storage_bundles').findOne({_id:id,state:'stored',bucket:this.store.bucket,configHash:this.store.configHash},{session});if(!bundle)throw fail();return {...await unpromotedProof(db,session,bundle),bundle};}
  private async fence(db:Db,session:ClientSession,p:ProjectRecord){if(!Long.isLong(p.guardRevision)||p.guardRevision.isNegative()||p.guardRevision.greaterThanOrEqual(Long.fromNumber(Number.MAX_SAFE_INTEGER)))throw fail();if(!(await db.collection<ProjectRecord>('projects').updateOne({_id:p._id,workspaceId:p.workspaceId,deletedAt:p.deletedAt,guardRevision:p.guardRevision},{$inc:{guardRevision:Long.ONE}},{session})).matchedCount)throw fail();}
  async clean(id:string){requireProjectId(id);
    const initial=await databaseTransaction(this.client,this.name,(db,session)=>this.proof(db,session,id));
    if(!initial.task){if(!this.reader)throw fail();const bytes=await this.reader.read({run:initial.run,artifact:initial.artifact,approval:initial.approval});for(const object of initial.bundle.objects)verifyObject(object,bytes[object.kind]);if(sha256(bytes.manifest)!==initial.bundle.manifestHash||bytes.input.toString('utf8')!==initial.approval.inputCanonical)throw fail();}
    const task=await databaseTransaction(this.client,this.name,async(db,session)=>{const p=await this.proof(db,session,id);if(p.sourceHash!==initial.sourceHash)throw fail();if(p.task?.state==='deleted')return null;await this.fence(db,session,p.project);
      const now=new Date(),task:UnpromotedTask={_id:id,workspaceId:p.bundle.workspaceId,projectId:p.bundle.projectId,runId:p.bundle.runId,sourceHash:p.sourceHash,configHash:p.bundle.configHash,bucket:p.bundle.bucket,objects:p.bundle.objects,removedKinds:p.task?.removedKinds??[],state:'pending',revision:p.task?p.task.revision.add(Long.ONE):Long.ONE,createdAt:p.task?.createdAt??now,updatedAt:now,deletedAt:null,error:null};
      if(p.task)await db.collection<UnpromotedTask>('unpromoted_cleanup_tasks').replaceOne({_id:id,revision:p.task.revision},task,{session});else await db.collection<UnpromotedTask>('unpromoted_cleanup_tasks').insertOne(task,{session});return task;
    });if(!task)return false;
    try{
      for(const object of task.objects){
        const needed=await databaseTransaction(this.client,this.name,async(db,session)=>{const p=await this.proof(db,session,id);if(!p.task||p.task.state==='deleted')return false;await this.fence(db,session,p.project);return !p.task.removedKinds.includes(object.kind);});if(!needed)continue;
        await this.store.remove(object);
        await databaseTransaction(this.client,this.name,async(db,session)=>{const p=await this.proof(db,session,id);if(!p.task||p.task.state==='deleted')return;await this.fence(db,session,p.project);await db.collection<UnpromotedTask>('unpromoted_cleanup_tasks').updateOne({_id:id,revision:p.task.revision},{$addToSet:{removedKinds:object.kind},$inc:{revision:Long.ONE},$set:{updatedAt:new Date()}},{session});});
      }
      return await databaseTransaction(this.client,this.name,async(db,session)=>{const p=await this.proof(db,session,id);if(!p.task||p.task.state==='deleted')return false;if(storageKinds.some(kind=>!p.task!.removedKinds.includes(kind)))throw fail();await this.fence(db,session,p.project);return !!(await db.collection<UnpromotedTask>('unpromoted_cleanup_tasks').updateOne({_id:id,revision:p.task.revision},{$set:{state:'deleted',deletedAt:new Date(),updatedAt:new Date(),error:null},$inc:{revision:Long.ONE}},{session})).matchedCount;});
    }catch(error){await this.client.db(this.name).collection<UnpromotedTask>('unpromoted_cleanup_tasks').updateOne({_id:id,state:{$ne:'deleted'},sourceHash:task.sourceHash},{$set:{state:'retry',error:'UNPROMOTED_REMOVAL_FAILED',updatedAt:new Date()}});throw error instanceof CleanupFault?error:new CleanupFault('UNPROMOTED_REMOVAL_FAILED');}
  }
  async next(projectId:string){requireProjectId(projectId);const [bundle]=await this.client.db(this.name).collection<StorageBundle>('generation_storage_bundles').aggregate<StorageBundle>([
    {$match:{projectId,state:'stored',epoch:Long.ONE,configHash:this.store.configHash,bucket:this.store.bucket}},{$lookup:{from:'ready_videos',localField:'runId',foreignField:'runId',as:'ready'}},{$match:{'ready.0':{$exists:false}}},{$lookup:{from:'unpromoted_cleanup_tasks',localField:'_id',foreignField:'_id',as:'cleanup'}},{$match:{'cleanup.0.state':{$ne:'deleted'}}},{$sort:{createdAt:1,_id:1}},{$limit:1}
  ]).toArray();if(!bundle)return false;await this.clean(bundle._id);return true;}
}
