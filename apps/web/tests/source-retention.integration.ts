import {after, before, beforeEach, describe, test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {MongoClient, Long, type Db} from 'mongodb';
import {databaseClientOptions} from '../src/server/db/connection';
import {migrateDatabase} from '../src/server/db/migrations';
import {sourceRetentionAudit} from '../src/server/cleanup/source-retention';
import {reuseRecordHash} from '../src/server/cleanup/reuse-pins';
import {ProjectService} from '../src/server/projects/service';
import {projectFixture, workspaceFixture, membershipFixture, testWorkspaceId, testUserId, type Row} from './fixtures/database';

const uri = process.env.MONGODB_TEST_URI ?? 'mongodb://127.0.0.1:27028/?replicaSet=vcF03';
if (!/^mongodb:\/\/(127\.0\.0\.1|localhost):\d+\/(?:\?[^\s]*)?$/.test(uri)) throw new Error('Isolated loopback replica set required.');
const name = `videocraft_retention_test_${randomUUID().replaceAll('-', '')}`;
const client = new MongoClient(uri, {...databaseClientOptions, monitorCommands: true});

describe('read-only deleted-project source retention audit', {concurrency: false}, () => {
  let db: Db, project: Row;
  const writes: string[] = [];
  client.on('commandStarted', event => {if (['insert', 'update', 'delete', 'findAndModify', 'create', 'createIndexes', 'collMod', 'drop'].includes(event.commandName)) writes.push(event.commandName);});
  before(async () => {await client.connect(); db = client.db(name); await migrateDatabase(db);});
  beforeEach(async () => {
    for (const c of await db.listCollections({}, {nameOnly: true}).toArray()) if (c.name !== 'schema_migrations') await db.collection(c.name).deleteMany({});
    await db.collection<Row>('workspaces').insertOne(workspaceFixture());
    await db.collection<Row>('memberships').insertOne(membershipFixture());
    project = projectFixture(); project.brief.idea = 'PRIVATE_SOURCE_MARKER';
    await db.collection<Row>('projects').insertOne(project);
    const service = new ProjectService(client, name, {workspaceId: testWorkspaceId, userId: testUserId, userName: 'Tester'}, 'retention-test-secret-'.repeat(3));
    await service.delete(project._id, {expectedProjectRevision: 1}, randomUUID());
  });
  after(async () => {try {if (!/^videocraft_retention_test_[a-f0-9]{32}$/.test(name)) throw new Error('Unsafe fixture cleanup'); await db.dropDatabase();} finally {await client.close();}});
  const audit = () => sourceRetentionAudit(client, name, project._id);
  const insert = (collection: string, extra: Record<string, unknown> = {}) => {
    const row: Row = {_id: randomUUID(), workspaceId: testWorkspaceId, projectId: project._id, ...extra};
    return db.collection<Row>(collection).insertOne(row, {bypassDocumentValidation: true}).then(() => row);
  };
  const codes = (result: Awaited<ReturnType<typeof audit>>) => result.blockers.map(b => b.code);

  test('tombstone-only snapshot reports counts without permission to purge, content or writes', async () => {
    await insert('plan_versions', {plan: {title: 'PRIVATE_PLAN_MARKER'}});
    await insert('idempotency_records', {safeResultRef: {id: project._id}, safeResponseSnapshot: {brief: 'PRIVATE_REPLAY_MARKER'}});
    const before = await db.collection<Row>('projects').findOne({_id: project._id}); writes.length = 0;
    const result = await audit();
    assert.equal(result.state, 'review_required'); assert.equal(result.purgeImplemented, false); assert.equal(result.retainedContent, true);
    assert.deepEqual(result.counts.plan_versions, {count: 1, truncated: false});
    assert.deepEqual(result.counts.idempotency_records, {count: 1, truncated: false});
    assert.equal(result.counts.project_delete_commands.count, 1);
    assert.deepEqual(result.blockers, []); assert.deepEqual(writes, []);
    assert(!JSON.stringify(result).includes('PRIVATE_')); assert.deepEqual(await db.collection<Row>('projects').findOne({_id: project._id}), before);
    assert.equal(await db.collection('plan_versions').countDocuments(), 1);
  });
  test('live, missing and invalid tombstones refuse without writes', async () => {
    await db.collection<Row>('projects').updateOne({_id: project._id}, {$set: {deletedAt: null}}); writes.length = 0;
    await assert.rejects(audit(), {code: 'DELETED_PROJECT_REQUIRED'}); assert.deepEqual(writes, []);
    await assert.rejects(sourceRetentionAudit(client, name, randomUUID()), {code: 'DELETED_PROJECT_REQUIRED'});
    await db.collection<Row>('projects').updateOne({_id: project._id}, {$set: {deletedAt: new Date(), deletionReceipt: null}});
    await assert.rejects(audit(), {code: 'DELETED_PROJECT_REQUIRED'});
  });
  test('expired rendering lease and uncertain planning/speech evidence remain blockers', async () => {
    const run = await insert('generation_runs', {state: 'running', owner: randomUUID(), leaseUntil: new Date(0), stage: 'rendering'});
    const job = await insert('jobs', {state: 'failed', submission: 'uncertain', owner: null, leaseUntil: null});
    await insert('stage_attempts', {jobId: job._id, state: 'uncertain'});
    await insert('generation_speech_attempts', {runId: run._id, state: 'uncertain'});
    writes.length = 0; assert(codes(await audit()).includes('unresolved_work')); assert.deepEqual(writes, []);
    assert.equal((await db.collection<Row>('generation_runs').findOne({_id: run._id}))!.state, 'running');
  });
  test('settled speech requires exact completed source checkpoint; drift cannot be hidden by removed label', async () => {
    const run = await insert('generation_runs', {state: 'failed', owner: null, leaseUntil: null});
    const attempt = await insert('generation_speech_attempts', {runId: run._id, state: 'settled', audioHash: 'a'.repeat(64), inputHash: 'b'.repeat(64), providerConfigHash: 'c'.repeat(64), textHash: 'd'.repeat(64), segmentId: 'segment_scene_1', byteLength: 48044, sampleRate: 24000});
    assert(codes(await audit()).includes('incomplete_speech_cleanup'));
    const {state: _state, workspaceId: _workspace, projectId: _project, _id, ...source} = attempt;
    await insert('speech_cleanup_tasks', {_id: attempt._id, state: 'removed', source: {...source, attemptId: _id}});
    assert(!codes(await audit()).includes('incomplete_speech_cleanup'));
    await db.collection<Row>('speech_cleanup_tasks').updateOne({_id: attempt._id}, {$set: {'source.audioHash': 'e'.repeat(64)}}, {bypassDocumentValidation: true});
    assert(codes(await audit()).includes('incomplete_speech_cleanup'));
  });
  test('rendered artifacts require matching cleanup provenance, retained assets still block', async () => {
    const artifactId = randomUUID(); const run = await insert('generation_runs', {state: 'rendered_local', owner: null, leaseUntil: null, artifactId, finishedAt: new Date()});
    const artifact = await insert('generation_local_artifacts', {_id: artifactId, runId: run._id, manifestHash: 'a'.repeat(64), inputHash: 'b'.repeat(64), rendererBuildHash: 'c'.repeat(64)});
    assert(codes(await audit()).includes('incomplete_media_cleanup'));
    await insert('local_render_cleanup_tasks', {_id: artifactId, runId: run._id, state: 'cleaned', source: {artifactId, runId: run._id, manifestHash: artifact.manifestHash, inputHash: artifact.inputHash, rendererBuildHash: artifact.rendererBuildHash}});
    assert(!codes(await audit()).includes('incomplete_media_cleanup'));
    await insert('video_assets', {lifecycleState: 'available'});
    assert(codes(await audit()).includes('incomplete_media_cleanup'));
  });
  test('release receipts must match every original reuse field; foreign consumers remain visible', async () => {
    const ref = await insert('generation_speech_reuses', {runId: randomUUID(), sourceRunId: randomUUID(), sourceAttemptId: randomUUID(), leaseEpoch: Long.ONE, createdAt: new Date()});
    assert(codes(await audit()).includes('retained_reuse'));
    await insert('speech_reuse_releases', {_id: ref._id, targetRunId: ref.runId, sourceRunId: ref.sourceRunId, sourceAttemptId: ref.sourceAttemptId, reuseHash: reuseRecordHash(ref), reason: 'deleted_target_render_cleaned', releasedAt: new Date()});
    assert(!codes(await audit()).includes('retained_reuse'));
    await db.collection<Row>('generation_speech_reuses').updateOne({_id: ref._id}, {$set: {leaseEpoch: Long.fromNumber(2)}}, {bypassDocumentValidation: true});
    assert(codes(await audit()).includes('retained_reuse'));
    const source = await insert('generation_runs', {state: 'failed', owner: null, leaseUntil: null});
    await insert('generation_speech_reuses', {workspaceId: randomUUID(), projectId: randomUUID(), sourceRunId: source._id});
    assert(codes(await audit()).includes('scope_mismatch'));
  });
  test('scope mismatch, copied provenance and unknown global publication/pins fail conservatively', async () => {
    await insert('plan_versions', {workspaceId: randomUUID()});
    await insert('project_duplicate_commands', {sourceProjectId: project._id, projectId: randomUUID()});
    await insert('publishing_payloads', {projectId: randomUUID()});
    await insert('asset_refs', {projectId: randomUUID()});
    const result = await audit();
    assert(codes(result).includes('scope_mismatch')); assert(codes(result).includes('copied_plan_provenance')); assert(codes(result).includes('external_reference'));
    assert.equal(result.counts.plan_versions.count, 0);
  });
  test('bounded inventories disclose truncation, never an eligibility result or private row data', async () => {
    await db.collection<Row>('plan_versions').insertMany(Array.from({length: 201}, (_, i) => ({_id: randomUUID(), workspaceId: testWorkspaceId, projectId: project._id, versionNumber: Long.fromNumber(i + 1), sourcePlanningRequestId: randomUUID(), privateText: 'PRIVATE_OVER_LIMIT'})), {bypassDocumentValidation: true});
    const result = await audit(); assert.deepEqual(result.counts.plan_versions, {count: 200, truncated: true});
    assert(codes(result).includes('inventory_limit')); assert.equal(result.state, 'blocked'); assert.equal(result.purgeImplemented, false);
    assert(!JSON.stringify(result).includes('PRIVATE_'));
  });
  test('operator CLI reports the isolated fixture without credentials, content or mutations', async () => {
    const before = await db.collection<Row>('projects').findOne({_id: project._id});
    const cwd = fileURLToPath(new URL('../', import.meta.url));
    const {stdout, stderr} = await promisify(execFile)(process.execPath, ['--import', 'tsx', 'scripts/cleanup.ts', 'source-audit', project._id], {
      cwd, env: {...process.env, MONGODB_URI: uri, MONGODB_DB: name}, timeout: 60000,
    });
    const result = JSON.parse(stdout);
    assert.equal(result.projectId, project._id); assert.equal(result.state, 'review_required');
    assert.equal(result.retainedContent, true); assert.equal(result.purgeImplemented, false);
    assert(!stdout.includes(uri)); assert(!stdout.includes('PRIVATE_')); assert.equal(stderr, '');
    assert.deepEqual(await db.collection<Row>('projects').findOne({_id: project._id}), before);
    await assert.rejects(promisify(execFile)(process.execPath, ['--import', 'tsx', 'scripts/cleanup.ts', 'source-audit', randomUUID()], {
      cwd, env: {...process.env, MONGODB_URI: uri, MONGODB_DB: name}, timeout: 60000,
    }), (error: unknown) => {
      const result = error as {stdout: string; stderr: string};
      assert.equal(result.stdout, ''); assert.equal(result.stderr.trim(), 'DELETED_PROJECT_REQUIRED'); return true;
    });
  });
});
