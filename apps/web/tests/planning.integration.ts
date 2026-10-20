import {after, before, beforeEach, describe, test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Long, MongoClient, type Db} from 'mongodb';
import {databaseClientOptions} from '../src/server/db/connection';
import {migrateDatabase, checkDatabase} from '../src/server/db/migrations';
import {providerConfig} from '../src/server/providers/config';
import {PlanningService, type Row} from '../src/server/planning/service';
import {PlanningWorker} from '../src/server/planning/worker';
import {attestBudget} from '../src/server/planning/budget';
import {PlanningFault, PlanningGateway} from '../src/server/planning/gateway';
import {ProjectService} from '../src/server/projects/service';
import type {Job} from '../src/server/planning/contracts';
import {membershipFixture, workspaceFixture, testWorkspaceId, testUserId} from './fixtures/database';

const uri = process.env.MONGODB_TEST_URI ?? 'mongodb://127.0.0.1:27028/?replicaSet=vcF03';
if (!/^mongodb:\/\/(127\.0\.0\.1|localhost):\d+\/(?:\?[^\s]*)?$/.test(uri)) throw new Error('Isolated loopback test DB required.');
const name = `videocraft_f07_test_${randomUUID().replaceAll('-', '')}`, client = new MongoClient(uri, databaseClientOptions);
const env = {GEMINI_API_KEY: 'test-planning-key', GEMINI_FREE_TIER_CONFIRMED: 'true'}, context = {workspaceId: testWorkspaceId, userId: testUserId, userName: 'Tester'};
const settings = {language: 'en' as const, targetSeconds: 30 as const, voiceCatalogId: null, accentId: null, brandKitRevisionId: null, themeId: 'clean-educational-v1', captionStyleId: 'readable-default-v1'};
const output = () => ({title: 'Water cycle', learningObjective: 'Understand moving water', scenes: ['Evaporation', 'Condensation', 'Rain'].map(heading => ({heading, narration: `Learn about ${heading}.`, labels: ['Water', 'Vapour'], layout: 'cycle'}))});
class FakeGateway extends PlanningGateway {
  calls = 0;
  behavior: () => Promise<unknown> = async () => output();
  constructor() {super(env);}
  override async generate() {this.calls++; return this.behavior();}
}
describe('durable planning on a real isolated replica set', {concurrency: false}, () => {
  let db: Db, service: PlanningService, projects: ProjectService, gateway: FakeGateway, worker: PlanningWorker;
  before(async () => {await client.connect(); db = client.db(name); await migrateDatabase(db);});
  beforeEach(async () => {
    for (const c of ['jobs', 'plan_versions', 'planning_commands', 'stage_attempts', 'planning_budget', 'worker_slots', 'provider_controls', 'projects', 'idempotency_records', 'activity_events', 'memberships', 'workspaces']) await db.collection(c).deleteMany({});
    await db.collection<Row>('workspaces').insertOne(workspaceFixture()); await db.collection<Row>('memberships').insertOne(membershipFixture());
    const config = providerConfig('gemini', env), now = new Date();
    await db.collection<Row>('provider_controls').insertOne({_id: 'gemini', schemaVersion: 1, configHash: config.configHash, revision: Long.ONE, model: config.model, state: 'paused', operatorDisabled: false, reasonCode: 'FREE_ALLOWANCE_UNVERIFIED', checkedAt: now, expiresAt: new Date(now.getTime() + 60000), languages: ['en', 'te'], allowance: {unit: 'requests', observedRemaining: null, periodId: null}, tests: [], reservations: []});
    await attestBudget(db, env, 10, 0);
    service = new PlanningService(client, name, context, env); projects = new ProjectService(client, name, context, 'test-secret'.repeat(10), env);
    gateway = new FakeGateway(); worker = new PlanningWorker(client, name, env, gateway); await worker.heartbeat();
  });
  after(async () => {try {if (!/^videocraft_f07_test_[a-f0-9]{32}$/.test(name)) throw new Error('Unsafe cleanup'); await db.dropDatabase();} finally {await client.close();}});
  async function create() {return (await projects.create({idea: 'Explain the water cycle', settings}, randomUUID())).project;}
  async function queue() {const p = await create(); const job = await service.command(p.id, null, 'plan', {expectedProjectRevision: p.revision}, randomUUID()); return {p, job};}
  test('command retries deduplicate before stale/capacity checks; committed snapshots remain stable', async () => {
    const p = await create(), key = randomUUID();
    const results = await Promise.all(Array.from({length: 4}, () => service.command(p.id, null, 'plan', {expectedProjectRevision: 1}, key)));
    assert.equal(new Set(results.map(r => r.jobId)).size, 1); assert.equal(await db.collection('jobs').countDocuments(), 1);
    await worker.tick(); assert.equal(gateway.calls, 1);
    const ready = await service.job(results[0].jobId); assert.equal(ready.state, 'ready'); assert.ok(ready.result && 'planVersionId' in ready.result);
    const plan = await service.plan(ready.result.planVersionId); assert.equal(plan.isCurrent, true); assert.equal(plan.canGenerate, false);
    await db.collection<Row>('planning_budget').updateOne({_id: 'gemini'}, {$set: {paused: true}});
    assert.deepEqual(await service.command(p.id, null, 'plan', {expectedProjectRevision: 1}, key), results[0]);
    await assert.rejects(service.command(p.id, null, 'plan', {expectedProjectRevision: 2}, key), /different input/);
    assert.equal(await db.collection('stage_attempts').countDocuments({state: 'settled'}), 1); await checkDatabase(db);
  });
  test('worker singleton, one-minute spacing and free budget prevent duplicate submissions', async () => {
    await queue(); const other = new PlanningWorker(client, name, env, gateway);
    assert.equal(await other.tick(), false); await worker.tick(); await queue(); await worker.tick();
    assert.equal(gateway.calls, 1); assert.equal((await db.collection<Row>('planning_budget').findOne({_id: 'gemini'}))?.remaining, 9);
  });
  test('queued cancellation and replay are durable and consume no allowance', async () => {
    const {job} = await queue(), key = randomUUID();
    const result = await service.command(null, job.jobId, 'cancel', {expectedRevision: 1}, key); assert.equal(result.state, 'cancelled');
    assert.deepEqual(await service.command(null, job.jobId, 'cancel', {expectedRevision: 1}, key), result);
    await worker.tick(); assert.equal(gateway.calls, 0); assert.equal((await db.collection<Row>('planning_budget').findOne({_id: 'gemini'}))?.remaining, 10);
  });
  test('edits during inference supersede the late result without overwriting the brief', async () => {
    const {p, job} = await queue(); let resolve!: (v: unknown) => void; let started!: () => void;
    const began = new Promise<void>(r => {started = r;}); gateway.behavior = () => {started(); return new Promise(r => {resolve = r;});};
    const run = worker.tick(); await began;
    await projects.patch(p.id, {expectedProjectRevision: 1, patch: {brief: {...p.brief, idea: 'A newer idea'}}}, randomUUID());
    resolve(output()); await run; assert.equal((await service.job(job.jobId)).state, 'superseded');
    assert.equal(await db.collection('plan_versions').countDocuments(), 0); assert.equal((await projects.get(p.id)).brief.idea, 'A newer idea');
  });
  test('unknown provider consumption pauses new work and cannot be cleared by budget refresh', async () => {
    const {job} = await queue(); gateway.behavior = async () => {throw new PlanningFault('PROVIDER_OUTCOME_UNKNOWN', true);}; await worker.tick();
    const row = await service.job(job.jobId); assert.equal(row.state, 'paused'); assert.deepEqual(row.allowedActions, []);
    assert.equal((await db.collection<Row>('planning_budget').findOne({_id: 'gemini'}))?.uncertain, true);
    await assert.rejects(attestBudget(db, env, 500, 3), /UNCERTAIN/);
    await assert.rejects(service.command((await create()).id, null, 'plan', {expectedProjectRevision: 1}, randomUUID()), /paused/);
  });
  test('a definitive quota failure pauses the shared path until a fresh operator observation', async () => {
    const {job} = await queue(); gateway.behavior = async () => {throw new PlanningFault('PROVIDER_RATE_LIMITED', false, true);}; await worker.tick();
    assert.equal((await service.job(job.jobId)).state, 'failed');
    const budget = await db.collection<Row>('planning_budget').findOne({_id: 'gemini'}); assert.equal(budget?.paused, true); assert.equal(budget?.uncertain, false);
    await assert.rejects(service.command((await create()).id, null, 'plan', {expectedProjectRevision: 1}, randomUUID()), /paused/);
    await attestBudget(db, env, 5, budget!.revision.toNumber()); assert.equal((await db.collection<Row>('planning_budget').findOne({_id: 'gemini'}))?.paused, false);
  });
  test('definitive invalid output supports explicit bounded retry with a new attempt', async () => {
    const {job} = await queue(); gateway.behavior = async () => ({bad: 'shape'}); await worker.tick();
    const failed = await service.job(job.jobId); assert.equal(failed.state, 'failed'); assert.deepEqual(failed.allowedActions, ['retry']);
    await service.command(null, job.jobId, 'retry', {expectedRevision: failed.statusRevision}, randomUUID());
    await db.collection<Row>('planning_budget').updateOne({_id: 'gemini'}, {$set: {nextRequestAt: new Date(0)}});
    gateway.behavior = async () => output(); await worker.tick(); assert.equal((await service.job(job.jobId)).state, 'ready'); assert.equal(gateway.calls, 2);
    assert.equal(await db.collection('stage_attempts').countDocuments(), 2);
  });
  test('expired submitted jobs are held uncertain by a replacement worker and never blindly resubmitted', async () => {
    const {job} = await queue(); const previousOwner = randomUUID();
    await db.collection<Job>('jobs').updateOne({_id: job.jobId}, {$set: {state: 'running', submission: 'submitted', attempt: 1, owner: previousOwner, leaseUntil: new Date(0)}});
    await worker.tick(); assert.equal((await service.job(job.jobId)).state, 'paused'); assert.equal(gateway.calls, 0);
  });
  test('replacement slot owner waits for a still-live older job lease instead of dispatching another request', async () => {
    const {job} = await queue();
    await db.collection<Job>('jobs').updateOne({_id: job.jobId}, {$set: {state: 'running', submission: 'submitted', attempt: 1, owner: randomUUID(), leaseUntil: new Date(Date.now() + 30000)}});
    await queue(); assert.equal(await worker.tick(), false); assert.equal(gateway.calls, 0);
    assert.equal((await db.collection<Row>('planning_budget').findOne({_id: 'gemini'}))?.remaining, 10);
  });
  test('operator disablement after queueing prevents provider reservation and survives planning', async () => {
    const {job} = await queue(); await db.collection<Row>('provider_controls').updateOne({_id: 'gemini'}, {$set: {operatorDisabled: true}});
    await worker.tick(); assert.equal((await service.job(job.jobId)).state, 'paused'); assert.equal(gateway.calls, 0);
    assert.equal((await db.collection<Row>('planning_budget').findOne({_id: 'gemini'}))?.remaining, 10);
  });
  test('running cancellation keeps submitted usage and never publishes the cancelled result', async () => {
    const {job} = await queue(); let resolve!: (v: unknown) => void, started!: () => void;
    const began = new Promise<void>(r => {started = r;}); gateway.behavior = () => {started(); return new Promise(r => {resolve = r;});};
    const run = worker.tick(); await began;
    const running = await service.job(job.jobId);
    assert.equal((await service.command(null, job.jobId, 'cancel', {expectedRevision: running.statusRevision}, randomUUID())).state, 'cancellation_requested');
    resolve(output()); await run;
    assert.equal((await service.job(job.jobId)).state, 'cancelled'); assert.equal(await db.collection('plan_versions').countDocuments(), 0);
    assert.equal((await db.collection<Row>('planning_budget').findOne({_id: 'gemini'}))?.remaining, 9);
  });
  test('previous immutable proposals remain readable and become outdated after a saved edit', async () => {
    const {p, job} = await queue(); await worker.tick();
    const ready = await service.job(job.jobId); assert.ok(ready.result && 'planVersionId' in ready.result); const id = ready.result.planVersionId;
    const before = await db.collection('plan_versions').findOne({projectId: p.id});
    await projects.patch(p.id, {expectedProjectRevision: 1, patch: {brief: {...p.brief, idea: 'New explanation'}}}, randomUUID());
    assert.equal((await service.plan(id)).isCurrent, false);
    assert.deepEqual(await db.collection('plan_versions').findOne({projectId: p.id}), before);
    assert.equal((await projects.get(p.id)).currentPlanVersionId, id); await checkDatabase(db);
  });
  test('optional brainstorming does not invalidate an existing plan until an idea is actually selected', async () => {
    const {p, job} = await queue(); await worker.tick();
    const ready = await service.job(job.jobId); assert.ok(ready.result && 'planVersionId' in ready.result);
    await service.command(p.id, null, 'brainstorm', {expectedProjectRevision: 1}, randomUUID());
    assert.equal((await service.plan(ready.result.planVersionId)).isCurrent, true);
  });
  test('brainstorm selection validates project, current source revision and actual selected content', async () => {
    const p = await create(); gateway.behavior = async () => ({angles: [1, 2, 3].map(i => ({title: `Angle ${i}`, hook: 'A useful hook', learningObjective: 'Understand water'}))});
    const job = await service.command(p.id, null, 'brainstorm', {expectedProjectRevision: 1}, randomUUID()); await worker.tick();
    const ready = await service.job(job.jobId); assert.ok(ready.result && 'angles' in ready.result); const angle = ready.result.angles[0];
    const patch = {brief: {...p.brief, idea: `${angle.title}\n${angle.hook}\n${angle.learningObjective}`}, brainstormSelection: {jobId: job.jobId, angleId: angle.id}};
    await assert.rejects(projects.patch(p.id, {expectedProjectRevision: 1, patch: {...patch, brief: {...patch.brief, idea: 'Forged selected content'}}}, randomUUID()), /current saved angle/);
    const saved = await projects.patch(p.id, {expectedProjectRevision: 1, patch}, randomUUID()); assert.equal(saved.project.briefRevision, 2);
    await assert.rejects(projects.patch(p.id, {expectedProjectRevision: 2, patch}, randomUUID()), /current saved angle/);
  });
  test('budget observations are revision/config bound and expire before the Pacific daily reset', async () => {
    await assert.rejects(attestBudget(db, env, 501, 1), /INVALID_FREE_BUDGET/);
    await assert.rejects(attestBudget(db, env, 5, 0), /REVISION_CHANGED/);
    const now = new Date('2026-10-21T06:59:00Z'); // 23:59 PDT
    const result = await attestBudget(db, env, 5, 1, now);
    assert.ok(new Date(result.expiresAt) < new Date('2026-10-21T07:00:00Z'));
    const changed = new PlanningService(client, name, context, {...env, GEMINI_API_KEY: 'different-key'});
    await assert.rejects(changed.checkCapacity(), /paused/);
  });
  test('scoped access, stale revisions, absent worker and expired budget refuse acceptance', async () => {
    const p = await create();
    const stranger = new PlanningService(client, name, {...context, workspaceId: randomUUID()}, env);
    await assert.rejects(stranger.overview(p.id), /team access/);
    await assert.rejects(service.command(p.id, null, 'plan', {expectedProjectRevision: 2}, randomUUID()), /latest saved brief/);
    await worker.release(); await assert.rejects(service.command(p.id, null, 'plan', {expectedProjectRevision: 1}, randomUUID()), /worker/);
    await worker.heartbeat(); await db.collection<Row>('planning_budget').updateOne({_id: 'gemini'}, {$set: {expiresAt: new Date(0)}});
    await assert.rejects(service.command(p.id, null, 'plan', {expectedProjectRevision: 1}, randomUUID()), /paused/);
  });
});
