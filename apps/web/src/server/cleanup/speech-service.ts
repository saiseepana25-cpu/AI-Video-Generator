import {Long,type Db,type ClientSession,type MongoClient} from 'mongodb';
import {isDeepStrictEqual} from 'node:util';
import {databaseTransaction} from '../db/transactions';
import {requireProjectId} from '../projects/contracts';
import {inspectDeletionWork} from '../projects/deletion-work';
import type {ProjectRecord} from '../projects/service';
import type {GenerationRun,SpeechAttempt,LocalArtifact,Approval} from '../generation/contracts';
import type {LocalTask} from './local-contracts';
import type {SpeechCleanupTask,SpeechFileCleaner,SpeechSource} from './speech-contracts';
import {CleanupFault} from './contracts';
import {hasRetainedSpeechPin} from './reuse-pins';
const fail=()=>new CleanupFault('SPEECH_CLEANUP_UNAVAILABLE');
const advance=(n:Long)=>{if(!Long.isLong(n)||n.isNegative()||n.greaterThanOrEqual(Long.fromNumber(Number.MAX_SAFE_INTEGER)))throw fail();return n.add(Long.ONE);};
export async function speechCleanupStatus(db:Db,workspaceId:string,projectId:string){
  const rows=await db.collection<SpeechAttempt>('generation_speech_attempts').aggregate<{_id:string}>([{$match:{workspaceId,state:'settled'}},{$lookup:{from:'generation_runs',localField:'runId',foreignField:'_id',as:'run'}},{$match:{'run.0.workspaceId':workspaceId,'run.0.projectId':projectId}},{$project:{_id:1}}]).toArray();let pinnedAttempts=0;for(const row of rows)if(await hasRetainedSpeechPin(db,row._id))pinnedAttempts++;
  const scope={workspaceId,projectId};return {settledAttempts:rows.length,pinnedAttempts,removedAttempts:await db.collection('speech_cleanup_tasks').countDocuments({...scope,state:'removed'}),retryAttempts:await db.collection('speech_cleanup_tasks').countDocuments({...scope,state:'retry'}),pendingAttempts:await db.collection('speech_cleanup_tasks').countDocuments({...scope,state:'pending'}),retainedContent:true};
}
export class SpeechCleanupService{
  constructor(private client:MongoClient,private name:string,private files:SpeechFileCleaner){}
  private get db(){return this.client.db(this.name);}
  private async proof(db:Db,session:ClientSession,id:string){
    const attempt=await db.collection<SpeechAttempt>('generation_speech_attempts').findOne({_id:id,state:'settled'},{session});if(!attempt?.audioHash||!attempt.byteLength||attempt.sampleRate!==24000||!(attempt.finishedAt instanceof Date))throw fail();
    const run=await db.collection<GenerationRun>('generation_runs').findOne({_id:attempt.runId,workspaceId:attempt.workspaceId,state:'rendered_local',inputHash:attempt.inputHash,providerConfigHash:attempt.providerConfigHash,owner:null,leaseUntil:null},{session});if(!run?.artifactId||!(run.finishedAt instanceof Date)||run.owner!==null||run.leaseUntil!==null)throw fail();
    const project=await db.collection<ProjectRecord>('projects').findOne({_id:run.projectId,workspaceId:run.workspaceId,deletedAt:{$type:'date'}},{session});if(!project?.deletionReceipt)throw fail();const work=await inspectDeletionWork(db,session,project);if(!work.impact.canDelete||work.planning.length||work.generation.length)throw fail();
    const local=await db.collection<LocalTask>('local_render_cleanup_tasks').findOne({_id:run.artifactId,runId:run._id,workspaceId:run.workspaceId,projectId:run.projectId,state:'cleaned',rootHash:this.files.rootHash},{session});
    const artifact=await db.collection<LocalArtifact>('generation_local_artifacts').findOne({_id:run.artifactId,runId:run._id,workspaceId:run.workspaceId,approvalId:run.approvalId,inputHash:run.inputHash,rendererBuildHash:run.rendererBuildHash},{session});
    const approval=await db.collection<Approval>('approvals').findOne({_id:run.approvalId,workspaceId:run.workspaceId,projectId:run.projectId,inputHash:run.inputHash},{session});
    if(!local||!artifact||!approval||local.source.runId!==run._id||local.source.artifactId!==artifact._id||local.source.manifestHash!==artifact.manifestHash||local.source.inputHash!==run.inputHash||local.source.rendererBuildHash!==run.rendererBuildHash)throw fail();
    // Only an exact permanent release receipt can retire a historical pin.
    // Cross-project reuse is unsupported; future pin writers must join the same
    // project guard and refuse any speech-cleanup checkpoint before reading.
    if(await hasRetainedSpeechPin(db,id,session)||await db.collection('asset_refs').findOne({assetId:id},{session,projection:{_id:1}})||await db.collection('publishing_payloads').findOne({},{session,projection:{_id:1}}))throw fail();
    const source:SpeechSource={runId:run._id,attemptId:id,audioHash:attempt.audioHash,byteLength:attempt.byteLength,sampleRate:24000,inputHash:attempt.inputHash,providerConfigHash:attempt.providerConfigHash,textHash:attempt.textHash,segmentId:attempt.segmentId};return {source,project};
  }
  private async fence(db:Db,session:ClientSession,project:ProjectRecord){advance(project.guardRevision);if(!(await db.collection<ProjectRecord>('projects').updateOne({_id:project._id,workspaceId:project.workspaceId,deletedAt:project.deletedAt,guardRevision:project.guardRevision},{$inc:{guardRevision:Long.ONE}},{session})).matchedCount)throw fail();}
  async clean(id:string){requireProjectId(id);
    const initial=await databaseTransaction(this.client,this.name,async(db,session)=>({...await this.proof(db,session,id),prior:await db.collection<SpeechCleanupTask>('speech_cleanup_tasks').findOne({_id:id},{session})}));
    const {source,project,prior}=initial;
    const matches=(task:SpeechCleanupTask)=>task.rootHash===this.files.rootHash&&task.workspaceId===project.workspaceId&&task.projectId===project._id&&isDeepStrictEqual(task.source,source);
    if(prior&&!matches(prior))throw fail();if(prior?.state==='removed')return false;if(!prior)await this.files.inspect(source);
    const task=await databaseTransaction(this.client,this.name,async(db,session)=>{const proof=await this.proof(db,session,id);if(!isDeepStrictEqual(proof.source,source))throw fail();const old=await db.collection<SpeechCleanupTask>('speech_cleanup_tasks').findOne({_id:id},{session});if(old&&!matches(old))throw fail();if(old?.state==='removed')return null;
      const now=new Date(),task:SpeechCleanupTask={_id:id,workspaceId:project.workspaceId,projectId:project._id,source,rootHash:this.files.rootHash,state:'pending',revision:old?advance(old.revision):Long.ONE,attempts:old?advance(old.attempts):Long.ONE,error:null,createdAt:old?.createdAt??now,updatedAt:now,removedAt:null};await this.fence(db,session,proof.project);
      if(old){if(!(await db.collection<SpeechCleanupTask>('speech_cleanup_tasks').replaceOne({_id:id,revision:old.revision},task,{session})).matchedCount)throw fail();}else await db.collection<SpeechCleanupTask>('speech_cleanup_tasks').insertOne(task,{session});return task;});if(!task)return false;
    try{await this.files.remove(task.source);}catch{await this.db.collection<SpeechCleanupTask>('speech_cleanup_tasks').updateOne({_id:id,revision:task.revision,state:'pending'},{$set:{state:'retry',error:'SPEECH_REMOVAL_FAILED',updatedAt:new Date()}});throw new CleanupFault('SPEECH_REMOVAL_FAILED');}
    return databaseTransaction(this.client,this.name,async(db,session)=>{const proof=await this.proof(db,session,id);if(!isDeepStrictEqual(proof.source,task.source))throw fail();const current=await db.collection<SpeechCleanupTask>('speech_cleanup_tasks').findOne({_id:id,revision:task.revision,state:'pending'},{session});if(!current)return false;if(!isDeepStrictEqual(current,task))throw fail();await this.fence(db,session,proof.project);const now=new Date();return !!(await db.collection<SpeechCleanupTask>('speech_cleanup_tasks').updateOne({_id:id,revision:task.revision,state:'pending'},{$set:{state:'removed',removedAt:now,updatedAt:now,error:null}},{session})).matchedCount;});
  }
  async next(projectId:string){requireProjectId(projectId);const [candidate]=await this.db.collection<SpeechAttempt>('generation_speech_attempts').aggregate<SpeechAttempt>([
    {$match:{state:'settled'}},{$lookup:{from:'generation_runs',localField:'runId',foreignField:'_id',as:'run'}},{$match:{'run.0.projectId':projectId,'run.0.state':'rendered_local'}},
    {$lookup:{from:'local_render_cleanup_tasks',localField:'runId',foreignField:'runId',as:'local'}},{$match:{'local.0.state':'cleaned'}},
    {$lookup:{from:'generation_speech_reuses',localField:'_id',foreignField:'sourceAttemptId',as:'refs'}},{$lookup:{from:'speech_reuse_releases',localField:'refs._id',foreignField:'_id',as:'releases'}},{$match:{$expr:{$eq:[{$size:'$refs'},{$size:'$releases'}]}}},
    {$lookup:{from:'speech_cleanup_tasks',localField:'_id',foreignField:'_id',as:'task'}},{$match:{'task.0.state':{$ne:'removed'}}},{$sort:{createdAt:1,_id:1}},{$limit:1}
  ]).toArray();if(!candidate)return false;await this.clean(candidate._id);return true;}
}
