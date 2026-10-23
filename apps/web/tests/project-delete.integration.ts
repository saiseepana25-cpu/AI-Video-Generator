import {after,before,beforeEach,describe,test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Long,MongoClient,type Db} from 'mongodb';
import {databaseClientOptions} from '../src/server/db/connection';
import {migrateDatabase,checkDatabase} from '../src/server/db/migrations';
import {deletionCollections} from '../src/server/db/deletion-schemas';
import {ProjectService} from '../src/server/projects/service';
import {workspaceFixture,membershipFixture,projectFixture,testWorkspaceId,testUserId,type Row} from './fixtures/database';
const uri=process.env.MONGODB_TEST_URI??'mongodb://127.0.0.1:27028/?replicaSet=vcF03';
if(!/^mongodb:\/\/(127\.0\.0\.1|localhost):\d+\/(?:\?[^\s]*)?$/.test(uri))throw new Error('Isolated loopback replica set required.');
const client=new MongoClient(uri,databaseClientOptions),name=`videocraft_delete_test_${randomUUID().replaceAll('-','')}`,context={workspaceId:testWorkspaceId,userId:testUserId,userName:'Tester'},secret='deletion-test-secret-'.repeat(3);
describe('guarded idle project tombstones',{concurrency:false},()=>{
  let db:Db,service:ProjectService,source:Row;
  before(async()=>{await client.connect();db=client.db(name);await migrateDatabase(db);});
  beforeEach(async()=>{for(const c of ['projects','project_delete_commands','project_duplicate_commands','memberships','workspaces','activity_events','jobs','generation_runs','generation_storage_bundles'])await db.collection(c).deleteMany({});await db.collection<Row>('workspaces').insertOne(workspaceFixture());await db.collection<Row>('memberships').insertOne(membershipFixture());source=projectFixture();await db.collection<Row>('projects').insertOne(source);service=new ProjectService(client,name,context,secret);});
  after(async()=>{try{if(!/^videocraft_delete_test_[a-f0-9]{32}$/.test(name))throw new Error('Unsafe cleanup');await db.dropDatabase();}finally{await client.close();}});
  const input=()=>({expectedProjectRevision:1});
  test('hides an idle project without removing content, assets or related copies',async()=>{
    const copy=(await service.duplicate(source._id,input(),randomUUID())).project;
    const result=await service.delete(source._id,input(),randomUUID());assert.equal(result.receipt.cleanupState,'retained');assert.equal(result.receipt.cleanupJobId,null);
    assert.deepEqual(await service.deletionStatus(source._id),result.receipt);assert.ok(!JSON.stringify(result.receipt).includes(source.displayTitle));
    await assert.rejects(service.get(source._id),{status:404});assert.deepEqual((await service.list({q:'',limit:20,cursor:null,order:'updated_desc'})).items.map(p=>p.id),[copy.id]);
    const row=await db.collection<Row>('projects').findOne({_id:source._id});assert.deepEqual(row!.brief,source.brief);assert.equal(row!.revision.toString(),'2');assert.equal(row!.briefRevision.toString(),'1');assert.equal(row!.guardRevision.toString(),'2');assert.ok(row!.deletedAt instanceof Date);assert.deepEqual((await service.get(copy.id)).brief,source.brief);
    assert.equal(await db.collection('activity_events').countDocuments({type:'project_deleted'}),1);await checkDatabase(db);
    await assert.rejects(service.patch(source._id,{expectedProjectRevision:2,patch:{displayTitle:'Restored?'}},randomUUID()),{status:404});await assert.rejects(service.duplicate(source._id,{expectedProjectRevision:2},randomUUID()),{status:404});
  });
  test('concurrent exact retries produce one tombstone and permanent receipt',async()=>{
    const key=randomUUID(),results=await Promise.all(Array.from({length:4},()=>service.delete(source._id,input(),key)));assert.equal(results.filter(r=>!r.replayed).length,1);assert.equal(await db.collection('project_delete_commands').countDocuments(),1);assert.equal(await db.collection('activity_events').countDocuments(),1);
    await db.collection('project_delete_commands').updateOne({projectId:source._id},{$set:{createdAt:new Date(0)}});assert.deepEqual((await service.delete(source._id,input(),key)).receipt,results[0].receipt);
    await assert.rejects(service.delete(source._id,{expectedProjectRevision:2},key),{code:'IDEMPOTENCY_MISMATCH'});await assert.rejects(service.delete(source._id,input(),randomUUID()),{status:404});
  });
  test('stale revision, foreign scope and disabled membership refuse without writes',async()=>{
    await assert.rejects(service.delete(source._id,{expectedProjectRevision:2},randomUUID()),{code:'STALE_REVISION'});
    const foreign=new ProjectService(client,name,{...context,workspaceId:randomUUID()},secret);await assert.rejects(foreign.delete(source._id,input(),randomUUID()),{status:403});
    await db.collection<Row>('memberships').updateOne({userId:testUserId},{$set:{status:'disabled',disabledAt:new Date(),disabledBy:{kind:'user',userId:testUserId}}});await assert.rejects(service.delete(source._id,input(),randomUUID()),{status:403});assert.equal(await db.collection('project_delete_commands').countDocuments(),0);
  });
  test('revocation denies minimal status and command replay',async()=>{
    const key=randomUUID();await service.delete(source._id,input(),key);await db.collection<Row>('memberships').updateOne({userId:testUserId},{$set:{status:'disabled',disabledAt:new Date(),disabledBy:{kind:'user',userId:testUserId}}});await assert.rejects(service.deletionStatus(source._id),{status:403});await assert.rejects(service.delete(source._id,input(),key),{status:403});
  });
  test('active pointer and unresolved rows refuse even when lease expired',async()=>{
    for(const field of ['activePlanningJobId','latestRunId']){await db.collection<Row>('projects').updateOne({_id:source._id},{$set:{[field]:randomUUID()}});await assert.rejects(service.delete(source._id,input(),randomUUID()),{code:'PROJECT_WORK_UNRESOLVED'});await db.collection<Row>('projects').updateOne({_id:source._id},{$set:{[field]:null}});}
    // Controlled malformed/legacy rows prove fail-closed handling independently
    // of normal writer validation, including expired executor evidence.
    for(const [collection,row] of [['jobs',{state:'paused',submission:'uncertain'}],['generation_runs',{state:'running',stage:'rendering',leaseUntil:new Date(0)}],['generation_storage_bundles',{state:'uploading',leaseUntil:new Date(0)}],['generation_runs',{state:'rendered_local'}]] as const){
      await db.collection<Row>(collection).insertOne({_id:randomUUID(),workspaceId:testWorkspaceId,projectId:source._id,...row},{bypassDocumentValidation:true});await assert.rejects(service.delete(source._id,input(),randomUUID()),{code:'PROJECT_WORK_UNRESOLVED'});await db.collection(collection).deleteMany({});
    }
    assert.equal((await service.get(source._id)).revision,1);assert.equal(await db.collection('project_delete_commands').countDocuments(),0);
  });
  test('receipt failure rolls back tombstone, source/member guards and activity',async()=>{
    const member=await db.collection('memberships').findOne({userId:testUserId}),workspace=await db.collection<Row>('workspaces').findOne({_id:testWorkspaceId});
    await db.command({collMod:'project_delete_commands',validator:{$jsonSchema:{bsonType:'object',required:['controlled_failure']}}});try{await assert.rejects(service.delete(source._id,input(),randomUUID()));}finally{await db.command({collMod:'project_delete_commands',validator:deletionCollections[2].validator});}
    assert.deepEqual(await db.collection<Row>('projects').findOne({_id:source._id}),source);assert.deepEqual(await db.collection('memberships').findOne({userId:testUserId}),member);assert.deepEqual(await db.collection<Row>('workspaces').findOne({_id:testWorkspaceId}),workspace);assert.equal(await db.collection('activity_events').countDocuments(),0);
  });
  test('source tombstone revokes earlier duplication response snapshots',async()=>{
    const key=randomUUID(),copy=await service.duplicate(source._id,input(),key);await service.delete(source._id,input(),randomUUID());await assert.rejects(service.duplicate(source._id,input(),key),{status:404});assert.deepEqual((await service.get(copy.project.id)).brief,source.brief);
  });
  test('stored output and ownership rows are retained byte-for-byte',async()=>{
    const runId=randomUUID(),bundleId=randomUUID(),assetId=randomUUID(),scope={workspaceId:testWorkspaceId,projectId:source._id};
    const run={_id:runId,...scope,state:'rendered_local'},bundle={_id:bundleId,...scope,runId,state:'stored'},asset={_id:assetId,...scope,refCount:Long.ONE};
    await db.collection<Row>('generation_runs').insertOne(run,{bypassDocumentValidation:true});await db.collection<Row>('generation_storage_bundles').insertOne(bundle,{bypassDocumentValidation:true});await db.collection<Row>('video_assets').insertOne(asset,{bypassDocumentValidation:true});
    await service.delete(source._id,input(),randomUUID());assert.deepEqual(await db.collection<Row>('generation_runs').findOne({_id:runId}),run);assert.deepEqual(await db.collection<Row>('generation_storage_bundles').findOne({_id:bundleId}),bundle);assert.deepEqual(await db.collection<Row>('video_assets').findOne({_id:assetId}),asset);
    await db.collection('video_assets').deleteMany({});
  });
  test('live projects have no deletion receipt and foreign tombstones remain hidden',async()=>{
    await assert.rejects(service.deletionStatus(source._id),{status:404});await service.delete(source._id,input(),randomUUID());await db.collection<Row>('projects').updateOne({_id:source._id},{$set:{workspaceId:randomUUID()}});await assert.rejects(service.deletionStatus(source._id),{status:404});
  });
  test('rename versus deletion never deletes a newer unreviewed revision',async()=>{
    const results=await Promise.allSettled([service.delete(source._id,input(),randomUUID()),service.patch(source._id,{expectedProjectRevision:1,patch:{displayTitle:'A newer title'}},randomUUID())]);
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1);const row=await db.collection<Row>('projects').findOne({_id:source._id});if(row!.deletedAt)assert.equal(row!.displayTitle,source.displayTitle);else assert.equal(row!.displayTitle,'A newer title');
  });
});
