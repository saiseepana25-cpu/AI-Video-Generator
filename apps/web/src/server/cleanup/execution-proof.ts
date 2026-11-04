import type {Db,ClientSession} from 'mongodb';
import type {GenerationRun} from '../generation/contracts';
import type {Execution} from '../generation/executor-contracts';
import type {ExecutionCleanupTask} from './execution-service';
import {sourceRecordHash} from './source-contracts';
import {artifactOwner,workspaceOwner} from '../../../../../src/pipeline/execution-owner';
/** Permanent stopped/cleaned receipts, never age/lease inference. Metadata only. */
export async function executionWorkspaceCleared(db:Db,session:ClientSession,run:GenerationRun,rootHash?:string){
  const rows=await db.collection<Execution>('generation_executors').find({runId:run._id},{session}).limit(3).toArray();
  if(rows.length>2)return false;
  if(!rows.length)return run.executorProtocol==='windows-job-v1'&&(run.submissionCount??0)===0;
  for(const e of rows){
    if(e.state!=='stopped'||!e.stoppedAt||!e.payloadSealedAt||e.exitCode===null||e.workspaceId!==run.workspaceId||e.projectId!==run.projectId||e.inputHash!==run.inputHash||e.rendererBuildHash!==run.rendererBuildHash||!e.leaseEpoch.equals(run.leaseEpoch!)||rootHash&&e.rootHash!==rootHash)return false;
    const task=await db.collection<ExecutionCleanupTask>('execution_cleanup_tasks').findOne({_id:e._id,state:'cleaned',workspaceId:e.workspaceId,projectId:e.projectId,runId:run._id,rootHash:e.rootHash,sourceHash:sourceRecordHash(e)},{session});
    if(!task||task.source.executionId!==e._id||task.source.runId!==run._id||task.source.artifactId!==e.artifactId||task.source.stoppedAt.getTime()!==Math.max(e.stoppedAt.getTime(),e.payloadSealedAt.getTime())||task.source.includeArtifact!==(e.stage==='render'&&e.artifactId!==null&&run.state!=='rendered_local'))return false;
    if(task.source.workOwnerHash!==workspaceOwner(e._id,run._id,run.inputHash,run.rendererBuildHash).sha256)return false;
    if(task.source.artifactOwnerHash!==(task.source.includeArtifact?artifactOwner(e._id,run._id,e.artifactId!,run.inputHash,run.rendererBuildHash).sha256:null))return false;
  }return true;
}
export async function failedRunWorkspaceCleared(db:Db,session:ClientSession,run:GenerationRun,rootHash?:string){
  if(!['failed','cancelled'].includes(run.state)||run.executorProtocol!=='windows-job-v1'||run.owner!==null||run.leaseUntil!==null||!run.finishedAt||run.artifactId||!await executionWorkspaceCleared(db,session,run,rootHash))return false;
  if(await db.collection('generation_speech_attempts').findOne({runId:run._id,state:{$nin:['settled','refused']}},{session,projection:{_id:1}})||await db.collection('provider_controls').findOne({reservations:{$elemMatch:{id:run.reservationId,state:{$ne:'settled'}}}},{session,projection:{_id:1}}))return false;
  for(const name of ['generation_local_artifacts','generation_storage_bundles','ready_videos'])if(await db.collection(name).findOne({runId:run._id},{session,projection:{_id:1}}))return false;
  return true;
}
