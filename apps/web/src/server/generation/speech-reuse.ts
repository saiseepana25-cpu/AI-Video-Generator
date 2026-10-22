import {randomUUID} from 'node:crypto';
import type {ClientSession,Db,MongoClient} from 'mongodb';
import {databaseTransaction} from '../db/transactions';
import {generationHash,validateRenderPlan,type RenderPlan} from '../rendering/contract';
import type {Row} from '../planning/service';
import type {ProviderControl,Env} from '../providers/contracts';
import {digest,providerConfig} from '../providers/config';
import type {Approval,GenerationRun,LocalArtifact,SpeechAttempt} from './contracts';
import {GenerationFault,type GenerationEngine} from './engine';
import {speechIdentity} from './speech-identity';
type Source={run:GenerationRun;attempt:SpeechAttempt;approval:Approval;artifact:LocalArtifact;identityHash:string};
export async function trySpeechReuse(client:MongoClient,name:string,env:Env,engine:GenerationEngine,run:GenerationRun,plan:RenderPlan,segmentId:string,signal:AbortSignal,fence:(db:Db,session:ClientSession)=>Promise<unknown>) {
  if(!engine.readSpeech)return null;
  const db=client.db(name),identityHash=speechIdentity(run.workspaceId,run.projectId,plan,segmentId);
  const candidates=await db.collection<GenerationRun>('generation_runs').find({workspaceId:run.workspaceId,projectId:run.projectId,state:'rendered_local',providerConfigHash:run.providerConfigHash,_id:{$ne:run._id}}).sort({createdAt:-1,_id:-1}).limit(20).toArray();
  for(const sourceRun of candidates){
    signal.throwIfAborted();
    const approval=await db.collection<Approval>('approvals').findOne({_id:sourceRun.approvalId,workspaceId:run.workspaceId,projectId:run.projectId,planVersionId:sourceRun.planVersionId,inputHash:sourceRun.inputHash});
    let sourcePlan:RenderPlan;
    try{if(!approval)continue;sourcePlan=validateRenderPlan(JSON.parse(approval.inputCanonical));if(generationHash(sourcePlan)!==sourceRun.inputHash||speechIdentity(run.workspaceId,run.projectId,sourcePlan,segmentId)!==identityHash)continue;}catch{continue;}
    const attempt=await db.collection<SpeechAttempt>('generation_speech_attempts').findOne({runId:sourceRun._id,workspaceId:run.workspaceId,segmentId,state:'settled',inputHash:sourceRun.inputHash,providerConfigHash:run.providerConfigHash,textHash:digest(plan.narration.find(n=>n.segmentId===segmentId)!.text)});
    const artifact=sourceRun.artifactId&&await db.collection<LocalArtifact>('generation_local_artifacts').findOne({_id:sourceRun.artifactId,runId:sourceRun._id,workspaceId:run.workspaceId,approvalId:sourceRun.approvalId,inputHash:sourceRun.inputHash});
    if(!attempt?.audioHash||!attempt.byteLength||attempt.sampleRate!==24000||!artifact)continue;
    const source:Source={run:sourceRun,attempt,approval:approval!,artifact,identityHash};
    let audio;try{audio=await engine.readSpeech({runId:sourceRun._id,attemptId:attempt._id,audioHash:attempt.audioHash,byteLength:attempt.byteLength,sampleRate:attempt.sampleRate},signal);}catch{signal.throwIfAborted();continue;}
    if(audio.sampleRate!==24000||audio.samples.length<2400||audio.samples.length>2160000||audio.samples.some(n=>!Number.isFinite(n)))continue;
    await databaseTransaction(client,name,async(tx,session)=>{
      await fence(tx,session);signal.throwIfAborted();
      const provider=await tx.collection<ProviderControl>('provider_controls').findOne({_id:'elevenlabs',state:'enabled',operatorDisabled:{$ne:true},configHash:run.providerConfigHash},{session});
      if(!provider||provider.reasonCode||provider.reservations.some(r=>r.state==='uncertain')||providerConfig('elevenlabs',env).configHash!==run.providerConfigHash)throw new GenerationFault('FREE_SPEECH_UNAVAILABLE');
      if(!await tx.collection<GenerationRun>('generation_runs').findOne({_id:source.run._id,workspaceId:run.workspaceId,projectId:run.projectId,state:'rendered_local',inputHash:source.run.inputHash,approvalId:source.approval._id,artifactId:source.artifact._id,providerConfigHash:run.providerConfigHash},{session})
        ||!await tx.collection<Approval>('approvals').findOne({_id:source.approval._id,workspaceId:run.workspaceId,projectId:run.projectId,inputHash:source.run.inputHash,inputCanonical:source.approval.inputCanonical},{session})
        ||!await tx.collection<SpeechAttempt>('generation_speech_attempts').findOne({_id:attempt._id,runId:sourceRun._id,workspaceId:run.workspaceId,segmentId,state:'settled',inputHash:sourceRun.inputHash,textHash:attempt.textHash,providerConfigHash:run.providerConfigHash,audioHash:attempt.audioHash,byteLength:attempt.byteLength,sampleRate:attempt.sampleRate},{session})
        ||!await tx.collection<LocalArtifact>('generation_local_artifacts').findOne({_id:artifact._id,runId:sourceRun._id,workspaceId:run.workspaceId,approvalId:source.approval._id,inputHash:source.run.inputHash},{session}))throw new GenerationFault('SPEECH_REUSE_SOURCE_CHANGED');
      await tx.collection<Row>('generation_speech_reuses').insertOne({_id:randomUUID(),workspaceId:run.workspaceId,projectId:run.projectId,runId:run._id,segmentId,sourceRunId:sourceRun._id,sourceAttemptId:attempt._id,sourceApprovalId:source.approval._id,
        sourceInputHash:sourceRun.inputHash,inputHash:run.inputHash,identityHash,providerConfigHash:run.providerConfigHash,audioHash:attempt.audioHash,byteLength:attempt.byteLength,sampleRate:attempt.sampleRate,owner:run.owner,leaseEpoch:run.leaseEpoch,createdAt:new Date()},{session});
    });
    return audio;
  }
  return null;
}
