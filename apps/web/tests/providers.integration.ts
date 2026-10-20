import {after, before, describe, test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {MongoClient} from 'mongodb';
import {databaseClientOptions} from '../src/server/db/connection';
import {migrateDatabase} from '../src/server/db/migrations';
import {ProviderStore} from '../src/server/providers/store';
import {ProjectService} from '../src/server/projects/service';
import {providerEnv, providerFixture, providerMock} from './fixtures/providers';
import {testUserId, testWorkspaceId, workspaceFixture, membershipFixture, type Row} from './fixtures/database';
import type {ProviderControl} from '../src/server/providers/contracts';
const uri = process.env.MONGODB_TEST_URI ?? 'mongodb://127.0.0.1:27028/?replicaSet=vcF03';
if (!/^mongodb:\/\/(127\.0\.0\.1|localhost):\d+\/(?:\?[^\s]*)?$/.test(uri)) throw new Error('Tests require isolated loopback MongoDB.');
const client = new MongoClient(uri, databaseClientOptions), name = `videocraft_f06_test_${randomUUID().replaceAll('-', '')}`, db = client.db(name), collection = db.collection<ProviderControl>('provider_controls');
describe('provider controls on a real local replica set', {concurrency: false}, () => {
  before(async () => {await client.connect(); await migrateDatabase(db);});
  after(async () => {try {if (!/^videocraft_f06_test_[a-f0-9]{32}$/.test(name)) throw new Error('Unsafe cleanup'); await db.dropDatabase();} finally {await client.close();}});
  async function reset() {await collection.deleteMany({}); await collection.insertOne(providerFixture());}
  test('atomic reservations cannot overcommit observed remaining capacity', async () => {
    await reset(); const store = new ProviderStore(db, providerEnv);
    const results = await Promise.allSettled(Array.from({length: 6}, () => store.reserve('elevenlabs', 400)));
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 2);
    const row = await collection.findOne({_id: 'elevenlabs'}); assert.equal(row?.allowance.observedRemaining, 200); assert.equal(row?.reservations.length, 2);
    await collection.updateOne({_id: 'elevenlabs'}, {$set: {expiresAt: new Date(0)}});
    await assert.rejects(store.reserve('elevenlabs', 1), /FREE_ALLOWANCE_UNAVAILABLE/);
  });
  test('refresh cannot overwrite a reservation committed during provider metadata reads', async () => {
    await reset(); let release!: () => void, started!: () => void;
    const waiting = new Promise<void>(r => {release = r;}), ready = new Promise<void>(r => {started = r;});
    const mock = providerMock([]);
    const delayed = (async (url, options) => {if (String(url).endsWith('/subscription')) {started(); await waiting;} return mock(url, options);}) as typeof fetch;
    const store = new ProviderStore(db, providerEnv, delayed), refresh = store.refresh('elevenlabs', true);
    await ready; await store.reserve('elevenlabs', 600); release(); await refresh;
    assert.equal((await collection.findOne({_id: 'elevenlabs'}))?.allowance.observedRemaining, 400);
  });
  test('successful probe records language evidence once and repeat probe performs no synthesis', async () => {
    await reset(); await collection.updateOne({_id: 'elevenlabs'}, {$set: {tests: []}});
    const calls: {url: string; method: string}[] = [], store = new ProviderStore(db, providerEnv, providerMock(calls));
    const results = await Promise.allSettled([store.probe('en'), store.probe('en')]);
    assert.ok(results.some(r => r.status === 'fulfilled'));
    assert.equal(calls.filter(c => c.method === 'POST').length, 1);
    assert.equal((await collection.findOne({_id: 'elevenlabs'}))?.tests.length, 1);
    await store.probe('en'); assert.equal(calls.filter(c => c.method === 'POST').length, 1);
  });
  test('uncertain speech consumes its reservation and remains paused across metadata refresh', async () => {
    await reset(); await collection.updateOne({_id: 'elevenlabs'}, {$set: {tests: []}});
    const calls: {url: string; method: string}[] = [], store = new ProviderStore(db, providerEnv, providerMock(calls, {post: async () => {throw new Error('private transport details');}}));
    await assert.rejects(store.probe('te'), /PROVIDER_UNREACHABLE/);
    await assert.rejects(store.probe('te'), /UNCERTAIN_PROVIDER_USAGE/);
    const row = await collection.findOne({_id: 'elevenlabs'}); assert.equal(row?.reservations[0].state, 'uncertain'); assert.equal(row?.state, 'paused'); assert.equal(row?.tests.length, 0);
    assert.equal(calls.filter(c => c.method === 'POST').length, 1);
  });
  test('expired configuration, unknown Gemini allowance and bounded reservation overflow deny submission', async () => {
    await reset(); const store = new ProviderStore(db, providerEnv);
    await assert.rejects(new ProviderStore(db, {...providerEnv, ELEVENLABS_API_KEY: 'changed'}).reserve('elevenlabs', 1));
    await assert.rejects(store.reserve('gemini', 1));
    await collection.updateOne({_id: 'elevenlabs'}, {$set: {reservations: Array.from({length: 100}, () => ({id: randomUUID(), units: 0, state: 'settled' as const, createdAt: new Date()}))}});
    await assert.rejects(store.reserve('elevenlabs', 1));
  });
  test('draft voice selection validates server-side, and committed command replay survives provider pause', async () => {
    await reset();
    await db.collection<Row>('workspaces').insertOne(workspaceFixture()); await db.collection<Row>('memberships').insertOne(membershipFixture());
    const service = new ProjectService(client, name, {workspaceId: testWorkspaceId, userId: testUserId, userName: 'Test'}, 'cursor-test-secret'.repeat(3), providerEnv);
    const settings = {language: 'te', targetSeconds: 30, accentId: 'source-voice', voiceCatalogId: 'alice-evaluation', brandKitRevisionId: null, themeId: 'clean-educational-v1', captionStyleId: 'readable-default-v1'};
    const input = {idea: 'Explain plants', settings}, key = randomUUID();
    const created = await service.create(input, key); assert.equal(created.project.settings.voiceCatalogId, 'alice-evaluation');
    await assert.rejects(service.create({...input, settings: {...settings, accentId: 'te-IN'}}, randomUUID()), /unavailable/);
    await assert.rejects(service.create({...input, settings: {...settings, voiceCatalogId: 'madhavi'}}, randomUUID()), /unavailable/);
    await collection.updateOne({_id: 'elevenlabs'}, {$set: {state: 'paused', reasonCode: 'FREE_ALLOWANCE_EXHAUSTED'}});
    assert.deepEqual((await service.create(input, key)).project, created.project);
    await assert.rejects(service.patch(created.project.id, {expectedProjectRevision: 1, patch: {settings: {...settings, targetSeconds: 60}}}, randomUUID()), /unavailable/);
    const cleared = await service.patch(created.project.id, {expectedProjectRevision: 1, patch: {settings: {...settings, voiceCatalogId: null, accentId: null}}}, randomUUID());
    assert.equal(cleared.project.revision, 2);
  });
});
