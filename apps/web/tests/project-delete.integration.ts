import {after,before,beforeEach,describe,test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Long,MongoClient,type Db} from 'mongodb';
import {databaseClientOptions} from '../src/server/db/connection';
import {migrateDatabase,checkDatabase} from '../src/server/db/migrations';
import {deletionCollections} from '../src/server/db/deletion-schemas';
import {ProjectService} from '../src/server/projects/service';
import {databaseTransaction} from '../src/server/db/transactions';
import type {GenerationRun} from '../src/server/generation/contracts';
import type {ProviderControl} from '../src/server/providers/contracts';
import type {Job} from '../src/server/planning/contracts';
import {providerFixture} from './fixtures/providers';
import {workspaceFixture,membershipFixture,projectFixture,testWorkspaceId,testUserId,type Row} from './fixtures/database';
const uri=process.env.MONGODB_TEST_URI??'mongodb://127.0.0.1:27028/?replicaSet=vcF03';
if(!/^mongodb:\/\/(127\.0\.0\.1|localhost):\d+\/(?:\?[^\s]*)?$/.test(uri))throw new Error('Isolated loopback replica set required.');
const client=new MongoClient(uri,databaseClientOptions),name=`videocraft_delete_test_${randomUUID().replaceAll('-','')}`,context={workspaceId:testWorkspaceId,userId:testUserId,userName:'Tester'},secret='deletion-test-secret-'.repeat(3);
describe('guarded idle project tombstones',{concurrency:false},()=>{
  let db:Db,service:ProjectService,source:Row;
  before(async()=>{await client.connect();db=client.db(name);await migrateDatabase(db);});
  beforeEach(async()=>{for(const c of ['projects','project_delete_commands','project_duplicate_commands','memberships','workspaces','activity_events','jobs','generation_runs','generation_storage_bundles','stage_attempts','generation_speech_attempts','provider_controls'])await db.collection(c).deleteMany({});await db.collection<Row>('workspaces').insertOne(workspaceFixture());await db.collection<Row>('memberships').insertOne(membershipFixture());source=projectFixture();await db.collection<Row>('projects').insertOne(source);service=new ProjectService(client,name,context,secret);});
  after(async()=>{try{if(!/^videocraft_delete_test_[a-f0-9]{32}$/.test(name))throw new Error('Unsafe cleanup');await db.dropDatabase();}finally{await client.close();}});
  const input=()=>({expectedProjectRevision:1});
  async function queued(){
    const provider=providerFixture(),now=new Date(),run:GenerationRun={_id:randomUUID(),schemaVersion:1,workspaceId:testWorkspaceId,projectId:source._id,planVersionId:randomUUID(),approvalId:randomUUID(),jobId:randomUUID(),inputHash:'a'.repeat(64),settingsSnapshotHash:'b'.repeat(64),sourceBriefRevision:Long.ONE,providerConfigHash:provider.configHash,reservationId:randomUUID(),reservationPeriodId:provider.allowance.periodId,rendererBuildHash:'c'.repeat(64),state:'queued',statusRevision:Long.ONE,createdAt:now,updatedAt:now,finishedAt:null,createdBy:testUserId};
    provider.allowance.observedRemaining=900;provider.reservations=[{id:run.reservationId,units:100,state:'reserved',createdAt:now}];
    const job:Job={_id:randomUUID(),schemaVersion:1,workspaceId:testWorkspaceId,projectId:source._id,userId:testUserId,kind:'plan',keyHash:'d'.repeat(64),requestHash:'e'.repeat(64),requestId:randomUUID(),inputHash:'f'.repeat(64),sourceBriefRevision:Long.ONE,input:{brief:source.brief,settings:source.settings},state:'queued',statusRevision:Long.ONE,attempt:0,submission:'none',owner:null,leaseUntil:null,createdAt:now,updatedAt:now,startedAt:null,finishedAt:null,result:null,error:null};
    await db.collection<ProviderControl>('provider_controls').insertOne(provider);await db.collection<GenerationRun>('generation_runs').insertOne(run);await db.collection<Job>('jobs').insertOne(job);await db.collection<Row>('projects').updateOne({_id:source._id},{$set:{activePlanningJobId:job._id,latestRunId:run._id}});
    return {run,job,provider};
  }
  const acknowledge=(workRevision:number)=>({...input(),acknowledgeActiveWork:true as const,expectedWorkRevision:workRevision});
  test('impact is read-only, sanitized and requires acknowledgement before cancelling queued work',async()=>{
    const {provider}=await queued(),before=await db.collection<Row>('projects').findOne({_id:source._id}),impact=await service.deletionImpact(source._id);
    assert.deepEqual(impact,{projectId:source._id,projectRevision:1,workRevision:0,queuedPlanning:1,queuedGenerations:1,canDelete:true,blockReason:null});assert.ok(!JSON.stringify(impact).includes(provider.configHash));assert.deepEqual(await db.collection<Row>('projects').findOne({_id:source._id}),before);
    await assert.rejects(service.delete(source._id,input(),randomUUID()),{code:'ACTIVE_WORK_ACK_REQUIRED'});assert.deepEqual(await db.collection<ProviderControl>('provider_controls').findOne({_id:'elevenlabs'}),provider);assert.equal(await db.collection('project_delete_commands').countDocuments(),0);
  });
  test('acknowledged deletion cancels only unstarted work and closes one unused reservation exactly once',async()=>{
    const {run,job}=await queued(),key=randomUUID(),impact=await service.deletionImpact(source._id),command=acknowledge(impact.workRevision);const result=await service.delete(source._id,command,key);
    assert.equal((await db.collection<Job>('jobs').findOne({_id:job._id}))!.state,'cancelled');assert.equal((await db.collection<GenerationRun>('generation_runs').findOne({_id:run._id}))!.state,'cancelled');const provider=(await db.collection<ProviderControl>('provider_controls').findOne({_id:'elevenlabs'}))!;assert.equal(provider.allowance.observedRemaining,1000);assert.equal(provider.reservations.length,0);
    const project=(await db.collection<Row>('projects').findOne({_id:source._id}))!;assert.equal(project.activePlanningJobId,null);assert.equal(project.latestRunId,null);assert.equal(project.revision.toString(),'2');assert.equal(project.guardRevision.toString(),'1');assert.equal((await service.delete(source._id,command,key)).replayed,true);assert.deepEqual((await service.delete(source._id,command,key)).receipt,result.receipt);assert.deepEqual(await db.collection<ProviderControl>('provider_controls').findOne({_id:'elevenlabs'}),provider);await checkDatabase(db);
  });
  test('changed work revision refuses the old acknowledgement without cancelling anything',async()=>{
    const {run,job}=await queued(),impact=await service.deletionImpact(source._id);await db.collection<Row>('projects').updateOne({_id:source._id},{$inc:{guardRevision:Long.ONE}});await assert.rejects(service.delete(source._id,acknowledge(impact.workRevision),randomUUID()),{code:'STALE_WORK'});assert.equal((await db.collection<Job>('jobs').findOne({_id:job._id}))!.state,'queued');assert.equal((await db.collection<GenerationRun>('generation_runs').findOne({_id:run._id}))!.state,'queued');
  });
  test('receipt failure rolls back queued cancellations and allowance settlement',async()=>{
    const {run,job,provider}=await queued();await db.command({collMod:'project_delete_commands',validator:{$jsonSchema:{bsonType:'object',required:['controlled_failure']}}});try{await assert.rejects(service.delete(source._id,acknowledge(0),randomUUID()));}finally{await db.command({collMod:'project_delete_commands',validator:deletionCollections[2].validator});}
    assert.deepEqual(await db.collection<GenerationRun>('generation_runs').findOne({_id:run._id}),run);assert.deepEqual(await db.collection<Job>('jobs').findOne({_id:job._id}),job);assert.deepEqual(await db.collection<ProviderControl>('provider_controls').findOne({_id:'elevenlabs'}),provider);assert.equal((await service.get(source._id)).revision,1);assert.equal(await db.collection('activity_events').countDocuments(),0);
  });
  test('attempt evidence and uncertain holds refuse a queued label without any refund',async()=>{
    const {run,job}=await queued();await db.collection<Row>('stage_attempts').insertOne({_id:randomUUID(),jobId:job._id,attempt:1,owner:randomUUID(),state:'submitted',submittedAt:new Date(),finishedAt:null});assert.equal((await service.deletionImpact(source._id)).canDelete,false);await assert.rejects(service.delete(source._id,acknowledge(0),randomUUID()),{code:'PROJECT_WORK_UNRESOLVED'});await db.collection('stage_attempts').deleteMany({});
    await db.collection<Row>('generation_speech_attempts').insertOne({_id:randomUUID(),runId:run._id},{bypassDocumentValidation:true});await assert.rejects(service.delete(source._id,acknowledge(0),randomUUID()),{code:'PROJECT_WORK_UNRESOLVED'});await db.collection('generation_speech_attempts').deleteMany({});
    await db.collection<ProviderControl>('provider_controls').updateOne({_id:'elevenlabs'},{$set:{'reservations.0.state':'uncertain'}});await assert.rejects(service.delete(source._id,acknowledge(0),randomUUID()),{code:'PROJECT_WORK_UNRESOLVED'});assert.equal((await db.collection<ProviderControl>('provider_controls').findOne({_id:'elevenlabs'}))!.allowance.observedRemaining,900);
  });
  test('worker claim versus deletion cannot leave a running executor on a tombstoned project',async()=>{
    const {run}=await queued(),owner=randomUUID(),now=new Date();
    const claim=()=>databaseTransaction(client,name,async(db,session)=>{
      const project=await db.collection<Row>('projects').findOne({_id:source._id,deletedAt:null},{session});if(!project)return false;
      const update=await db.collection<GenerationRun>('generation_runs').updateOne({_id:run._id,state:'queued'},{$set:{state:'running',owner,leaseEpoch:Long.ONE,leaseUntil:new Date(now.getTime()+90000),startedAt:now,stage:'plan_validation',submissionCount:0,artifactId:null,error:null}},{session});if(!update.matchedCount)return false;
      await db.collection<Row>('projects').updateOne({_id:source._id,deletedAt:null},{$inc:{guardRevision:Long.ONE}},{session});return true;
    });
    const results=await Promise.allSettled([service.delete(source._id,acknowledge(0),randomUUID()),claim()]);const project=await db.collection<Row>('projects').findOne({_id:source._id}),actual=await db.collection<GenerationRun>('generation_runs').findOne({_id:run._id});if(project!.deletedAt){assert.equal(actual!.state,'cancelled');assert.equal(results[1].status,'fulfilled');if(results[1].status==='fulfilled')assert.equal(results[1].value,false);}else{assert.equal(actual!.state,'running');assert.equal(results[0].status,'rejected');}
  });
  test('queued cancellation preserves provider disablement and does not refund a different accounting period',async()=>{
    await queued();await db.collection<ProviderControl>('provider_controls').updateOne({_id:'elevenlabs'},{$set:{state:'disabled',operatorDisabled:true,'allowance.periodId':'new-period'}});await service.delete(source._id,acknowledge(0),randomUUID());const provider=(await db.collection<ProviderControl>('provider_controls').findOne({_id:'elevenlabs'}))!;assert.equal(provider.state,'disabled');assert.equal(provider.operatorDisabled,true);assert.equal(provider.allowance.observedRemaining,900);assert.deepEqual(provider.reservations,[]);
  });
  test('impact refuses missing, foreign, deleted or inactive scope',async()=>{
    await assert.rejects(service.deletionImpact(randomUUID()),{status:404});const id=source._id;await service.delete(id,input(),randomUUID());await assert.rejects(service.deletionImpact(id),{status:404});await db.collection<Row>('memberships').updateOne({userId:testUserId},{$set:{status:'disabled',disabledAt:new Date(),disabledBy:{kind:'user',userId:testUserId}}});await assert.rejects(service.deletionImpact(id),{status:403});
  });
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
