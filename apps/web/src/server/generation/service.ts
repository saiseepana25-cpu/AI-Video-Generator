import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {Long, type ClientSession, type Db, type MongoClient} from 'mongodb';
import {approvalInput} from '../../lib/generation-command';
import {databaseTransaction} from '../db/transactions';
import type {PlanVersion} from '../planning/contracts';
import type {Row} from '../planning/service';
import {revisionInput} from '../planning/validation';
import {ProjectError, requireProjectId, type ProjectContext} from '../projects/contracts';
import type {ProjectRecord} from '../projects/service';
import {requireIdempotencyKey} from '../projects/validation';
import {voiceCatalog} from '../providers/catalog';
import {digest, providerConfig} from '../providers/config';
import type {Env, ProviderControl} from '../providers/contracts';
import {loadFontPins} from '../rendering/assets';
import {buildRenderPlan, canonicalJson, generationHash, type FontPins} from '../rendering/contract';
import {RenderInputService} from '../rendering/service';
import {compatibleWorker, readGenerationWorker, workerUnavailable} from './capability';
import {generationView, type Approval, type GenerationRun, type GenerationView, type GenerationWorker} from './contracts';
import {closeGenerationReservation} from './reservation';

const fail = (code: string, status: number, message: string) => new ProjectError(code, status, message);
type Receipt = {_id: string; workspaceId: string; userId: string; scope: string; keyHash: string; requestHash: string; projectId: string; runId: string; snapshotCanonical: string; createdAt: Date};

/** Admission only. External calls and file reads never occur in a transaction.
 * Runs double as generation jobs; the planning worker cannot consume them.
 */
