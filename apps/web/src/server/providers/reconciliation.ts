import {isDeepStrictEqual} from 'node:util';
import {Long,type Db,type ClientSession,type MongoClient} from 'mongodb';
import {databaseTransaction} from '../db/transactions';
import {sourceRecordHash} from '../cleanup/source-contracts';
import type {GenerationRun,SpeechAttempt} from '../generation/contracts';
import {providerConfig,digest} from './config';
import {isOperatorDisabled,type Env,type ProviderControl} from './contracts';
import {ProviderGateway,ProviderFault} from './gateway';
type Input={commandId:string;expectedRevision:number;confirmedRemaining:number};
type Entry={id:string;units:number;state:'settled';createdAt:Date;runId:string;runHash:string;attemptsHash:string};
type Receipt={_id:string;requestHash:string;configHash:string;periodId:string;sourceRevision:Long;operatorConfirmedRemaining:number;providerRemaining:number;availableAfter:number;retainedUnits:number;observedAt:Date;createdAt:Date;reservations:Entry[]};
const fail=(code='ALLOWANCE_RECONCILIATION_UNAVAILABLE')=>new ProviderFault(code);
/** Explicit operator baseline only. No automatic refund, speech, or run retry.
 * Archives only old, exactly settled generation holds; unmatched probes remain.
 * The operator confirms the current account balance, independently matched by API.
 */
export class SpeechAllowanceReconciliation {
  private gateway:ProviderGateway;
  constructor(private client:MongoClient,private name:string,private env:Env,request?:typeof fetch,private now=()=>new Date()){this.gateway=new ProviderGateway(env,request);}
  private async proof(db:Db,session:ClientSession|undefined,row:ProviderControl,cutoff:Date){
    if(isOperatorDisabled(row)||row.configHash!==providerConfig('elevenlabs',this.env).configHash||!Long.isLong(row.revision)||row.revision.lessThan(Long.ONE)||row.revision.greaterThanOrEqual(Long.fromNumber(Number.MAX_SAFE_INTEGER))||!row.allowance.periodId||row.allowance.periodId==='unknown'||row.reservations.some(r=>r.state!=='settled'))throw fail();
    if(new Set(row.reservations.map(r=>r.id)).size!==row.reservations.length)throw fail();
    if(await db.collection('generation_runs').findOne({state:{$in:['queued','running','cancellation_requested']}},{session,projection:{_id:1}})||await db.collection('generation_speech_attempts').findOne({state:{$in:['submitted','uncertain']}},{session,projection:{_id:1}}))throw fail('ACTIVE_OR_UNCERTAIN_SPEECH');
    const eligible:Entry[]=[];
    for(const hold of row.reservations){
      const runs=await db.collection<GenerationRun>('generation_runs').find({reservationId:hold.id},{session}).limit(2).toArray();
      if(runs.length!==1)continue;const run=runs[0];
      if(!['rendered_local','failed','cancelled'].includes(run.state)||run.owner!==null||run.leaseUntil!==null||!(run.finishedAt instanceof Date)||run.finishedAt>cutoff||run.providerConfigHash!==row.configHash||run.reservationPeriodId!==row.allowance.periodId||!Number.isInteger(run.submissionCount)||!run.submissionCount)continue;
      const attempts=await db.collection<SpeechAttempt>('generation_speech_attempts').find({runId:run._id},{session}).sort({_id:1}).limit(9).toArray();
      if(attempts.length!==run.submissionCount||attempts.length>8||attempts.some(a=>a.state!=='settled'||a.workspaceId!==run.workspaceId||a.providerConfigHash!==row.configHash||a.inputHash!==run.inputHash||!a.audioHash||!a.byteLength||!(a.finishedAt instanceof Date)||a.finishedAt>run.finishedAt!))continue;
      eligible.push({...hold,state:'settled',runId:run._id,runHash:sourceRecordHash(run),attemptsHash:sourceRecordHash(attempts)});
    }return eligible;
  }
  async reconcile(input:Input){
    if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(input.commandId)||!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<1||!Number.isSafeInteger(input.confirmedRemaining)||input.confirmedRemaining<0)throw fail('INVALID_RECONCILIATION_INPUT');
    const config=providerConfig('elevenlabs',this.env),requestHash=digest(JSON.stringify(input));
    const db=this.client.db(this.name),receipts=db.collection<Receipt>('speech_allowance_reconciliations');
    const replay=(receipt:Receipt)=>{if(receipt.requestHash!==requestHash||receipt.configHash!==config.configHash)throw fail('RECONCILIATION_COMMAND_MISMATCH');return {replayed:true,reconciledReservations:receipt.reservations.length,availableAtReconciliation:receipt.availableAfter,retainedUnits:receipt.retainedUnits};};
    const prior=await receipts.findOne({_id:input.commandId});if(prior)return replay(prior);
    const startedAt=this.now(),cutoff=new Date(startedAt.getTime()-24*3600000),before=await db.collection<ProviderControl>('provider_controls').findOne({_id:'elevenlabs'});
    if(!before||!before.revision.equals(Long.fromNumber(input.expectedRevision)))throw fail('PROVIDER_STATE_CHANGED');
    const eligible=await this.proof(db,undefined,before,cutoff);if(!eligible.length)throw fail('NO_RECONCILABLE_RESERVATIONS');
    const observed=await this.gateway.observe('elevenlabs'),observedAt=this.now();
    if(observed.state!=='enabled'||observed.reasonCode||observed.periodId!==before.allowance.periodId||observed.remaining!==input.confirmedRemaining||observedAt.getTime()-startedAt.getTime()>60000)throw fail('PROVIDER_BALANCE_CHANGED');
    return databaseTransaction(this.client,this.name,async(db,session)=>{
      const duplicate=await db.collection<Receipt>('speech_allowance_reconciliations').findOne({_id:input.commandId},{session});if(duplicate)return replay(duplicate);
      const row=await db.collection<ProviderControl>('provider_controls').findOne({_id:'elevenlabs'},{session});
      if(!row||!isDeepStrictEqual(row,before)||!isDeepStrictEqual(await this.proof(db,session,row,cutoff),eligible)||this.now().getTime()-observedAt.getTime()>60000)throw fail('PROVIDER_STATE_CHANGED');
      const ids=new Set(eligible.map(r=>r.id)),retained=row.reservations.filter(r=>!ids.has(r.id)),held=retained.reduce((n,r)=>n+r.units,0);if(!Number.isSafeInteger(held))throw fail();
      const available=Math.max(0,observed.remaining!-held),receipt:Receipt={_id:input.commandId,requestHash,configHash:row.configHash,periodId:observed.periodId!,sourceRevision:row.revision,operatorConfirmedRemaining:input.confirmedRemaining,providerRemaining:observed.remaining!,availableAfter:available,retainedUnits:held,observedAt,createdAt:this.now(),reservations:eligible};
      await db.collection<Receipt>('speech_allowance_reconciliations').insertOne(receipt,{session});
      if(!(await db.collection<ProviderControl>('provider_controls').updateOne({_id:'elevenlabs',revision:row.revision,state:row.state,operatorDisabled:row.operatorDisabled??{$exists:false}},{$set:{reservations:retained,allowance:{...row.allowance,observedRemaining:available},checkedAt:observedAt,expiresAt:new Date(observedAt.getTime()+300000),languages:observed.languages,state:'enabled',reasonCode:null},$inc:{revision:Long.ONE}},{session})).matchedCount)throw fail('PROVIDER_STATE_CHANGED');
      return {replayed:false,reconciledReservations:eligible.length,availableAtReconciliation:available,retainedUnits:held};
    });
  }
}
