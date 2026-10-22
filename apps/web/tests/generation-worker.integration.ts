import {after, before, beforeEach, describe, test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Long, MongoClient, type Db} from 'mongodb';
import {databaseClientOptions} from '../src/server/db/connection';
import {checkDatabase, migrateDatabase} from '../src/server/db/migrations';
import {GenerationService} from '../src/server/generation/service';
import {GenerationWorker} from '../src/server/generation/worker';
import {GenerationFault, type GenerationEngine, type MeasuredSpeech} from '../src/server/generation/engine';
import {requiredCapabilities, type GenerationRun, type SpeechAttempt, type GenerationWorker as WorkerRow} from '../src/server/generation/contracts';
import type {PlanVersion} from '../src/server/planning/contracts';
import type {ProviderControl} from '../src/server/providers/contracts';
import {digest} from '../src/server/providers/config';
import {generationHash,buildRenderPlan} from '../src/server/rendering/contract';
import {membershipFixture, projectFixture, workspaceFixture, testWorkspaceId, testUserId, type Row} from './fixtures/database';
import {providerEnv, providerFixture} from './fixtures/providers';
import {pins, renderFixture} from './fixtures/rendering';
import {StorageService} from '../src/server/storage/service';
import {storageKinds, StorageFault, type StorageBundle, type StorageKind, type StorageObject} from '../src/server/storage/contracts';
import {sha256, verifyObject} from '../src/server/storage/r2';
import {VideoService, promoteStoredVideo} from '../src/server/videos/service';
import type {ReadyVideo} from '../src/server/videos/contracts';
import {VideoHistoryService} from '../src/server/videos/history';
import {RevisionReviewService} from '../src/server/planning/revision-review';
import {PlanEditService} from '../src/server/planning/plan-edit-service';

