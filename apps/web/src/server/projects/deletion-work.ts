import {Long,type ClientSession,type Db,type Document} from 'mongodb';
import type {Job} from '../planning/contracts';
import type {GenerationRun} from '../generation/contracts';
import type {ProviderControl} from '../providers/contracts';
import {closeGenerationReservation} from '../generation/reservation';
import type {ProjectRecord} from './service';
import {ProjectError} from './contracts';
import type {DeletionImpact} from './deletion';
type Row=Document&{_id:string};
const bounded=(n:Long)=>{if(!Long.isLong(n)||n.isNegative()||n.greaterThan(Long.fromNumber(Number.MAX_SAFE_INTEGER)))throw new ProjectError('DELETE_UNAVAILABLE',409,'Stored work counters need operator review.');return n.toNumber();};
const empty=(value:unknown)=>value===undefined||value===null;
export async function inspectDeletionWork(db:Db,session:ClientSession,source:ProjectRecord){
  const scope={workspaceId:source.workspaceId,projectId:source._id},blocked='Running, previously started, uncertain or unstored work needs resolution before deletion. Expired leases do not prove an executor stopped.';
  const jobs=await db.collection<Job>('jobs').find({...scope,$or:[{state:{$nin:['ready','failed','cancelled','superseded']}},{submission:{$in:['submitted','uncertain']}}]},{session}).limit(51).toArray();
  const runs=await db.collection<GenerationRun>('generation_runs').find({...scope,state:{$nin:['cancelled','failed','rendered_local']}},{session}).limit(51).toArray();
  let reason:string|null=null;
  if(jobs.length>50||runs.length>50)reason='Too many unresolved jobs. Resolve work before deleting.';
  const planning=jobs.filter(j=>j.state==='queued'&&j.submission==='none'&&j.attempt===0&&j.owner===null&&j.leaseUntil===null&&j.startedAt===null&&j.finishedAt===null);
  const generation=runs.filter(r=>r.state==='queued'&&(r.submissionCount===undefined||r.submissionCount===0)&&empty(r.owner)&&empty(r.leaseUntil)&&empty(r.startedAt)&&r.finishedAt===null&&empty(r.artifactId)&&(r.stage===undefined||r.stage==='plan_validation')&&(r.leaseEpoch===undefined||Long.isLong(r.leaseEpoch)&&r.leaseEpoch.isZero()));
  if(planning.length!==jobs.length||generation.length!==runs.length)reason=blocked;
  if(source.activePlanningJobId&&!planning.some(j=>j._id===source.activePlanningJobId)||source.latestRunId&&!generation.some(r=>r._id===source.latestRunId))reason=blocked;
  if(planning.length&&await db.collection('stage_attempts').findOne({jobId:{$in:planning.map(j=>j._id)}},{session,projection:{_id:1}}))reason=blocked;
  if(generation.length){
    if(await db.collection('generation_speech_attempts').findOne({runId:{$in:generation.map(r=>r._id)}},{session,projection:{_id:1}}))reason=blocked;
    const provider=await db.collection<ProviderControl>('provider_controls').findOne({_id:'elevenlabs'},{session});
    if(generation.some(run=>{const held=provider?.reservations.find(r=>r.id===run.reservationId);return held&&held.state!=='reserved';}))reason=blocked;
  }
  if(await db.collection('generation_storage_bundles').findOne({...scope,state:{$ne:'stored'}},{session,projection:{_id:1}}))reason=blocked;
  const unstored=await db.collection<Row>('generation_runs').aggregate([
    {$match:{...scope,state:'rendered_local'}},{$lookup:{from:'generation_storage_bundles',localField:'_id',foreignField:'runId',as:'bundles'}},
    {$match:{bundles:{$not:{$elemMatch:{...scope,state:'stored'}}}}},{$limit:1},{$project:{_id:1}},
  ],{session}).next();
  if(unstored)reason=blocked;
  if(await db.collection('publishing_intents').findOne(scope,{session,projection:{_id:1}}))reason='Publishing work must be resolved before this project can be deleted.';
  const impact:DeletionImpact={projectId:source._id,projectRevision:bounded(source.revision),workRevision:bounded(source.guardRevision),queuedPlanning:planning.length,queuedGenerations:generation.length,canDelete:reason===null,blockReason:reason};
  return {impact,planning,generation};
}
export async function cancelUnstartedDeletionWork(db:Db,session:ClientSession,work:Awaited<ReturnType<typeof inspectDeletionWork>>,now:Date){
  for(const job of work.planning){
    if(bounded(job.statusRevision)>=Number.MAX_SAFE_INTEGER)throw new ProjectError('DELETE_UNAVAILABLE',409,'A work counter has reached its limit.');
    const update=await db.collection<Job>('jobs').updateOne({_id:job._id,workspaceId:job.workspaceId,projectId:job.projectId,state:'queued',statusRevision:job.statusRevision,submission:'none',attempt:0,owner:null,leaseUntil:null,startedAt:null},{$set:{state:'cancelled',updatedAt:now,finishedAt:now},$inc:{statusRevision:Long.ONE}},{session});
    if(!update.matchedCount)throw new ProjectError('STALE_WORK',409,'Work changed. Reload and review before deleting.');
  }
  for(const run of work.generation){
    if(bounded(run.statusRevision)>=Number.MAX_SAFE_INTEGER)throw new ProjectError('DELETE_UNAVAILABLE',409,'A work counter has reached its limit.');
    await closeGenerationReservation(db,session,run,'unused');
    const update=await db.collection<GenerationRun>('generation_runs').updateOne({_id:run._id,workspaceId:run.workspaceId,projectId:run.projectId,state:'queued',statusRevision:run.statusRevision},{$set:{state:'cancelled',updatedAt:now,finishedAt:now},$inc:{statusRevision:Long.ONE}},{session});
    if(!update.matchedCount)throw new ProjectError('STALE_WORK',409,'Work changed. Reload and review before deleting.');
  }
}
