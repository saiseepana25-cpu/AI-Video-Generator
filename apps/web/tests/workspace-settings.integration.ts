import {before,beforeEach,after,describe,test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {MongoClient,Long,type Db} from 'mongodb';
import {databaseClientOptions} from '../src/server/db/connection';
import {migrateDatabase,checkDatabase} from '../src/server/db/migrations';
import {workspaceSettingsCollections} from '../src/server/db/workspace-settings-schemas';
import {SettingsService} from '../src/server/settings/service';
import {ProjectService} from '../src/server/projects/service';
import {defaultComposerSettings,composerBody} from '../src/lib/composer-settings';
import {workspaceFixture,membershipFixture,testWorkspaceId,testUserId,type Row} from './fixtures/database';
import {providerFixture,providerEnv} from './fixtures/providers';
import type {ProviderControl} from '../src/server/providers/contracts';
const uri=process.env.MONGODB_TEST_URI??'mongodb://127.0.0.1:27028/?replicaSet=vcF03';
if(!/^mongodb:\/\/(127\.0\.0\.1|localhost):\d+\/(?:\?[^\s]*)?$/.test(uri))throw new Error('Isolated loopback database required.');
const name=`videocraft_f13_test_${randomUUID().replaceAll('-','')}`,client=new MongoClient(uri,databaseClientOptions),context={workspaceId:testWorkspaceId,userId:testUserId,userName:'Tester'};
describe('shared workspace defaults on an isolated replica set',{concurrency:false},()=>{
  let db:Db,service:SettingsService;
  before(async()=>{await client.connect();db=client.db(name);await migrateDatabase(db);});
  beforeEach(async()=>{for(const n of ['workspaces','memberships','workspace_settings_commands','activity_events','provider_controls','projects','idempotency_records'])await db.collection(n).deleteMany({});await db.collection<Row>('workspaces').insertOne(workspaceFixture());await db.collection<Row>('memberships').insertOne(membershipFixture());await db.collection<ProviderControl>('provider_controls').insertOne(providerFixture());service=new SettingsService(client,name,context,providerEnv);});
  after(async()=>{try{if(!/^videocraft_f13_test_[a-f0-9]{32}$/.test(name))throw new Error('Unsafe cleanup');await db.dropDatabase();}finally{await client.close();}});
  const body=async(language:'en'|'te'='te')=>({expectedRevision:1,patch:{timezone:'Asia/Kolkata',defaults:{...(await service.get()).defaults,language,targetSeconds:30}}});
  test('read is scoped and normalizes unresolved legacy accent without writing',async()=>{
    const before=await db.collection('workspaces').findOne({});const view=await service.get();assert.equal(view.revision,1);assert.equal(view.defaults.preferredAccentId,null);assert.deepEqual(await db.collection('workspaces').findOne({}),before);assert.equal(await db.collection('workspace_settings_commands').countDocuments(),0);
  });
  test('save commits settings, revision, actor, replay receipt and one workspace event atomically',async()=>{
    const input=await body(),key=randomUUID(),result=await service.patch(input,key);assert.equal(result.replayed,false);assert.equal(result.settings.revision,2);assert.equal(result.settings.defaults.language,'te');
    const workspace=(await db.collection<Row>('workspaces').findOne({}))!;assert.ok(Long.isLong(workspace.settingsRevision));assert.equal(workspace.updatedBy.userId,testUserId);
    const event=(await db.collection<Row>('activity_events').findOne({}))!;assert.equal(event.type,'workspace_settings_changed');assert.equal(event.projectId,null);assert.deepEqual(event.resourceRefs,{workspaceId:testWorkspaceId});
    assert.equal((await service.patch(input,key)).replayed,true);assert.equal(await db.collection('activity_events').countDocuments(),1);assert.equal(await db.collection('workspace_settings_commands').countDocuments(),1);await checkDatabase(db);
  });
  test('same-command replay returns original snapshot after later saves and rejects changed payload',async()=>{
    const input=await body(),key=randomUUID(),first=await service.patch(input,key);await service.patch({expectedRevision:2,patch:{timezone:'UTC'}},randomUUID());
    assert.deepEqual((await service.patch(input,key)).settings,first.settings);assert.equal((await service.get()).revision,3);assert.equal((await service.get()).timezone,'UTC');
    await assert.rejects(service.patch({...input,patch:{timezone:'UTC'}},key),/different settings/);assert.equal(await db.collection('activity_events').countDocuments(),2);
  });
  test('concurrent saves refuse stale revision without losing the winner',async()=>{
    const input=await body();const results=await Promise.allSettled([service.patch(input,randomUUID()),service.patch({...input,patch:{timezone:'UTC'}},randomUUID())]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected').length,1);assert.equal((await service.get()).revision,2);assert.equal(await db.collection('activity_events').countDocuments(),1);
  });
  test('unsupported/unavailable voice cannot change settings or write receipts; null defaults remain usable',async()=>{
    await db.collection<ProviderControl>('provider_controls').updateOne({_id:'elevenlabs'},{$set:{state:'disabled',operatorDisabled:true}});const input=await body();input.patch.defaults={...input.patch.defaults,preferredVoiceCatalogId:'alice-evaluation',preferredAccentId:'source-voice'};
    await assert.rejects(service.patch(input,randomUUID()),/voice is unavailable/);assert.equal((await service.get()).revision,1);assert.equal(await db.collection('activity_events').countDocuments(),0);assert.equal(await db.collection('workspace_settings_commands').countDocuments(),0);
    await service.patch(await body(),randomUUID());assert.equal((await service.get()).revision,2);
  });
  test('new projects inherit captured defaults while existing project snapshots stay unchanged',async()=>{
    const projects=new ProjectService(client,name,context,'settings-test-secret'.repeat(2),providerEnv),initial=(await service.get()).defaults;
    const old=(await projects.create({idea:'Original explanation',settings:defaultComposerSettings(initial,'en')},randomUUID())).project;
    const original=await db.collection<Row>('projects').findOne({_id:old.id});
    const selected={...(await body()).patch.defaults,preferredVoiceCatalogId:'alice-evaluation',preferredAccentId:'source-voice'};
    await service.patch({expectedRevision:1,patch:{defaults:selected}},randomUUID());
    const saved=await service.get(),inherited=defaultComposerSettings(saved.defaults,saved.defaults.language);
    const created=(await projects.create(JSON.parse(composerBody({idea:'New explanation',language:inherited.language,seconds:inherited.targetSeconds,voiceCatalogId:inherited.voiceCatalogId,accentId:inherited.accentId})),randomUUID())).project;
    assert.equal(created.language,'te');assert.equal(created.targetSeconds,30);assert.equal(created.settings.voiceCatalogId,'alice-evaluation');assert.deepEqual(await db.collection<Row>('projects').findOne({_id:old.id}),original);
  });
  test('inactive/foreign membership and missing workspace deny reads and writes including replay',async()=>{
    const input=await body(),key=randomUUID();await service.patch(input,key);await db.collection('memberships').updateOne({userId:testUserId},{$set:{status:'disabled'}});
    await assert.rejects(service.get(),/team access/);await assert.rejects(service.patch(input,key),/team access/);
    await assert.rejects(new SettingsService(client,name,{...context,workspaceId:randomUUID()},providerEnv).get(),/team access/);
    await db.collection('memberships').updateOne({userId:testUserId},{$set:{status:'active'}});await db.collection('workspaces').deleteMany({});await assert.rejects(service.get(),/could not be found/);
  });
  test('timezone-only patches and no-op refusal do not change saved voice or existing projects',async()=>{
    const current=await service.get();await assert.rejects(service.patch({expectedRevision:1,patch:{timezone:current.timezone}},randomUUID()),/Change a default/);
    const updated=await service.patch({expectedRevision:1,patch:{timezone:'UTC'}},randomUUID());assert.deepEqual(updated.settings.defaults,current.defaults);assert.equal(updated.settings.timezone,'UTC');assert.equal(await db.collection('workspace_settings_commands').countDocuments(),1);
  });
  test('event failure rolls back settings, activity sequence, membership fence and receipt',async()=>{
    const input=await body(),before=await db.collection<Row>('workspaces').findOne({}),member=await db.collection<Row>('memberships').findOne({});
    await db.command({collMod:'activity_events',validator:{$jsonSchema:{bsonType:'object',required:['controlled_failure']}}});
    try{await assert.rejects(service.patch(input,randomUUID()),(e:unknown)=>!!e&&typeof e==='object'&&'code'in e&&e.code===121);}
    finally{await db.command({collMod:'activity_events',validator:workspaceSettingsCollections.find(c=>c.name==='activity_events')!.validator});}
    assert.deepEqual(await db.collection<Row>('workspaces').findOne({}),before);assert.deepEqual(await db.collection<Row>('memberships').findOne({}),member);assert.equal(await db.collection('workspace_settings_commands').countDocuments(),0);assert.equal(await db.collection('activity_events').countDocuments(),0);
  });
});
