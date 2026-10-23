import {after, before, describe, test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Long, MongoClient, ObjectId, type Db} from 'mongodb';
import {databaseClientOptions} from '../src/server/db/connection';
import {checkDatabase, migrateDatabase} from '../src/server/db/migrations';
import {planningCollections} from '../src/server/db/planning-schemas';
import {deletionCollections} from '../src/server/db/deletion-schemas';
import {ProjectService} from '../src/server/projects/service';
import {ProjectError, type ProjectContext} from '../src/server/projects/contracts';
import {parseListOptions} from '../src/server/projects/validation';
import {membershipFixture, projectFixture, testUserId, testWorkspaceId, workspaceFixture, type Row} from './fixtures/database';

// Local disposable databases only; application credentials are never loaded.
const uri = process.env.MONGODB_TEST_URI ?? 'mongodb://127.0.0.1:27028/?replicaSet=vcF03';
if (!/^mongodb:\/\/(127\.0\.0\.1|localhost):\d+\/(?:\?[^\s]*)?$/.test(uri)) throw new Error('Tests require an isolated loopback replica set.');
const client = new MongoClient(uri, databaseClientOptions);
const name = `videocraft_f04_test_${randomUUID().replaceAll('-', '')}`;
const context: ProjectContext = {workspaceId: testWorkspaceId, userId: testUserId, userName: 'Test member'};
const secret = 'project-service-test-key-'.repeat(3);
const input = () => ({idea: 'Explain how sunlight becomes electricity.', settings: {
  language: 'en', targetSeconds: 60, accentId: null, voiceCatalogId: null, brandKitRevisionId: null,
  themeId: 'clean-educational-v1', captionStyleId: 'readable-default-v1',
}});
const hasCode = (code: string) => (error: unknown) => error instanceof ProjectError && error.code === code;

