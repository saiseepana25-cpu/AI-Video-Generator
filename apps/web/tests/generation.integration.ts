import {after, before, beforeEach, describe, test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Long, MongoClient, type Db} from 'mongodb';
import {databaseClientOptions} from '../src/server/db/connection';
import {checkDatabase, migrateDatabase} from '../src/server/db/migrations';
import {GenerationService} from '../src/server/generation/service';
import {generationView, requiredCapabilities, type Approval, type GenerationRun, type GenerationWorker} from '../src/server/generation/contracts';
import {RenderInputService} from '../src/server/rendering/service';
import {canonicalJson, generationHash, validateRenderPlan} from '../src/server/rendering/contract';
import type {PlanVersion} from '../src/server/planning/contracts';
import {membershipFixture, workspaceFixture, projectFixture, testUserId, testWorkspaceId, type Row} from './fixtures/database';
import {pins, renderFixture} from './fixtures/rendering';
import {providerEnv, providerFixture} from './fixtures/providers';
import type {ProviderControl} from '../src/server/providers/contracts';
import {digest} from '../src/server/providers/config';
import {PlanEditService} from '../src/server/planning/plan-edit-service';
import {BrandService} from '../src/server/brand/service';
import {initialBrand} from '../src/server/brand/palette';
import {brandPaletteCapability} from '../src/server/generation/contracts';