export class GenerationService {
  constructor(private client: MongoClient, private name: string, private context: ProjectContext, private env: Env, private assets: () => Promise<FontPins> = loadFontPins) {}
  private async authorize(db: Db, session?: ClientSession, fence = false) {
    const query = {workspaceId: this.context.workspaceId, userId: this.context.userId, status: 'active'};
    const member = fence ? (await db.collection('memberships').updateOne(query, {$inc: {generationGuardRevision: Long.ONE}}, {session})).matchedCount : await db.collection('memberships').findOne(query, {session});
    if (!member) throw fail('TEAM_ACCESS_DENIED', 403, 'This account does not have team access.');
  }
  private async project(db: Db, id: string, session?: ClientSession) {
    const row = await db.collection<ProjectRecord>('projects').findOne({_id: id, workspaceId: this.context.workspaceId, deletedAt: null}, {session});
    if (!row) throw fail('RESOURCE_NOT_FOUND', 404, 'This project could not be found.');
    return row;
  }
  async job(id: string) {
    requireProjectId(id);
    return databaseTransaction(this.client, this.name, async (db, session) => {
      await this.authorize(db, session);
      const run = await db.collection<GenerationRun>('generation_runs').findOne({jobId: id, workspaceId: this.context.workspaceId}, {session});
      if (!run) return null;
      return generationView(run, (await this.project(db, run.projectId, session)).revision.toNumber());
    });
  }
  async overview(id: string) {
    requireProjectId(id);
    return databaseTransaction(this.client, this.name, async (db, session) => {
      await this.authorize(db, session); const project = await this.project(db, id, session);
      const run = await db.collection<GenerationRun>('generation_runs').findOne({projectId: id, workspaceId: this.context.workspaceId}, {session, sort: {createdAt: -1, _id: -1}});
      return {job: run ? generationView(run, project.revision.toNumber()) : null};
    });
  }
  private identity(scope: string, key: string) {return {workspaceId: this.context.workspaceId, userId: this.context.userId, scope, keyHash: digest(key)};}
  private async replay(db: Db, session: ClientSession, identity: ReturnType<GenerationService['identity']>, requestHash: string) {
    const receipt = await db.collection<Receipt>('generation_commands').findOne(identity, {session});
    if (!receipt) return null;
    if (receipt.requestHash !== requestHash) throw fail('IDEMPOTENCY_MISMATCH', 409, 'This request key was used for different generation input.');
    await this.project(db, receipt.projectId, session);
    return {job: JSON.parse(receipt.snapshotCanonical) as GenerationView, replayed: true};
  }
  private async receipt(db: Db, session: ClientSession, identity: ReturnType<GenerationService['identity']>, requestHash: string, run: GenerationRun, job: GenerationView) {
    await db.collection<Receipt>('generation_commands').insertOne({_id: randomUUID(), ...identity, requestHash, projectId: run.projectId, runId: run._id, snapshotCanonical: canonicalJson(job), createdAt: new Date()}, {session});
  }
  private async event(db: Db, session: ClientSession, run: GenerationRun, message: string) {
    const workspace = await db.collection<Row>('workspaces').findOneAndUpdate({_id: this.context.workspaceId}, {$inc: {nextActivitySequence: Long.ONE}}, {session, returnDocument: 'after'});
    if (!workspace) throw new Error('WORKSPACE_UNAVAILABLE');
    await db.collection<Row>('activity_events').insertOne({_id: randomUUID(), schemaVersion: 1, workspaceId: this.context.workspaceId, projectId: run.projectId,
      sequence: workspace.nextActivitySequence, dedupeKey: `generation:${run._id}:${run.state}`, type: 'generation_changed', actor: {kind: 'user', userId: this.context.userId},
      resourceRefs: {projectId: run.projectId}, message, actionNeeded: false, safeActionRoute: `/projects/${run.projectId}`, createdAt: new Date()}, {session});
  }
  async approve(projectId: string, raw: unknown, key: string) {
    requireProjectId(projectId); requireIdempotencyKey(key);
    if (raw && typeof raw === 'object' && !Array.isArray(raw) && !('expectedProjectRevision' in raw)) throw fail('PRECONDITION_REQUIRED', 428, 'Include the reviewed project revision.');
    const input = approvalInput(raw);
    if (!input) throw fail('INVALID_INPUT', 422, 'Provide the reviewed project revision, plan ID and video input hash.');
    const identity = this.identity(`approve:${projectId}`, key), requestHash = digest(canonicalJson(input));
    const prior = async (db: Db, session: ClientSession) => {
      await this.authorize(db, session); const project = await this.project(db, projectId, session);
      const replay = await this.replay(db, session, identity, requestHash); if (replay) return replay;
      const existing = await db.collection<GenerationRun>('generation_runs').findOne({workspaceId: this.context.workspaceId, projectId, planVersionId: input.planVersionId, inputHash: input.generationInputHash}, {session});
      if (!existing) return null;
      await this.authorize(db, session, true);
      const job = generationView(existing, project.revision.toNumber());
      await this.receipt(db, session, identity, requestHash, existing, job);
      return {job, replayed: true};
    };
    // A retry must work even when assets/providers/workers later become unavailable.
    const previous = await databaseTransaction(this.client, this.name, prior); if (previous) return previous;
    let prepared;
    try {prepared = await new RenderInputService(this.client, this.name, this.context, this.env, this.assets).prepare(input.planVersionId);}
    catch (error) {const concurrent = await databaseTransaction(this.client, this.name, prior); if (concurrent) return concurrent; throw error;}
    if (prepared.version.projectId !== projectId) throw fail('RESOURCE_NOT_FOUND', 404, 'This plan could not be found.');
    if (!prepared.plan || prepared.generationInputHash !== input.generationInputHash) throw fail('PLAN_INPUT_CHANGED', 409, 'Check the current video plan and approve its exact input.');
    const pins = Object.fromEntries(prepared.plan.settingsSnapshot.brand.fonts.map(f => [f.role, f.sha256])) as FontPins;
    return databaseTransaction(this.client, this.name, async (db, session) => {
      const previous = await prior(db, session); if (previous) return previous;
      await this.authorize(db, session, true);
      const project = await this.project(db, projectId, session);
      const version = await db.collection<PlanVersion>('plan_versions').findOne({_id: input.planVersionId, projectId, workspaceId: this.context.workspaceId}, {session});
      if (!version || !project.revision.equals(Long.fromNumber(input.expectedProjectRevision)) || project.currentPlanVersionId !== version._id || !project.briefRevision.equals(version.sourceBriefRevision)
        || project.planningRequestId !== version.sourcePlanningRequestId || !isDeepStrictEqual(project.settings, version.settingsSnapshot)) throw fail('STALE_REVISION', 409, 'The project changed. Review and check its current plan before approval.');
      if (project.activePlanningJobId || project.latestRunId) throw fail('GENERATION_IN_PROGRESS', 409, 'Finish or cancel the active work before approving a video.');
      if (project.revision.toNumber() >= Number.MAX_SAFE_INTEGER) throw fail('REVISION_LIMIT', 409, 'This project has reached its revision limit.');
      if (digest(JSON.stringify({brief: project.brief, settings: version.settingsSnapshot})) !== version.inputHash) throw fail('PLAN_SOURCE_MISMATCH', 409, 'Prepare a new plan for the current source.');
      const plan = buildRenderPlan(version.plan, project.brief, version.settingsSnapshot, pins), hash = generationHash(plan);
      if (hash !== input.generationInputHash) throw fail('PLAN_INPUT_CHANGED', 409, 'The video input changed. Review it before approval.');
      const now = new Date(), worker = await readGenerationWorker(db, session);
      if (!compatibleWorker(worker, plan, now)) throw fail(workerUnavailable.code, 503, workerUnavailable.message);
      const speech = await db.collection<ProviderControl>('provider_controls').findOne({_id: 'elevenlabs'}, {session});
      const voice = voiceCatalog({language: plan.language, accentId: plan.settingsSnapshot.accentId, intendedUse: 'evaluation', includeUnavailable: true}, speech ? [speech] : [], this.env, now).items.find(v => v.id === plan.settingsSnapshot.voiceCatalogId);
      const units = plan.narration.reduce((n, s) => n + s.text.length * 2 + 100, 0);
      if (!speech || !voice?.available || speech.reservations.some(r => r.state === 'uncertain') || speech.reservations.length >= 100 || (speech.allowance.observedRemaining ?? 0) < units) throw fail('SPEECH_RESERVATION_UNAVAILABLE', 503, 'Refresh free speech availability and resolve any uncertain usage before generation.');
      const runId = randomUUID(), approvalId = randomUUID(), reservationId = randomUUID();
      const reserved = await db.collection<ProviderControl>('provider_controls').updateOne({_id: 'elevenlabs', revision: speech.revision, state: 'enabled', operatorDisabled: {$ne: true}, configHash: providerConfig('elevenlabs', this.env).configHash, expiresAt: {$gt: now}},
        {$inc: {'allowance.observedRemaining': -units, revision: Long.ONE}, $push: {reservations: {id: reservationId, units, state: 'reserved', createdAt: now}}}, {session});
      if (!reserved.matchedCount) throw fail('SPEECH_RESERVATION_UNAVAILABLE', 503, 'Speech availability changed. Check again before generation.');
      const claimed = await db.collection<GenerationWorker>('generation_workers').updateOne({_id: worker!._id, revision: worker!.revision, owner: worker!.owner, state: 'healthy', expiresAt: {$gt: now}}, {$inc: {revision: Long.ONE}}, {session});
      if (!claimed.matchedCount) throw fail(workerUnavailable.code, 503, workerUnavailable.message);
      const settingsSnapshotHash = digest(canonicalJson(plan.settingsSnapshot)), revision = project.revision.add(Long.ONE);
      const approval: Approval = {_id: approvalId, schemaVersion: 1, workspaceId: this.context.workspaceId, projectId, planVersionId: version._id, inputHash: hash, settingsSnapshotHash,
        sourceBriefRevision: version.sourceBriefRevision, approvedProjectRevision: project.revision, inputCanonical: canonicalJson(plan), approvedAt: now, approvedBy: this.context.userId};
      const run: GenerationRun = {_id: runId, schemaVersion: 1, workspaceId: this.context.workspaceId, projectId, planVersionId: version._id, approvalId, jobId: randomUUID(), inputHash: hash,
        settingsSnapshotHash, sourceBriefRevision: version.sourceBriefRevision, providerConfigHash: speech.configHash, reservationId, reservationPeriodId: speech.allowance.periodId,
        rendererBuildHash: worker!.rendererBuildHash, state: 'queued', statusRevision: Long.ONE, createdAt: now, updatedAt: now, finishedAt: null, createdBy: this.context.userId};
      await db.collection<Approval>('approvals').insertOne(approval, {session}); await db.collection<GenerationRun>('generation_runs').insertOne(run, {session});
      await db.collection<Row>('projects').updateOne({_id: projectId, workspaceId: this.context.workspaceId, revision: project.revision, deletedAt: null}, {$set: {latestRunId: runId, updatedAt: now, updatedBy: {kind: 'user', userId: this.context.userId}}, $inc: {revision: Long.ONE, guardRevision: Long.ONE}}, {session});
      const job = generationView(run, revision.toNumber()); await this.receipt(db, session, identity, requestHash, run, job); await this.event(db, session, run, 'The reviewed video plan was approved and queued.');
      return {job, replayed: false};
    });
  }
  async cancel(id: string, raw: unknown, key: string) {
    requireProjectId(id); requireIdempotencyKey(key); const input = {expectedRevision: revisionInput(raw, 'expectedRevision')};
    const identity = this.identity(`cancel:${id}`, key), requestHash = digest(canonicalJson(input));
    return databaseTransaction(this.client, this.name, async (db, session) => {
      await this.authorize(db, session); const previous = await this.replay(db, session, identity, requestHash); if (previous) return previous;
      const run = await db.collection<GenerationRun>('generation_runs').findOne({jobId: id, workspaceId: this.context.workspaceId}, {session});
      if (!run) throw fail('RESOURCE_NOT_FOUND', 404, 'This generation could not be found.');
      const project = await this.project(db, run.projectId, session);
      if (run.statusRevision.toNumber() !== input.expectedRevision) throw fail('STALE_REVISION', 409, 'Generation status changed. Refresh before cancelling.');
      if (!['queued', 'running', 'cancellation_requested'].includes(run.state)) throw fail('CANCELLATION_UNAVAILABLE', 409, 'This generation is already finished.');
      await this.authorize(db, session, true);
      if (run.state !== 'queued') {
        const next: GenerationRun = run.state === 'cancellation_requested' ? run : {...run, state: 'cancellation_requested', statusRevision: run.statusRevision.add(Long.ONE), updatedAt: new Date()};
        if (run.state === 'running') {
          await db.collection<GenerationRun>('generation_runs').replaceOne({_id: run._id, state: 'running', statusRevision: run.statusRevision}, next, {session});
          await this.event(db, session, next, 'Video cancellation was requested. Submitted speech can still consume allowance.');
        }
        const job = generationView(next, project.revision.toNumber()); await this.receipt(db, session, identity, requestHash, next, job); return {job, replayed: false};
      }
      const now = new Date();
      await closeGenerationReservation(db, session, run, 'unused');
      await db.collection<GenerationRun>('generation_runs').updateOne({_id: run._id, state: 'queued', statusRevision: run.statusRevision}, {$set: {state: 'cancelled', updatedAt: now, finishedAt: now}, $inc: {statusRevision: Long.ONE}}, {session});
      const clearsPointer = project.latestRunId === run._id;
      if (project.revision.toNumber() >= Number.MAX_SAFE_INTEGER) throw fail('REVISION_LIMIT', 409, 'This project has reached its revision limit.');
      await db.collection<Row>('projects').updateOne({_id: project._id, revision: project.revision, deletedAt: null}, {$set: {...(clearsPointer ? {latestRunId: null} : {}), updatedAt: now, updatedBy: {kind: 'user', userId: this.context.userId}}, $inc: {revision: Long.ONE, guardRevision: Long.ONE}}, {session});
      const cancelled: GenerationRun = {...run, state: 'cancelled', updatedAt: now, finishedAt: now, statusRevision: run.statusRevision.add(Long.ONE)};
      const job = generationView(cancelled, project.revision.toNumber() + 1);
      await this.receipt(db, session, identity, requestHash, cancelled, job); await this.event(db, session, cancelled, 'The queued video was cancelled before generation started.');
      return {job, replayed: false};
    });
  }
}
