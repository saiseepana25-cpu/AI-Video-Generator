import type {MongoClient} from 'mongodb';
import {databaseTransaction} from '../db/transactions';
import type {ProjectContext} from '../projects/contracts';
import type {Row} from '../planning/service';
import {providerConfig} from '../providers/config';
import {isOperatorDisabled,type Env,type ProviderControl} from '../providers/contracts';
import {activityScope} from './service';
import type {Operations,RecoveryItem} from './contracts';

export function recoveryMessage(kind:RecoveryItem['kind'],code:unknown,expiredRender=false){
  if(expiredRender)return 'The renderer stopped reporting. An operator must confirm that it has stopped before recovering its slot. Do not start a replacement render.';
  if(code==='NARRATION_DURATION_EXCEEDED')return 'Narration is too long. Shorten it, save and check a new plan version, then approve that version before generating again.';
  if(code==='NARRATION_TOO_SHORT')return 'Narration is too short for this duration without long pauses. Expand the plan or choose a shorter supported target, then save, check and approve a new version.';
  if(code==='TEXT_LAYOUT_EXCEEDED')return 'Video text does not fit. Shorten narration, headings or diagram labels, save and check a new version, then approve it.';
  if(code==='LAYOUT_CHECK_UNAVAILABLE')return 'The local font/layout check could not finish. No speech was requested. Ask the operator to verify the fonts and browser.';
  if(code==='SPEECH_OUTCOME_UNKNOWN'||code==='PROVIDER_OUTCOME_UNKNOWN')return 'A provider request has an uncertain outcome. Ask the operator to review usage; do not repeat it blindly.';
  if(kind==='storage')return 'Private video storage needs review. Ask the operator to check storage status; a storage retry must not regenerate speech or video.';
  return kind==='planning'?'Planning needs review. Open the saved idea to inspect its current status and available recovery actions.':'Video generation needs review. Open the saved plan and current status before preparing another version.';
}
export class OperationsService{
  constructor(private client:MongoClient,private name:string,private context:ProjectContext,private env:Env){}
  async read():Promise<Operations>{
    return databaseTransaction(this.client,this.name,async(db,session)=>{
      await activityScope(db,session,this.context);const now=new Date();
      const worker=await db.collection<Row>('generation_workers').findOne({_id:'generation:local'},{session}),planning=await db.collection<Row>('worker_slots').findOne({_id:'planning:global'},{session});
      const fresh=(row:Row|null)=>!!row&&row.heartbeatAt instanceof Date&&row.heartbeatAt.getTime()>now.getTime()-30000&&row.expiresAt>now;
      const providers:Operations['providers']=[];
      for(const id of ['gemini','elevenlabs'] as const){
        const config=providerConfig(id,this.env),row=await db.collection<ProviderControl>('provider_controls').findOne({_id:id},{session});
        let state:Operations['providers'][number]['state']='unverified',message='Free availability needs a current operator or provider check.';
        if(isOperatorDisabled(row)){state='disabled';message='Disabled by the operator. Refreshing availability cannot enable it.';}
        else if(row?.reservations.some(r=>r.state==='uncertain')){state='paused';message='Usage is uncertain. Operator review is required before further requests.';}
        else if(config.key&&config.reviewed&&config.confirmedFree&&row?.configHash===config.configHash&&row.expiresAt>now){
          if(row.state==='enabled'&&!row.reasonCode){state=(row.allowance.observedRemaining??0)>0?'observed':'exhausted';message=state==='observed'?'Free evaluation availability was observed. Each request still runs its own checks.':'No verified free allowance remains.';}
          else{state='paused';message='Requests are paused. Review availability in the project or ask the operator.';}
        }
        if(id==='gemini'&&state==='observed'){
          const budget=await db.collection<Row>('planning_budget').findOne({_id:'gemini'},{session});
          if(!budget||budget.configHash!==config.configHash||budget.expiresAt<=now||budget.paused||budget.uncertain){state='unverified';message='A current free-request quota check is required. Refreshing the connection cannot confirm Google quota.';}
          else if(budget.remaining<1){state='exhausted';message='No verified free planning requests remain.';}
        }
        providers.push({id,state,message});
      }
      const generationWaiting=await db.collection('generation_runs').countDocuments({workspaceId:this.context.workspaceId,state:'queued'},{session});
      const planningWaiting=await db.collection('jobs').countDocuments({workspaceId:this.context.workspaceId,state:'queued'},{session});
      // Expired render leases still occupy a slot until executor-stop evidence exists.
      const activeRenders=await db.collection('generation_runs').countDocuments({state:{$in:['running','cancellation_requested']},stage:{$in:['rendering','validating']}},{session});
      const recent=await db.collection<Row>('activity_events').find({workspaceId:this.context.workspaceId},{session,projection:{projectId:1}}).sort({sequence:-1}).limit(50).toArray();
      const ids=[...new Set(recent.map(r=>r.projectId).filter((id):id is string=>typeof id==='string'))].slice(0,10);
      const projects=await db.collection<Row>('projects').find({_id:{$in:ids},workspaceId:this.context.workspaceId,deletedAt:null},{session,projection:{displayTitle:1,currentPlanVersionId:1,briefRevision:1}}).toArray(),items:RecoveryItem[]=[];
      for(const project of projects){
        const add=(row:Row,kind:RecoveryItem['kind'],code:unknown,expired=false)=>items.push({id:`${kind}:${row._id}`,projectId:project._id,projectTitle:project.displayTitle,kind,message:recoveryMessage(kind,code,expired),actionLabel:'Review project',safeActionRoute:`/projects/${project._id}`});
        const run=await db.collection<Row>('generation_runs').findOne({workspaceId:this.context.workspaceId,projectId:project._id},{session,sort:{createdAt:-1,_id:-1},projection:{state:1,stage:1,leaseUntil:1,planVersionId:1,sourceBriefRevision:1,error:1}});
        if(run&&run.planVersionId===project.currentPlanVersionId&&run.sourceBriefRevision.equals(project.briefRevision)){
          const expired=['running','cancellation_requested'].includes(run.state)&&['rendering','validating'].includes(run.stage)&&run.leaseUntil<=now;
          if(run.state==='failed'||expired)add(run,'generation',run.error?.code,expired);
          if(run.state==='rendered_local'){
            const bundle=await db.collection<Row>('generation_storage_bundles').findOne({workspaceId:this.context.workspaceId,projectId:project._id,runId:run._id},{session,projection:{state:1}});
            if(bundle?.state==='failed')add(bundle,'storage',null);
          }
        }
        for(const kind of ['plan','brainstorm']){
          const job=await db.collection<Row>('jobs').findOne({workspaceId:this.context.workspaceId,projectId:project._id,kind},{session,sort:{createdAt:-1,_id:-1},projection:{state:1,error:1,sourceBriefRevision:1}});
          if(job&&['failed','paused'].includes(job.state)&&job.sourceBriefRevision.equals(project.briefRevision))add(job,'planning',job.error?.code);
        }
      }
      return {checkedAt:now.toISOString(),worker:{state:!worker?'not_started':worker.state==='disabled'?'disabled':worker.state==='draining'?'draining':fresh(worker)?'healthy':'stale',lastSeenAt:worker?.heartbeatAt?.toISOString()??null,renderCapacity:1,activeRenders},
        planningWorker:{state:!planning?'not_started':fresh(planning)?'healthy':'stale',lastSeenAt:planning?.heartbeatAt?.toISOString()??null},providers,queues:{generationWaiting,planningWaiting,publishingNeedsReview:null},scheduling:{enabled:false,reasonCode:'NOT_IMPLEMENTED'},recovery:{items,scope:'recent_projects'}};
    });
  }
}
