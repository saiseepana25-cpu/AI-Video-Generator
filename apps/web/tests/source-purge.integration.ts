import {after, before, beforeEach, describe, test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Long, MongoClient, type Db} from 'mongodb';
import {databaseClientOptions} from '../src/server/db/connection';
import {migrateDatabase, checkDatabase} from '../src/server/db/migrations';
import {ProjectService} from '../src/server/projects/service';
import {SourcePurgeService} from '../src/server/cleanup/source-purge';
import {sourceCleanupStatus} from '../src/server/cleanup/source-contracts';
import {sourcePurgeCollections} from '../src/server/db/source-purge-schemas';
import type {PlanVersion, Job} from '../src/server/planning/contracts';
import {digest} from '../src/server/providers/config';
import {renderFixture} from './fixtures/rendering';
import {workspaceFixture, membershipFixture, testWorkspaceId, testUserId, type Row} from './fixtures/database';
const uri = process.env.MONGODB_TEST_URI ?? 'mongodb://127.0.0.1:27028/?replicaSet=vcF03';
if (!/^mongodb:\/\/(127\.0\.0\.1|localhost):\d+\/(?:\?[^\s]*)?$/.test(uri)) throw new Error('Isolated loopback replica set required.');
const name = `videocraft_source_purge_test_${randomUUID().replaceAll('-', '')}`, client = new MongoClient(uri, databaseClientOptions);
describe('guarded source-content purge and permanent minimal receipts', {concurrency: false}, () => {
  let db: Db, projects: ProjectService, purge: SourcePurgeService, projectId: string, createKey: string;
  const body = () => ({displayTitle: 'PRIVATE_TITLE', idea: 'PRIVATE_IDEA', settings: {language: 'en', targetSeconds: 30, voiceCatalogId: null, accentId: null, brandKitRevisionId: null, themeId: 'clean-educational-v1', captionStyleId: 'readable-default-v1'}});
  before(async () => {await client.connect(); db = client.db(name); await migrateDatabase(db);});
  beforeEach(async () => {
    for (const c of await db.listCollections({}, {nameOnly: true}).toArray()) if (c.name !== 'schema_migrations') await db.collection(c.name).deleteMany({});
    await db.collection<Row>('workspaces').insertOne(workspaceFixture()); await db.collection<Row>('memberships').insertOne(membershipFixture());
    projects = new ProjectService(client, name, {workspaceId: testWorkspaceId, userId: testUserId, userName: 'Tester'}, 'purge-test-secret-'.repeat(3));
    purge = new SourcePurgeService(client, name); createKey = randomUUID(); projectId = (await projects.create(body(), createKey)).project.id;
  });
  after(async () => {try {if (!/^videocraft_source_purge_test_[a-f0-9]{32}$/.test(name)) throw new Error('Unsafe cleanup'); await db.dropDatabase();} finally {await client.close();}});
  const remove = async (id = projectId) => {const p = await projects.get(id); return projects.delete(id, {expectedProjectRevision: p.revision}, randomUUID());};
  const seed = async () => {
    const p = await projects.get(projectId), now = new Date();
    const version: PlanVersion = {_id: randomUUID(), workspaceId: testWorkspaceId, projectId, schemaVersion: 1, versionNumber: Long.ONE, sourceBriefRevision: Long.ONE, sourcePlanningRequestId: randomUUID(), inputHash: digest(JSON.stringify({brief: p.brief, settings: p.settings})), settingsSnapshot: p.settings,
      plan: {...renderFixture().proposal, title: 'PRIVATE_PLAN_TITLE'}, plannerModelId: 'test-model', promptContractVersion: 'educational-diagrams-v1', createdAt: now, createdBy: testUserId};
    const job: Job = {_id: randomUUID(), workspaceId: testWorkspaceId, projectId, schemaVersion: 1, userId: testUserId, kind: 'plan', keyHash: 'a'.repeat(64), requestHash: 'b'.repeat(64), requestId: randomUUID(), inputHash: 'c'.repeat(64), sourceBriefRevision: Long.ONE,
      input: {brief: p.brief, settings: p.settings}, state: 'failed', statusRevision: Long.ONE, attempt: 0, submission: 'none', owner: null, leaseUntil: null, createdAt: now, updatedAt: now, startedAt: null, finishedAt: now, result: null, error: {code: 'TEST', message: 'No external request sent.', retryable: false}};
    await db.collection<PlanVersion>('plan_versions').insertOne(version); await db.collection<Job>('jobs').insertOne(job); return {version, job};
  };
  test('removes closed source plans/jobs, redacts project/replay payloads, preserves deletion and replay semantics', async () => {
    await seed(); const removed = await remove(), result = await purge.purge(projectId);
    assert.equal(result.sourceRecordsRemoved, true); assert.equal(result.allDataErased, false);
    assert.equal(await db.collection('jobs').countDocuments({projectId}), 0); assert.equal(await db.collection('plan_versions').countDocuments({projectId}), 0);
    const project = await db.collection<Row>('projects').findOne({_id: projectId}), replay = await db.collection<Row>('idempotency_records').findOne({'safeResultRef.id': projectId});
    assert.equal(project!.brief.idea, 'Source removed'); assert.equal(replay!.safeResponseSnapshot.brief.idea, 'Source removed');
    assert(!JSON.stringify(project).includes('PRIVATE_')); assert(!JSON.stringify(replay).includes('PRIVATE_'));
    await assert.rejects(projects.create(body(), createKey), {code: 'RESOURCE_NOT_FOUND'});
    assert.deepEqual((await projects.deletionStatus(projectId)).projectId, removed.receipt.projectId);
    assert.equal((await purge.purge(projectId)).replayed, true); assert.equal((await sourceCleanupStatus(db, testWorkspaceId, projectId)).state, 'source_records_removed');
    assert.equal(await db.collection('project_delete_commands').countDocuments({projectId}), 1); await checkDatabase(db);
  });
  test('purging a deleted copy redacts its duplicate receipt while preserving the live original', async () => {
    const source = await projects.get(projectId), copy = (await projects.duplicate(projectId, {expectedProjectRevision: source.revision}, randomUUID())).project;
    await remove(copy.id); await purge.purge(copy.id);
    const receipt = await db.collection<Row>('project_duplicate_commands').findOne({projectId: copy.id});
    assert.equal(receipt!.snapshot.displayTitle, 'Deleted project'); assert.equal(receipt!.snapshot.brief.idea, 'Source removed');
    assert.deepEqual(await projects.get(projectId), source); await checkDatabase(db);
  });
  test('live projects and surviving copies refuse without erasing any source', async () => {
    await assert.rejects(purge.purge(projectId), {code: 'SOURCE_PURGE_UNAVAILABLE'});
    const source = await projects.get(projectId); await projects.duplicate(projectId, {expectedProjectRevision: source.revision}, randomUUID());
    await remove(); await assert.rejects(purge.purge(projectId));
    assert.equal((await db.collection<Row>('projects').findOne({_id: projectId}))!.brief.idea, 'PRIVATE_IDEA'); assert.equal(await db.collection('source_purge_receipts').countDocuments(), 0);
  });
  test('uncertain planning, foreign scope and unknown publication/pins remain retention blockers', async () => {
    const {version, job} = await seed(); await remove();
    await db.collection<Job>('jobs').updateOne({_id: job._id}, {$set: {submission: 'uncertain'}}); await assert.rejects(purge.purge(projectId));
    await db.collection<Job>('jobs').updateOne({_id: job._id}, {$set: {submission: 'none'}});
    await db.collection<PlanVersion>('plan_versions').updateOne({_id: version._id}, {$set: {workspaceId: randomUUID()}}); await assert.rejects(purge.purge(projectId));
    await db.collection<PlanVersion>('plan_versions').updateOne({_id: version._id}, {$set: {workspaceId: testWorkspaceId}});
    await db.collection('publishing_payloads').insertOne({projectId: randomUUID()}); await assert.rejects(purge.purge(projectId)); await db.collection('publishing_payloads').deleteMany({});
    await db.collection('asset_refs').insertOne({owner: 'unknown'}); await assert.rejects(purge.purge(projectId));
    assert.equal(await db.collection('plan_versions').countDocuments({projectId}), 1); assert.equal(await db.collection('source_purge_receipts').countDocuments(), 0);
  });
  test('over-limit inventories refuse atomically; no partial batch or receipt', async () => {
    const {version} = await seed();
    await db.collection<PlanVersion>('plan_versions').insertMany(Array.from({length: 100}, (_, i) => ({...version, _id: randomUUID(), sourcePlanningRequestId: randomUUID(), versionNumber: Long.fromNumber(i + 2)})));
    await remove(); await assert.rejects(purge.purge(projectId), {code: 'SOURCE_PURGE_LIMIT'});
    assert.equal(await db.collection('plan_versions').countDocuments({projectId}), 101); assert.equal(await db.collection('source_purge_receipts').countDocuments(), 0);
  });
  test('receipt insertion failure rolls back project redaction and deleted sources', async () => {
    await seed(); await remove(); const before = await db.collection<Row>('projects').findOne({_id: projectId});
    await db.command({collMod: 'source_purge_receipts', validator: {$jsonSchema: {required: ['controlled_failure']}}});
    try {await assert.rejects(purge.purge(projectId));} finally {await db.command({collMod: 'source_purge_receipts', validator: sourcePurgeCollections[0].validator});}
    assert.deepEqual(await db.collection<Row>('projects').findOne({_id: projectId}), before);
    assert.equal(await db.collection('plan_versions').countDocuments({projectId}), 1); assert.equal(await db.collection('jobs').countDocuments({projectId}), 1);
    assert.equal((await purge.purge(projectId)).replayed, false);
  });
  test('source replay drift refuses a changed snapshot and cannot erase its evidence', async () => {
    await remove(); await purge.purge(projectId);
    await db.collection<Row>('idempotency_records').updateOne({'safeResultRef.id': projectId}, {$set: {'safeResponseSnapshot.brief.idea': 'Resurrected private source'}});
    await assert.rejects(purge.purge(projectId), {code: 'SOURCE_PURGE_DRIFT'});
    assert.equal((await db.collection<Row>('idempotency_records').findOne({'safeResultRef.id': projectId}))!.safeResponseSnapshot.brief.idea, 'Resurrected private source');
  });
});
