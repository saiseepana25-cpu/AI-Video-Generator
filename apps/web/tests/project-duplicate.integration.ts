import {after,before,beforeEach,describe,test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Long,MongoClient,ObjectId,type Db} from 'mongodb';
import {databaseClientOptions} from '../src/server/db/connection';
import {migrateDatabase,checkDatabase} from '../src/server/db/migrations';
import {duplicateCollections} from '../src/server/db/duplicate-schemas';
import {ProjectService} from '../src/server/projects/service';
import {PlanningService} from '../src/server/planning/service';
import {PlanEditService} from '../src/server/planning/plan-edit-service';
import {RenderInputService} from '../src/server/rendering/service';
import type {PlanVersion} from '../src/server/planning/contracts';
import {digest} from '../src/server/providers/config';
import {workspaceFixture,membershipFixture,projectFixture,testWorkspaceId,testUserId,type Row} from './fixtures/database';
import {renderFixture,pins} from './fixtures/rendering';
import {providerFixture,providerEnv} from './fixtures/providers';
const uri=process.env.MONGODB_TEST_URI??'mongodb://127.0.0.1:27028/?replicaSet=vcF03';
if(!/^mongodb:\/\/(127\.0\.0\.1|localhost):\d+\/(?:\?[^\s]*)?$/.test(uri))throw new Error('Isolated loopback replica set required.');
const client=new MongoClient(uri,databaseClientOptions),name=`videocraft_duplicate_test_${randomUUID().replaceAll('-','')}`,context={workspaceId:testWorkspaceId,userId:testUserId,userName:'Tester'},secret='duplicate-test-secret-'.repeat(3);
describe('atomic project duplication on an isolated replica set',{concurrency:false},()=>{
  let db:Db,service:ProjectService,source:Row;
  before(async()=>{await client.connect();db=client.db(name);await migrateDatabase(db);});
  beforeEach(async()=>{for(const collection of ['projects','plan_versions','project_duplicate_commands','memberships','workspaces','users','activity_events','provider_controls','plan_edit_commands'])await db.collection(collection).deleteMany({});await db.collection<Row>('workspaces').insertOne(workspaceFixture());await db.collection<Row>('memberships').insertOne(membershipFixture());await db.collection('users').insertOne({_id:new ObjectId(testUserId),name:'Tester'});source=projectFixture();await db.collection<Row>('projects').insertOne(source);service=new ProjectService(client,name,context,secret);});
  after(async()=>{try{if(!/^videocraft_duplicate_test_[a-f0-9]{32}$/.test(name))throw new Error('Unsafe cleanup');await db.dropDatabase();}finally{await client.close();}});
  async function addPlan(){const id=randomUUID(),request=randomUUID();const version:PlanVersion={_id:id,schemaVersion:1,workspaceId:testWorkspaceId,projectId:source._id,versionNumber:Long.fromNumber(7),sourceBriefRevision:source.briefRevision,sourcePlanningRequestId:request,inputHash:digest(JSON.stringify({brief:source.brief,settings:source.settings})),settingsSnapshot:source.settings,plan:renderFixture('te').proposal,plannerModelId:'fixture-model',promptContractVersion:'educational-diagrams-v1',createdAt:new Date(),createdBy:testUserId};await db.collection<PlanVersion>('plan_versions').insertOne(version);await db.collection<Row>('projects').updateOne({_id:source._id},{$set:{currentPlanVersionId:id,planningRequestId:request,nextPlanVersionNumber:Long.fromNumber(7)}});return version;}
  const body=()=>({expectedProjectRevision:1});
  test('copies a brief/settings snapshot without provider access or operational state',async()=>{
    const active={activePlanningJobId:randomUUID(),latestRunId:randomUUID(),latestReadyVideoId:randomUUID(),nextVideoVersionNumber:Long.fromNumber(3),nextMessageSequence:Long.fromNumber(9)};
    await db.collection<Row>('projects').updateOne({_id:source._id},{$set:active});const before=await db.collection<Row>('projects').findOne({_id:source._id});
    const result=await service.duplicate(source._id,body(),randomUUID()),copy=await db.collection<Row>('projects').findOne({_id:result.project.id});
    assert.notEqual(copy!._id,source._id);assert.equal(copy!.sourceProjectId,source._id);assert.deepEqual(copy!.brief,source.brief);assert.deepEqual(copy!.settings,source.settings);assert.equal(copy!.displayTitle,`Copy of ${source.displayTitle}`);
    for(const key of ['revision','briefRevision'])assert.equal(copy![key].toString(),'1');for(const key of ['guardRevision','nextPlanVersionNumber','nextVideoVersionNumber','nextMessageSequence'])assert.equal(copy![key].toString(),'0');
    for(const key of ['currentPlanVersionId','planningRequestId','activePlanningJobId','latestRunId','latestReadyVideoId'])assert.equal(copy![key],null);
    const after=await db.collection<Row>('projects').findOne({_id:source._id});assert.deepEqual({...after,guardRevision:before!.guardRevision},before);assert.equal(after!.guardRevision.toString(),'1');
    for(const collection of ['approvals','generation_runs','jobs','messages','ready_videos','generation_storage_bundles'])assert.equal(await db.collection(collection).countDocuments({projectId:copy!._id}),0);
    assert.equal(await db.collection('activity_events').countDocuments({projectId:copy!._id}),1);await checkDatabase(db);
  });
  test('copies a current plan with new provenance and it remains editable and compilable',async()=>{
    const original=await addPlan(),result=await service.duplicate(source._id,{...body(),displayTitle:'కొత్త వివరణ'},randomUUID()),copy=result.project;
    const plan=await db.collection<PlanVersion>('plan_versions').findOne({projectId:copy.id});assert.ok(plan);assert.notEqual(plan._id,original._id);assert.equal(plan.versionNumber.toString(),'1');assert.equal(plan.source,'duplicate');assert.equal(plan.duplicatedFromPlanVersionId,original._id);assert.equal(plan.sourcePlanningRequestId,plan._id);assert.equal(copy.currentPlanVersionId,plan._id);assert.deepEqual(plan.plan,original.plan);
    const view=await new PlanningService(client,name,context,{}).plan(plan._id);assert.equal(view.isCurrent,true);assert.equal(view.canEdit,true);
    await db.collection<Row>('provider_controls').insertOne(providerFixture());const prepared=await new RenderInputService(client,name,context,providerEnv,async()=>pins).prepare(plan._id);assert.ok(prepared.plan);assert.deepEqual(prepared.issues,[]);
    await new PlanEditService(client,name,context).edit(plan._id,{expectedProjectRevision:1,edits:{headings:[{sceneId:'scene_1',text:'కొత్త శీర్షిక'}]}},randomUUID());
    assert.deepEqual(await db.collection<PlanVersion>('plan_versions').findOne({_id:original._id}),original);assert.equal((await service.get(source._id)).currentPlanVersionId,original._id);
  });
  test('outdated plan is not promoted into the copy; missing/foreign plan pointers refuse',async()=>{
    const original=await addPlan();await db.collection<Row>('projects').updateOne({_id:source._id},{$inc:{briefRevision:Long.ONE}});
    const copy=(await service.duplicate(source._id,body(),randomUUID())).project;assert.equal(copy.currentPlanVersionId,null);assert.equal(await db.collection('plan_versions').countDocuments({projectId:copy.id}),0);
    await db.collection<PlanVersion>('plan_versions').deleteOne({_id:original._id});await assert.rejects(service.duplicate(source._id,body(),randomUUID()),/source plan is unavailable/);
    await db.collection<PlanVersion>('plan_versions').insertOne({...original,projectId:randomUUID()});await assert.rejects(service.duplicate(source._id,body(),randomUUID()),/source plan is unavailable/);
  });
  test('same-key concurrent retries create exactly one copy and replay original snapshot after later edits',async()=>{
    await addPlan();const key=randomUUID(),results=await Promise.all(Array.from({length:5},()=>service.duplicate(source._id,body(),key)));assert.equal(new Set(results.map(v=>v.project.id)).size,1);assert.equal(results.filter(v=>!v.replayed).length,1);assert.equal(await db.collection('projects').countDocuments(),2);assert.equal(await db.collection('project_duplicate_commands').countDocuments(),1);
    await service.patch(source._id,{expectedProjectRevision:1,patch:{displayTitle:'Renamed source'}},randomUUID());await service.patch(results[0].project.id,{expectedProjectRevision:1,patch:{displayTitle:'Renamed copy'}},randomUUID());
    assert.deepEqual((await service.duplicate(source._id,body(),key)).project,results[0].project);
    await assert.rejects(service.duplicate(source._id,{...body(),displayTitle:'Different payload'},key),/different duplicate/);
    assert.equal(await db.collection('activity_events').countDocuments({projectId:results[0].project.id,type:'project_created'}),1);
  });
  test('stale source, unavailable brand and disabled/foreign membership cannot create copies',async()=>{
    await assert.rejects(service.duplicate(source._id,{expectedProjectRevision:2},randomUUID()),/newer saved changes/);
    await db.collection<Row>('projects').updateOne({_id:source._id},{$set:{'settings.brandKitRevisionId':randomUUID()}});await assert.rejects(service.duplicate(source._id,body(),randomUUID()),/brand palette is unavailable/);
    await db.collection<Row>('memberships').updateOne({userId:testUserId},{$set:{status:'disabled',disabledAt:new Date(),disabledBy:{kind:'user',userId:testUserId}}});await assert.rejects(service.duplicate(source._id,body(),randomUUID()),/team access/);
    assert.equal(await db.collection('projects').countDocuments(),1);assert.equal(await db.collection('project_duplicate_commands').countDocuments(),0);
  });
  test('deleted source or target refuses receipt replay; no copied content resurfaces',async()=>{
    const key=randomUUID(),result=await service.duplicate(source._id,body(),key),actor={kind:'user',userId:testUserId};
    await db.collection<Row>('projects').updateOne({_id:source._id},{$set:{deletedAt:new Date(),deletedBy:actor}});await assert.rejects(service.duplicate(source._id,body(),key),/could not be found/);
    await db.collection<Row>('projects').updateOne({_id:source._id},{$set:{deletedAt:null,deletedBy:null}});await db.collection<Row>('projects').updateOne({_id:result.project.id},{$set:{deletedAt:new Date(),deletedBy:actor}});await assert.rejects(service.duplicate(source._id,body(),key),/could not be found/);assert.equal(await db.collection('projects').countDocuments(),2);
  });
  test('receipt failure rolls back copy, plan, membership/source guards and event sequence',async()=>{
    await addPlan();const before=await db.collection<Row>('projects').findOne({_id:source._id}),member=await db.collection('memberships').findOne({userId:testUserId}),workspace=await db.collection<Row>('workspaces').findOne({_id:testWorkspaceId});
    await db.command({collMod:'project_duplicate_commands',validator:{$jsonSchema:{bsonType:'object',required:['controlled_failure']}}});try{await assert.rejects(service.duplicate(source._id,body(),randomUUID()));}finally{await db.command({collMod:'project_duplicate_commands',validator:duplicateCollections[1].validator});}
    assert.equal(await db.collection('projects').countDocuments(),1);assert.equal(await db.collection('plan_versions').countDocuments(),1);assert.equal(await db.collection('activity_events').countDocuments(),0);assert.deepEqual(await db.collection<Row>('projects').findOne({_id:source._id}),before);assert.deepEqual(await db.collection('memberships').findOne({userId:testUserId}),member);assert.deepEqual(await db.collection<Row>('workspaces').findOne({_id:testWorkspaceId}),workspace);
  });
  test('rename/duplicate races never copy an unreviewed source revision',async()=>{
    const outcomes=await Promise.allSettled([service.duplicate(source._id,body(),randomUUID()),service.patch(source._id,{expectedProjectRevision:1,patch:{displayTitle:'Source winner'}},randomUUID())]);
    assert.equal(outcomes[1].status,'fulfilled');if(outcomes[0].status==='fulfilled')assert.equal(outcomes[0].value.project.displayTitle,`Copy of ${source.displayTitle}`);else assert.equal(outcomes[0].reason.code,'STALE_REVISION');
  });
  test('receipt replay denies revoked membership and foreign sources, and does not expire with HTTP TTL',async()=>{
    const key=randomUUID(),copy=await service.duplicate(source._id,body(),key);
    await db.collection('project_duplicate_commands').updateOne({projectId:copy.project.id},{$set:{createdAt:new Date(0)}});
    assert.equal((await service.duplicate(source._id,body(),key)).project.id,copy.project.id);
    await db.collection<Row>('memberships').updateOne({userId:testUserId},{$set:{status:'disabled',disabledAt:new Date(),disabledBy:{kind:'user',userId:testUserId}}});
    await assert.rejects(service.duplicate(source._id,body(),key),/team access/);
    await db.collection<Row>('memberships').updateOne({userId:testUserId},{$set:{status:'active',disabledAt:null,disabledBy:null}});
    await db.collection<Row>('projects').updateOne({_id:source._id},{$set:{workspaceId:randomUUID()}});
    await assert.rejects(service.duplicate(source._id,body(),key),/could not be found/);assert.equal(await db.collection('projects').countDocuments(),2);
  });
});
