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
import {generationHash} from '../src/server/rendering/contract';
import {membershipFixture, projectFixture, workspaceFixture, testWorkspaceId, testUserId, type Row} from './fixtures/database';
import {providerEnv, providerFixture} from './fixtures/providers';
import {pins, renderFixture} from './fixtures/rendering';
import {StorageService} from '../src/server/storage/service';
import {storageKinds, StorageFault, type StorageBundle, type StorageKind, type StorageObject} from '../src/server/storage/contracts';
import {sha256, verifyObject} from '../src/server/storage/r2';

const uri = process.env.MONGODB_TEST_URI ?? 'mongodb://127.0.0.1:27028/?replicaSet=vcF03';
if (!/^mongodb:\/\/(127\.0\.0\.1|localhost):\d+\/(?:\?[^\s]*)?$/.test(uri)) throw new Error('Isolated loopback database required.');
const name = `videocraft_f10_test_${randomUUID().replaceAll('-', '')}`, client = new MongoClient(uri, databaseClientOptions), context = {workspaceId: testWorkspaceId, userId: testUserId, userName: 'Tester'};
const audio = (): MeasuredSpeech => ({sampleRate: 24000, samples: Float32Array.from({length: 24000}, (_, i) => Math.sin(i / 10) * .2)});
const deferred = <T>() => {let resolve!: (value: T) => void; const promise = new Promise<T>(r => {resolve = r;}); return {promise, resolve};};
class FakeEngine implements GenerationEngine {
  capabilities = requiredCapabilities; build = 'd'.repeat(64); speechCalls = 0; renderCalls = 0; remaining = 10000;
  beforeObservation?: () => Promise<void>; duringSpeech?: () => Promise<MeasuredSpeech>; duringRender?: () => Promise<void>; persistFailure = false; renderFailure = false;
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
    for (const n of ['projects', 'workspaces', 'memberships', 'provider_controls', 'plan_versions', 'activity_events', 'approvals', 'generation_runs', 'generation_workers', 'generation_commands', 'generation_speech_attempts', 'generation_local_artifacts', 'generation_storage_bundles']) await db.collection(n).deleteMany({});
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
    await db.collection<Row>('generation_local_artifacts').updateOne({_id: current.artifactId!}, {$set: {manifestHash: sha256(bytes.manifest)}});
    const reader = {read: async () => bytes}, store = {configHash: 'a'.repeat(64), bucket: 'test-private', calls: 0, objects: new Map<string, Buffer>(), hook: undefined as undefined | (() => Promise<void>),
      async ensure(object: StorageObject, data: Buffer) {this.calls++; verifyObject(object, data); await this.hook?.(); const old = this.objects.get(object.key); if (old) assert.deepEqual(old, data); else this.objects.set(object.key, data);}};
    return {current, bytes, reader, store, storage: new StorageService(client, name, store, reader)};
  }
  test('private storage preparation is unique and persisted bundles are not ready/public video results', async () => {
    const {storage, store, current} = await storageSetup();
    await Promise.all([storage.prepare(current._id), storage.prepare(current._id)]);
    assert.equal(await db.collection('generation_storage_bundles').countDocuments(), 1);
    assert.equal(await storage.tick(), true); assert.equal(await storage.tick(), false);
    const bundle = (await db.collection<StorageBundle>('generation_storage_bundles').findOne({}))!;
    assert.equal(bundle.state, 'stored'); assert.equal(bundle.objects.length, 5); assert.equal(store.objects.size, 5); assert.equal(bundle.owner, null);
    assert.equal((await run())!.state, 'rendered_local'); assert.equal((await service.job(current.jobId))!.result, null);
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
});
