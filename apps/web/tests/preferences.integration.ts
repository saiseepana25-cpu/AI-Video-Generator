import {before,beforeEach,after,describe,test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {MongoClient,Long,type Db} from 'mongodb';
import {databaseClientOptions} from '../src/server/db/connection';
import {migrateDatabase,checkDatabase} from '../src/server/db/migrations';
import {preferencesCollections} from '../src/server/db/preferences-schemas';
import {PreferencesService} from '../src/server/preferences/service';
import {emptyPreferences} from '../src/server/preferences/validation';
import {workspaceFixture,membershipFixture,projectFixture,testWorkspaceId,testUserId,type Row} from './fixtures/database';
import {providerFixture,providerEnv} from './fixtures/providers';
const uri=process.env.MONGODB_TEST_URI??'mongodb://127.0.0.1:27028/?replicaSet=vcF03';
if(!/^mongodb:\/\/(127\.0\.0\.1|localhost):\d+\/(?:\?[^\s]*)?$/.test(uri))throw new Error('Isolated loopback database required.');
const name=`videocraft_preferences_test_${randomUUID().replaceAll('-','')}`,client=new MongoClient(uri,databaseClientOptions),context={workspaceId:testWorkspaceId,userId:testUserId,userName:'Tester'};
describe('personal preferences isolation and command recovery',{concurrency:false},()=>{
  let db:Db,service:PreferencesService;
  before(async()=>{await client.connect();db=client.db(name);await migrateDatabase(db);});
  beforeEach(async()=>{for(const n of ['memberships','workspaces','member_preferences_commands','provider_controls','projects'])await db.collection(n).deleteMany({});await db.collection<Row>('memberships').insertOne(membershipFixture());await db.collection<Row>('workspaces').insertOne(workspaceFixture());await db.collection<Row>('provider_controls').insertOne(providerFixture());service=new PreferencesService(client,name,context,providerEnv);});
  after(async()=>{try{if(!/^videocraft_preferences_test_[a-f0-9]{32}$/.test(name))throw new Error('Unsafe cleanup');await db.dropDatabase();}finally{await client.close();}});
  const body=(revision=1)=>({expectedRevision:revision,patch:{language:'te',timezone:'UTC'}});
  test('legacy read projects null accent without writing; save changes only this member and a private receipt',async()=>{
    const old=await db.collection('memberships').findOne({}),workspace=await db.collection('workspaces').findOne({});assert.deepEqual(await service.get(),{revision:1,preferences:emptyPreferences});assert.deepEqual(await db.collection('memberships').findOne({}),old);
    await db.collection<Row>('projects').insertOne(projectFixture());const project=await db.collection('projects').findOne({});const result=await service.patch(body(),randomUUID());assert.equal(result.preferences.revision,2);assert.equal(result.preferences.preferences.language,'te');assert.equal((await db.collection<Row>('memberships').findOne({}))!.activityReadThroughSequence.toString(),'0');assert.deepEqual(await db.collection('workspaces').findOne({}),workspace);assert.deepEqual(await db.collection('projects').findOne({}),project);assert.equal(await db.collection('member_preferences_commands').countDocuments(),1);await checkDatabase(db);
  });
  test('same-key retries replay original snapshot after newer edits and unavailable voices',async()=>{
    const key=randomUUID(),input={expectedRevision:1,patch:{...emptyPreferences,language:'en',voiceCatalogId:'alice-evaluation',accentId:'source-voice'}},first=await service.patch(input,key);
    await db.collection<Row>('provider_controls').updateOne({_id:'elevenlabs'},{$set:{operatorDisabled:true}});await service.patch({expectedRevision:2,patch:{...first.preferences.preferences,timezone:'UTC'}},randomUUID());
    assert.deepEqual((await service.patch(input,key)).preferences,first.preferences);assert.equal((await service.get()).revision,3);await assert.rejects(service.patch({...input,patch:{timezone:null}},key),/different preferences/);
  });
  test('concurrent identical commands create one receipt/revision; competing distinct edits have one winner',async()=>{
    const key=randomUUID(),results=await Promise.all([service.patch(body(),key),service.patch(body(),key)]);assert.equal(results.filter(r=>!r.replayed).length,1);assert.equal(await db.collection('member_preferences_commands').countDocuments(),1);
    const edits=await Promise.allSettled([service.patch({expectedRevision:2,patch:{timezone:'Asia/Kolkata'}},randomUUID()),service.patch({expectedRevision:2,patch:{timezone:null}},randomUUID())]);assert.equal(edits.filter(r=>r.status==='fulfilled').length,1);assert.equal((await service.get()).revision,3);
  });
  test('teammates are isolated and cannot replay another member receipt',async()=>{
    const other='abcdef0123456789abcdef01',member={...membershipFixture(),userId:other,normalizedEmail:'other@example.com'};await db.collection<Row>('memberships').insertOne(member);const key=randomUUID();await service.patch(body(),key);
    const teammate=new PreferencesService(client,name,{...context,userId:other},providerEnv);assert.deepEqual(await teammate.get(),{revision:1,preferences:emptyPreferences});assert.equal((await teammate.patch(body(),key)).replayed,false);assert.equal(await db.collection('member_preferences_commands').countDocuments(),2);assert.equal(await db.collection('activity_events').countDocuments(),0);
  });
  test('revoked or foreign access denies reads, mutations and completed replay',async()=>{
    const key=randomUUID();await service.patch(body(),key);await db.collection('memberships').updateOne({userId:testUserId},{$set:{status:'disabled'}});await assert.rejects(service.get(),/team access/);await assert.rejects(service.patch(body(),key),/team access/);await assert.rejects(new PreferencesService(client,name,{...context,workspaceId:randomUUID()},providerEnv).get(),/team access/);
  });
  test('voice/accent/language validation respects provider disablement; clearing stays possible',async()=>{
    const input={expectedRevision:1,patch:{...emptyPreferences,language:'en',voiceCatalogId:'alice-evaluation',accentId:'source-voice'}};await db.collection<Row>('provider_controls').updateOne({_id:'elevenlabs'},{$set:{operatorDisabled:true}});await assert.rejects(service.patch(input,randomUUID()),/voice is unavailable/);assert.equal((await service.get()).revision,1);
    await db.collection<Row>('provider_controls').updateOne({_id:'elevenlabs'},{$set:{operatorDisabled:false}});await service.patch(input,randomUUID());await assert.rejects(service.patch({expectedRevision:2,patch:{language:null}},randomUUID()),/personal video language/);await assert.rejects(service.patch({expectedRevision:2,patch:{accentId:null}},randomUUID()),/voice and accent/);
    await db.collection<Row>('provider_controls').updateOne({_id:'elevenlabs'},{$set:{operatorDisabled:true}});await service.patch({expectedRevision:2,patch:{...emptyPreferences}},randomUUID());assert.deepEqual((await service.get()).preferences,emptyPreferences);
  });
  test('receipt failure rolls back preferences and revision; no-op creates no command',async()=>{
    const old=await db.collection('memberships').findOne({});await assert.rejects(service.patch({expectedRevision:1,patch:{timezone:null}},randomUUID()),/Change a personal/);
    await db.command({collMod:'member_preferences_commands',validator:{$jsonSchema:{bsonType:'object',required:['controlled_failure']}}});try{await assert.rejects(service.patch(body(),randomUUID()));}finally{await db.command({collMod:'member_preferences_commands',validator:preferencesCollections.find(c=>c.name==='member_preferences_commands')!.validator});}
    assert.deepEqual(await db.collection('memberships').findOne({}),old);assert.equal(await db.collection('member_preferences_commands').countDocuments(),0);await checkDatabase(db);
  });
});
