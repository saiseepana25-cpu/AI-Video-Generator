import {randomUUID} from 'node:crypto';
import {Long, type ClientSession, type Db, type Document, type MongoClient} from 'mongodb';
import {databaseTransaction} from '../db/transactions';
import {digest, providerConfig} from '../providers/config';
import {isOperatorDisabled, type Env, type ProviderControl} from '../providers/contracts';
import {ProjectError, requireProjectId, type ProjectContext} from '../projects/contracts';
import {requireIdempotencyKey} from '../projects/validation';
import type {ProjectRecord} from '../projects/service';
import {jobView, type Job, type Kind, type PlanVersion} from './contracts';
import {planningPrompt, revisionInput} from './validation';
import {planningActivity} from './activity';
import {ProviderStore} from '../providers/store';

export type Row = Document & {_id: string};
const fail = (code: string, status: number, message: string) => new ProjectError(code, status, message);
export const unavailable = () => fail('FREE_ALLOWANCE_UNAVAILABLE', 503, 'Planning is paused. Ask the operator to verify the remaining free allowance.');
export const accepted = (job: Job) => ({jobId: job._id, kind: job.kind, state: job.state, statusUrl: `/api/v1/jobs/${job._id}`, sourceBriefRevision: job.sourceBriefRevision.toNumber(), pollAfterSeconds: 3});