describe('shared project library on a real local replica set', {concurrency: false}, () => {
  let db: Db, service: ProjectService;
  before(async () => {
    await client.connect(); db = client.db(name);
    await migrateDatabase(db);
    await db.collection<Row>('workspaces').insertOne(workspaceFixture());
    await db.collection<Row>('memberships').insertOne(membershipFixture());
    await db.collection('users').insertOne({_id: new ObjectId(testUserId), name: context.userName, email: 'member@example.com'});
    service = new ProjectService(client, name, context, secret);
  });
  after(async () => {
    try {
      if (!/^videocraft_f04_test_[a-f0-9]{32}$/.test(name)) throw new Error('Unsafe test cleanup refused.');
      await db.dropDatabase();
    } finally {await client.close();}
  });

  test('create atomically persists a draft, audit event and replay receipt, with English/Telugu parity', async () => {
    const before = await db.collection('projects').countDocuments();
    for (const language of ['en', 'te']) {
      const result = await service.create({...input(), idea: language === 'te' ? 'నీటి చక్రం గురించి వివరించండి.' : input().idea, settings: {...input().settings, language}}, randomUUID());
      assert.equal(result.replayed, false); assert.equal(result.project.settings.language, language);
      assert.equal(result.project.settings.voiceCatalogId, null); assert.equal(result.project.settings.accentId, null);
      assert.deepEqual(result.project.allowedActions, ['edit']);
      const persisted = await db.collection<Row>('projects').findOne({_id: result.project.id});
      assert.ok(Long.isLong(persisted?.revision)); assert.equal(persisted?.workspaceId, context.workspaceId);
      assert.equal(await db.collection('activity_events').countDocuments({projectId: result.project.id}), 1);
      assert.equal(await db.collection('idempotency_records').countDocuments({'safeResultRef.id': result.project.id}), 1);
      assert.equal((await service.get(result.project.id)).brief.idea, result.project.brief.idea);
    }
    assert.equal(await db.collection('projects').countDocuments(), before + 2);
    await checkDatabase(db);
  });

  test('replay returns the original committed snapshot after a later edit; mismatched payload conflicts', async () => {
    const key = randomUUID();
    const first = await service.create(input(), key);
    await db.collection<Row>('projects').updateOne({_id: first.project.id}, {$set: {displayTitle: 'A later title'}, $inc: {revision: Long.ONE}});
    const again = await service.create(input(), key);
    assert.equal(again.replayed, true); assert.deepEqual(again.project, first.project);
    assert.equal((await service.get(first.project.id)).displayTitle, 'A later title');
    await assert.rejects(service.create({...input(), idea: 'Different idea'}, key), hasCode('IDEMPOTENCY_MISMATCH'));
  });

  test('concurrent retries produce exactly one project, one event and one receipt', async () => {
    const key = randomUUID();
    const before = await db.collection('projects').countDocuments();
    const result = await Promise.all(Array.from({length: 6}, () => service.create(input(), key)));
    assert.equal(new Set(result.map(value => value.project.id)).size, 1);
    assert.equal(result.filter(value => !value.replayed).length, 1);
    assert.equal(await db.collection('projects').countDocuments(), before + 1);
    assert.equal(await db.collection('activity_events').countDocuments({projectId: result[0].project.id}), 1);
  });

  test('different commands allocate unique monotonic workspace event sequences', async () => {
    const results = await Promise.all(Array.from({length: 4}, () => service.create(input(), randomUUID())));
    assert.equal(new Set(results.map(result => result.project.id)).size, 4);
    const events = await db.collection('activity_events').find({projectId: {$in: results.map(result => result.project.id)}}).sort({sequence: 1}).toArray();
    assert.equal(new Set(events.map(event => event.sequence.toString())).size, 4);
    assert.ok(events[3].sequence.subtract(events[0].sequence).equals(Long.fromNumber(3)));
  });

  test('invalid commands do not reserve a key; logical expiry works before TTL cleanup', async () => {
    const key = randomUUID();
    await assert.rejects(service.create({...input(), idea: ''}, key), hasCode('VALIDATION_FAILED'));
    const first = await service.create(input(), key);
    await db.collection('idempotency_records').updateOne({'safeResultRef.id': first.project.id}, {$set: {expiresAt: new Date(0)}});
    const next = await service.create({...input(), idea: 'A new action after expiry'}, key);
    assert.notEqual(next.project.id, first.project.id);
    assert.equal(next.replayed, false);
    assert.ok(await service.get(first.project.id));
  });

  test('deleted/foreign projects are inaccessible through details, list or replay', async () => {
    const key = randomUUID();
    const first = await service.create(input(), key);
    await db.collection<Row>('projects').updateOne({_id: first.project.id}, {$set: {deletedAt: new Date(), deletedBy: {kind: 'user', userId: context.userId}}});
    await assert.rejects(service.get(first.project.id), hasCode('RESOURCE_NOT_FOUND'));
    await assert.rejects(service.create(input(), key), hasCode('RESOURCE_NOT_FOUND'));
    const otherWorkspace = randomUUID();
    const foreign = projectFixture(); foreign.workspaceId = otherWorkspace; foreign.displayTitle = 'foreign-secret-title'; foreign.searchTitle = 'foreign-secret-title';
    await db.collection<Row>('projects').insertOne(foreign);
    await assert.rejects(service.get(foreign._id), hasCode('RESOURCE_NOT_FOUND'));
    assert.equal((await service.list(parseListOptions(new URLSearchParams('q=foreign-secret-title')))).items.length, 0);
  });

  test('only active workspace members can read/create; members share the same library but have separate command identities', async () => {
    const otherUser = new ObjectId().toHexString();
    const denied = new ProjectService(client, name, {...context, userId: otherUser}, secret);
    await assert.rejects(denied.list(parseListOptions(new URLSearchParams())), hasCode('TEAM_ACCESS_DENIED'));
    await assert.rejects(denied.create(input(), randomUUID()), hasCode('TEAM_ACCESS_DENIED'));
    await assert.rejects(denied.get(randomUUID()), hasCode('TEAM_ACCESS_DENIED'));
    await db.collection<Row>('memberships').insertOne({...membershipFixture(), userId: otherUser});
    await db.collection('users').insertOne({_id: new ObjectId(otherUser), name: 'Second test member', email: 'second@example.com'});
    const key = randomUUID();
    const mine = await service.create(input(), key), theirs = await denied.create(input(), key);
    assert.notEqual(mine.project.id, theirs.project.id);
    assert.equal((await denied.get(mine.project.id)).createdBy.id, context.userId);
    assert.equal((await service.get(theirs.project.id)).createdBy.name, 'Second test member');
    await assert.rejects(service.create({...input(), workspaceId: randomUUID()}, randomUUID()), hasCode('UNKNOWN_FIELD'));
  });

  test('keyset pagination handles ties and filters before limit; summary excludes idea/reference content', async () => {
    const timestamp = new Date('2026-10-20T08:30:00.000Z');
    const records = Array.from({length: 53}, (_, i) => ({...projectFixture(), displayTitle: `page-fixture ${i}`, searchTitle: `page-fixture ${i}`, updatedAt: timestamp}));
    await db.collection<Row>('projects').insertMany(records);
    const expected = records.map(row => row._id).sort().reverse();
    const ids: string[] = [];
    let cursor: string | null = null;
    do {
      const params = new URLSearchParams({q: 'page-fixture', limit: '7'}); if (cursor) params.set('cursor', cursor);
      const page = await service.list(parseListOptions(params));
      assert.ok(page.items.length <= 7);
      for (const summary of page.items) {assert.ok(!('brief' in summary)); assert.ok(!('workspaceId' in summary)); ids.push(summary.id);}
      cursor = page.page.nextCursor;
      assert.equal(Boolean(cursor), page.page.hasMore);
    } while (cursor);
    assert.deepEqual(ids, expected);
    const literal = {...projectFixture(), displayTitle: 'literal .* [test]', searchTitle: 'literal .* [test]'};
    await db.collection<Row>('projects').insertOne(literal);
    const search = await service.list(parseListOptions(new URLSearchParams({q: '.*', limit: '1'})));
    assert.deepEqual(search.items.map(row => row.id), [literal._id]);
    const first = await service.list(parseListOptions(new URLSearchParams('q=page-fixture&limit=1')));
    await assert.rejects(service.list(parseListOptions(new URLSearchParams({q: 'different', cursor: first.page.nextCursor!}))), hasCode('INVALID_CURSOR'));
  });

  test('an event-write failure rolls back project, command receipt and counter together', async () => {
    const projects = await db.collection('projects').countDocuments(), receipts = await db.collection('idempotency_records').countDocuments();
    const previous = await db.collection<Row>('workspaces').findOne({_id: context.workspaceId});
    const eventContract = deletionCollections.find(contract => contract.name === 'activity_events')!;
    await db.command({collMod: 'activity_events', validator: {$jsonSchema: {bsonType: 'object', required: ['controlled_failure']}}});
    try {await assert.rejects(service.create(input(), randomUUID()), error => !!error && typeof error === 'object' && 'code' in error && error.code === 121);}
    finally {await db.command({collMod: 'activity_events', validator: eventContract.validator});}
    assert.equal(await db.collection('projects').countDocuments(), projects);
    assert.equal(await db.collection('idempotency_records').countDocuments(), receipts);
    assert.equal((await db.collection<Row>('workspaces').findOne({_id: context.workspaceId}))?.nextActivitySequence.toString(), previous?.nextActivitySequence.toString());
  });
  test('edits replace brief/settings and atomically advance revisions, activity and replay exactly once', async () => {
    const first = (await service.create(input(), randomUUID())).project, key = randomUUID();
    const body = {expectedProjectRevision: 1, patch: {brief: {...first.brief, idea: 'Explain solar panels to children.'}, settings: {...first.settings, language: 'te', targetSeconds: 30}}};
    const results = await Promise.all(Array.from({length: 4}, () => service.patch(first.id, body, key)));
    assert.equal(results.filter(r => !r.replayed).length, 1);
    for (const result of results) {assert.equal(result.project.revision, 2); assert.equal(result.project.briefRevision, 2); assert.equal(result.project.settings.language, 'te');}
    assert.equal(await db.collection('activity_events').countDocuments({projectId: first.id, type: 'project_updated'}), 1);
    const row = await db.collection<Row>('projects').findOne({_id: first.id});
    assert.equal(row?.guardRevision.toString(), '1');
    const next = await service.patch(first.id, {expectedProjectRevision: 2, patch: {brief: {...first.brief, idea: 'Third revision'}}}, randomUUID());
    assert.equal(next.project.revision, 3);
    assert.deepEqual((await service.patch(first.id, body, key)).project, results[0].project);
    await assert.rejects(service.patch(first.id, {...body, expectedProjectRevision: 3}, key), hasCode('IDEMPOTENCY_MISMATCH'));
    await checkDatabase(db);
  });

  test('concurrent different edits reject the stale writer without overwriting its winner', async () => {
    const first = (await service.create(input(), randomUUID())).project;
    const results = await Promise.allSettled(['Writer A', 'Writer B'].map(idea => service.patch(first.id, {expectedProjectRevision: 1, patch: {brief: {...first.brief, idea}}}, randomUUID())));
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    const loser = results.find(r => r.status === 'rejected'); assert.ok(loser?.status === 'rejected');
    assert.equal(loser.reason.code, 'STALE_REVISION'); assert.equal(loser.reason.details.currentRevision, 2);
    assert.equal(typeof loser.reason.details.updatedBy.name, 'string'); assert.ok(!('email' in loser.reason.details.updatedBy));
    assert.equal((await service.get(first.id)).revision, 2);
    assert.equal(await db.collection('activity_events').countDocuments({projectId: first.id}), 2);
  });

  test('no-op and logically expired edit receipts preserve counters; deleted/missing edits are denied', async () => {
    const first = (await service.create(input(), randomUUID())).project, key = randomUUID();
    const body = {expectedProjectRevision: 1, patch: {brief: first.brief}};
    const before = await db.collection<Row>('workspaces').findOne({_id: context.workspaceId});
    assert.equal((await service.patch(first.id, body, key)).project.revision, 1);
    await db.collection('idempotency_records').updateOne({routeScope: `PATCH /api/v1/projects/${first.id}`}, {$set: {expiresAt: new Date(0)}});
    assert.equal((await service.patch(first.id, body, key)).replayed, false);
    assert.equal((await db.collection<Row>('workspaces').findOne({_id: context.workspaceId}))?.nextActivitySequence.toString(), before?.nextActivitySequence.toString());
    await db.collection<Row>('projects').updateOne({_id: first.id}, {$set: {deletedAt: new Date(), deletedBy: {kind: 'user', userId: context.userId}}});
    await assert.rejects(service.patch(first.id, body, key), hasCode('RESOURCE_NOT_FOUND'));
    await assert.rejects(service.patch(randomUUID(), body, randomUUID()), hasCode('RESOURCE_NOT_FOUND'));
  });

  test('title-only rename updates literal search and actor while preserving generation inputs and pointers', async () => {
    const first=(await service.create(input(),randomUUID())).project;
    const pointers={currentPlanVersionId:randomUUID(),activePlanningJobId:randomUUID(),planningRequestId:randomUUID(),latestRunId:randomUUID(),latestReadyVideoId:randomUUID()};
    await db.collection<Row>('projects').updateOne({_id:first.id},{$set:pointers});
    const before=await db.collection<Row>('projects').findOne({_id:first.id});
    const body={expectedProjectRevision:1,patch:{displayTitle:'  నీటి ప్రయాణం [QA].*  '}};
    const saved=(await service.patch(first.id,body,randomUUID())).project;
    assert.equal(saved.displayTitle,'నీటి ప్రయాణం [QA].*');assert.equal(saved.revision,2);assert.equal(saved.briefRevision,1);
    const after=await db.collection<Row>('projects').findOne({_id:first.id});
    for(const field of ['brief','settings','briefRevision','guardRevision','nextPlanVersionNumber','nextVideoVersionNumber',...Object.keys(pointers)])assert.deepEqual(after![field],before![field],field);
    assert.equal(after!.searchTitle,'నీటి ప్రయాణం [qa].*');
    const results=await service.list(parseListOptions(new URLSearchParams('q=%5BQA%5D.*')));assert.ok(results.items.some(p=>p.id===first.id));
    const event=await db.collection('activity_events').findOne({projectId:first.id,type:'project_updated'});assert.equal(event!.message,'A project was renamed.');
    await assert.rejects(service.patch(first.id,{expectedProjectRevision:2,patch:{displayTitle:'Must not partially rename',brief:{...first.brief,idea:'Changed'}}},randomUUID()),hasCode('EDIT_UNAVAILABLE'));
    assert.equal((await service.get(first.id)).displayTitle,saved.displayTitle);
  });

  test('rename concurrent retries replay exactly once, stale writers refuse and old snapshots remain original',async()=>{
    const first=(await service.create(input(),randomUUID())).project,key=randomUUID(),body={expectedProjectRevision:1,patch:{displayTitle:'First rename'}};
    const results=await Promise.all(Array.from({length:4},()=>service.patch(first.id,body,key)));
    assert.equal(results.filter(v=>!v.replayed).length,1);assert.equal(await db.collection('activity_events').countDocuments({projectId:first.id,type:'project_updated'}),1);
    const races=await Promise.allSettled(['Second A','Second B'].map(displayTitle=>service.patch(first.id,{expectedProjectRevision:2,patch:{displayTitle}},randomUUID())));
    assert.equal(races.filter(v=>v.status==='fulfilled').length,1);const loser=races.find(v=>v.status==='rejected');assert.ok(loser?.status==='rejected');assert.equal(loser.reason.code,'STALE_REVISION');
    assert.deepEqual((await service.patch(first.id,body,key)).project,results[0].project);
    await assert.rejects(service.patch(first.id,{...body,patch:{displayTitle:'Different payload'}},key),hasCode('IDEMPOTENCY_MISMATCH'));
    await assert.rejects(service.patch(first.id,{expectedProjectRevision:2,patch:{brief:{...first.brief,idea:'Stale brief'}}},randomUUID()),hasCode('STALE_REVISION'));
  });

  test('canonical no-op rename preserves counters and title-only rename can accompany a valid brief edit',async()=>{
    const first=(await service.create(input(),randomUUID())).project;
    const before=await db.collection<Row>('projects').findOne({_id:first.id});
    const saved=await service.patch(first.id,{expectedProjectRevision:1,patch:{displayTitle:` ${first.displayTitle} `}},randomUUID());
    assert.equal(saved.project.revision,1);assert.deepEqual(await db.collection<Row>('projects').findOne({_id:first.id}),before);
    assert.equal(await db.collection('activity_events').countDocuments({projectId:first.id}),1);
    const both=(await service.patch(first.id,{expectedProjectRevision:1,patch:{displayTitle:'New name',brief:{...first.brief,idea:'New explanation'}}},randomUUID())).project;
    assert.equal(both.displayTitle,'New name');assert.equal(both.revision,2);assert.equal(both.briefRevision,2);
  });

  test('rename refuses inaccessible projects and revoked membership, including successful receipt replay',async()=>{
    const first=(await service.create(input(),randomUUID())).project,key=randomUUID(),body={expectedProjectRevision:1,patch:{displayTitle:'Renamed'}};
    await service.patch(first.id,body,key);
    const other=new ProjectService(client,name,{...context,workspaceId:randomUUID()},secret);
    await assert.rejects(other.patch(first.id,body,key),hasCode('TEAM_ACCESS_DENIED'));
    await db.collection<Row>('memberships').updateOne({workspaceId:context.workspaceId,userId:context.userId},{$set:{status:'disabled',disabledAt:new Date(),disabledBy:{kind:'user',userId:context.userId}}});
    try{await assert.rejects(service.patch(first.id,body,key),hasCode('TEAM_ACCESS_DENIED'));}finally{await db.collection<Row>('memberships').updateOne({workspaceId:context.workspaceId,userId:context.userId},{$set:{status:'active',disabledAt:null,disabledBy:null}});}
    await db.collection<Row>('projects').updateOne({_id:first.id},{$set:{deletedAt:new Date(),deletedBy:{kind:'user',userId:context.userId}}});
    await assert.rejects(service.patch(first.id,body,key),hasCode('RESOURCE_NOT_FOUND'));
  });

  test('rename receipt failure rolls back title, search, actor, counters and activity',async()=>{
    const first=(await service.create(input(),randomUUID())).project,before=await db.collection<Row>('projects').findOne({_id:first.id}),workspace=await db.collection<Row>('workspaces').findOne({_id:context.workspaceId});
    const contract=planningCollections.find(c=>c.name==='idempotency_records')!;
    await db.command({collMod:'idempotency_records',validator:{$jsonSchema:{bsonType:'object',required:['controlled_failure']}}});
    try{await assert.rejects(service.patch(first.id,{expectedProjectRevision:1,patch:{displayTitle:'Must roll back'}},randomUUID()));}finally{await db.command({collMod:'idempotency_records',validator:contract.validator});}
    assert.deepEqual(await db.collection<Row>('projects').findOne({_id:first.id}),before);assert.equal(await db.collection('activity_events').countDocuments({projectId:first.id}),1);
    assert.equal((await db.collection<Row>('workspaces').findOne({_id:context.workspaceId}))!.nextActivitySequence.toString(),workspace!.nextActivitySequence.toString());
  });

  test('failed edit receipt rolls back the project, activity and workspace counter', async () => {
    const first = (await service.create(input(), randomUUID())).project;
    const before = await db.collection<Row>('workspaces').findOne({_id: context.workspaceId});
    const receipt = planningCollections.find(c => c.name === 'idempotency_records')!;
    await db.command({collMod: 'idempotency_records', validator: {$jsonSchema: {bsonType: 'object', required: ['controlled_failure']}}});
    try {await assert.rejects(service.patch(first.id, {expectedProjectRevision: 1, patch: {brief: {...first.brief, idea: 'Must roll back'}}}, randomUUID()));}
    finally {await db.command({collMod: 'idempotency_records', validator: receipt.validator});}
    assert.deepEqual(await service.get(first.id), first);
    assert.equal(await db.collection('activity_events').countDocuments({projectId: first.id}), 1);
    assert.equal((await db.collection<Row>('workspaces').findOne({_id: context.workspaceId}))?.nextActivitySequence.toString(), before?.nextActivitySequence.toString());
  });
});
