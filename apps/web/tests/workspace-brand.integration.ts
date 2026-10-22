import {before,beforeEach,after,describe,test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {MongoClient,Long,type Db} from 'mongodb';
import {databaseClientOptions} from '../src/server/db/connection';
import {migrateDatabase,checkDatabase} from '../src/server/db/migrations';
import {brandCollections} from '../src/server/db/brand-schemas';
import {BrandService} from '../src/server/brand/service';
import {SettingsService} from '../src/server/settings/service';
import {initialBrand} from '../src/server/brand/validation';
import {workspaceFixture,membershipFixture,projectFixture,testWorkspaceId,testUserId,type Row} from './fixtures/database';
const uri=process.env.MONGODB_TEST_URI??'mongodb://127.0.0.1:27028/?replicaSet=vcF03';
if(!/^mongodb:\/\/(127\.0\.0\.1|localhost):\d+\/(?:\?[^\s]*)?$/.test(uri))throw new Error('Isolated loopback database required.');
const name=`videocraft_brand_test_${randomUUID().replaceAll('-','')}`,client=new MongoClient(uri,databaseClientOptions),context={workspaceId:testWorkspaceId,userId:testUserId,userName:'Tester'};
describe('immutable shared branding on an isolated replica set',{concurrency:false},()=>{
  let db:Db,service:BrandService;
  before(async()=>{await client.connect();db=client.db(name);await migrateDatabase(db);});
  beforeEach(async()=>{for(const n of ['workspaces','memberships','workspace_brand_commands','workspace_settings_commands','brand_kits','activity_events','projects'])await db.collection(n).deleteMany({});await db.collection<Row>('workspaces').insertOne(workspaceFixture());await db.collection<Row>('memberships').insertOne(membershipFixture());service=new BrandService(client,name,context);});
  after(async()=>{try{if(!/^videocraft_brand_test_[a-f0-9]{32}$/.test(name))throw new Error('Unsafe cleanup');await db.dropDatabase();}finally{await client.close();}});
  const body=(revision=0)=>({expectedRevision:revision,brandKit:initialBrand});
  test('empty read performs no brand writes; first save atomically pins revision and receipt/event',async()=>{
    assert.deepEqual(await service.get(),{revision:0,brandKit:null});assert.equal(await db.collection('brand_kits').countDocuments(),0);
    const key=randomUUID(),result=await service.put(body(),key);assert.equal(result.replayed,false);assert.equal(result.brand.revision,1);
    const workspace=(await db.collection<Row>('workspaces').findOne({}))!;assert.equal(workspace.brandKitRevisionId,result.brand.brandKit!.id);assert.equal(workspace.brandRevision.toString(),'1');assert.equal(workspace.settingsRevision.toString(),'1');assert.equal(workspace.nextActivitySequence.toString(),'1');
    const row=(await db.collection<Row>('brand_kits').findOne({}))!;assert.equal(row.parentBrandKitRevisionId,null);assert.ok(Long.isLong(row.revision));assert.equal((await db.collection<Row>('activity_events').findOne({}))!.type,'workspace_brand_changed');assert.equal((await service.put(body(),key)).replayed,true);assert.equal(await db.collection('brand_kits').countDocuments(),1);await checkDatabase(db);
  });
  test('later save preserves immutable history and replay returns original snapshot before stale checks',async()=>{
    const key=randomUUID(),first=await service.put(body(),key),original=await db.collection<Row>('brand_kits').findOne({_id:first.brand.brandKit!.id});
    await service.put({expectedRevision:1,brandKit:{...initialBrand,primaryColor:'#FFFFFF'}},randomUUID());
    assert.deepEqual((await service.put(body(),key)).brand,first.brand);assert.equal((await service.get()).revision,2);assert.deepEqual(await db.collection<Row>('brand_kits').findOne({_id:first.brand.brandKit!.id}),original);
    const latest=await db.collection<Row>('brand_kits').findOne({revision:Long.fromNumber(2)});assert.equal(latest!.parentBrandKitRevisionId,original!._id);
    await assert.rejects(service.put({expectedRevision:0,brandKit:{...initialBrand,primaryColor:'#FFFFFF'}},key),/different branding/);assert.equal(await db.collection('activity_events').countDocuments(),2);
  });
  test('competing first saves produce one winner and no-op/stale requests create no revision',async()=>{
    const results=await Promise.allSettled([service.put(body(),randomUUID()),service.put({...body(),brandKit:{...initialBrand,primaryColor:'#FFFFFF'}},randomUUID())]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
    const current=await service.get();const {id,revision,createdAt,createdBy,...kit}=current.brandKit!;
    await assert.rejects(service.put({expectedRevision:1,brandKit:kit},randomUUID()),/Change a palette/);await assert.rejects(service.put(body(),randomUUID()),/Shared branding changed/);assert.equal(await db.collection('brand_kits').countDocuments(),1);assert.equal(await db.collection('workspace_brand_commands').countDocuments(),1);
  });
  test('settings and branding have independent counters; projects retain exact saved data',async()=>{
    await db.collection<Row>('projects').insertOne(projectFixture());const original=await db.collection('projects').findOne({});
    await Promise.all([service.put(body(),randomUUID()),new SettingsService(client,name,context,{}).patch({expectedRevision:1,patch:{timezone:'UTC'}},randomUUID())]);
    const row=(await db.collection<Row>('workspaces').findOne({}))!;assert.equal(row.brandRevision.toString(),'1');assert.equal(row.settingsRevision.toString(),'2');assert.equal(row.nextActivitySequence.toString(),'2');assert.equal(row.timezone,'UTC');assert.deepEqual(await db.collection('projects').findOne({}),original);assert.equal(await db.collection('activity_events').countDocuments(),2);
  });
  test('inactive or foreign membership denies get, writes and receipt replay; missing pointer fails closed',async()=>{
    const key=randomUUID();await service.put(body(),key);await db.collection('memberships').updateOne({userId:testUserId},{$set:{status:'disabled'}});
    await assert.rejects(service.get(),/team access/);await assert.rejects(service.put(body(),key),/team access/);await assert.rejects(new BrandService(client,name,{...context,workspaceId:randomUUID()}).get(),/team access/);
    await db.collection('memberships').updateOne({userId:testUserId},{$set:{status:'active'}});await db.collection<Row>('workspaces').updateOne({},{$set:{brandKitRevisionId:randomUUID()}});await assert.rejects(service.get(),/unavailable/);
  });
  test('event failure rolls back new revision, pointer, receipt and membership fence',async()=>{
    const workspace=await db.collection('workspaces').findOne({}),member=await db.collection('memberships').findOne({});
    await db.command({collMod:'activity_events',validator:{$jsonSchema:{bsonType:'object',required:['controlled_failure']}}});
    try{await assert.rejects(service.put(body(),randomUUID()),(e:unknown)=>!!e&&typeof e==='object'&&'code'in e&&e.code===121);}
    finally{await db.command({collMod:'activity_events',validator:brandCollections.find(c=>c.name==='activity_events')!.validator});}
    assert.deepEqual(await db.collection('workspaces').findOne({}),workspace);assert.deepEqual(await db.collection('memberships').findOne({}),member);for(const n of ['brand_kits','workspace_brand_commands','activity_events'])assert.equal(await db.collection(n).countDocuments(),0);
  });
  test('database refuses duplicate revision, foreign font and unknown properties',async()=>{
    await service.put(body(),randomUUID());const row=(await db.collection<Row>('brand_kits').findOne({}))!;
    await assert.rejects(db.collection<Row>('brand_kits').insertOne({...row,_id:randomUUID()}),(e:unknown)=>!!e&&typeof e==='object'&&'code'in e&&e.code===11000);
    for(const patch of [{englishFontId:'arbitrary'},{extra:true}])await assert.rejects(db.collection<Row>('brand_kits').insertOne({...row,_id:randomUUID(),revision:Long.fromNumber(2),...patch}),(e:unknown)=>!!e&&typeof e==='object'&&'code'in e&&e.code===121);
    await checkDatabase(db);
  });
});