export class PlanningService {
  readonly db: Db;
  constructor(private client: MongoClient, private name: string, private context: ProjectContext, private env: Env) {this.db = client.db(name);}
  private async authorize(db = this.db, session?: ClientSession) {
    if (!await db.collection('memberships').findOne({workspaceId: this.context.workspaceId, userId: this.context.userId, status: 'active'}, {session})) throw fail('TEAM_ACCESS_DENIED', 403, 'This account does not have team access.');
  }
  private async project(id: string, db = this.db, session?: ClientSession) {
    const row = await db.collection<ProjectRecord>('projects').findOne({_id: id, workspaceId: this.context.workspaceId, deletedAt: null}, {session});
    if (!row) throw fail('RESOURCE_NOT_FOUND', 404, 'This project could not be found.'); return row;
  }
  async job(id: string) {
    await this.authorize(); requireProjectId(id);
    const row = await this.db.collection<Job>('jobs').findOne({_id: id, workspaceId: this.context.workspaceId});
    if (!row) throw fail('RESOURCE_NOT_FOUND', 404, 'This job could not be found.');
    await this.project(row.projectId); return jobView(row);
  }
  async plan(id: string) {
    await this.authorize(); requireProjectId(id);
    const row = await this.db.collection<PlanVersion>('plan_versions').findOne({_id: id, workspaceId: this.context.workspaceId});
    if (!row) throw fail('RESOURCE_NOT_FOUND', 404, 'This plan could not be found.');
    const project = await this.project(row.projectId);
    const isCurrent = project.currentPlanVersionId === row._id && project.briefRevision.equals(row.sourceBriefRevision) && project.planningRequestId === row.sourcePlanningRequestId;
    return {id: row._id, projectId: row.projectId, versionNumber: row.versionNumber.toNumber(), sourceBriefRevision: row.sourceBriefRevision.toNumber(),
      plan: row.plan, settingsSnapshot: row.settingsSnapshot, inputHash: row.inputHash, isCurrent, canGenerate: false,
      blockedReasons: [{code: isCurrent ? 'REVIEW_NOT_IMPLEMENTED' : 'PLAN_OUTDATED', message: isCurrent ? 'Plan editing and approval are the next feature.' : 'The saved brief has changed. Prepare a new plan.'}]};
  }
  async overview(id: string) {
    await this.authorize(); requireProjectId(id); const project = await this.project(id);
    const latest = await this.db.collection<Job>('jobs').find({projectId: id, workspaceId: this.context.workspaceId}).sort({createdAt: -1, _id: -1}).limit(1).next();
    return {job: latest ? jobView(latest) : null, plan: project.currentPlanVersionId ? await this.plan(project.currentPlanVersionId) : null};
  }
  async checkCapacity(db = this.db, session?: ClientSession) {
    const now = new Date(), config = providerConfig('gemini', this.env);
    if (!config.key || !config.confirmedFree || !config.reviewed) throw unavailable();
    const provider = await db.collection<ProviderControl>('provider_controls').findOne({_id: 'gemini'}, {session});
    if (!provider || provider.expiresAt <= now || provider.configHash !== config.configHash || isOperatorDisabled(provider) || !['FREE_ALLOWANCE_UNVERIFIED', null].includes(provider.reasonCode)) throw unavailable();
    const budget = await db.collection<Row>('planning_budget').findOne({_id: 'gemini', configHash: config.configHash, expiresAt: {$gt: now}, remaining: {$gt: 0}, paused: false, uncertain: false}, {session});
    if (!budget) throw unavailable();
  }
  private async worker(db: Db, session: ClientSession) {
    if (!await db.collection<Row>('worker_slots').findOne({_id: 'planning:global', expiresAt: {$gt: new Date()}, heartbeatAt: {$gt: new Date(Date.now() - 30000)}}, {session})) throw fail('WORKER_UNAVAILABLE', 503, 'Start the local planning worker, then try again.');
  }
  async command(projectId: string | null, jobId: string | null, action: Kind | 'cancel' | 'retry', raw: unknown, key: string) {
    await this.authorize(); requireIdempotencyKey(key); requireProjectId((projectId ?? jobId)!);
    const revision = revisionInput(raw, projectId ? 'expectedProjectRevision' : 'expectedRevision');
    const scope = `${action}:${projectId ?? jobId}`, now = new Date(), id = randomUUID(), requestId = randomUUID(), receiptId = randomUUID(), eventId = randomUUID();
    const identity = {workspaceId: this.context.workspaceId, userId: this.context.userId, scope, keyHash: digest(key)}, requestHash = digest(JSON.stringify({revision}));
    const replay = async (db: Db, session?: ClientSession) => {
      const row = await db.collection<Row>('planning_commands').findOne(identity, {session});
      if (!row) return null;
      if (row.requestHash !== requestHash) throw fail('IDEMPOTENCY_MISMATCH', 409, 'This request key was used with different input.');
      const job = await db.collection<Job>('jobs').findOne({_id: row.jobId, workspaceId: this.context.workspaceId}, {session});
      if (!job) throw fail('RESOURCE_NOT_FOUND', 404, 'This job could not be found.');
      await this.project(job.projectId, db, session); return row.snapshot;
    };
    const prior = await replay(this.db); if (prior) return prior;
    if (action !== 'cancel') await new ProviderStore(this.db, this.env).refresh('gemini');
    const transaction = async () => databaseTransaction(this.client, this.name, async (db, session) => {
      await this.authorize(db, session); const previous = await replay(db, session); if (previous) return previous;
      let row: Job;
      if (projectId) {
        const project = await this.project(projectId, db, session);
        if (!project.revision.equals(Long.fromNumber(revision))) throw fail('STALE_REVISION', 409, 'Reload the latest saved brief before planning.');
        if (project.activePlanningJobId) throw fail('PLANNING_IN_PROGRESS', 409, 'A planning job is already active.');
        const input = {brief: project.brief, settings: project.settings}; planningPrompt(input, action as Kind);
        await this.worker(db, session); await this.checkCapacity(db, session);
        row = {_id: id, schemaVersion: 1, workspaceId: this.context.workspaceId, projectId, userId: this.context.userId, kind: action as Kind,
          keyHash: digest(key), requestHash, requestId, inputHash: digest(JSON.stringify(input)), sourceBriefRevision: project.briefRevision, input,
          state: 'queued', statusRevision: Long.ONE, attempt: 0, submission: 'none', owner: null, leaseUntil: null,
          createdAt: now, updatedAt: now, startedAt: null, finishedAt: null, result: null, error: null};
        await db.collection<Job>('jobs').insertOne(row, {session});
        await db.collection<Row>('projects').updateOne({_id: projectId, workspaceId: this.context.workspaceId, revision: project.revision}, {$set: {activePlanningJobId: id, ...(action === 'plan' ? {planningRequestId: requestId} : {})}, $inc: {guardRevision: Long.ONE}}, {session});
      } else {
        const existing = await db.collection<Job>('jobs').findOne({_id: jobId!, workspaceId: this.context.workspaceId}, {session});
        if (!existing) throw fail('RESOURCE_NOT_FOUND', 404, 'This job could not be found.'); row = existing;
        const project = await this.project(row.projectId, db, session);
        if (!row.statusRevision.equals(Long.fromNumber(revision))) throw fail('STALE_REVISION', 409, 'Refresh the job before changing it.');
        if (action === 'retry') {
          if (!jobView(row).allowedActions.includes('retry')) throw fail('RETRY_UNAVAILABLE', 409, 'This request cannot safely be retried.');
          const latest = await db.collection<Job>('jobs').find({workspaceId: row.workspaceId, projectId: row.projectId}, {session}).sort({createdAt: -1, _id: -1}).limit(1).next();
          if (!project.briefRevision.equals(row.sourceBriefRevision) || row.kind === 'plan' && project.planningRequestId !== row.requestId || latest?._id !== row._id || project.activePlanningJobId && project.activePlanningJobId !== row._id) throw fail('PLAN_OUTDATED', 409, 'The brief changed or a newer request exists. Prepare a new plan.');
          await this.worker(db, session); await this.checkCapacity(db, session);
          row = {...row, state: 'queued', error: null, submission: 'none', finishedAt: null, owner: null, leaseUntil: null};
          await db.collection<Row>('projects').updateOne({_id: project._id}, {$set: {activePlanningJobId: row._id}, $inc: {guardRevision: Long.ONE}}, {session});
        } else {
          if (!['queued', 'running'].includes(row.state)) throw fail('CANCEL_UNAVAILABLE', 409, 'This job is already finished or cancellation is pending.');
          row = {...row, state: row.state === 'queued' ? 'cancelled' : 'cancellation_requested'};
          if (row.state === 'cancelled') {row.finishedAt = now; await db.collection<Row>('projects').updateOne({_id: project._id, activePlanningJobId: row._id}, {$set: {activePlanningJobId: null}, $inc: {guardRevision: Long.ONE}}, {session});}
        }
        row.updatedAt = now; row.statusRevision = row.statusRevision.add(Long.ONE);
        await db.collection<Job>('jobs').replaceOne({_id: row._id, statusRevision: existing.statusRevision}, row, {session});
      }
      const snapshot = accepted(row);
      await planningActivity(db, session, row, eventId, now, action === 'cancel' ? 'Planning cancellation was requested.' : action === 'retry' ? 'Planning was explicitly retried.' : 'A planning request was saved.');
      await db.collection<Row>('planning_commands').insertOne({_id: receiptId, ...identity, requestHash, jobId: row._id, snapshot, createdAt: now}, {session});
      return snapshot;
    });
    try {return await transaction();} catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 11000) {await this.authorize(); const previous = await replay(this.db); if (previous) return previous;}
      throw error;
    }
  }
}