const uri = process.env.MONGODB_TEST_URI ?? 'mongodb://127.0.0.1:27028/?replicaSet=vcF03';
if (!/^mongodb:\/\/(127\.0\.0\.1|localhost):\d+\/(?:\?[^\s]*)?$/.test(uri)) throw new Error('Isolated loopback database required.');
const name = `videocraft_f10_test_${randomUUID().replaceAll('-', '')}`, client = new MongoClient(uri, databaseClientOptions), context = {workspaceId: testWorkspaceId, userId: testUserId, userName: 'Tester'};
const audio = (): MeasuredSpeech => ({sampleRate: 24000, samples: Float32Array.from({length: 24000}, (_, i) => Math.sin(i / 10) * .2)});
const deferred = <T>() => {let resolve!: (value: T) => void; const promise = new Promise<T>(r => {resolve = r;}); return {promise, resolve};};
class FakeEngine implements GenerationEngine {
  capabilities = requiredCapabilities; build = 'd'.repeat(64); speechCalls = 0; renderCalls = 0; remaining = 10000;
  beforeObservation?: () => Promise<void>; duringSpeech?: () => Promise<MeasuredSpeech>; duringRender?: () => Promise<void>; persistFailure = false; renderFailure = false;
  reuseEnabled=false; reuseReads=0; duringRead?:()=>Promise<MeasuredSpeech>;
  readSpeech=async()=>{this.reuseReads++;if(!this.reuseEnabled)throw new Error('missing');return this.duringRead?this.duringRead():audio();};
  inspect = async () => ({rendererBuildHash: this.build, fonts: pins});
  observe = async () => {await this.beforeObservation?.(); return {state: 'enabled' as const, reasonCode: null, languages: ['en', 'te'] as ('en'|'te')[], remaining: this.remaining, periodId: 'test-period'};};
  speech = async () => {this.speechCalls++; return this.duringSpeech ? this.duringSpeech() : audio();};
  persistSpeech = async () => {if (this.persistFailure) throw new Error('disk'); return {audioHash: 'e'.repeat(64), byteLength: 48044};};
  render = async () => {this.renderCalls++; await this.duringRender?.(); if (this.renderFailure) throw new Error('render'); return {_id: randomUUID(), rendererBuildHash: this.build, manifestHash: 'f'.repeat(64), media: {width: 1080, height: 1920, videoCodec: 'h264', audioCodec: 'aac', durationSeconds: 30.016, audioSampleRate: 48000, meanVolumeDb: -20.1}};};
}
describe('generation worker ownership, submission fencing and recovery', {concurrency: false}, () => {
  let db: Db, engine: FakeEngine, worker: GenerationWorker, service: GenerationService, projectId: string, planId: string;
  before(async () => {await client.connect(); db = client.db(name); await migrateDatabase(db);});
  beforeEach(async () => {
    for (const n of ['projects', 'workspaces', 'memberships', 'provider_controls', 'plan_versions', 'plan_edit_commands', 'activity_events', 'approvals', 'generation_runs', 'generation_workers', 'generation_commands', 'generation_speech_attempts', 'generation_speech_reuses', 'generation_local_artifacts', 'generation_storage_bundles', 'ready_videos', 'video_assets']) await db.collection(n).deleteMany({});
    await db.collection<Row>('workspaces').insertOne(workspaceFixture()); await db.collection<Row>('memberships').insertOne(membershipFixture());
    const provider = providerFixture(); provider.allowance.observedRemaining = 10000; await db.collection<ProviderControl>('provider_controls').insertOne(provider);
    const f = renderFixture(), project = projectFixture(); planId = randomUUID(); projectId = project._id;
    project.brief = {...f.brief, idea: 'Explain water'}; project.settings = f.settings; project.currentPlanVersionId = project.planningRequestId = planId; project.nextPlanVersionNumber = Long.ONE;
    await db.collection<Row>('projects').insertOne(project);
    await db.collection<PlanVersion>('plan_versions').insertOne({_id: planId, schemaVersion: 1, workspaceId: testWorkspaceId, projectId, versionNumber: Long.ONE, sourceBriefRevision: Long.ONE, sourcePlanningRequestId: planId,
      inputHash: digest(JSON.stringify({brief: project.brief, settings: project.settings})), settingsSnapshot: f.settings, plan: f.proposal, plannerModelId: 'test-model', promptContractVersion: 'educational-diagrams-v1', createdAt: new Date(), createdBy: testUserId});
    engine = new FakeEngine(); worker = new GenerationWorker(client, name, providerEnv, engine); assert.equal(await worker.heartbeat(), true);
    service = new GenerationService(client, name, context, providerEnv, async () => pins);
  });
  after(async () => {try {if (!/^videocraft_f10_test_[a-f0-9]{32}$/.test(name)) throw new Error('Unsafe cleanup'); await db.dropDatabase();} finally {await client.close();}});
  const body = () => ({expectedProjectRevision: 1, planVersionId: planId, generationInputHash: generationHash(renderFixture().plan)});
  const approve = () => service.approve(projectId, body(), randomUUID());
  const run = () => db.collection<GenerationRun>('generation_runs').findOne({projectId});
  const provider = () => db.collection<ProviderControl>('provider_controls').findOne({_id: 'elevenlabs'});
  async function approveRevision(changeNarration=false){
    const project=(await db.collection<Row>('projects').findOne({_id:projectId}))!;
    const edited=await new PlanEditService(client,name,context).edit(planId,{expectedProjectRevision:project.revision.toNumber(),edits:changeNarration?{narration:[{segmentId:'scene_1',text:'Clouds form above rivers.'}]}:{headings:[{sceneId:'scene_1',text:'A clearer diagram'}]}},randomUUID());
    const current=(await db.collection<Row>('projects').findOne({_id:projectId}))!;
    const result=await service.approve(projectId,{expectedProjectRevision:current.revision.toNumber(),planVersionId:edited.plan.id,generationInputHash:generationHash(buildRenderPlan(edited.plan.plan,current.brief,current.settings,pins))},randomUUID());
    return (await db.collection<GenerationRun>('generation_runs').findOne({_id:result.job.generationRunId}))!;
  }
  async function cancelCurrent() {const current = (await run())!; return service.cancel(current.jobId, {expectedRevision: current.statusRevision.toNumber()}, randomUUID());}
  test('one worker owns the slot and explicit disabled policy survives expiry/startup', async () => {
    const other = new GenerationWorker(client, name, providerEnv, new FakeEngine()); assert.equal(await other.heartbeat(), false);
    await db.collection<WorkerRow>('generation_workers').updateOne({_id: 'generation:local'}, {$set: {state: 'disabled', expiresAt: new Date(0)}});
    assert.equal(await worker.heartbeat(), false); assert.equal(await other.heartbeat(), false); assert.equal(engine.speechCalls, 0);
    assert.equal((await db.collection<WorkerRow>('generation_workers').findOne({}))!.state, 'disabled');
  });
  test('approved input produces three settled attempts and one local artifact, not a ready/public video', async () => {
    const accepted = await approve(); assert.equal(await worker.tick(), true);
    const current = (await run())!; assert.equal(current.state, 'rendered_local'); assert.equal(current.submissionCount, 3); assert.equal(current.owner, null);
    const attempts = await db.collection<SpeechAttempt>('generation_speech_attempts').find({runId: current._id}).toArray(); assert.equal(attempts.length, 3); assert.ok(attempts.every(a => a.state === 'settled' && a.audioHash));
    assert.equal(await db.collection('generation_local_artifacts').countDocuments(), 1); assert.equal(engine.speechCalls, 3); assert.equal(engine.renderCalls, 1);
    assert.equal((await provider())!.reservations[0].state, 'settled'); assert.ok((await provider())!.reservations[0].units > 0);
    assert.equal((await db.collection<Row>('projects').findOne({_id: projectId}))!.latestRunId, null);
    const view = await service.job(accepted.job.jobId); assert.equal(view!.result, null); assert.equal(JSON.stringify(view).includes('localArtifact'), false); assert.equal(view!.allowedActions.length, 0); await checkDatabase(db);
  });
  test('verified speech reuse avoids all new submissions for a visual-only revision and refunds its unused hold',async()=>{
    await approve();await worker.tick();const first=(await run())!,remaining=(await provider())!.allowance.observedRemaining;
    engine.reuseEnabled=true;const next=await approveRevision();await worker.tick();
    const completed=(await db.collection<GenerationRun>('generation_runs').findOne({_id:next._id}))!;
    assert.equal(completed.state,'rendered_local');assert.equal(completed.submissionCount,0);assert.equal(engine.speechCalls,3);assert.equal(engine.renderCalls,2);
    const refs=await db.collection<Row>('generation_speech_reuses').find({runId:next._id}).toArray();assert.equal(refs.length,3);assert.ok(refs.every(r=>r.sourceRunId===first._id&&r.sourceAttemptId&&r.audioHash==='e'.repeat(64)));
    assert.equal(await db.collection('generation_speech_attempts').countDocuments({runId:next._id}),0);
    assert.equal((await provider())!.allowance.observedRemaining,remaining);assert.equal((await provider())!.reservations.some(r=>r.id===next.reservationId),false);
    await assert.rejects(db.collection<Row>('generation_speech_reuses').insertOne({...refs[0],_id:randomUUID()}), (e:unknown)=>!!e&&typeof e==='object'&&'code'in e&&e.code===11000);
  });
  test('verified speech reuse synthesizes only changed narration and never counts reused phrases as submissions',async()=>{
    await approve();await worker.tick();engine.reuseEnabled=true;const next=await approveRevision(true);await worker.tick();
    const completed=(await db.collection<GenerationRun>('generation_runs').findOne({_id:next._id}))!;
    assert.equal(completed.state,'rendered_local');assert.equal(completed.submissionCount,1);assert.equal(engine.speechCalls,4);
    assert.equal(await db.collection('generation_speech_reuses').countDocuments({runId:next._id}),2);
    assert.equal(await db.collection('generation_speech_attempts').countDocuments({runId:next._id,state:'settled'}),1);
    assert.equal((await provider())!.reservations.find(r=>r.id===next.reservationId)!.state,'settled');
  });
  test('missing or corrupt reusable audio follows normal approved synthesis without a false reuse receipt',async()=>{
    await approve();await worker.tick();const next=await approveRevision();await worker.tick();
    assert.equal((await db.collection<GenerationRun>('generation_runs').findOne({_id:next._id}))!.state,'rendered_local');assert.equal(engine.speechCalls,6);assert.equal(await db.collection('generation_speech_reuses').countDocuments(),0);
  });
  test('reuse refuses changed source provider configuration',async()=>{
    await approve();await worker.tick();const first=(await run())!;engine.reuseEnabled=true;
    await db.collection<GenerationRun>('generation_runs').updateOne({_id:first._id},{$set:{providerConfigHash:'b'.repeat(64)}});
    const next=await approveRevision();await worker.tick();assert.equal(engine.speechCalls,6);assert.equal(await db.collection('generation_speech_reuses').countDocuments({runId:next._id}),0);
  });
  test('reuse never imports speech from a different project even for identical narration',async()=>{
    await approve();await worker.tick();const first=(await run())!,other=projectFixture();await db.collection<Row>('projects').insertOne(other);engine.reuseEnabled=true;
    await db.collection<GenerationRun>('generation_runs').updateOne({_id:first._id},{$set:{projectId:other._id}});
    const next=await approveRevision();await worker.tick();assert.equal(engine.speechCalls,6);assert.equal(await db.collection('generation_speech_reuses').countDocuments({runId:next._id}),0);
  });
  test('operator disablement during reusable audio retrieval fences reuse and new speech',async()=>{
    await approve();await worker.tick();engine.reuseEnabled=true;const next=await approveRevision();
    engine.duringRead=async()=>{await db.collection<ProviderControl>('provider_controls').updateOne({_id:'elevenlabs'},{$set:{operatorDisabled:true,state:'disabled'}});return audio();};
    await worker.tick();assert.equal((await db.collection<GenerationRun>('generation_runs').findOne({_id:next._id}))!.state,'failed');assert.equal(engine.speechCalls,3);assert.equal(await db.collection('generation_speech_reuses').countDocuments(),0);
  });
  test('cancellation during reusable audio retrieval wins before reuse receipt or render',async()=>{
    await approve();await worker.tick();engine.reuseEnabled=true;const next=await approveRevision();
    engine.duringRead=async()=>{const live=(await db.collection<GenerationRun>('generation_runs').findOne({_id:next._id}))!;await service.cancel(live.jobId,{expectedRevision:live.statusRevision.toNumber()},randomUUID());return audio();};
    await worker.tick();assert.equal((await db.collection<GenerationRun>('generation_runs').findOne({_id:next._id}))!.state,'cancelled');assert.equal(engine.speechCalls,3);assert.equal(engine.renderCalls,1);assert.equal(await db.collection('generation_speech_reuses').countDocuments(),0);
  });
  test('source settlement changes after retrieval refuse reuse without silently submitting speech',async()=>{
    await approve();await worker.tick();engine.reuseEnabled=true;const first=(await run())!,next=await approveRevision();
    engine.duringRead=async()=>{await db.collection<SpeechAttempt>('generation_speech_attempts').updateOne({runId:first._id,segmentId:'segment_scene_1'},{$set:{state:'uncertain'}});return audio();};
    await worker.tick();assert.equal((await db.collection<GenerationRun>('generation_runs').findOne({_id:next._id}))!.state,'failed');assert.equal(engine.speechCalls,3);assert.equal(await db.collection('generation_speech_reuses').countDocuments(),0);
  });
  test('overlapping ticks and competing workers cannot duplicate submissions or local artifacts', async () => {
    await approve(); const secondEngine = new FakeEngine(), second = new GenerationWorker(client, name, providerEnv, secondEngine);
    await Promise.all([worker.tick(), worker.tick(), second.tick()]); assert.equal(engine.speechCalls, 3); assert.equal(secondEngine.speechCalls, 0); assert.equal(await db.collection('generation_local_artifacts').countDocuments(), 1);
    await worker.tick(); assert.equal(engine.speechCalls, 3);
  });
  test('a fully reserved account can finish its phrases without releasing consumed holds to other jobs', async () => {
    const plan = renderFixture().plan, phrase = plan.narration[0].text.length * 2 + 100, units = phrase * 3;
    await db.collection<ProviderControl>('provider_controls').updateOne({_id: 'elevenlabs'}, {$set: {'allowance.observedRemaining': units}}); await approve();
    engine.beforeObservation = async () => {engine.remaining = units - engine.speechCalls * phrase;};
    engine.duringSpeech = async () => {assert.equal((await provider())!.allowance.observedRemaining, 0); return audio();};
    await worker.tick(); assert.equal(engine.speechCalls, 3); assert.equal((await run())!.state, 'rendered_local'); assert.equal((await provider())!.reservations[0].units, units);
  });
  test('new active states require ownership/lease metadata and cannot be forged from a legacy queued row', async () => {
    await approve(); await assert.rejects(db.collection<GenerationRun>('generation_runs').updateOne({projectId}, {$set: {state: 'running'}}), e => !!e && typeof e === 'object' && 'code' in e && e.code === 121);
    assert.equal((await run())!.state, 'queued');
  });
  test('jobs approved by a later-disabled member continue as shared team work', async () => {
    await approve(); await db.collection<Row>('memberships').updateOne({userId: testUserId}, {$set: {status: 'disabled'}});
    await worker.tick(); assert.equal((await run())!.state, 'rendered_local');
  });
  test('changed renderer pins refuse before speech and release an unused reservation', async () => {
    await approve(); engine.build = 'c'.repeat(64); await worker.tick(); assert.equal((await run())!.state, 'failed'); assert.equal(engine.speechCalls, 0); assert.equal((await provider())!.reservations.length, 0);
  });
  test('operator disablement between live observation and submission wins without re-enablement', async () => {
    await approve(); engine.beforeObservation = async () => {await db.collection<Row>('provider_controls').updateOne({_id: 'elevenlabs'}, {$set: {operatorDisabled: true}, $inc: {revision: Long.ONE}});};
    await worker.tick(); assert.equal(engine.speechCalls, 0); assert.equal((await run())!.state, 'failed'); assert.equal((await provider())!.operatorDisabled, true); assert.equal((await provider())!.reservations.length, 0);
  });
  test('configuration/period changes and missing confirmed account capacity cannot dispatch', async () => {
    await approve(); engine.beforeObservation = async () => {await db.collection<Row>('provider_controls').updateOne({_id: 'elevenlabs'}, {$set: {configHash: 'a'.repeat(64), 'allowance.periodId': 'changed'}});};
    await worker.tick(); assert.equal(engine.speechCalls, 0); assert.equal((await run())!.state, 'failed');
  });
  test('running cancellation before the first durable submission is confirmed with full unused release', async () => {
    await approve(); engine.beforeObservation = async () => {const result = await cancelCurrent(); assert.equal(result.job.state, 'cancellation_requested'); assert.equal(result.job.cancellationConfirmed, false);};
    await worker.tick(); assert.equal(engine.speechCalls, 0); assert.equal((await run())!.state, 'cancelled'); assert.equal((await provider())!.allowance.observedRemaining, 10000);
  });
  test('cancellation after a known speech response stores its outcome and prevents later phrases/render', async () => {
    await approve(); engine.duringSpeech = async () => {await cancelCurrent(); return audio();};
    await worker.tick(); assert.equal(engine.speechCalls, 1); assert.equal(engine.renderCalls, 0); assert.equal((await run())!.state, 'cancelled');
    assert.equal((await db.collection<SpeechAttempt>('generation_speech_attempts').findOne({}))!.state, 'settled'); assert.equal((await provider())!.reservations[0].state, 'settled');
  });
  test('cancellation during rendering cannot commit a successful local artifact', async () => {
    await approve(); engine.duringRender = async () => {await cancelCurrent();}; await worker.tick();
    assert.equal((await run())!.state, 'cancelled'); assert.equal(await db.collection('generation_local_artifacts').countDocuments(), 0); assert.equal((await provider())!.reservations[0].state, 'settled');
  });
  test('unknown speech outcome retains uncertain usage, pauses future requests and never auto-retries', async () => {
    const input = body(); await approve(); engine.duringSpeech = async () => {throw new GenerationFault('SPEECH_OUTCOME_UNKNOWN', true);}; await worker.tick();
    assert.equal((await run())!.error!.code, 'SPEECH_OUTCOME_UNKNOWN'); assert.equal((await provider())!.reservations[0].state, 'uncertain'); assert.equal((await provider())!.state, 'paused');
    assert.equal((await service.approve(projectId, input, randomUUID())).job.state, 'failed'); await worker.tick(); assert.equal(engine.speechCalls, 1);
  });
  test('unknown usage cannot overwrite a legacy operator disablement written during speech', async () => {
    await approve(); engine.duringSpeech = async () => {await db.collection<ProviderControl>('provider_controls').updateOne({_id: 'elevenlabs'}, {$set: {state: 'disabled'}}); throw new GenerationFault('SPEECH_OUTCOME_UNKNOWN', true);};
    await worker.tick(); assert.equal((await provider())!.state, 'disabled'); assert.equal((await provider())!.reservations[0].state, 'uncertain');
  });
  test('a lost local speech write after submission is uncertain and is not refunded', async () => {
    await approve(); const remaining = (await provider())!.allowance.observedRemaining; engine.persistFailure = true; await worker.tick();
    assert.equal((await run())!.error!.code, 'SPEECH_OUTCOME_UNKNOWN'); assert.equal((await provider())!.allowance.observedRemaining, remaining); assert.equal(engine.speechCalls, 1);
  });
  test('a definite provider refusal is recorded once and pauses access without calling renderer', async () => {
    await approve(); engine.duringSpeech = async () => {throw new GenerationFault('SPEECH_ACCESS_REFUSED');}; await worker.tick();
    assert.equal((await db.collection<SpeechAttempt>('generation_speech_attempts').findOne({}))!.state, 'refused'); assert.equal((await provider())!.state, 'paused'); assert.equal(engine.speechCalls, 1); assert.equal(engine.renderCalls, 0);
  });
  test('renderer failure preserves known settled speech without claiming provider uncertainty', async () => {
    await approve(); engine.renderFailure = true; await worker.tick(); assert.equal((await run())!.state, 'failed'); assert.equal((await provider())!.state, 'enabled'); assert.equal((await provider())!.reservations[0].state, 'settled'); assert.equal(await db.collection('generation_local_artifacts').countDocuments(), 0);
  });
  test('a replacement recovers a submitted expired lease as uncertain and fences the old owner', async () => {
    await approve(); const started = deferred<void>(), release = deferred<MeasuredSpeech>(); engine.duringSpeech = async () => {started.resolve(); return release.promise;};
    const old = worker.tick(); await started.promise;
    assert.equal((await db.collection<SpeechAttempt>('generation_speech_attempts').findOne({}))!.state, 'submitted');
    await db.collection<GenerationRun>('generation_runs').updateOne({projectId}, {$set: {leaseUntil: new Date(0)}}); await db.collection<WorkerRow>('generation_workers').updateOne({_id: 'generation:local'}, {$set: {expiresAt: new Date(0)}});
    const replacementEngine = new FakeEngine(), replacement = new GenerationWorker(client, name, providerEnv, replacementEngine); assert.equal(await replacement.heartbeat(), true); assert.equal(await replacement.recoverExpired(), 1);
    release.resolve(audio()); await old; assert.equal((await run())!.state, 'failed'); assert.equal((await provider())!.reservations[0].state, 'uncertain'); assert.equal(await db.collection('generation_local_artifacts').countDocuments(), 0); assert.equal(replacementEngine.speechCalls, 0);
  });
  test('lease loss before any submission fails safely without consumption or resubmission', async () => {
    await approve(); const started = deferred<void>(), release = deferred<void>(); engine.beforeObservation = async () => {started.resolve(); await release.promise;};
    const old = worker.tick(); await started.promise;
    await db.collection<GenerationRun>('generation_runs').updateOne({projectId}, {$set: {leaseUntil: new Date(0)}}); await db.collection<WorkerRow>('generation_workers').updateOne({_id: 'generation:local'}, {$set: {expiresAt: new Date(0)}});
    const replacement = new GenerationWorker(client, name, providerEnv, new FakeEngine()); await replacement.heartbeat(); await replacement.recoverExpired(); release.resolve(); await old;
    assert.equal(engine.speechCalls, 0); assert.equal((await run())!.state, 'failed'); assert.equal((await provider())!.reservations.length, 0); assert.equal((await provider())!.allowance.observedRemaining, 10000);
  });
  for (const stage of ['rendering', 'validating'] as const) for (const cancelling of [false, true]) {
    test(`expired ${stage} lease ${cancelling ? 'with cancellation' : 'without cancellation'} retains the physical slot without executor-stop evidence`, async () => {
      await approve();
      // A second, independently approved project must not start while the old
      // renderer ignores abort/loses DB connectivity, even after slot takeover.
      const secondProjectId = randomUUID(), secondPlanId = randomUUID();
      const firstProject = (await db.collection<Row>('projects').findOne({_id: projectId}))!;
      await db.collection<Row>('projects').insertOne({...firstProject, _id: secondProjectId, revision: Long.ONE, latestRunId: null, currentPlanVersionId: secondPlanId, planningRequestId: secondPlanId});
      const firstPlan = (await db.collection<PlanVersion>('plan_versions').findOne({_id: planId}))!;
      await db.collection<PlanVersion>('plan_versions').insertOne({...firstPlan, _id: secondPlanId, projectId: secondProjectId, sourcePlanningRequestId: secondPlanId});
      const second = await service.approve(secondProjectId, {...body(), planVersionId: secondPlanId}, randomUUID());
      const started = deferred<void>(), release = deferred<void>();
      engine.duringRender = async () => {
        if (stage === 'validating') await db.collection<GenerationRun>('generation_runs').updateOne({projectId}, {$set: {stage}});
        started.resolve(); await release.promise;
      };
      const old = worker.tick(); await started.promise;
      try {
        if (cancelling) await cancelCurrent();
        await db.collection<GenerationRun>('generation_runs').updateOne({projectId}, {$set: {leaseUntil: new Date(0)}});
        await db.collection<WorkerRow>('generation_workers').updateOne({_id: 'generation:local'}, {$set: {expiresAt: new Date(0)}});
        const beforeRun = await run(), beforeProvider = await provider();
        const beforeProject = await db.collection<Row>('projects').findOne({_id: projectId});
        const replacementEngine = new FakeEngine(), replacement = new GenerationWorker(client, name, providerEnv, replacementEngine);
        assert.equal(await replacement.heartbeat(), true);
        assert.equal(await replacement.recoverExpired(), 0);
        assert.equal(await replacement.tick(), false);
        assert.deepEqual(await run(), beforeRun); assert.deepEqual(await provider(), beforeProvider);
        assert.deepEqual(await db.collection<Row>('projects').findOne({_id: projectId}), beforeProject);
        assert.equal((await service.job(second.job.jobId))!.state, 'queued');
        assert.equal(engine.renderCalls, 1); assert.equal(replacementEngine.speechCalls, 0); assert.equal(replacementEngine.renderCalls, 0);
        release.resolve(); await old;
        // Even a late result/file is not durable process-tree stop evidence.
        assert.equal(await replacement.recoverExpired(), 0); assert.equal(await replacement.tick(), false);
        assert.deepEqual(await run(), beforeRun); assert.equal(await db.collection('generation_local_artifacts').countDocuments(), 0);
        assert.equal((await service.job(second.job.jobId))!.state, 'queued');
        assert.equal(replacementEngine.speechCalls, 0); assert.equal(replacementEngine.renderCalls, 0);
      } finally {release.resolve(); await old;}
    });
  }
  test('project deletion after claim prevents any subsequent external request and cannot resurrect the project', async () => {
    await approve(); engine.beforeObservation = async () => {await db.collection<Row>('projects').updateOne({_id: projectId}, {$set: {deletedAt: new Date()}});};
    await worker.tick(); assert.equal(engine.speechCalls, 0); assert.equal((await run())!.state, 'failed'); assert.ok((await db.collection<Row>('projects').findOne({_id: projectId}))!.deletedAt);
  });
  async function storageSetup() {
    await approve(); await worker.tick(); const current = (await run())!;
    const bytes = Object.fromEntries(storageKinds.map(k => [k, Buffer.from(k)])) as Record<StorageKind, Buffer>;
    bytes.input = Buffer.from((await db.collection<Row>('approvals').findOne({_id: current.approvalId}))!.inputCanonical);
    const plan = JSON.parse(bytes.input.toString()), media = (await db.collection<Row>('generation_local_artifacts').findOne({_id: current.artifactId!}))!.media;
    const cues = plan.narration.map((n: {text: string; segmentId: string}, i: number) => ({segmentId: n.segmentId, sceneId: plan.scenes[i].sceneId, text: n.text, startFrame: i * 300, speechEndFrame: i * 300 + 250, endFrame: (i + 1) * 300}));
    bytes.manifest = Buffer.from(JSON.stringify({mp4Sha256: sha256(bytes.mp4), state: 'validated_local', mode: 'elevenlabs-evaluation', diagnostic: false, voicePinSatisfied: true, publicationAllowed: false,
      inputHash: current.inputHash, rendererBuildHash: current.rendererBuildHash, language: plan.language, fps: 30, durationInFrames: 900, audioHash: 'a'.repeat(64), media}));
    bytes.timing = Buffer.from(JSON.stringify({cues, audioHash: 'a'.repeat(64), layout: {scenes: cues.map((c: {text: string}) => ({caption: {lines: [c.text]}}))}}));
    bytes.srt = Buffer.from(cues.map((c: {text: string}, i: number) => `${i+1}\n00:00:${String(i*10).padStart(2,'0')},000 --> 00:00:${String((i+1)*10).padStart(2,'0')},000\n${c.text}\n`).join('\n'));
    await db.collection<Row>('generation_local_artifacts').updateOne({_id: current.artifactId!}, {$set: {manifestHash: sha256(bytes.manifest)}});
    const reader = {read: async () => bytes}, store = {configHash: 'a'.repeat(64), bucket: 'test-private', calls: 0, objects: new Map<string, Buffer>(), hook: undefined as undefined | (() => Promise<void>),
      async read(object: StorageObject) {const data = this.objects.get(object.key); if (!data) throw new Error('missing'); return Buffer.from(data);},
      async ensure(object: StorageObject, data: Buffer) {this.calls++; verifyObject(object, data); await this.hook?.(); const old = this.objects.get(object.key); if (old) assert.deepEqual(old, data); else this.objects.set(object.key, data);}};
    return {current, bytes, reader, store, storage: new StorageService(client, name, store, reader)};
  }
  test('private storage preparation is unique and atomically creates evaluation-only ready playback metadata', async () => {
    const {storage, store, current} = await storageSetup();
    await Promise.all([storage.prepare(current._id), storage.prepare(current._id)]);
    assert.equal(await db.collection('generation_storage_bundles').countDocuments(), 1);
    assert.equal(await storage.tick(), true); assert.equal(await storage.tick(), false);
    const bundle = (await db.collection<StorageBundle>('generation_storage_bundles').findOne({}))!;
    assert.equal(bundle.state, 'stored'); assert.equal(bundle.objects.length, 5); assert.equal(store.objects.size, 5); assert.equal(bundle.owner, null);
    assert.equal((await run())!.state, 'rendered_local'); assert.equal((await service.job(current.jobId))!.result, null);
    const latest = await new VideoService(client, name, context, store).latest(projectId);
    assert.equal(latest.video!.id, bundle._id); assert.equal(latest.video!.capabilities.publish, false); assert.equal(latest.video!.capabilities.download, true);
    assert.equal(await db.collection('video_assets').countDocuments({videoId: bundle._id, refCount: 1}), 5);
    assert.equal(engine.speechCalls, 3); assert.equal(engine.renderCalls, 1);
    assert.equal(await db.collection('activity_events').countDocuments({dedupeKey: `storage:${bundle._id}:stored`}), 1); await checkDatabase(db);
  });
  test('partial storage failure retries the exact keys/bytes without new speech/rendering', async () => {
    const {storage, store, current} = await storageSetup(); const bundle = await storage.prepare(current._id);
    store.hook = async () => {if (store.calls === 3) throw new Error('Private provider details');};
    await assert.rejects(storage.tick(), /STORAGE_FAILED/); assert.equal(store.objects.size, 2);
    assert.equal((await db.collection<StorageBundle>('generation_storage_bundles').findOne({}))!.state, 'failed'); assert.equal(await storage.tick(), false);
    const holds = await provider(); store.hook = undefined; await storage.retry(current._id); await storage.tick();
    const saved = (await db.collection<StorageBundle>('generation_storage_bundles').findOne({}))!;
    assert.equal(saved.state, 'stored'); assert.deepEqual(saved.objects, bundle.objects); assert.equal(store.objects.size, 5); assert.deepEqual(await provider(), holds);
    assert.equal(engine.speechCalls, 3); assert.equal(engine.renderCalls, 1);
  });
  test('storage lease takeover fences a late owner and safely reuses immutable object identities', async () => {
    const {storage, store, reader, current} = await storageSetup(); await storage.prepare(current._id);
    const started = deferred<void>(), release = deferred<void>(); let first = true;
    store.hook = async () => {if (first) {first = false; started.resolve(); await release.promise;}};
    const old = storage.tick(); const handled = old.catch(error => error); await started.promise;
    try {
      await db.collection<StorageBundle>('generation_storage_bundles').updateOne({runId: current._id}, {$set: {leaseUntil: new Date(0)}});
      const replacement = new StorageService(client, name, store, reader); assert.equal(await replacement.tick(), true);
      release.resolve(); assert.match((await handled).message, /STORAGE_OWNERSHIP_LOST/);
      const bundle = (await db.collection<StorageBundle>('generation_storage_bundles').findOne({}))!;
      assert.equal(bundle.state, 'stored'); assert.equal(bundle.epoch.toNumber(), 2); assert.equal(store.objects.size, 5);
      assert.equal(await db.collection('activity_events').countDocuments({dedupeKey: `storage:${bundle._id}:stored`}), 1);
    } finally {release.resolve(); await handled;}
  });
  test('unexpired storage ownership prevents a competing uploader', async () => {
    const {storage, store, reader, current} = await storageSetup(); await storage.prepare(current._id);
    const started = deferred<void>(), release = deferred<void>(); let first = true;
    store.hook = async () => {if (first) {first = false; started.resolve(); await release.promise;}};
    const old = storage.tick(); await started.promise;
    try {assert.equal(await new StorageService(client, name, store, reader).tick(), false); assert.equal(await storage.tick(), false);}
    finally {release.resolve(); await old;}
    assert.equal(store.objects.size, 5);
  });
  test('project deletion during upload prevents stored finalization without rerendering or resurrection', async () => {
    const {storage, store, current} = await storageSetup(); await storage.prepare(current._id);
    store.hook = async () => {await db.collection<Row>('projects').updateOne({_id: projectId}, {$set: {deletedAt: new Date()}});};
    await assert.rejects(storage.tick(), /STORAGE_SOURCE_UNAVAILABLE/);
    assert.equal(store.objects.size, 1); assert.equal((await db.collection<StorageBundle>('generation_storage_bundles').findOne({}))!.state, 'failed');
    assert.equal(await db.collection('activity_events').countDocuments({message: /private storage/}), 0); assert.equal(engine.renderCalls, 1);
  });
  test('changed local bytes cannot reuse a reserved object key', async () => {
    const {storage, store, current, bytes} = await storageSetup(); await storage.prepare(current._id); bytes.srt = Buffer.from('changed captions');
    await assert.rejects(storage.tick(), /STORAGE_BYTES_CHANGED/); assert.equal(store.calls, 0); assert.equal(engine.renderCalls, 1);
  });
  test('completed MP4 checksum is required before bundle preparation even with a custom reader', async () => {
    const {storage, store, current, bytes} = await storageSetup(); bytes.mp4 = Buffer.from('replaced video with identical metrics');
    await assert.rejects(storage.prepare(current._id), /STORAGE_SOURCE_CHANGED/);
    assert.equal(await db.collection('generation_storage_bundles').countDocuments(), 0); assert.equal(store.calls, 0);
  });
  test('checksumless legacy artifacts cannot be prepared or silently backfilled', async () => {
    const {storage, store, current, bytes} = await storageSetup(); bytes.manifest = Buffer.from('{}');
    await db.collection<Row>('generation_local_artifacts').updateOne({_id: current.artifactId!}, {$set: {manifestHash: sha256(bytes.manifest)}});
    await assert.rejects(storage.prepare(current._id), /STORAGE_VIDEO_CHECKSUM_REQUIRED/);
    assert.equal(await db.collection('generation_storage_bundles').countDocuments(), 0); assert.equal(store.calls, 0);
  });
  test('destination changes cannot migrate or retry a bundle into another bucket silently', async () => {
    const {storage, store, reader, current} = await storageSetup(); await storage.prepare(current._id);
    const changed = new StorageService(client, name, {...store, bucket: 'other', configHash: 'b'.repeat(64)}, reader);
    assert.equal(await changed.tick(), false);
    store.hook = async () => {throw new StorageFault('STORAGE_VERIFICATION_FAILED');}; await assert.rejects(storage.tick());
    await assert.rejects(changed.retry(current._id), /STORAGE_SOURCE_CHANGED/); assert.equal(store.objects.size, 0);
  });
  test('missing or foreign local provenance refuses storage before object writes', async () => {
    const {storage, store, current} = await storageSetup();
    await db.collection<Row>('generation_local_artifacts').updateOne({_id: current.artifactId!}, {$set: {workspaceId: randomUUID()}});
    await assert.rejects(storage.prepare(current._id), /STORAGE_SOURCE_UNAVAILABLE/); assert.equal(store.calls, 0); assert.equal(await db.collection('generation_storage_bundles').countDocuments(), 0);
  });
  test('discovery queues valid output, skips broken folders until explicit correction and excludes deleted projects', async () => {
    const {storage, store, reader, current} = await storageSetup();
    const read = reader.read; reader.read = async () => {throw new Error('missing local folder');};
    await assert.rejects(storage.discover()); assert.equal(await storage.discover(), false); assert.equal(store.calls, 0);
    reader.read = read; await storage.prepare(current._id); assert.equal(store.objects.size, 0);
    await db.collection('generation_storage_bundles').deleteMany({});
    await db.collection<Row>('projects').updateOne({_id: projectId}, {$set: {deletedAt: new Date()}});
    const replacement = new StorageService(client, name, store, reader); assert.equal(await replacement.discover(), false);
    await db.collection<Row>('projects').updateOne({_id: projectId}, {$set: {deletedAt: null}});
    assert.equal(await replacement.discover(), true); assert.equal(await replacement.tick(), true); assert.equal(store.objects.size, 5);
  });
  test('playback verifies private bytes and supports bounded full, single-range and HEAD responses', async () => {
    const {storage, store, current, bytes} = await storageSetup(); await storage.prepare(current._id); await storage.tick();
    const videos = new VideoService(client, name, context, store), view = (await videos.latest(projectId)).video!;
    const full = await videos.playback(view.id, null); assert.equal(full.status, 200); assert.deepEqual(Buffer.from(full.body!), bytes.mp4); assert.equal(full.headers['Cache-Control'], 'private, no-store');
    const part = await videos.playback(view.id, 'bytes=1-1'); assert.equal(part.status, 206); assert.deepEqual(Buffer.from(part.body!), bytes.mp4.subarray(1,2));
    assert.equal((await videos.playback(view.id, null, true)).body, null);
    await assert.rejects(videos.playback(view.id, 'bytes=999-'), (e: unknown) => !!e && typeof e === 'object' && 'status' in e && e.status === 416);
    assert.equal(JSON.stringify(view).includes('workspaces/'), false); assert.equal(JSON.stringify(view).includes(store.configHash), false);
  });
  test('downloads return exact MP4 and matching UTF-8 SRT with safe attachment headers, ranges and HEAD', async () => {
    const {storage, store, current, bytes} = await storageSetup(); await storage.prepare(current._id); await storage.tick();
    const videos = new VideoService(client, name, context, store), view = (await videos.latest(projectId)).video!;
    assert.equal(view.capabilities.download, true); assert.equal(view.capabilities.publish, false);
    for (const kind of ['mp4','srt'] as const) {
      assert.equal(view.downloadUrls[kind], `/api/v1/videos/${view.id}/downloads/${kind}`);
      const result = await videos.download(view.id, kind, null);
      assert.deepEqual(Buffer.from(result.body!), bytes[kind]); assert.equal(result.status, 200);
      assert.equal(result.headers['Content-Disposition'], `attachment; filename="videocraft-v1-${view.language}.${kind}"`);
      assert.equal(result.headers['Content-Length'], String(bytes[kind].length));
      assert.equal(result.headers['Cache-Control'], 'private, no-store'); assert.equal(result.headers.Vary, 'Cookie');
      assert.equal(result.headers['X-Content-Type-Options'], 'nosniff');
      assert.equal(result.headers['Content-Type'], kind === 'mp4' ? 'video/mp4' : 'application/x-subrip; charset=utf-8');
      assert.equal((await videos.download(view.id, kind, null, true)).body, null);
      const part = await videos.download(view.id, kind, 'bytes=0-1'); assert.equal(part.status, 206); assert.deepEqual(Buffer.from(part.body!), bytes[kind].subarray(0,2));
      await assert.rejects(videos.download(view.id, kind, 'bytes=0-1,3-4'), (e: unknown) => e instanceof Error && 'status' in e && e.status === 416);
    }
    for (const kind of ['input','manifest','timing','../srt','']) await assert.rejects(videos.download(view.id,kind,null), /could not be found/);
  });
  test('downloads reject corrupt or unavailable subtitle assets independently of playable MP4', async () => {
    const {storage, store, current} = await storageSetup(); await storage.prepare(current._id); await storage.tick();
    const videos = new VideoService(client,name,context,store), id = (await videos.latest(projectId)).video!.id;
    const bundle = (await db.collection<StorageBundle>('generation_storage_bundles').findOne({}))!, key = bundle.objects.find(o => o.kind === 'srt')!.key;
    const original = store.objects.get(key)!; store.objects.set(key, Buffer.from('substituted captions'));
    await assert.rejects(videos.download(id,'srt',null), /temporarily unavailable/); store.objects.set(key,original);
    await db.collection<Row>('video_assets').updateOne({videoId:id,'object.kind':'srt'},{$set:{lifecycleState:'deleting'}});
    await assert.rejects(videos.download(id,'srt',null), /temporarily unavailable/);
    assert.equal((await videos.download(id,'mp4',null)).status,200);
  });
  test('downloads recheck subtitle pin revision after retrieval and deny changed access', async () => {
    const {storage,store,current} = await storageSetup(); await storage.prepare(current._id); await storage.tick();
    const videos = new VideoService(client,name,context,store), id = (await videos.latest(projectId)).video!.id, read = store.read;
    store.read = async function(object) {const bytes = await read.call(this,object); await db.collection<Row>('video_assets').updateOne({videoId:id,'object.kind':'srt'},{$inc:{referenceRevision:Long.ONE}}); return bytes;};
    await assert.rejects(videos.download(id,'srt',null), /temporarily unavailable/);
    store.read = async function(object) {const bytes = await read.call(this,object); await db.collection<Row>('memberships').updateOne({userId:testUserId},{$set:{status:'disabled'}}); return bytes;};
    await assert.rejects(videos.download(id,'mp4',null), /team access/);
  });
  test('downloads refuse foreign workspace, deleted project and changed destination', async () => {
    const {storage,store,current} = await storageSetup(); await storage.prepare(current._id); await storage.tick();
    const videos = new VideoService(client,name,context,store), id = (await videos.latest(projectId)).video!.id;
    await assert.rejects(new VideoService(client,name,{...context,workspaceId:randomUUID()},store).download(id,'srt',null));
    await assert.rejects(new VideoService(client,name,context,{...store,configHash:'b'.repeat(64)}).download(id,'srt',null), /temporarily unavailable/);
    await db.collection<Row>('projects').updateOne({_id:projectId},{$set:{deletedAt:new Date()}});
    await assert.rejects(videos.download(id,'mp4',null), /could not be found/);
  });
  test('foreign scope, inactive membership and deleted projects cannot resolve or play a video', async () => {
    const {storage, store, current} = await storageSetup(); await storage.prepare(current._id); await storage.tick();
    const videos = new VideoService(client, name, context, store), view = (await videos.latest(projectId)).video!;
    await assert.rejects(new VideoService(client, name, {...context, workspaceId: randomUUID()}, store).get(view.id));
    await db.collection<Row>('memberships').updateOne({userId: testUserId}, {$set: {status: 'disabled'}}); await assert.rejects(videos.playback(view.id,null), /team access/);
    await db.collection<Row>('memberships').updateOne({userId: testUserId}, {$set: {status: 'active'}});
    await db.collection<Row>('projects').updateOne({_id: projectId}, {$set: {deletedAt: new Date()}}); await assert.rejects(videos.get(view.id), /could not be found/);
  });
  test('corrupt remote bytes, changed destination and unavailable asset pins deny playback', async () => {
    const {storage, store, current} = await storageSetup(); await storage.prepare(current._id); await storage.tick();
    const videos = new VideoService(client, name, context, store), view = (await videos.latest(projectId)).video!;
    const bundle = (await db.collection<StorageBundle>('generation_storage_bundles').findOne({}))!, key = bundle.objects.find(o => o.kind === 'mp4')!.key;
    const original = store.objects.get(key)!; store.objects.set(key, Buffer.from('bad')); await assert.rejects(videos.playback(view.id,null), /temporarily unavailable/); store.objects.set(key,original);
    await assert.rejects(new VideoService(client,name,context,{...store,configHash:'b'.repeat(64)}).get(view.id), /temporarily unavailable/);
    await db.collection<Row>('video_assets').updateOne({videoId: view.id, 'object.kind':'mp4'}, {$set: {lifecycleState: 'deleting'}}); await assert.rejects(videos.playback(view.id,null), /temporarily unavailable/);
  });
  test('revocation or deletion during remote retrieval wins before a playback body is returned', async () => {
    const {storage, store, current} = await storageSetup(); await storage.prepare(current._id); await storage.tick();
    const videos = new VideoService(client, name, context, store), id = (await videos.latest(projectId)).video!.id, read = store.read;
    store.read = async function(object) {const data = await read.call(this,object); await db.collection<Row>('memberships').updateOne({userId:testUserId},{$set:{status:'disabled'}}); return data;};
    await assert.rejects(videos.playback(id,null), /team access/);
  });
  test('stored reconciliation is idempotent and needs no local files or additional generation', async () => {
    const {storage, store, current, reader} = await storageSetup(); await storage.prepare(current._id); await storage.tick();
    const original = (await db.collection<ReadyVideo>('ready_videos').findOne({}))!;
    // Simulate a stored bundle from before migration 012, with local files lost.
    await db.collection('ready_videos').deleteMany({}); await db.collection('video_assets').deleteMany({});
    await db.collection<Row>('projects').updateOne({_id:projectId},{$set:{latestReadyVideoId:null,nextVideoVersionNumber:Long.ZERO}});
    await db.collection('activity_events').deleteOne({dedupeKey:`video:${original._id}:ready`});
    reader.read = async () => {throw new Error('local files no longer exist');};
    await Promise.all([promoteStoredVideo(client,name,store,current._id),promoteStoredVideo(client,name,store,current._id)]);
    assert.equal(await db.collection('ready_videos').countDocuments(),1); assert.equal(await db.collection('video_assets').countDocuments(),5);
    const before = (await db.collection<ReadyVideo>('ready_videos').findOne({}))!;
    await promoteStoredVideo(client,name,store,current._id);
    assert.deepEqual(await db.collection<ReadyVideo>('ready_videos').findOne({}),before); assert.equal(engine.renderCalls,1); assert.equal(engine.speechCalls,3);
    assert.equal(await db.collection('activity_events').countDocuments({dedupeKey:`video:${before._id}:ready`}),1);
  });
  test('an older render finishing storage late preserves the newer latest ready video', async () => {
    const {storage,store,current} = await storageSetup(); await storage.prepare(current._id); await storage.tick();
    const videos = new VideoService(client,name,context,store), first = (await videos.latest(projectId)).video!;
    const runId = randomUUID(), approvalId = randomUUID(), artifactId = randomUUID(), versionId = randomUUID();
    const approval = (await db.collection<Row>('approvals').findOne({_id:current.approvalId}))!;
    const artifact = (await db.collection<Row>('generation_local_artifacts').findOne({_id:current.artifactId!}))!;
    const plan = (await db.collection<PlanVersion>('plan_versions').findOne({_id:current.planVersionId}))!;
    await db.collection<PlanVersion>('plan_versions').insertOne({...plan,_id:versionId,versionNumber:Long.fromNumber(2),sourcePlanningRequestId:versionId});
    await db.collection<Row>('approvals').insertOne({...approval,_id:approvalId,planVersionId:versionId});
    await db.collection<Row>('generation_local_artifacts').insertOne({...artifact,_id:artifactId,runId,approvalId});
    await db.collection<GenerationRun>('generation_runs').insertOne({...current,_id:runId,jobId:randomUUID(),approvalId,planVersionId:versionId,artifactId,createdAt:new Date(current.createdAt.getTime()-60000)});
    await storage.prepare(runId); await storage.tick(runId);
    assert.equal((await videos.latest(projectId)).video!.id,first.id); assert.equal(await db.collection('ready_videos').countDocuments(),2);
    const historical = (await db.collection<ReadyVideo>('ready_videos').findOne({runId}))!;
    assert.equal(historical.versionNumber.toNumber(),2); assert.equal((await videos.get(historical._id)).generationRunId,runId);
    const history = await new VideoHistoryService(client,name,context,'test-history-secret').versions(projectId,new URLSearchParams('kind=video'));
    assert.deepEqual(history.items.map(v=>[v.versionNumber,v.isLatest]),[[2,false],[1,true]]);
    assert.equal((await videos.playback(historical._id,null)).status,200);
    assert.equal((await videos.download(historical._id,'srt',null)).status,200);
    assert.equal((await videos.latest(projectId)).video!.id,first.id);
  });
  test('latest-video lookup refuses a pointer to a different project in the same workspace', async () => {
    const {storage,store,current} = await storageSetup(); await storage.prepare(current._id); await storage.tick();
    const videos = new VideoService(client,name,context,store), video = (await videos.latest(projectId)).video!;
    const other = projectFixture(); other.latestReadyVideoId = video.id; await db.collection<Row>('projects').insertOne(other);
    await assert.rejects(videos.latest(other._id),/temporarily unavailable/);
  });
  test('video history is empty for a live draft and denies foreign, disabled and deleted scopes', async () => {
    const history = new VideoHistoryService(client,name,context,'test-history-secret'), query = new URLSearchParams('kind=video');
    assert.deepEqual(await history.versions(projectId,query),{items:[],page:{hasMore:false,nextCursor:null}});
    await assert.rejects(new VideoHistoryService(client,name,{...context,workspaceId:randomUUID()},'test-history-secret').versions(projectId,query));
    await db.collection<Row>('memberships').updateOne({userId:testUserId},{$set:{status:'disabled'}});
    await assert.rejects(history.versions(projectId,query), /team access/);
    await db.collection<Row>('memberships').updateOne({userId:testUserId},{$set:{status:'active'}});
    await db.collection<Row>('projects').updateOne({_id:projectId},{$set:{deletedAt:new Date()}});
    await assert.rejects(history.versions(projectId,query), /could not be found/);
  });
  test('revision review without completed output is read-only and requires fresh current input',async()=>{
    const reviews=new RevisionReviewService(client,name,context),before=await db.collection<Row>('projects').findOne({_id:projectId});
    const result=await reviews.review(planId);assert.equal(result.baseline,null);assert.equal(result.changes,null);assert.equal(result.speechReuse,'verified_clips_only');
    assert.deepEqual(await db.collection<Row>('projects').findOne({_id:projectId}),before);assert.equal(engine.speechCalls,0);
    await db.collection<Row>('projects').updateOne({_id:projectId},{$inc:{briefRevision:Long.ONE}});
    await assert.rejects(reviews.review(planId),/current plan/);
  });
  test('revision review compares edited plan to pinned completed approval and preserves playable old output',async()=>{
    const {storage,store,current}=await storageSetup();await storage.prepare(current._id);await storage.tick();
    const reviews=new RevisionReviewService(client,name,context),original=(await db.collection<ReadyVideo>('ready_videos').findOne({}))!;
    assert.equal((await reviews.review(planId)).changes!.hasChanges,false);
    const project=(await db.collection<Row>('projects').findOne({_id:projectId}))!;
    const body={expectedProjectRevision:project.revision.toNumber(),edits:{narration:[{segmentId:'scene_1',text:'Clouds form above rivers.'}],headings:[{sceneId:'scene_2',text:'River flow'}]}};
    const edited=await new PlanEditService(client,name,context).edit(planId,body,randomUUID());
    const result=await reviews.review(edited.plan.id);assert.equal(result.baseline!.videoId,original._id);assert.equal(result.requiresNewApproval,true);
    assert.deepEqual(result.changes!.scenes.map(s=>[s.sceneId,s.narrationChanged,s.headingChanged]),[['scene_1',true,false],['scene_2',false,true]]);
    assert.equal(result.speechReuse,'verified_clips_only');assert.deepEqual(await db.collection<ReadyVideo>('ready_videos').findOne({_id:original._id}),original);
    const videos=new VideoService(client,name,context,store);assert.equal((await videos.latest(projectId)).video!.id,original._id);
    assert.equal((await videos.download(original._id,'mp4',null)).status,200);assert.equal(engine.speechCalls,3);assert.equal(engine.renderCalls,1);
    await assert.rejects(reviews.review(planId),/current plan/);
  });
  test('revision review refuses inactive or foreign access, active work and deleted projects',async()=>{
    const reviews=new RevisionReviewService(client,name,context);
    await assert.rejects(new RevisionReviewService(client,name,{...context,workspaceId:randomUUID()}).review(planId));
    await db.collection<Row>('memberships').updateOne({userId:testUserId},{$set:{status:'disabled'}});await assert.rejects(reviews.review(planId),/team access/);
    await db.collection<Row>('memberships').updateOne({userId:testUserId},{$set:{status:'active'}});
    await db.collection<Row>('projects').updateOne({_id:projectId},{$set:{latestRunId:randomUUID()}});await assert.rejects(reviews.review(planId),/Finish active work/);
    await db.collection<Row>('projects').updateOne({_id:projectId},{$set:{latestRunId:null,deletedAt:new Date()}});await assert.rejects(reviews.review(planId),/could not be found/);
  });
  test('revision review refuses mismatched completed input and cross-project ready pointers',async()=>{
    const {storage,current}=await storageSetup();await storage.prepare(current._id);await storage.tick();const reviews=new RevisionReviewService(client,name,context);
    await db.collection<Row>('approvals').updateOne({_id:current.approvalId},{$set:{inputCanonical:'{}'}});await assert.rejects(reviews.review(planId),/could not be verified/);
    const other=projectFixture();await db.collection<Row>('projects').insertOne(other);
    await db.collection<Row>('ready_videos').updateOne({runId:current._id},{$set:{projectId:other._id}});await assert.rejects(reviews.review(planId),/could not be verified/);
  });
  test('video history keysets preserve completed versions through concurrent inserts without changing latest', async () => {
    const {storage,store,current} = await storageSetup(); await storage.prepare(current._id); await storage.tick();
    const original = (await db.collection<ReadyVideo>('ready_videos').findOne({}))!, before = await db.collection<Row>('projects').findOne({_id:projectId});
    // Additional isolated metadata fixtures exercise pagination; they never enter the application DB.
    for (let version=2;version<=4;version++) await db.collection<ReadyVideo>('ready_videos').insertOne({...original,_id:randomUUID(),runId:randomUUID(),bundleId:randomUUID(),versionNumber:Long.fromNumber(version)});
    const history = new VideoHistoryService(client,name,context,'test-history-secret'), first = await history.versions(projectId,new URLSearchParams('kind=video&limit=2'));
    assert.deepEqual(first.items.map(v=>v.versionNumber),[4,3]); assert.equal(first.page.hasMore,true);
    await db.collection<ReadyVideo>('ready_videos').insertOne({...original,_id:randomUUID(),runId:randomUUID(),bundleId:randomUUID(),versionNumber:Long.fromNumber(5)});
    const second = await history.versions(projectId,new URLSearchParams({kind:'video',limit:'2',cursor:first.page.nextCursor!}));
    assert.deepEqual(second.items.map(v=>v.versionNumber),[2,1]); assert.equal(second.page.nextCursor,null); assert.equal(second.items[1].isLatest,true);
    assert.deepEqual(await db.collection<Row>('projects').findOne({_id:projectId}),before);
    assert.equal((await history.versions(projectId,new URLSearchParams('kind=video&limit=2'))).items[0].versionNumber,5);
    const serialized = JSON.stringify(first); for (const privateValue of [original.bucket,original.configHash,original.mp4Sha256,'workspaces/','downloadUrls','transcript']) assert.equal(serialized.includes(privateValue),false);
    assert.equal(engine.renderCalls,1); assert.equal(engine.speechCalls,3);
    const other = projectFixture(); await db.collection<Row>('projects').insertOne(other);
    assert.equal((await history.versions(other._id,new URLSearchParams('kind=video'))).items.length,0);
    await assert.rejects(history.versions(other._id,new URLSearchParams({kind:'video',limit:'2',cursor:first.page.nextCursor!})), /expired or changed/);
  });
});
