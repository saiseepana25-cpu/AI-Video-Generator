import {randomUUID} from 'node:crypto';
import {Long, type ClientSession, type Db, type MongoClient} from 'mongodb';
import {databaseTransaction} from '../db/transactions';
import type {Row} from '../planning/service';
import type {Env, ProviderControl} from '../providers/contracts';
import type {Observation} from '../providers/gateway';
import {digest, providerConfig} from '../providers/config';
import {canonicalJson, generationHash, RENDER_CONTRACT, validateRenderPlan, type RenderPlan} from '../rendering/contract';
import {requiredCapabilities, type Approval, type GenerationRun, type GenerationWorker as WorkerRow, type LocalArtifact, type SpeechAttempt} from './contracts';
import {GenerationFault, type GenerationEngine, type SpeechClip} from './engine';
import {closeGenerationReservation} from './reservation';

const activeStates = ['running', 'cancellation_requested'] as const;
const safeError = (code: string) => ({code, retryable: false as const, message: code === 'SPEECH_OUTCOME_UNKNOWN' ? 'Speech usage is uncertain. Further speech requests are paused for operator review.' : code === 'CANCELLED' ? 'Generation stopped. A submitted speech request may still consume free allowance.' : 'Video generation did not finish. Review the saved plan and provider/worker status before creating a new version.'});
export class GenerationWorker {
  readonly owner = randomUUID();
  private busy = false;
  private stopping = false;
  private controller: AbortController | null = null;
  constructor(private client: MongoClient, private name: string, private env: Env, private engine: GenerationEngine) {}
  private get db() {return this.client.db(this.name);}
  async heartbeat() {
    const spec = await this.engine.inspect(), now = new Date();
    if (!requiredCapabilities.every(c => this.engine.capabilities.includes(c))) throw new GenerationFault('ENGINE_NOT_CAPABLE');
    try {
      const result = await this.db.collection<WorkerRow>('generation_workers').updateOne({_id: 'generation:local', state: {$ne: 'disabled'}, $or: [{owner: this.owner}, {expiresAt: {$lte: now}}]},
        {$set: {owner: this.owner, state: this.stopping ? 'draining' : 'healthy', contract: RENDER_CONTRACT, compilerVersion: 'staged-diagrams-compiler-v1',
          rendererBuildHash: spec.rendererBuildHash, fonts: spec.fonts, capabilities: this.engine.capabilities, heartbeatAt: now, expiresAt: new Date(now.getTime() + 45000)}, $inc: {revision: Long.ONE}}, {upsert: true});
      return !!(result.matchedCount || result.upsertedCount);
    } catch (error) {if (error && typeof error === 'object' && 'code' in error && error.code === 11000) return false; throw error;}
  }
  async stop() {this.stopping = true; this.controller?.abort(); await this.db.collection<WorkerRow>('generation_workers').updateOne({_id: 'generation:local', owner: this.owner, state: 'healthy'}, {$set: {state: 'draining'}, $inc: {revision: Long.ONE}});}
  async release() {await this.db.collection<WorkerRow>('generation_workers').updateOne({_id: 'generation:local', owner: this.owner, state: {$ne: 'disabled'}}, {$set: {state: 'draining', expiresAt: new Date(0)}, $inc: {revision: Long.ONE}});}
  private async slot(db: Db, session: ClientSession) {
    const result = await db.collection<WorkerRow>('generation_workers').findOneAndUpdate({_id: 'generation:local', owner: this.owner, state: {$in: ['healthy', 'draining']}, expiresAt: {$gt: new Date()}}, {$inc: {revision: Long.ONE}}, {session, returnDocument: 'after'});
    if (!result) throw new GenerationFault('WORKER_OWNERSHIP_LOST'); return result;
  }
  private async owned(db: Db, session: ClientSession, run: GenerationRun, allowCancellation = false) {
    await this.slot(db, session);
    const row = await db.collection<GenerationRun>('generation_runs').findOne({_id: run._id, owner: this.owner, leaseEpoch: run.leaseEpoch, state: {$in: activeStates}, leaseUntil: {$gt: new Date()}}, {session});
    if (!row) throw new GenerationFault('WORKER_OWNERSHIP_LOST');
    if (row.state === 'cancellation_requested' && !allowCancellation) throw new GenerationFault('CANCELLED');
    if (!allowCancellation) {
      const project = await db.collection<Row>('projects').updateOne({_id: row.projectId, workspaceId: row.workspaceId, deletedAt: null, latestRunId: row._id}, {$inc: {guardRevision: Long.ONE}}, {session});
      if (!project.matchedCount) throw new GenerationFault('PROJECT_UNAVAILABLE');
    }
    // Every submission/finalization touches the lease, fencing concurrent recovery/cancellation.
    await db.collection<GenerationRun>('generation_runs').updateOne({_id: row._id}, {$set: {leaseUntil: new Date(Date.now() + 90000)}}, {session}); return row;
  }
  private async finishWithin(db: Db, session: ClientSession, run: GenerationRun, code: string | null, artifact?: LocalArtifact) {
    const pending = await db.collection<SpeechAttempt>('generation_speech_attempts').find({runId: run._id, state: 'submitted'}, {session}).toArray();
    const unknown = pending.length > 0 || code === 'SPEECH_OUTCOME_UNKNOWN';
    if (code === 'SPEECH_ACCESS_REFUSED' || code === 'FREE_SPEECH_UNAVAILABLE') {
      await db.collection<ProviderControl>('provider_controls').updateOne({_id: 'elevenlabs', configHash: run.providerConfigHash, state: {$ne: 'disabled'}}, {$set: {state: 'paused', reasonCode: code}, $inc: {revision: Long.ONE}}, {session});
    }
    if (pending.length) await db.collection<SpeechAttempt>('generation_speech_attempts').updateMany({runId: run._id, state: 'submitted'}, {$set: {state: 'uncertain', finishedAt: new Date()}}, {session});
    await closeGenerationReservation(db, session, run, unknown ? 'uncertain' : (run.submissionCount ?? 0) ? 'settled' : 'unused');
    const cancelled = run.state === 'cancellation_requested' || code === 'CANCELLED';
    const state = cancelled ? 'cancelled' : code || unknown ? 'failed' : 'rendered_local', now = new Date();
    const error = unknown ? safeError('SPEECH_OUTCOME_UNKNOWN') : code ? safeError(code) : null;
    if (artifact && state === 'rendered_local') await db.collection<LocalArtifact>('generation_local_artifacts').insertOne(artifact, {session});
    await db.collection<GenerationRun>('generation_runs').updateOne({_id: run._id}, {$set: {state, finishedAt: now, updatedAt: now, owner: null, leaseUntil: null,
      leaseEpoch: run.leaseEpoch ?? Long.ZERO, startedAt: run.startedAt ?? null, stage: run.stage ?? 'plan_validation', submissionCount: run.submissionCount ?? 0,
      artifactId: state === 'rendered_local' ? artifact!._id : null, error}, $inc: {statusRevision: Long.ONE}}, {session});
    await db.collection<Row>('projects').updateOne({_id: run.projectId, workspaceId: run.workspaceId, latestRunId: run._id}, {$set: {latestRunId: null, updatedAt: now, updatedBy: {kind: 'system', service: 'generation-worker'}}, $inc: {revision: Long.ONE, guardRevision: Long.ONE}}, {session});
    const workspace = await db.collection<Row>('workspaces').findOneAndUpdate({_id: run.workspaceId}, {$inc: {nextActivitySequence: Long.ONE}}, {session, returnDocument: 'after'});
    if (!workspace) throw new GenerationFault('WORKSPACE_UNAVAILABLE');
    await db.collection<Row>('activity_events').insertOne({_id: randomUUID(), schemaVersion: 1, workspaceId: run.workspaceId, projectId: run.projectId, sequence: workspace.nextActivitySequence,
      dedupeKey: `generation:${run._id}:${state}`, type: 'generation_changed', actor: {kind: 'user', userId: run.createdBy}, resourceRefs: {projectId: run.projectId},
      message: state === 'rendered_local' ? 'The video was rendered and validated locally. Media delivery is pending.' : state === 'cancelled' ? 'Video generation stopped.' : 'Video generation needs review.',
      actionNeeded: false, safeActionRoute: `/projects/${run.projectId}`, createdAt: now}, {session});
  }
  async recoverExpired() {
    return databaseTransaction(this.client, this.name, async (db, session) => {
      await this.slot(db, session);
      const expired = await db.collection<GenerationRun>('generation_runs').find({state: {$in: activeStates}, leaseUntil: {$lte: new Date()}}, {session}).limit(20).toArray();
      for (const run of expired) await this.finishWithin(db, session, run, 'WORKER_INTERRUPTED');
      return expired.length;
    });
  }
  private async claim() {
    return databaseTransaction(this.client, this.name, async (db, session) => {
      const slot = await this.slot(db, session); if (this.stopping || slot.state !== 'healthy') return null;
      if (await db.collection<GenerationRun>('generation_runs').findOne({state: {$in: activeStates}}, {session})) return null;
      const run = await db.collection<GenerationRun>('generation_runs').findOne({state: 'queued'}, {session, sort: {createdAt: 1, _id: 1}}); if (!run) return null;
      const project = await db.collection<Row>('projects').findOne({_id: run.projectId, workspaceId: run.workspaceId, deletedAt: null, latestRunId: run._id}, {session});
      const approval = await db.collection<Approval>('approvals').findOne({_id: run.approvalId, workspaceId: run.workspaceId, projectId: run.projectId, planVersionId: run.planVersionId, inputHash: run.inputHash, settingsSnapshotHash: run.settingsSnapshotHash}, {session});
      let plan: RenderPlan | null = null;
      try {plan = approval && validateRenderPlan(JSON.parse(approval.inputCanonical));} catch { /* Invalid immutable input is a terminal correction, never executable. */ }
      if (!project || !plan || generationHash(plan) !== run.inputHash || digest(canonicalJson(plan.settingsSnapshot)) !== run.settingsSnapshotHash || run.rendererBuildHash !== slot.rendererBuildHash || canonicalJson(Object.fromEntries(plan.settingsSnapshot.brand.fonts.map(f => [f.role, f.sha256]))) !== canonicalJson(slot.fonts)) {
        await this.finishWithin(db, session, run, 'APPROVAL_OR_WORKER_CHANGED'); return null;
      }
      const next: GenerationRun = {...run, state: 'running', owner: this.owner, leaseEpoch: (run.leaseEpoch ?? Long.ZERO).add(Long.ONE), leaseUntil: new Date(Date.now() + 90000),
        startedAt: new Date(), stage: 'plan_validation', submissionCount: 0, artifactId: null, error: null, statusRevision: run.statusRevision.add(Long.ONE), updatedAt: new Date()};
      await db.collection<GenerationRun>('generation_runs').replaceOne({_id: run._id, state: 'queued'}, next, {session}); return {run: next, plan};
    });
  }
  private async beginSpeech(run: GenerationRun, plan: RenderPlan, segmentId: string, observation: Observation) {
    const id = randomUUID();
    return databaseTransaction(this.client, this.name, async (db, session) => {
      const current = await this.owned(db, session, run), config = providerConfig('elevenlabs', this.env);
      const row = await db.collection<ProviderControl>('provider_controls').findOne({_id: 'elevenlabs'}, {session});
      const held = row?.reservations.find(r => r.id === run.reservationId && r.state === 'reserved');
      const units = plan.narration.reduce((n, s) => n + s.text.length * 2 + 100, 0), allHeld = row?.reservations.reduce((n, r) => n + r.units, 0) ?? 0;
      const settled = await db.collection<SpeechAttempt>('generation_speech_attempts').find({runId: run._id, state: 'settled'}, {session}).toArray();
      const settledIds = new Set(settled.map(a => a.segmentId));
      const alreadyConsumed = plan.narration.filter(n => settledIds.has(n.segmentId)).reduce((sum, n) => sum + n.text.length * 2 + 100, 0);
      if (this.stopping || !row || !held || held.units < units || row.operatorDisabled || row.state !== 'enabled' || row.reasonCode || row.configHash !== run.providerConfigHash || config.configHash !== run.providerConfigHash || row.allowance.periodId !== run.reservationPeriodId
        || row.reservations.some(r => r.state === 'uncertain') || !row.tests.some(t => t.language === plan.language) || observation.state !== 'enabled' || observation.reasonCode || observation.remaining === null || observation.remaining < Math.max(0, allHeld - alreadyConsumed) || !observation.languages.includes(plan.language) || observation.periodId !== run.reservationPeriodId) throw new GenerationFault('FREE_SPEECH_UNAVAILABLE');
      const now = new Date();
      // Keep the entire conservative hold in the public net balance, including
      // known consumed phrases. Delayed provider accounting cannot release it
      // to another job. Only this run's settled phrases reduce its send gate.
      await db.collection<ProviderControl>('provider_controls').updateOne({_id: row._id, revision: row.revision, operatorDisabled: {$ne: true}, state: 'enabled'}, {$inc: {revision: Long.ONE}, $set: {checkedAt: now, expiresAt: new Date(now.getTime() + 300000), 'allowance.observedRemaining': Math.max(0, observation.remaining - allHeld)}}, {session});
      const text = plan.narration.find(n => n.segmentId === segmentId)!.text;
      await db.collection<SpeechAttempt>('generation_speech_attempts').insertOne({_id: id, runId: run._id, workspaceId: run.workspaceId, segmentId, inputHash: run.inputHash, textHash: digest(text), providerConfigHash: run.providerConfigHash,
        owner: this.owner, leaseEpoch: run.leaseEpoch!, state: 'submitted', audioHash: null, byteLength: null, sampleRate: null, createdAt: now, finishedAt: null}, {session});
      await db.collection<GenerationRun>('generation_runs').updateOne({_id: run._id}, {$set: {stage: 'speech', updatedAt: now}, $inc: {statusRevision: Long.ONE, submissionCount: 1}}, {session});
      return {id, count: (current.submissionCount ?? 0) + 1};
    });
  }
  async tick() {
    if (this.busy || this.stopping) return false; this.busy = true;
    try {
      if (!await this.heartbeat()) return false; await this.recoverExpired();
      const claimed = await this.claim(); if (!claimed) return false;
      const {run, plan} = claimed, controller = new AbortController(); this.controller = controller; let heartbeatBusy = false;
      const timer = setInterval(() => {
        if (heartbeatBusy) return; heartbeatBusy = true;
        void (async () => {
          if (!await this.heartbeat()) {controller.abort(); return;}
          const result = await this.db.collection<GenerationRun>('generation_runs').findOneAndUpdate({_id: run._id, owner: this.owner, leaseEpoch: run.leaseEpoch, state: {$in: activeStates}, leaseUntil: {$gt: new Date()}}, {$set: {leaseUntil: new Date(Date.now() + 90000)}}, {returnDocument: 'after'});
          if (!result || result.state === 'cancellation_requested') controller.abort();
        })().catch(() => controller.abort()).finally(() => {heartbeatBusy = false;});
      }, 10000);
      try {
        const clips: SpeechClip[] = [];
        for (const segment of plan.narration) {
          const observation = await this.engine.observe();
          const attempt = await this.beginSpeech(run, plan, segment.segmentId, observation);
          let audio;
          try {audio = await this.engine.speech(plan, segment.segmentId, controller.signal);}
          catch (error) {
            if (error instanceof GenerationFault && !error.unknown) await databaseTransaction(this.client, this.name, async (db, session) => {await this.owned(db, session, run, true); await db.collection<SpeechAttempt>('generation_speech_attempts').updateOne({_id: attempt.id, state: 'submitted'}, {$set: {state: 'refused', finishedAt: new Date()}}, {session});});
            throw error;
          }
          const saved = await this.engine.persistSpeech(run._id, attempt.id, audio);
          await databaseTransaction(this.client, this.name, async (db, session) => {
            await this.owned(db, session, run, true);
            await db.collection<SpeechAttempt>('generation_speech_attempts').updateOne({_id: attempt.id, owner: this.owner, leaseEpoch: run.leaseEpoch, state: 'submitted'}, {$set: {state: 'settled', ...saved, sampleRate: audio.sampleRate, finishedAt: new Date()}}, {session});
          });
          clips.push({segmentId: segment.segmentId, text: segment.text, audio, source: {provider: 'elevenlabs', model: plan.settingsSnapshot.speech.model, voiceId: plan.settingsSnapshot.speech.voiceId}});
        }
        const currentSpec = await this.engine.inspect(); if (currentSpec.rendererBuildHash !== run.rendererBuildHash) throw new GenerationFault('RENDERER_CHANGED');
        await databaseTransaction(this.client, this.name, async (db, session) => {await this.owned(db, session, run); await db.collection<GenerationRun>('generation_runs').updateOne({_id: run._id}, {$set: {stage: 'rendering', updatedAt: new Date()}, $inc: {statusRevision: Long.ONE}}, {session});});
        const result = await this.engine.render(run._id, plan, run.inputHash, clips, controller.signal);
        if (result.rendererBuildHash !== run.rendererBuildHash) throw new GenerationFault('RENDERER_CHANGED');
        await databaseTransaction(this.client, this.name, async (db, session) => {
          const current = await this.owned(db, session, run);
          const project = await db.collection<Row>('projects').findOne({_id: run.projectId, workspaceId: run.workspaceId, deletedAt: null, latestRunId: run._id}, {session});
          if (!project) throw new GenerationFault('PROJECT_UNAVAILABLE');
          await this.finishWithin(db, session, current, null, {...result, runId: run._id, workspaceId: run.workspaceId, approvalId: run.approvalId, inputHash: run.inputHash, createdAt: new Date()});
        });
      } catch (error) {
        try {await databaseTransaction(this.client, this.name, async (db, session) => {
          const current = await this.owned(db, session, run, true);
          await this.finishWithin(db, session, current, error instanceof GenerationFault ? error.code : 'GENERATION_INTERRUPTED');
        });} catch (finishError) {if (!(finishError instanceof GenerationFault && finishError.code === 'WORKER_OWNERSHIP_LOST')) throw finishError;}
      } finally {clearInterval(timer); controller.abort(); this.controller = null;}
      return true;
    } finally {this.busy = false;}
  }
}
