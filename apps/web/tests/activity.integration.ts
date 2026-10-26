import {after,before,beforeEach,describe,test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Long,MongoClient,type Db} from 'mongodb';
import {databaseClientOptions} from '../src/server/db/connection';
import {migrateDatabase} from '../src/server/db/migrations';
import {ActivityService} from '../src/server/activity/service';
import {OperationsService} from '../src/server/activity/operations';
import {membershipFixture,workspaceFixture,projectFixture,testWorkspaceId,testUserId,type Row} from './fixtures/database';
import {providerEnv,providerFixture} from './fixtures/providers';
import type {ProviderControl} from '../src/server/providers/contracts';
const uri=process.env.MONGODB_TEST_URI??'mongodb://127.0.0.1:27028/?replicaSet=vcF03';
if(!/^mongodb:\/\/(127\.0\.0\.1|localhost):\d+\/(?:\?[^\s]*)?$/.test(uri))throw Error('Isolated loopback required');
const name=`videocraft_activity_test_${randomUUID().replaceAll('-','')}`,client=new MongoClient(uri,databaseClientOptions),context={workspaceId:testWorkspaceId,userId:testUserId,userName:'Tester'},secret='activity-fixture-secret';
describe('member activity feed and read-only operations',{concurrency:false},()=>{
  let db:Db,service:ActivityService,project:Row;
  before(async()=>{await client.connect();db=client.db(name);await migrateDatabase(db);});
  beforeEach(async()=>{
    for(const collection of ['activity_events','memberships','projects','workspaces','provider_controls'])await db.collection(collection).deleteMany({});
    await db.collection<Row>('workspaces').insertOne(workspaceFixture());await db.collection<Row>('memberships').insertOne(membershipFixture());project=projectFixture();await db.collection<Row>('projects').insertOne(project);
    service=new ActivityService(client,name,context,secret);
  });
  after(async()=>{try{if(!/^videocraft_activity_test_[a-f0-9]{32}$/.test(name))throw Error('Unsafe test cleanup');await db.dropDatabase();}finally{await client.close();}});
  async function event(sequence:number,projectId=project._id,type='project_created'){
    await db.collection<Row>('activity_events').insertOne({_id:randomUUID(),schemaVersion:1,workspaceId:testWorkspaceId,projectId,sequence:Long.fromNumber(sequence),dedupeKey:randomUUID(),type,actor:{kind:'user',userId:testUserId},resourceRefs:{projectId},message:'A project was saved.',actionNeeded:false,safeActionRoute:'https://untrusted.example/secret',createdAt:new Date()});
    await db.collection<Row>('workspaces').updateOne({_id:testWorkspaceId},{$max:{nextActivitySequence:Long.fromNumber(sequence)}});
  }
  test('empty and populated feed is private, ordered and read-only until explicit acknowledgement',async()=>{
    const empty=await service.list(new URLSearchParams());assert.deepEqual(empty.items,[]);assert.equal(empty.latestSequence,0);
    await event(1);await event(2,project._id,'project_updated');const page=await service.list(new URLSearchParams());
    assert.deepEqual(page.items.map(i=>i.sequence),[2,1]);assert.equal(page.readThroughSequence,0);assert.equal(page.latestSequence,2);assert.equal(page.items[0].safeActionRoute,`/projects/${project._id}`);
    assert.ok(!JSON.stringify(page).includes('untrusted'));assert.ok(!JSON.stringify(page).includes('resourceRefs'));assert.ok(!JSON.stringify(page).includes(testUserId));
    assert.equal((await db.collection<Row>('memberships').findOne({userId:testUserId}))!.activityReadThroughSequence.toNumber(),0);
  });
  test('pagination is pinned to first-page snapshot through concurrent new events',async()=>{
    for(let n=1;n<=4;n++)await event(n);const first=await service.list(new URLSearchParams('limit=2'));assert.deepEqual(first.items.map(i=>i.sequence),[4,3]);assert.ok(first.page.nextCursor);
    await event(5);const second=await service.list(new URLSearchParams({limit:'2',cursor:first.page.nextCursor}));assert.deepEqual(second.items.map(i=>i.sequence),[2,1]);assert.equal(second.latestSequence,4);assert.equal(second.page.hasMore,false);
    await service.markRead({throughSequence:first.latestSequence});const fresh=await service.list(new URLSearchParams());assert.equal(fresh.latestSequence,5);assert.equal(fresh.readThroughSequence,4);
  });
  test('filter binding and cross-workspace membership prevent cursor and project leakage',async()=>{
    await event(1);await event(2,project._id,'project_updated');await event(3);
    const filtered=await service.list(new URLSearchParams({types:'project_updated',projectId:project._id}));assert.deepEqual(filtered.items.map(i=>i.sequence),[2]);
    await assert.rejects(service.list(new URLSearchParams({projectId:randomUUID()})),{code:'RESOURCE_NOT_FOUND'});
    const page=await service.list(new URLSearchParams('limit=1'));await assert.rejects(service.list(new URLSearchParams({limit:'1',types:'project_updated',cursor:page.page.nextCursor!})),{code:'INVALID_CURSOR'});
    await assert.rejects(new ActivityService(client,name,{...context,workspaceId:randomUUID()},secret).list(new URLSearchParams()),{code:'TEAM_ACCESS_DENIED'});
  });
  test('deleted or missing projects expose minimal notices with no title or removed links',async()=>{
    await event(1);await db.collection<Row>('projects').updateOne({_id:project._id},{$set:{deletedAt:new Date()}});
    const item=(await service.list(new URLSearchParams())).items[0];assert.equal(item.projectId,null);assert.equal(item.projectTitle,null);assert.equal(item.safeActionRoute,'/projects');assert.match(item.message,/removed/);assert.ok(!JSON.stringify(item).includes(project.displayTitle));
    await assert.rejects(service.list(new URLSearchParams({projectId:project._id})),{code:'RESOURCE_NOT_FOUND'});
  });
  test('acknowledgements are monotonic, per-member and do not edit preferences or event history',async()=>{
    await event(1);await event(2);await event(3);const before=await db.collection<Row>('memberships').findOne({userId:testUserId});
    await Promise.all([service.markRead({throughSequence:3}),service.markRead({throughSequence:1}),service.markRead({throughSequence:2})]);assert.deepEqual(await service.markRead({throughSequence:0}),{readThroughSequence:3});
    const member=(await db.collection<Row>('memberships').findOne({userId:testUserId}))!;assert.deepEqual(member.preferences,before!.preferences);assert.ok(member.preferencesRevision.equals(before!.preferencesRevision));assert.equal(await db.collection('activity_events').countDocuments(),3);
    const other=membershipFixture();other.userId='abcdef0123456789abcdef01';other.normalizedEmail='other@example.com';await db.collection<Row>('memberships').insertOne(other);
    const otherService=new ActivityService(client,name,{...context,userId:other.userId},secret);assert.equal((await otherService.list(new URLSearchParams())).readThroughSequence,0);
    await assert.rejects(service.markRead({throughSequence:4}),{code:'VALIDATION_FAILED'});
    await db.collection<Row>('memberships').updateOne({userId:testUserId},{$set:{status:'disabled'}});await assert.rejects(service.markRead({throughSequence:3}),{code:'TEAM_ACCESS_DENIED'});await assert.rejects(service.list(new URLSearchParams()),{code:'TEAM_ACCESS_DENIED'});
  });
  test('operations reports missing workers and unverified providers without metadata refresh or writes',async()=>{
    const operations=new OperationsService(client,name,context,providerEnv);const before=await db.collection<Row>('memberships').findOne({userId:testUserId});const result=await operations.read();
    assert.equal(result.worker.state,'not_started');assert.equal(result.planningWorker.state,'not_started');assert.equal(result.scheduling.enabled,false);assert.deepEqual(result.recovery.items,[]);assert.ok(result.providers.every(p=>p.state==='unverified'));
    assert.equal(await db.collection('provider_controls').countDocuments(),0);assert.deepEqual(await db.collection<Row>('memberships').findOne({userId:testUserId}),before);
  });
  test('operations preserves disabled provider policy and hides balances, keys and raw reason codes',async()=>{
    const provider=providerFixture();provider.state='disabled';provider.operatorDisabled=true;await db.collection<ProviderControl>('provider_controls').insertOne(provider);
    const result=await new OperationsService(client,name,context,providerEnv).read();assert.equal(result.providers.find(p=>p.id==='elevenlabs')!.state,'disabled');
    const json=JSON.stringify(result);for(const value of [provider.configHash,providerEnv.ELEVENLABS_API_KEY!,String(provider.allowance.observedRemaining)])assert.ok(!json.includes(value));
    await db.collection<Row>('memberships').updateOne({userId:testUserId},{$set:{status:'disabled'}});await assert.rejects(new OperationsService(client,name,context,providerEnv).read(),{code:'TEAM_ACCESS_DENIED'});
  });
});
