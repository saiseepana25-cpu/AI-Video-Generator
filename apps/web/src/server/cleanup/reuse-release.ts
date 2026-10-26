import {Long,type ClientSession,type Db,type MongoClient} from 'mongodb';
import {databaseTransaction} from '../db/transactions';
import type {Row} from '../planning/service';
import type {ProjectRecord} from '../projects/service';
import {requireProjectId} from '../projects/contracts';
import {inspectDeletionWork} from '../projects/deletion-work';
import type {GenerationRun,SpeechAttempt,Approval,LocalArtifact} from '../generation/contracts';
import {generationHash,validateRenderPlan} from '../rendering/contract';
import {speechIdentity} from '../generation/speech-identity';
import {digest} from '../providers/config';
import type {LocalTask} from './local-contracts';
import {CleanupFault} from './contracts';
import {reuseRecordHash,matchesReuseRelease,type ReuseRelease} from './reuse-pins';
const fail=()=>new CleanupFault('REUSE_RELEASE_UNAVAILABLE');
/** Release metadata only; original reuse receipts, approvals and files survive. */
export class ReuseReleaseService{
  constructor(private client:MongoClient,private name:string){}
  private async proof(db:Db,session:ClientSession,ref:Row){
    const project=await db.collection<ProjectRecord>('projects').findOne({_id:ref.projectId,workspaceId:ref.workspaceId,deletedAt:{$type:'date'}},{session});if(!project?.deletionReceipt)throw fail();
    const work=await inspectDeletionWork(db,session,project);if(!work.impact.canDelete||work.planning.length||work.generation.length||await db.collection('publishing_payloads').findOne({},{session,projection:{_id:1}})||await db.collection('asset_refs').findOne({$or:[{assetId:ref._id},{assetId:ref.sourceAttemptId}]},{session,projection:{_id:1}}))throw fail();
    const scope={workspaceId:ref.workspaceId,projectId:ref.projectId,state:'rendered_local' as const,owner:null,leaseUntil:null};
    const target=await db.collection<GenerationRun>('generation_runs').findOne({...scope,_id:ref.runId,inputHash:ref.inputHash,providerConfigHash:ref.providerConfigHash},{session}),source=await db.collection<GenerationRun>('generation_runs').findOne({...scope,_id:ref.sourceRunId,inputHash:ref.sourceInputHash,approvalId:ref.sourceApprovalId,providerConfigHash:ref.providerConfigHash},{session});
    if(!target?.artifactId||!source?.artifactId||target._id===source._id||target.owner!==null||source.owner!==null||target.leaseUntil!==null||source.leaseUntil!==null||!(target.finishedAt instanceof Date)||!(source.finishedAt instanceof Date))throw fail();
    if(!Long.isLong(target.leaseEpoch)||!Long.isLong(ref.leaseEpoch)||!target.leaseEpoch.equals(ref.leaseEpoch))throw fail();
    const local=await db.collection<LocalTask>('local_render_cleanup_tasks').findOne({_id:target.artifactId,runId:target._id,workspaceId:project.workspaceId,projectId:project._id,state:'cleaned'},{session});
    const targetArtifact=await db.collection<LocalArtifact>('generation_local_artifacts').findOne({_id:target.artifactId,runId:target._id,workspaceId:project.workspaceId,approvalId:target.approvalId,inputHash:target.inputHash,rendererBuildHash:target.rendererBuildHash},{session});
    const sourceArtifact=await db.collection<LocalArtifact>('generation_local_artifacts').findOne({_id:source.artifactId,runId:source._id,workspaceId:project.workspaceId,approvalId:source.approvalId,inputHash:source.inputHash,rendererBuildHash:source.rendererBuildHash},{session});
    if(!local||!targetArtifact||!sourceArtifact||local.source.runId!==target._id||local.source.artifactId!==target.artifactId||local.source.inputHash!==target.inputHash||local.source.rendererBuildHash!==target.rendererBuildHash||local.source.manifestHash!==targetArtifact.manifestHash)throw fail();
    const attempt=await db.collection<SpeechAttempt>('generation_speech_attempts').findOne({_id:ref.sourceAttemptId,runId:source._id,workspaceId:project.workspaceId,state:'settled',inputHash:source.inputHash,providerConfigHash:ref.providerConfigHash,segmentId:ref.segmentId,audioHash:ref.audioHash,byteLength:ref.byteLength,sampleRate:ref.sampleRate},{session});
    const sourceApproval=await db.collection<Approval>('approvals').findOne({_id:source.approvalId,workspaceId:project.workspaceId,projectId:project._id,planVersionId:source.planVersionId,inputHash:source.inputHash},{session}),targetApproval=await db.collection<Approval>('approvals').findOne({_id:target.approvalId,workspaceId:project.workspaceId,projectId:project._id,planVersionId:target.planVersionId,inputHash:target.inputHash},{session});
    if(!attempt||!(attempt.finishedAt instanceof Date)||!sourceApproval||!targetApproval)throw fail();
    try{const a=validateRenderPlan(JSON.parse(sourceApproval.inputCanonical)),b=validateRenderPlan(JSON.parse(targetApproval.inputCanonical)),text=b.narration.find(n=>n.segmentId===ref.segmentId)?.text;if(!text||generationHash(a)!==source.inputHash||generationHash(b)!==target.inputHash||digest(text)!==attempt.textHash||speechIdentity(project.workspaceId,project._id,a,ref.segmentId)!==ref.identityHash||speechIdentity(project.workspaceId,project._id,b,ref.segmentId)!==ref.identityHash)throw fail();}catch{throw fail();}
    return project;
  }
  async release(id:string){requireProjectId(id);return databaseTransaction(this.client,this.name,async(db,session)=>{
    const ref=await db.collection<Row>('generation_speech_reuses').findOne({_id:id},{session});if(!ref)throw fail();
    const prior=await db.collection<ReuseRelease>('speech_reuse_releases').findOne({_id:id},{session});if(prior){if(!matchesReuseRelease(ref,prior))throw fail();return false;}
    const project=await this.proof(db,session,ref);if(!Long.isLong(project.guardRevision)||project.guardRevision.isNegative()||project.guardRevision.greaterThanOrEqual(Long.fromNumber(Number.MAX_SAFE_INTEGER)))throw fail();
    if(!(await db.collection<ProjectRecord>('projects').updateOne({_id:project._id,workspaceId:project.workspaceId,deletedAt:project.deletedAt,guardRevision:project.guardRevision},{$inc:{guardRevision:Long.ONE}},{session})).matchedCount)throw fail();
    // Coordinate also with current source-audio cleanup, even though supported
    // same-project targets are already tombstoned and cannot acquire new pins.
    if(await db.collection<Row>('speech_cleanup_tasks').findOne({_id:ref.sourceAttemptId},{session}))throw fail();
    await db.collection<ReuseRelease>('speech_reuse_releases').insertOne({_id:id,workspaceId:project.workspaceId,projectId:project._id,targetRunId:ref.runId,sourceRunId:ref.sourceRunId,sourceAttemptId:ref.sourceAttemptId,reuseHash:reuseRecordHash(ref),reason:'deleted_target_render_cleaned',releasedAt:new Date()},{session});return true;
  });}
  async next(projectId:string){requireProjectId(projectId);const db=this.client.db(this.name),[ref]=await db.collection<Row>('generation_speech_reuses').aggregate<Row>([{$match:{projectId}},{$lookup:{from:'speech_reuse_releases',localField:'_id',foreignField:'_id',as:'release'}},{$match:{'release.0':{$exists:false}}},{$sort:{createdAt:1,_id:1}},{$limit:1}]).toArray();if(!ref)return false;await this.release(ref._id);return true;}
}
