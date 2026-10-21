import {after, before, beforeEach, describe, test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Long, MongoClient, type Db} from 'mongodb';
import {databaseClientOptions} from '../src/server/db/connection';
import {checkDatabase, migrateDatabase} from '../src/server/db/migrations';
import {PlanEditService} from '../src/server/planning/plan-edit-service';
import {PlanningService, type Row} from '../src/server/planning/service';
import {ProjectService} from '../src/server/projects/service';
import type {PlanVersion} from '../src/server/planning/contracts';
import {membershipFixture, workspaceFixture, testUserId, testWorkspaceId} from './fixtures/database';
import {RenderInputService} from '../src/server/rendering/service';
import {providerEnv, providerFixture} from './fixtures/providers';
import {pins} from './fixtures/rendering';
import {digest} from '../src/server/providers/config';

const uri = process.env.MONGODB_TEST_URI ?? 'mongodb://127.0.0.1:27028/?replicaSet=vcF03';
if (!/^mongodb:\/\/(127\.0\.0\.1|localhost):\d+\/(?:\?[^\s]*)?$/.test(uri)) throw new Error('Isolated loopback database required.');
const name = `videocraft_f08_test_${randomUUID().replaceAll('-', '')}`, client = new MongoClient(uri, databaseClientOptions);
const context = {workspaceId: testWorkspaceId, userId: testUserId, userName: 'Tester'};
describe('immutable direct plan text edits on a real replica set', {concurrency: false}, () => {
  let db: Db, edits: PlanEditService, projects: ProjectService, planning: PlanningService, base: PlanVersion;
  before(async () => {await client.connect(); db = client.db(name); await migrateDatabase(db);});
  beforeEach(async () => {
    for (const c of ['plan_versions', 'plan_edit_commands', 'plan_restore_commands', 'projects', 'workspaces', 'memberships', 'idempotency_records', 'activity_events', 'provider_controls']) await db.collection(c).deleteMany({});
    await db.collection<Row>('workspaces').insertOne(workspaceFixture()); await db.collection<Row>('memberships').insertOne(membershipFixture());
    edits = new PlanEditService(client, name, context); projects = new ProjectService(client, name, context, 'test-plan-secret'.repeat(4)); planning = new PlanningService(client, name, context, {AUTH_SECRET: 'test-plan-secret'.repeat(4)});
    const project = (await projects.create({idea: 'Explain water', settings: {language: 'en', targetSeconds: 30, voiceCatalogId: null, accentId: null, brandKitRevisionId: null, themeId: 'clean-educational-v1', captionStyleId: 'readable-default-v1'}}, randomUUID())).project;
    const id = randomUUID(), request = randomUUID();
    base = {_id: id, schemaVersion: 1, workspaceId: testWorkspaceId, projectId: project.id, versionNumber: Long.ONE, sourceBriefRevision: Long.ONE, sourcePlanningRequestId: request, inputHash: digest(JSON.stringify({brief: project.brief, settings: project.settings})), settingsSnapshot: project.settings,
      plan: {schemaVersion: 2, title: 'Water', learningObjective: 'Explain water', language: 'en', targetSeconds: 30, scenes: [1, 2, 3].map(i => ({sceneId: `scene_${i}`, heading: 'Water', narration: 'Water moves.', labels: ['Water', 'Air'], layout: 'cycle'})), captions: [1, 2, 3].map(i => ({captionId: `caption_scene_${i}`, sourceSegmentId: `scene_${i}`, text: 'Water moves.'})), reviewNotes: []}, plannerModelId: 'test-model', promptContractVersion: 'educational-diagrams-v1', createdAt: new Date(), createdBy: testUserId};
    await db.collection<PlanVersion>('plan_versions').insertOne(base);
    await db.collection<Row>('projects').updateOne({_id: project.id}, {$set: {currentPlanVersionId: id, planningRequestId: request, nextPlanVersionNumber: Long.ONE}});
  });
  after(async () => {try {if (!/^videocraft_f08_test_[a-f0-9]{32}$/.test(name)) throw new Error('Unsafe cleanup'); await db.dropDatabase();} finally {await client.close();}});
  const body = () => ({expectedProjectRevision: 1, edits: {narration: [{segmentId: 'scene_1', text: 'Rain falls into rivers.'}], headings: [{sceneId: 'scene_1', text: 'Rainfall'}]}});
  const renderInputs = () => new RenderInputService(client, name, context, providerEnv, async () => pins);
  async function selectRenderVoice() {
    const project = await projects.get(base.projectId), settings = {...project.settings, voiceCatalogId: 'alice-evaluation', accentId: 'source-voice'};
    await db.collection<Row>('projects').updateOne({_id: base.projectId}, {$set: {settings}});
    await db.collection<PlanVersion>('plan_versions').updateOne({_id: base._id}, {$set: {settingsSnapshot: settings, inputHash: digest(JSON.stringify({brief: project.brief, settings}))}});
    await db.collection<Row>('provider_controls').insertOne(providerFixture());
  }
  test('saves a new immutable version with matching captions, parent/hash, current pointer and actor/activity', async () => {
    const before = await db.collection<PlanVersion>('plan_versions').findOne({_id: base._id});
    const saved = await edits.edit(base._id, body(), randomUUID()); assert.equal(saved.plan.versionNumber, 2); assert.equal(saved.plan.projectRevision, 2);
    assert.equal(saved.plan.source, 'direct_edit'); assert.equal(saved.plan.parentPlanVersionId, base._id); assert.equal(saved.plan.isCurrent, true); assert.equal(saved.plan.canGenerate, false);
    assert.equal(saved.plan.plan.captions[0].text, 'Rain falls into rivers.'); assert.match(saved.plan.contentHash!, /^[a-f0-9]{64}$/);
    assert.deepEqual(await db.collection<PlanVersion>('plan_versions').findOne({_id: base._id}), before);
    const project = await projects.get(base.projectId); assert.equal(project.briefRevision, 1); assert.equal(project.revision, 2); assert.equal(project.currentPlanVersionId, saved.plan.id);
    assert.equal((await planning.plan(base._id)).isCurrent, false); assert.equal(await db.collection('activity_events').countDocuments({type: 'planning_changed'}), 1); await checkDatabase(db);
  });
  test('concurrent identical retries save one version; key mismatch refuses and replay survives later changes', async () => {
    const key = randomUUID(); const results = await Promise.all(Array.from({length: 4}, () => edits.edit(base._id, body(), key)));
    assert.equal(new Set(results.map(r => r.plan.id)).size, 1); assert.equal(await db.collection('plan_versions').countDocuments(), 2);
    const project = await projects.get(base.projectId); await projects.patch(project.id, {expectedProjectRevision: 2, patch: {brief: {...project.brief, idea: 'A newer brief'}}}, randomUUID());
    const replay = await edits.edit(base._id, body(), key); assert.equal(replay.plan.id, results[0].plan.id); assert.equal(replay.plan.projectRevision, 2); assert.equal(replay.plan.isCurrent, false);
    await assert.rejects(edits.edit(base._id, {...body(), expectedProjectRevision: 3}, key), /different plan edits/);
  });
  test('different concurrent editors have one winner and stale text cannot overwrite it', async () => {
    const results = await Promise.allSettled(['First', 'Second'].map(text => edits.edit(base._id, {expectedProjectRevision: 1, edits: {headings: [{sceneId: 'scene_1', text}]}}, randomUUID())));
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1); assert.equal(results.filter(r => r.status === 'rejected').length, 1);
    assert.equal(await db.collection('plan_versions').countDocuments(), 2);
    const project = await projects.get(base.projectId);
    await assert.rejects(edits.edit(base._id, {...body(), expectedProjectRevision: project.revision}, randomUUID()), /has changed/);
  });
  test('active planning, changed brief, missing membership and deleted projects refuse edits', async () => {
    await db.collection<Row>('projects').updateOne({_id: base.projectId}, {$set: {activePlanningJobId: randomUUID()}}); await assert.rejects(edits.edit(base._id, body(), randomUUID()), /active planning/);
    await db.collection<Row>('projects').updateOne({_id: base.projectId}, {$set: {activePlanningJobId: null}, $inc: {briefRevision: Long.ONE}}); await assert.rejects(edits.edit(base._id, body(), randomUUID()), /has changed/);
    const other = new PlanEditService(client, name, {...context, workspaceId: randomUUID()}); await assert.rejects(other.edit(base._id, body(), randomUUID()), /team access/);
    await db.collection<Row>('projects').updateOne({_id: base.projectId}, {$set: {deletedAt: new Date()}}); await assert.rejects(edits.edit(base._id, body(), randomUUID()), /could not be found/);
    assert.equal(await db.collection('plan_edit_commands').countDocuments(), 0);
  });
  test('no-op and invalid text cannot create versions or change counters', async () => {
    await assert.rejects(edits.edit(base._id, {expectedProjectRevision: 1, edits: {headings: [{sceneId: 'scene_1', text: 'Water'}]}}, randomUUID()), /Change narration/);
    await assert.rejects(edits.edit(base._id, {expectedProjectRevision: 1, edits: {narration: [{segmentId: 'scene_1', text: 'నీరు'}]}}, randomUUID()), /selected language/);
    assert.equal(await db.collection('plan_versions').countDocuments(), 1); assert.equal((await projects.get(base.projectId)).revision, 1);
  });
  test('diagram-only saves preserve spoken content and immutable originals while changing content hash and layout', async () => {
    const before = await db.collection<PlanVersion>('plan_versions').findOne({_id: base._id});
    const saved = await edits.edit(base._id, {expectedProjectRevision: 1, edits: {diagrams: [{sceneId: 'scene_1', labels: ['Rain', 'River', 'Sea'], layout: 'sequence'}]}}, randomUUID());
    assert.deepEqual(saved.plan.plan.captions, base.plan.captions); assert.equal(saved.plan.plan.scenes[0].narration, base.plan.scenes[0].narration);
    assert.deepEqual(saved.plan.plan.scenes[0].labels, ['Rain', 'River', 'Sea']); assert.equal(saved.plan.plan.scenes[0].layout, 'sequence');
    assert.deepEqual(await db.collection<PlanVersion>('plan_versions').findOne({_id: base._id}), before); assert.equal(saved.plan.parentPlanVersionId, base._id); assert.match(saved.plan.contentHash!, /^[a-f0-9]{64}$/);
    await checkDatabase(db);
  });
  test('mixed diagram/text commands replay once; invalid or stale diagram replacements cannot create versions', async () => {
    const key = randomUUID(), input = {...body(), edits: {...body().edits, diagrams: [{sceneId: 'scene_1', labels: ['Rain', 'River'], layout: 'comparison'}]}};
    const results = await Promise.all(Array.from({length: 3}, () => edits.edit(base._id, input, key)));
    assert.equal(new Set(results.map(r => r.plan.id)).size, 1); assert.equal(await db.collection('plan_versions').countDocuments(), 2);
    await assert.rejects(edits.edit(base._id, {...input, edits: {...input.edits, diagrams: [{...input.edits.diagrams[0], layout: 'cycle'}]}}, key), /different plan edits/);
    await assert.rejects(edits.edit(base._id, input, randomUUID()), /has changed/);
    const saved = results[0].plan;
    await assert.rejects(edits.edit(saved.id, {expectedProjectRevision: 2, edits: {diagrams: [{sceneId: 'scene_8', labels: ['Unknown', 'Scene'], layout: 'cycle'}]}}, randomUUID()), /Structural/);
    assert.equal(await db.collection('plan_versions').countDocuments(), 2);
  });
  test('history paginates newest-first with a project-bound cursor and legacy AI provenance', async () => {
    const second = await edits.edit(base._id, body(), randomUUID());
    await edits.edit(second.plan.id, {expectedProjectRevision: 2, edits: {headings: [{sceneId: 'scene_2', text: 'Clouds'}]}}, randomUUID());
    const first = await planning.versions(base.projectId, new URLSearchParams('kind=plan&limit=2'));
    assert.deepEqual(first.items.map(v => v.versionNumber), [3, 2]); assert.equal(first.page.hasMore, true);
    const next = await planning.versions(base.projectId, new URLSearchParams({kind: 'plan', limit: '2', cursor: first.page.nextCursor!}));
    assert.deepEqual(next.items.map(v => v.versionNumber), [1]); assert.equal(next.items[0].source, 'ai'); assert.equal(next.page.nextCursor, null);
    await assert.rejects(planning.versions(base.projectId, new URLSearchParams({kind: 'plan', limit: '1', cursor: first.page.nextCursor!})), /expired or changed/);
    const other = new PlanningService(client, name, {...context, workspaceId: randomUUID()}, {});
    await assert.rejects(other.versions(base.projectId, new URLSearchParams('kind=plan')), /team access/);
    await db.collection<Row>('projects').updateOne({_id: base.projectId}, {$set: {deletedAt: new Date()}});
    await assert.rejects(planning.versions(base.projectId, new URLSearchParams('kind=plan')), /could not be found/);
  });
  test('restore creates an immutable copy, records both parents, replays once and subsequent edits clear restore provenance', async () => {
    const second = await edits.edit(base._id, body(), randomUUID()), before = await db.collection<PlanVersion>('plan_versions').find().sort({versionNumber: 1}).toArray();
    const input = {expectedProjectRevision: 2, expectedCurrentPlanVersionId: second.plan.id}, key = randomUUID();
    const results = await Promise.all(Array.from({length: 4}, () => edits.restore(base._id, input, key)));
    const restored = results[0].plan; assert.equal(new Set(results.map(r => r.plan.id)).size, 1); assert.equal(restored.versionNumber, 3);
    assert.deepEqual(restored.plan, base.plan); assert.equal(restored.parentPlanVersionId, second.plan.id); assert.equal(restored.restoredFromPlanVersionId, base._id);
    assert.deepEqual(await db.collection<PlanVersion>('plan_versions').find({_id: {$in: before.map(v => v._id)}}).sort({versionNumber: 1}).toArray(), before);
    const edited = await edits.edit(restored.id, {expectedProjectRevision: 3, edits: {headings: [{sceneId: 'scene_1', text: 'Ocean'}]}}, randomUUID());
    assert.equal(edited.plan.restoredFromPlanVersionId, null); assert.equal(edited.plan.parentPlanVersionId, restored.id);
    const replay = await edits.restore(base._id, input, key); assert.equal(replay.plan.id, restored.id); assert.equal(replay.plan.projectRevision, 3); assert.equal(replay.plan.isCurrent, false);
    await assert.rejects(edits.restore(base._id, {...input, expectedProjectRevision: 4}, key), /different plan edits/);
    assert.equal(await db.collection('plan_restore_commands').countDocuments(), 1); assert.equal(await db.collection('jobs').countDocuments(), 0); await checkDatabase(db);
  });
  test('restore and concurrent edit have one winner; stale current IDs cannot overwrite it', async () => {
    const second = await edits.edit(base._id, body(), randomUUID());
    const input = {expectedProjectRevision: 2, expectedCurrentPlanVersionId: second.plan.id};
    const results = await Promise.allSettled([edits.restore(base._id, input, randomUUID()), edits.edit(second.plan.id, {expectedProjectRevision: 2, edits: {headings: [{sceneId: 'scene_2', text: 'Clouds'}]}}, randomUUID())]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1); assert.equal(await db.collection('plan_versions').countDocuments(), 3);
    await assert.rejects(edits.restore(base._id, {...input, expectedProjectRevision: 3}, randomUUID()), /has changed/);
  });
  test('restore refuses no-op, active work, older briefs/settings, inaccessible sources and malformed input without writes', async () => {
    await assert.rejects(edits.restore(base._id, {expectedProjectRevision: 1, expectedCurrentPlanVersionId: base._id}, randomUUID()), /already matches/);
    const second = await edits.edit(base._id, body(), randomUUID()), input = {expectedProjectRevision: 2, expectedCurrentPlanVersionId: second.plan.id};
    await db.collection<Row>('projects').updateOne({_id: base.projectId}, {$set: {activePlanningJobId: randomUUID()}});
    await assert.rejects(edits.restore(base._id, input, randomUUID()), /active planning/);
    await db.collection<Row>('projects').updateOne({_id: base.projectId}, {$set: {activePlanningJobId: null, 'settings.targetSeconds': 60}});
    await assert.rejects(edits.restore(base._id, input, randomUUID()), /different settings/);
    await db.collection<Row>('projects').updateOne({_id: base.projectId}, {$set: {settings: base.settingsSnapshot}, $inc: {briefRevision: Long.ONE}});
    await assert.rejects(edits.restore(base._id, input, randomUUID()), /has changed/);
    await assert.rejects(edits.restore(randomUUID(), input, randomUUID()), /could not be found/);
    await assert.rejects(edits.restore(base._id, {expectedProjectRevision: 2}, randomUUID()), /reviewed project/);
    assert.equal(await db.collection('plan_restore_commands').countDocuments(), 0); assert.equal(await db.collection('plan_versions').countDocuments(), 2);
  });
  test('an older source brief cannot be restored into a newer current plan; cross-workspace access and deleted replays refuse', async () => {
    const second = await edits.edit(base._id, body(), randomUUID());
    const input = {expectedProjectRevision: 2, expectedCurrentPlanVersionId: second.plan.id};
    await db.collection<Row>('projects').updateOne({_id: base.projectId}, {$set: {briefRevision: Long.fromNumber(2)}});
    await db.collection<PlanVersion>('plan_versions').updateOne({_id: second.plan.id}, {$set: {sourceBriefRevision: Long.fromNumber(2)}}); // Simulate a newer AI proposal from a changed brief.
    await assert.rejects(edits.restore(base._id, input, randomUUID()), /earlier brief/);
    const foreignWorkspace = randomUUID();
    await db.collection<Row>('memberships').insertOne({...membershipFixture(), _id: randomUUID(), workspaceId: foreignWorkspace});
    const foreign = new PlanEditService(client, name, {...context, workspaceId: foreignWorkspace});
    await assert.rejects(foreign.restore(base._id, input, randomUUID()), /could not be found/);
    await db.collection<Row>('projects').updateOne({_id: base.projectId}, {$set: {briefRevision: Long.ONE}});
    await db.collection<PlanVersion>('plan_versions').updateOne({_id: second.plan.id}, {$set: {sourceBriefRevision: Long.ONE}});
    const key = randomUUID(); await edits.restore(base._id, input, key);
    await db.collection<Row>('projects').updateOne({_id: base.projectId}, {$set: {deletedAt: new Date()}});
    await assert.rejects(edits.restore(base._id, input, key), /could not be found/);
  });
  test('render preparation requires explicit voice/accent, is read-only, leaks no provider IDs and makes no provider calls', async () => {
    const service = renderInputs(), missing = await service.check(base._id);
    assert.equal(missing.status, 'needs_changes'); assert.equal(missing.generationInputHash, null); assert.equal(missing.issues[0].code, 'VOICE_REQUIRED');
    await selectRenderVoice();
    const collections = ['projects', 'plan_versions', 'provider_controls', 'jobs', 'activity_events', 'plan_edit_commands', 'plan_restore_commands'];
    const before = await Promise.all(collections.map(c => db.collection(c).find().toArray()));
    const original = globalThis.fetch; let calls = 0;
    globalThis.fetch = (async () => {calls++; throw new Error('No provider request is allowed.');}) as typeof fetch;
    try {
      const first = await service.check(base._id), again = await service.check(base._id);
      assert.equal(first.status, 'compiled'); assert.equal(first.canGenerate, false); assert.match(first.generationInputHash!, /^[a-f0-9]{64}$/);
      assert.equal(first.generationInputHash, again.generationInputHash); assert.equal(first.summary?.sceneCount, 3);
      assert.deepEqual(first.executionBlocks.map(b => b.code), ['GENERATION_NOT_IMPLEMENTED']);
      assert.ok(!JSON.stringify(first).includes('Xb7hH8MSUJpSbSDYk0k2')); assert.ok(!JSON.stringify(first).includes(providerEnv.ELEVENLABS_API_KEY)); assert.equal(calls, 0);
    } finally {globalThis.fetch = original;}
    assert.deepEqual(await Promise.all(collections.map(c => db.collection(c).find().toArray())), before);
  });
  test('generation hash changes after direct edits; stale source/project/settings and active work cannot compile', async () => {
    await selectRenderVoice(); const service = renderInputs(), first = await service.check(base._id);
    const second = await edits.edit(base._id, body(), randomUUID()); const changed = await service.check(second.plan.id);
    assert.notEqual(changed.generationInputHash, first.generationInputHash);
    await assert.rejects(service.check(base._id), /current plan/);
    await db.collection<Row>('projects').updateOne({_id: base.projectId}, {$set: {activePlanningJobId: randomUUID()}});
    await assert.rejects(service.check(second.plan.id), /active work/);
    await db.collection<Row>('projects').updateOne({_id: base.projectId}, {$set: {activePlanningJobId: null, 'brief.idea': 'Undeclared source change'}});
    await assert.rejects(service.check(second.plan.id), /source does not match/);
    await db.collection<Row>('projects').updateOne({_id: base.projectId}, {$set: {'settings.targetSeconds': 60}});
    await assert.rejects(service.check(second.plan.id), /current plan/);
  });
  test('provider disablement, expiry, uncertainty and insufficient net allowance block execution without changing content hash', async () => {
    await selectRenderVoice(); const service = renderInputs(), first = await service.check(base._id);
    for (const [patch, code] of [[{operatorDisabled: true}, 'PROVIDER_DISABLED'], [{expiresAt: new Date(0)}, 'CAPABILITY_STALE'], [{'allowance.observedRemaining': 1}, 'FREE_ALLOWANCE_INSUFFICIENT'], [{reservations: [{id: randomUUID(), units: 10, state: 'uncertain', createdAt: new Date()}]}, 'UNCERTAIN_PROVIDER_USAGE']] as const) {
      await db.collection<Row>('provider_controls').replaceOne({_id: 'elevenlabs'}, providerFixture()); await db.collection<Row>('provider_controls').updateOne({_id: 'elevenlabs'}, {$set: patch});
      const result = await service.check(base._id); assert.equal(result.status, 'compiled'); assert.equal(result.generationInputHash, first.generationInputHash); assert.equal(result.executionBlocks[0].code, code);
    }
    await db.collection<Row>('provider_controls').replaceOne({_id: 'elevenlabs'}, {...providerFixture(), reservations: [{id: randomUUID(), units: 950, state: 'reserved', createdAt: new Date()}]});
    assert.deepEqual((await service.check(base._id)).executionBlocks.map(b => b.code), ['GENERATION_NOT_IMPLEMENTED']); // Remaining is already net of held units.
  });
  test('render preparation hides foreign/deleted plans, denies inactive members and sanitizes local asset failure', async () => {
    const foreign = new RenderInputService(client, name, {...context, workspaceId: randomUUID()}, providerEnv, async () => pins);
    await assert.rejects(foreign.check(base._id), /team access/);
    const foreignId = randomUUID(); await db.collection<Row>('memberships').insertOne({...membershipFixture(), _id: randomUUID(), workspaceId: foreignId});
    await assert.rejects(new RenderInputService(client, name, {...context, workspaceId: foreignId}, providerEnv, async () => pins).check(base._id), /could not be found/);
    await selectRenderVoice();
    await assert.rejects(new RenderInputService(client, name, context, providerEnv, async () => {throw new Error('private local path');}).check(base._id), error => !!error && typeof error === 'object' && 'code' in error && error.code === 'RENDER_ASSETS_UNAVAILABLE' && !String(error).includes('private local path'));
    await db.collection<Row>('projects').updateOne({_id: base.projectId}, {$set: {deletedAt: new Date()}}); await assert.rejects(renderInputs().check(base._id), /could not be found/);
  });
});
