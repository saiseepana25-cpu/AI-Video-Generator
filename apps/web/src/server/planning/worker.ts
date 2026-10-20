import {randomUUID} from 'node:crypto';
import {Long, type ClientSession, type Db, type MongoClient} from 'mongodb';
import {databaseTransaction} from '../db/transactions';
import {providerConfig} from '../providers/config';
import type {Env, ProviderControl} from '../providers/contracts';
import type {ProjectRecord} from '../projects/service';
import {PlanningService, type Row} from './service';
import {PlanningFault, PlanningGateway} from './gateway';
import {validateOutput} from './validation';
import type {Job, Plan, PlanVersion, SafeError} from './contracts';
import {planningActivity} from './activity';
import {ProviderStore} from '../providers/store';

const terminalError = (code: string, retryable: boolean): SafeError => ({code, retryable,
  message: code === 'PROVIDER_OUTCOME_UNKNOWN' ? 'The provider outcome is unknown. Further requests are paused for operator review.' : code === 'FREE_ALLOWANCE_UNAVAILABLE' ? 'Free allowance is unavailable. Verify it before explicitly retrying.' : 'Planning did not finish. Review the brief and retry if available.'});
export class PlanningWorker {
  readonly owner = randomUUID();
  private db: Db;
  constructor(private client: MongoClient, private name: string, private env: Env, private gateway = new PlanningGateway(env)) {this.db = client.db(name);}
  async heartbeat() {
    const now = new Date();
    const result = await this.db.collection<Row>('worker_slots').updateOne({_id: 'planning:global', $or: [{owner: this.owner}, {expiresAt: {$lte: now}}]},
      {$set: {owner: this.owner, expiresAt: new Date(now.getTime() + 90000), heartbeatAt: now}}, {upsert: true}).catch(error => {
        if (error?.code === 11000) return null; throw error;
      });
    return !!result && !!(result.matchedCount || result.upsertedCount);
  }
  async release() {await this.db.collection<Row>('worker_slots').updateOne({_id: 'planning:global', owner: this.owner}, {$set: {expiresAt: new Date(0), heartbeatAt: new Date(0)}});}
  private async owns(db: Db, session: ClientSession) {
    // Writing the slot makes concurrent ownership changes conflict with finalization/submission.
    const r = await db.collection<Row>('worker_slots').updateOne({_id: 'planning:global', owner: this.owner, expiresAt: {$gt: new Date()}}, {$set: {heartbeatAt: new Date()}}, {session});
    if (!r.matchedCount) throw new Error('WORKER_OWNERSHIP_LOST');
  }
  async recoverExpired() {
    const expired = await this.db.collection<Job>('jobs').find({state: {$in: ['running', 'cancellation_requested']}, leaseUntil: {$lte: new Date()}}).limit(20).toArray();
    for (const job of expired) await this.finish(job, null, new PlanningFault('PROVIDER_OUTCOME_UNKNOWN', job.submission === 'submitted'), true);
  }
  async tick(): Promise<boolean> {
    if (!await this.heartbeat()) return false;
    await this.recoverExpired();
    // A replacement slot owner must wait for an older job's lease to expire and
    // classify its submitted outcome before dispatching any other request.
    if (await this.db.collection<Job>('jobs').findOne({state: {$in: ['running', 'cancellation_requested']}})) return false;
    const row = await this.db.collection<Job>('jobs').find({state: 'queued'}).sort({createdAt: 1, _id: 1}).limit(1).next();
    if (!row) return false;
    await new ProviderStore(this.db, this.env).refresh('gemini');
    const budget = await this.db.collection<Row>('planning_budget').findOne({_id: 'gemini'});
    if (budget && budget.nextRequestAt > new Date() && budget.expiresAt > new Date() && !budget.paused && !budget.uncertain) return false;
    const now = new Date(), attemptId = randomUUID();
    const claimed = await databaseTransaction(this.client, this.name, async (db, session) => {
      await this.owns(db, session);
      const job = await db.collection<Job>('jobs').findOne({_id: row._id, state: 'queued', statusRevision: row.statusRevision}, {session});
      if (!job) return null;
      const project = await db.collection<ProjectRecord>('projects').findOne({_id: job.projectId, workspaceId: job.workspaceId, deletedAt: null}, {session});
      const member = await db.collection('memberships').findOne({workspaceId: job.workspaceId, userId: job.userId, status: 'active'}, {session});
      if (!member || !project || !project.briefRevision.equals(job.sourceBriefRevision) || project.activePlanningJobId !== job._id || job.kind === 'plan' && project.planningRequestId !== job.requestId) {
        await db.collection<Job>('jobs').updateOne({_id: job._id}, {$set: {state: 'superseded', finishedAt: now, updatedAt: now}, $inc: {statusRevision: Long.ONE}}, {session});
        await db.collection<Row>('projects').updateOne({_id: job.projectId, activePlanningJobId: job._id}, {$set: {activePlanningJobId: null}, $inc: {guardRevision: Long.ONE}}, {session});
        return null;
      }
      const service = new PlanningService(this.client, this.name, {workspaceId: job.workspaceId, userId: job.userId, userName: ''}, this.env);
      try {await service.checkCapacity(db, session);} catch {
        await db.collection<Job>('jobs').updateOne({_id: job._id}, {$set: {state: 'paused', error: terminalError('FREE_ALLOWANCE_UNAVAILABLE', true), finishedAt: now, updatedAt: now}, $inc: {statusRevision: Long.ONE}}, {session});
        await db.collection<Row>('projects').updateOne({_id: job.projectId, activePlanningJobId: job._id}, {$set: {activePlanningJobId: null}, $inc: {guardRevision: Long.ONE}}, {session}); return null;
      }
      const config = providerConfig('gemini', this.env);
      const capacity = await db.collection<Row>('planning_budget').updateOne({_id: 'gemini', configHash: config.configHash, remaining: {$gt: 0}, expiresAt: {$gt: now}, nextRequestAt: {$lte: now}, paused: false, uncertain: false},
        {$inc: {remaining: -1, revision: Long.ONE}, $set: {nextRequestAt: new Date(now.getTime() + 60000)}}, {session});
      if (!capacity.matchedCount) return null;
      const gate = await db.collection<ProviderControl>('provider_controls').updateOne({_id: 'gemini', configHash: config.configHash, operatorDisabled: {$ne: true}, state: {$ne: 'disabled'}, reasonCode: {$in: [null, 'FREE_ALLOWANCE_UNVERIFIED']}}, {$inc: {revision: Long.ONE}}, {session});
      if (!gate.matchedCount) throw new Error('PROVIDER_POLICY_CHANGED');
      const next: Job = {...job, state: 'running', submission: 'submitted', attempt: job.attempt + 1, owner: this.owner,
        leaseUntil: new Date(now.getTime() + 90000), statusRevision: job.statusRevision.add(Long.ONE), startedAt: job.startedAt ?? now, updatedAt: now};
      await db.collection<Job>('jobs').replaceOne({_id: job._id}, next, {session});
      await db.collection<Row>('stage_attempts').insertOne({_id: attemptId, jobId: job._id, attempt: next.attempt, owner: this.owner, state: 'submitted', submittedAt: now, finishedAt: null}, {session});
      return next;
    });
    if (!claimed) return true;
    const controller = new AbortController(); let heartbeatBusy = false;
    const timer = setInterval(() => {
      if (heartbeatBusy) return; heartbeatBusy = true;
      void (async () => {
        if (!await this.heartbeat()) {controller.abort(); return;}
        const result = await this.db.collection<Job>('jobs').updateOne({_id: claimed._id, owner: this.owner, state: 'running', leaseUntil: {$gt: new Date()}}, {$set: {leaseUntil: new Date(Date.now() + 90000)}});
        if (!result.matchedCount) controller.abort();
      })().catch(() => controller.abort()).finally(() => {heartbeatBusy = false;});
    }, 10000);
    try {
      const raw = await this.gateway.generate(claimed.input, claimed.kind, controller.signal);
      let validated: ReturnType<typeof validateOutput>;
      try {validated = validateOutput(raw, claimed.input, claimed.kind);} catch {throw new PlanningFault('PROVIDER_INVALID_OUTPUT', false, true);}
      await this.finish(claimed, validated, null);
    } catch (error) {
      await this.finish(claimed, null, error instanceof PlanningFault ? error : new PlanningFault('PROVIDER_OUTCOME_UNKNOWN', true));
    } finally {clearInterval(timer);}
    return true;
  }
  private async finish(original: Job, output: ReturnType<typeof validateOutput> | null, fault: PlanningFault | null, recovery = false) {
    const now = new Date(), planId = randomUUID(), eventId = randomUUID(), config = providerConfig('gemini', this.env);
    await databaseTransaction(this.client, this.name, async (db, session) => {
      await this.owns(db, session);
      const job = await db.collection<Job>('jobs').findOne({_id: original._id, owner: original.owner, attempt: original.attempt,
        state: {$in: ['running', 'cancellation_requested']}, leaseUntil: recovery ? {$lte: now} : {$gt: now}}, {session});
      if (!job) return; // Expired/superseded owner can never finalize.
      const project = await db.collection<ProjectRecord>('projects').findOne({_id: job.projectId, workspaceId: job.workspaceId, deletedAt: null}, {session});
      const member = await db.collection('memberships').findOne({workspaceId: job.workspaceId, userId: job.userId, status: 'active'}, {session});
      const current = member && project && project.briefRevision.equals(job.sourceBriefRevision) && (job.kind === 'brainstorm' || project.planningRequestId === job.requestId) && project.activePlanningJobId === job._id;
      const uncertain = fault?.uncertain ?? false;
      if (uncertain) await db.collection<Row>('planning_budget').updateOne({_id: 'gemini'}, {$set: {paused: true, uncertain: true}, $inc: {revision: Long.ONE}}, {session});
      else if (fault && ['PROVIDER_RATE_LIMITED', 'PROVIDER_ACCESS_DENIED', 'FREE_ACCESS_UNVERIFIED'].includes(fault.code)) await db.collection<Row>('planning_budget').updateOne({_id: 'gemini'}, {$set: {paused: true}, $inc: {revision: Long.ONE}}, {session});
      await db.collection<Row>('stage_attempts').updateOne({jobId: job._id, attempt: job.attempt, state: 'submitted'}, {$set: {state: uncertain ? 'uncertain' : 'settled', finishedAt: now}}, {session});
      let state: Job['state'] = job.state === 'cancellation_requested' ? 'cancelled' : !current ? 'superseded' : fault ? uncertain ? 'paused' : 'failed' : 'ready';
      let result: Job['result'] = null;
      if (state === 'ready' && output && project) {
        if ('angles' in output) result = {...output, sourceBriefRevision: job.sourceBriefRevision.toNumber()};
        else {
          const versionNumber = (project.nextPlanVersionNumber as Long).add(Long.ONE);
          const version: PlanVersion = {_id: planId, schemaVersion: 1, workspaceId: job.workspaceId, projectId: job.projectId, versionNumber,
            sourceBriefRevision: job.sourceBriefRevision, sourcePlanningRequestId: job.requestId, inputHash: job.inputHash, settingsSnapshot: job.input.settings,
            plan: output as Plan, plannerModelId: config.model, promptContractVersion: 'educational-diagrams-v1', createdAt: now, createdBy: job.userId};
          await db.collection<PlanVersion>('plan_versions').insertOne(version, {session});
          await db.collection<Row>('projects').updateOne({_id: project._id, planningRequestId: job.requestId, briefRevision: job.sourceBriefRevision}, {$set: {currentPlanVersionId: planId, nextPlanVersionNumber: versionNumber}, $inc: {guardRevision: Long.ONE}}, {session});
          result = {planVersionId: planId};
        }
      }
      if (state === 'ready' && !result) state = 'failed';
      await db.collection<Job>('jobs').updateOne({_id: job._id, owner: job.owner, attempt: job.attempt}, {$set: {state, result,
        error: fault ? terminalError(fault.code, fault.retryable && !uncertain) : null, submission: uncertain ? 'uncertain' : 'settled', leaseUntil: null, finishedAt: now, updatedAt: now}, $inc: {statusRevision: Long.ONE}}, {session});
      await db.collection<Row>('projects').updateOne({_id: job.projectId, activePlanningJobId: job._id}, {$set: {activePlanningJobId: null}, $inc: {guardRevision: Long.ONE}}, {session});
      await planningActivity(db, session, job, eventId, now, state === 'ready' ? 'An AI planning result is ready for review.' : state === 'cancelled' ? 'Planning was cancelled.' : state === 'superseded' ? 'Planning was superseded by newer input.' : 'Planning stopped and needs review.');
    });
  }
}