const uri = process.env.MONGODB_TEST_URI ?? 'mongodb://127.0.0.1:27028/?replicaSet=vcF03';
if (!/^mongodb:\/\/(127\.0\.0\.1|localhost):\d+\/(?:\?[^\s]*)?$/.test(uri)) throw new Error('Isolated loopback database required.');
const name = `videocraft_f09_test_${randomUUID().replaceAll('-', '')}`, client = new MongoClient(uri, databaseClientOptions);
const context = {workspaceId: testWorkspaceId, userId: testUserId, userName: 'Tester'};
describe('exact reviewed-input admission and queued cancellation', {concurrency: false}, () => {
  let db: Db, service: GenerationService, projectId: string, version: PlanVersion;
  async function seed(language: 'en' | 'te' = 'en') {
    const f = renderFixture(language), project = projectFixture(), id = randomUUID();
    project.brief = {...f.brief, idea: 'Explain water'}; project.settings = f.settings;
    project.currentPlanVersionId = id; project.planningRequestId = id; project.nextPlanVersionNumber = Long.ONE;
    const plan: PlanVersion = {_id: id, schemaVersion: 1, workspaceId: testWorkspaceId, projectId: project._id, versionNumber: Long.ONE, sourceBriefRevision: Long.ONE, sourcePlanningRequestId: id,
      inputHash: digest(JSON.stringify({brief: project.brief, settings: project.settings})), settingsSnapshot: f.settings, plan: f.proposal, plannerModelId: 'test-model', promptContractVersion: 'educational-diagrams-v1', createdAt: new Date(), createdBy: testUserId};
    await db.collection<Row>('projects').insertOne(project); await db.collection<PlanVersion>('plan_versions').insertOne(plan);
    return {projectId: project._id, version: plan};
  }
  before(async () => {await client.connect(); db = client.db(name); await migrateDatabase(db);});
  beforeEach(async () => {
    for (const collection of ['generation_runs', 'generation_commands', 'generation_workers', 'approvals', 'plan_versions', 'plan_edit_commands', 'projects', 'workspaces', 'memberships', 'activity_events', 'provider_controls','brand_kits','workspace_brand_commands']) await db.collection(collection).deleteMany({});
    await db.collection<Row>('workspaces').insertOne(workspaceFixture()); await db.collection<Row>('memberships').insertOne(membershipFixture());
    const speech = providerFixture(); speech.allowance.observedRemaining = 10000; await db.collection<ProviderControl>('provider_controls').insertOne(speech);
    const now = new Date(), f = renderFixture();
    await db.collection<GenerationWorker>('generation_workers').insertOne({_id: 'generation:local', owner: randomUUID(), revision: Long.ONE, state: 'healthy', contract: f.plan.contract, compilerVersion: f.plan.settingsSnapshot.compilerVersion,
      rendererBuildHash: 'd'.repeat(64), capabilities: requiredCapabilities, fonts: pins, heartbeatAt: now, expiresAt: new Date(now.getTime() + 300000)});
    service = new GenerationService(client, name, context, providerEnv, async () => pins);
    ({projectId, version} = await seed());
  });
  after(async () => {try {if (!/^videocraft_f09_test_[a-f0-9]{32}$/.test(name)) throw new Error('Unsafe cleanup'); await db.dropDatabase();} finally {await client.close();}});
  const body = () => ({expectedProjectRevision: 1, planVersionId: version._id, generationInputHash: generationHash(renderFixture(version.plan.language).plan)});
  const speech = () => db.collection<ProviderControl>('provider_controls').findOne({_id: 'elevenlabs'});
  const approve = () => service.approve(projectId, body(), randomUUID());

  test('captured brand compiles and approves unchanged after workspace brand edits; canonical approval stays pinned',async()=>{
    const brands=new BrandService(client,name,context),first=(await brands.put({expectedRevision:0,brandKit:{...initialBrand,backgroundColor:'#F5F3EB',primaryColor:'#3660D9',secondaryColor:'#173342'}},randomUUID())).brand.brandKit!;
    version.settingsSnapshot={...version.settingsSnapshot,brandKitRevisionId:first.id};
    const project=(await db.collection<Row>('projects').findOne({_id:projectId}))!;
    version.inputHash=digest(JSON.stringify({brief:project.brief,settings:version.settingsSnapshot}));
    await db.collection<Row>('projects').updateOne({_id:projectId},{$set:{settings:version.settingsSnapshot}});
    await db.collection<PlanVersion>('plan_versions').replaceOne({_id:version._id},version);
    const checker=new RenderInputService(client,name,context,providerEnv,async()=>pins),blocked=await checker.check(version._id);
    assert.equal(blocked.canGenerate,false);assert.equal(blocked.summary!.brand.revisionId,first.id);
    await db.collection<GenerationWorker>('generation_workers').updateOne({_id:'generation:local'},{$set:{capabilities:[...requiredCapabilities,brandPaletteCapability]}});
    const checked=await checker.check(version._id);assert.equal(checked.canGenerate,true);assert.equal(checked.summary!.brand.colors.text,'#000000');
    await brands.put({expectedRevision:1,brandKit:initialBrand},randomUUID());
    assert.equal((await checker.check(version._id)).generationInputHash,checked.generationInputHash);
    const key=randomUUID(),input={expectedProjectRevision:1,planVersionId:version._id,generationInputHash:checked.generationInputHash!},result=await service.approve(projectId,input,key);
    const run=(await db.collection<GenerationRun>('generation_runs').findOne({_id:result.job.generationRunId}))!,approval=(await db.collection<Approval>('approvals').findOne({_id:run.approvalId}))!;
    const snapshot=validateRenderPlan(JSON.parse(approval.inputCanonical));assert.equal(snapshot.settingsSnapshot.brand.revisionId,first.id);assert.equal(snapshot.settingsSnapshot.brand.colors.canvas,'#F5F3EB');
    await brands.put({expectedRevision:2,brandKit:{...initialBrand,primaryColor:'#FFFFFF'}},randomUUID());
    assert.equal((await db.collection<Approval>('approvals').findOne({_id:approval._id}))!.inputCanonical,approval.inputCanonical);
    assert.equal((await service.approve(projectId,input,key)).replayed,true);assert.equal((await speech())!.reservations.length,1);await checkDatabase(db);
  });

  test('missing captured brand cannot be checked or approved and consumes no speech allowance',async()=>{
    version.settingsSnapshot={...version.settingsSnapshot,brandKitRevisionId:randomUUID()};
    const project=(await db.collection<Row>('projects').findOne({_id:projectId}))!;
    version.inputHash=digest(JSON.stringify({brief:project.brief,settings:version.settingsSnapshot}));await db.collection<Row>('projects').updateOne({_id:projectId},{$set:{settings:version.settingsSnapshot}});await db.collection<PlanVersion>('plan_versions').replaceOne({_id:version._id},version);
    await assert.rejects(new RenderInputService(client,name,context,providerEnv,async()=>pins).check(version._id),/brand palette is unavailable/);
    await assert.rejects(approve(),/brand palette is unavailable/);assert.equal((await speech())!.reservations.length,0);assert.equal(await db.collection('approvals').countDocuments(),0);
  });

  test('English and Telugu approvals persist exact immutable canonical content, pins, one run/job and net reservation atomically', async () => {
    for (const language of ['en', 'te'] as const) {
      if (language === 'te') ({projectId, version} = await seed(language));
      const before = await speech(), result = await approve(); assert.equal(result.job.state, 'queued'); assert.equal(result.job.projectRevision, 2);
      const run = await db.collection<GenerationRun>('generation_runs').findOne({_id: result.job.generationRunId});
      const approval = await db.collection<Approval>('approvals').findOne({_id: run!.approvalId});
      const plan = validateRenderPlan(JSON.parse(approval!.inputCanonical)); assert.equal(generationHash(plan), body().generationInputHash);
      assert.equal(approval!.inputCanonical, canonicalJson(renderFixture(language).plan)); assert.equal(plan.settingsSnapshot.captionLanguage, language);
      assert.equal(run!.rendererBuildHash, 'd'.repeat(64)); assert.equal((await db.collection<Row>('projects').findOne({_id: projectId}))?.latestRunId, run!._id);
      const after = await speech(), held = after!.reservations.find(r => r.id === run!.reservationId)!;
      assert.equal(after!.allowance.observedRemaining, before!.allowance.observedRemaining! - held.units);
      assert.equal(await db.collection('jobs').countDocuments(), 0); assert.equal(JSON.stringify(result).includes('voiceId'), false);
    }
    assert.equal(await db.collection('activity_events').countDocuments({type: 'generation_changed'}), 2); await checkDatabase(db);
  });
  test('concurrent same-key and different-key approvals produce one approval/run/reservation, replay precedes later availability checks', async () => {
    const key = randomUUID(), input = body();
    const results = await Promise.all([key, key, randomUUID(), randomUUID()].map(k => service.approve(projectId, input, k)));
    assert.equal(new Set(results.map(r => r.job.jobId)).size, 1); assert.equal(await db.collection('approvals').countDocuments(), 1); assert.equal((await speech())!.reservations.length, 1);
    await db.collection<Row>('provider_controls').updateOne({_id: 'elevenlabs'}, {$set: {state: 'disabled', operatorDisabled: true}});
    await db.collection('generation_workers').deleteMany({});
    const unavailable = new GenerationService(client, name, context, {}, async () => {throw new Error('not installed');});
    assert.deepEqual(await unavailable.approve(projectId, input, key), {...results[0], replayed: true});
    assert.equal((await unavailable.approve(projectId, input, randomUUID())).job.jobId, results[0].job.jobId);
    await assert.rejects(service.approve(projectId, {...input, expectedProjectRevision: 2}, key), /different generation input/);
  });
  test('queued cancellation is confirmed, frees unused held units, preserves approval, and never restarts same version/hash', async () => {
    const input = body(), accepted = await approve(), original = await db.collection<Approval>('approvals').findOne({}); const key = randomUUID();
    const result = await service.cancel(accepted.job.jobId, {expectedRevision: 1}, key);
    assert.equal(result.job.state, 'cancelled'); assert.equal(result.job.cancellationConfirmed, true); assert.equal(result.job.statusRevision, 2);
    assert.equal((await speech())!.allowance.observedRemaining, 10000); assert.equal((await speech())!.reservations.length, 0);
    assert.equal((await db.collection<Row>('projects').findOne({_id: projectId}))!.latestRunId, null);
    assert.deepEqual(await db.collection<Approval>('approvals').findOne({}), original);
    assert.deepEqual(await service.cancel(accepted.job.jobId, {expectedRevision: 1}, key), {...result, replayed: true});
    assert.equal((await service.approve(projectId, input, randomUUID())).job.state, 'cancelled'); assert.equal(await db.collection('generation_runs').countDocuments(), 1);
    assert.equal((await service.overview(projectId)).job!.state, 'cancelled');
  });
  test('cancel CAS mismatch cannot release allowance; concurrent cancellation only releases once', async () => {
    const accepted = await approve(), before = (await speech())!.allowance.observedRemaining;
    await assert.rejects(service.cancel(accepted.job.jobId, {expectedRevision: 2}, randomUUID()), /status changed/); assert.equal((await speech())!.allowance.observedRemaining, before);
    const key = randomUUID(), results = await Promise.all([1, 2, 3].map(() => service.cancel(accepted.job.jobId, {expectedRevision: 1}, key)));
    assert.ok(results.every(r => r.job.state === 'cancelled')); assert.equal((await speech())!.allowance.observedRemaining, 10000);
  });
  test('changed provider config/period cancellation removes unused reservation without crediting a different allowance or reenabling provider', async () => {
    const accepted = await approve(); await db.collection<Row>('provider_controls').updateOne({_id: 'elevenlabs'}, {$set: {state: 'disabled', operatorDisabled: true, configHash: 'e'.repeat(64), 'allowance.periodId': 'new-period', 'allowance.observedRemaining': 20}});
    await service.cancel(accepted.job.jobId, {expectedRevision: 1}, randomUUID()); const row = (await speech())!;
    assert.equal(row.allowance.observedRemaining, 20); assert.equal(row.reservations.length, 0); assert.equal(row.operatorDisabled, true); assert.equal(row.state, 'disabled');
  });
  test('current pointer/revision/hash/source/settings and active work are independently guarded', async () => {
    const input = body(), original = await db.collection<Row>('projects').findOne({_id: projectId});
    for (const changes of [{revision: Long.fromNumber(2)}, {currentPlanVersionId: randomUUID()}, {briefRevision: Long.fromNumber(2)}, {planningRequestId: randomUUID()}, {activePlanningJobId: randomUUID()}, {latestRunId: randomUUID()}, {'brief.idea': 'changed'}, {'settings.targetSeconds': 60}]) {
      await db.collection<Row>('projects').replaceOne({_id: projectId}, original!); await db.collection<Row>('projects').updateOne({_id: projectId}, {$set: changes});
      await assert.rejects(service.approve(projectId, input, randomUUID()));
    }
    await db.collection<Row>('projects').replaceOne({_id: projectId}, original!);
    await assert.rejects(service.approve(projectId, {...input, generationInputHash: 'f'.repeat(64)}, randomUUID()), /exact input/);
    assert.equal(await db.collection('generation_runs').countDocuments(), 0); assert.equal((await speech())!.reservations.length, 0);
  });
  test('worker absent, expired, draining or incompatible refuses all writes/reservations', async () => {
    const workers = db.collection<GenerationWorker>('generation_workers'), original = await workers.findOne({});
    for (const changes of [{state: 'draining' as const}, {expiresAt: new Date(0)}, {heartbeatAt: new Date(0)}, {fonts: {...pins, telugu: 'f'.repeat(64)}}, {capabilities: []}]) {
      await workers.replaceOne({_id: 'generation:local'}, {...original!, ...changes}); await assert.rejects(approve(), /compatible running worker/);
    }
    await workers.deleteMany({}); await assert.rejects(approve(), /compatible running worker/);
    assert.equal(await db.collection('approvals').countDocuments(), 0); assert.equal((await speech())!.reservations.length, 0);
  });
  test('operator disablement, expired tests/config, uncertainty and insufficient free allowance refuse admission', async () => {
    const original = await speech();
    for (const changes of [{state: 'disabled'}, {operatorDisabled: true}, {state: 'paused'}, {expiresAt: new Date(0)}, {tests: []}, {configHash: 'f'.repeat(64)}, {'allowance.observedRemaining': 1}, {reservations: [{id: randomUUID(), state: 'uncertain', units: 1, createdAt: new Date()}]}]) {
      await db.collection<ProviderControl>('provider_controls').replaceOne({_id: 'elevenlabs'}, original!); await db.collection<Row>('provider_controls').updateOne({_id: 'elevenlabs'}, {$set: changes});
      await assert.rejects(approve(), /speech availability/);
    }
    assert.equal(await db.collection('generation_runs').countDocuments(), 0);
  });
  test('concurrent projects cannot overreserve the same free balance', async () => {
    const other = await seed(), f = renderFixture(), units = f.plan.narration.reduce((n, s) => n + s.text.length * 2 + 100, 0);
    await db.collection<Row>('provider_controls').updateOne({_id: 'elevenlabs'}, {$set: {'allowance.observedRemaining': units}});
    const results = await Promise.allSettled([approve(), service.approve(other.projectId, {...body(), planVersionId: other.version._id}, randomUUID())]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1); assert.equal((await speech())!.allowance.observedRemaining, 0); assert.equal((await speech())!.reservations.length, 1);
  });
  test('a disablement, worker drain, membership removal or source change between preparation and admission wins over approval', async () => {
    const originalProject = await db.collection<Row>('projects').findOne({_id: projectId}), originalProvider = await speech(), worker = await db.collection<GenerationWorker>('generation_workers').findOne({});
    const changes = [
      () => db.collection<Row>('provider_controls').updateOne({_id: 'elevenlabs'}, {$set: {operatorDisabled: true}, $inc: {revision: Long.ONE}}),
      () => db.collection<GenerationWorker>('generation_workers').updateOne({_id: 'generation:local'}, {$set: {state: 'draining'}, $inc: {revision: Long.ONE}}),
      () => db.collection<Row>('memberships').updateOne({userId: testUserId}, {$set: {status: 'disabled'}}),
      () => db.collection<Row>('projects').updateOne({_id: projectId}, {$inc: {revision: Long.ONE}}),
    ];
    for (const change of changes) {
      const racing = new GenerationService(client, name, context, providerEnv, async () => {await change(); return pins;});
      await assert.rejects(racing.approve(projectId, body(), randomUUID()));
      await db.collection<Row>('projects').replaceOne({_id: projectId}, originalProject!); await db.collection<ProviderControl>('provider_controls').replaceOne({_id: 'elevenlabs'}, originalProvider!);
      await db.collection<GenerationWorker>('generation_workers').replaceOne({_id: 'generation:local'}, worker!); await db.collection<Row>('memberships').updateOne({userId: testUserId}, {$set: {status: 'active'}});
    }
    assert.equal(await db.collection('generation_runs').countDocuments(), 0); assert.equal((await speech())!.reservations.length, 0);
  });
  test('a second approved actor deduplicates the run without replacing the first approval actor or reserving twice', async () => {
    const accepted = await approve(), original = await db.collection<Approval>('approvals').findOne({});
    const userId = 'abcdef012345678901234567'; await db.collection<Row>('memberships').insertOne({...membershipFixture(), userId, normalizedEmail: 'second@example.com'});
    const second = new GenerationService(client, name, {...context, userId}, providerEnv, async () => pins);
    assert.equal((await second.approve(projectId, body(), randomUUID())).job.jobId, accepted.job.jobId);
    assert.deepEqual(await db.collection<Approval>('approvals').findOne({}), original); assert.equal((await speech())!.reservations.length, 1);
  });
  test('uncertain held usage is retained on cancellation and never credited as unused', async () => {
    const accepted = await approve(), provider = (await speech())!;
    await db.collection<Row>('provider_controls').updateOne({_id: 'elevenlabs'}, {$set: {'reservations.0.state': 'uncertain'}});
    await service.cancel(accepted.job.jobId, {expectedRevision: 1}, randomUUID());
    assert.equal((await speech())!.allowance.observedRemaining, provider.allowance.observedRemaining); assert.equal((await speech())!.reservations[0].state, 'uncertain');
  });
  test('scoped foreign plan/job IDs never create a receipt or leak another workspace run', async () => {
    const accepted = await approve(), other = await seed();
    await assert.rejects(service.approve(other.projectId, body(), randomUUID()));
    const secondWorkspace = randomUUID(); await db.collection<Row>('memberships').insertOne({...membershipFixture(), workspaceId: secondWorkspace});
    const foreign = new GenerationService(client, name, {...context, workspaceId: secondWorkspace}, providerEnv, async () => pins);
    assert.equal(await foreign.job(accepted.job.jobId), null); await assert.rejects(foreign.overview(projectId), /could not be found/);
    await assert.rejects(foreign.cancel(accepted.job.jobId, {expectedRevision: 1}, randomUUID()), /could not be found/);
    assert.equal(await db.collection('generation_runs').countDocuments(), 1);
  });
  test('membership, project deletion and workspace scope guard initial requests, status, replay and cancellation', async () => {
    const key = randomUUID(), input = body(), accepted = await service.approve(projectId, input, key);
    const outsider = new GenerationService(client, name, {...context, workspaceId: randomUUID()}, providerEnv, async () => pins);
    await assert.rejects(outsider.job(accepted.job.jobId), /team access/);
    await db.collection<Row>('memberships').updateOne({userId: testUserId}, {$set: {status: 'disabled'}});
    await assert.rejects(service.approve(projectId, input, key), /team access/); await assert.rejects(service.cancel(accepted.job.jobId, {expectedRevision: 1}, randomUUID()), /team access/);
    await db.collection<Row>('memberships').updateOne({userId: testUserId}, {$set: {status: 'active'}});
    await db.collection<Row>('projects').updateOne({_id: projectId}, {$set: {deletedAt: new Date()}});
    await assert.rejects(service.job(accepted.job.jobId), /could not be found/); await assert.rejects(service.approve(projectId, input, key), /could not be found/);
  });
  test('a transaction failure rolls back the approval, run, receipt, reservation and project pointer', async () => {
    await db.command({collMod: 'generation_commands', validator: {$jsonSchema: {bsonType: 'object', required: ['impossible']}}});
    try {await assert.rejects(approve()); assert.equal(await db.collection('approvals').countDocuments(), 0); assert.equal(await db.collection('generation_runs').countDocuments(), 0); assert.equal((await speech())!.allowance.observedRemaining, 10000); assert.equal((await db.collection<Row>('projects').findOne({_id: projectId}))!.latestRunId, null);}
    finally {const {generationCollections} = await import('../src/server/db/generation-schemas'); await db.command({collMod: 'generation_commands', validator: generationCollections.find(c => c.name === 'generation_commands')!.validator});}
  });
  test('queued run blocks edits, cancel allows a new reviewed version without changing the original approval', async () => {
    const accepted = await approve(), edits = new PlanEditService(client, name, context);
    const change = {expectedProjectRevision: 2, edits: {headings: [{sceneId: 'scene_1', text: 'Rainfall'}]}};
    await assert.rejects(edits.edit(version._id, change, randomUUID()), /Generated-project editing/);
    await service.cancel(accepted.job.jobId, {expectedRevision: 1}, randomUUID());
    const saved = await edits.edit(version._id, {...change, expectedProjectRevision: 3}, randomUUID()); assert.equal(saved.plan.versionNumber, 2);
    const check = await new RenderInputService(client, name, context, providerEnv, async () => pins).check(saved.plan.id); assert.equal(check.canGenerate, true);
    assert.equal(generationView((await db.collection<GenerationRun>('generation_runs').findOne({}))!, 4).state, 'cancelled');
  });
});
