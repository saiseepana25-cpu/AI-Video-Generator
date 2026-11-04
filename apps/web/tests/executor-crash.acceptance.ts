import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn,type ChildProcessWithoutNullStreams} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs/promises';
import {setTimeout as wait} from 'node:timers/promises';
import {Long,MongoClient} from 'mongodb';
import {databaseClientOptions} from '../src/server/db/connection';
import {migrateDatabase,checkDatabase} from '../src/server/db/migrations';
import {workspaceFixture,membershipFixture,projectFixture,testWorkspaceId,testUserId,type Row} from './fixtures/database';
import {providerEnv,providerFixture} from './fixtures/providers';
import {renderFixture} from './fixtures/rendering';
import {selectedFontAssets,selectedRendererBuildHash} from '../../../src/pipeline/selected-renderer';
import {buildRenderPlan,generationHash} from '../src/server/rendering/contract';
import type {PlanVersion} from '../src/server/planning/contracts';
import {digest} from '../src/server/providers/config';
import {GenerationService} from '../src/server/generation/service';
import {GenerationWorker} from '../src/server/generation/worker';
import {DatabaseExecutor} from '../src/server/generation/executor-service';
import {LiveGenerationEngine} from '../../../src/pipeline/generation-engine';
import type {GenerationRun,GenerationWorker as WorkerRow} from '../src/server/generation/contracts';
import type {Execution} from '../src/server/generation/executor-contracts';
import {ExecutionFiles} from '../src/server/cleanup/execution-files';
import {ExecutionCleanupService} from '../src/server/cleanup/execution-service';
import {SpeechFiles} from '../src/server/cleanup/speech-files';
import {SpeechCleanupService} from '../src/server/cleanup/speech-service';
import {SourcePurgeService} from '../src/server/cleanup/source-purge';
import {ProjectService} from '../src/server/projects/service';
import {inspectWindowsExecutor} from '../../../src/pipeline/windows-executor';
test('actual worker crash and requested cancellation require OS stop proof before recovery and exact real-file cleanup',{skip:process.platform!=='win32',timeout:240000},async()=>{
  const uri=process.env.MONGODB_TEST_URI??'mongodb://127.0.0.1:27028/?replicaSet=vcF03';if(!/^mongodb:\/\/(127\.0\.0\.1|localhost):\d+\/(?:\?[^\s]*)?$/.test(uri))throw new Error('Loopback only');
  const name=`videocraft_executor_crash_${randomUUID().replaceAll('-','')}`,client=new MongoClient(uri,databaseClientOptions),root=path.resolve(process.cwd(),'../..');let child:ChildProcessWithoutNullStreams|undefined;
  const context={workspaceId:testWorkspaceId,userId:testUserId,userName:'Crash test'};
  try{
    await client.connect();const db=client.db(name);await migrateDatabase(db);await db.collection<Row>('workspaces').insertOne(workspaceFixture());await db.collection<Row>('memberships').insertOne(membershipFixture());await db.collection<Row>('provider_controls').insertOne(providerFixture());
    const {pins}=await selectedFontAssets(root),fixture=renderFixture(),p=projectFixture(),planId=randomUUID();p.brief={...fixture.brief,idea:'Disposable crash diagnostic'};p.settings=fixture.settings;p.currentPlanVersionId=p.planningRequestId=planId;p.nextPlanVersionNumber=Long.ONE;await db.collection<Row>('projects').insertOne(p);
    await db.collection<PlanVersion>('plan_versions').insertOne({_id:planId,workspaceId:testWorkspaceId,projectId:p._id,schemaVersion:1,versionNumber:Long.ONE,sourceBriefRevision:Long.ONE,sourcePlanningRequestId:planId,inputHash:digest(JSON.stringify({brief:p.brief,settings:p.settings})),settingsSnapshot:p.settings,plan:fixture.proposal,plannerModelId:'fixture',promptContractVersion:'educational-diagrams-v1',createdAt:new Date(),createdBy:testUserId});
    child=spawn(process.execPath,['--import','tsx','tests/fixtures/crash-generation-worker.ts',uri,name,root],{cwd:process.cwd(),windowsHide:true,env:{...process.env,GEMINI_API_KEY:'',GOOGLE_API_KEY:'',ELEVENLABS_API_KEY:''},stdio:['pipe','pipe','pipe']});
    await new Promise<void>((resolve,reject)=>{let output='';child!.stdout.on('data',bytes=>{output+=bytes.toString();if(output.includes('worker_ready'))resolve();});child!.once('error',reject);child!.once('exit',()=>reject(new Error('Fixture worker stopped before admission')));});
    const plan=buildRenderPlan(fixture.proposal,p.brief,p.settings,pins),approval=await new GenerationService(client,name,context,providerEnv,async()=>pins).approve(p._id,{expectedProjectRevision:1,planVersionId:planId,generationInputHash:generationHash(plan)},randomUUID());child.stdin.write('go\n');
    let execution:Execution|null=null;
    for(let n=0;n<1000;n++){execution=await db.collection<Execution>('generation_executors').findOne({runId:approval.job.generationRunId,stage:'render',state:'running'});if(execution&&await fs.access(path.join(root,'.cache','executors',execution._id.replaceAll('-',''),'progress.json')).then(()=>true,()=>false))break;await wait(100);if(n===999)assert.fail('No controlled render progress');}
    assert(execution);const closed=new Promise(resolve=>child!.once('close',resolve));child.kill();await closed;
    await db.collection<GenerationRun>('generation_runs').updateOne({_id:execution.runId},{$set:{leaseUntil:new Date(0)}});await db.collection<WorkerRow>('generation_workers').updateOne({_id:'generation:local'},{$set:{expiresAt:new Date(0)}});
    const env={...providerEnv,REMOTION_FREE_LICENSE_CONFIRMED:'true'},engine=new LiveGenerationEngine(root,env),worker=new GenerationWorker(client,name,env,engine);engine.executor=new DatabaseExecutor(client,name,root,worker.owner);
    engine.observe=async()=>{throw new Error('No provider allowed during recovery');};engine.speech=async()=>{throw new Error('No speech allowed during recovery');};
    assert.equal(await worker.heartbeat(),true);assert.equal(await worker.recoverExpired(),1);assert.equal(await worker.tick(),false);await worker.release();
    const failed=(await db.collection<GenerationRun>('generation_runs').findOne({_id:execution.runId}))!;assert.equal(failed.state,'failed');assert.equal(await db.collection('generation_local_artifacts').countDocuments(),0);assert.equal(await db.collection('ready_videos').countDocuments(),0);assert.equal(await db.collection('generation_executors').countDocuments({state:'stopped'}),2);
    const projects=new ProjectService(client,name,context,'crash-fixture-secret-'.repeat(3)),current=await projects.get(p._id);await projects.delete(p._id,{expectedProjectRevision:current.revision},randomUUID());
    const cleanup=new ExecutionCleanupService(client,name,root,await ExecutionFiles.create(root),()=>new Date(Date.now()+24*3600000+10000));while(await cleanup.next(p._id)){}
    const speech=new SpeechCleanupService(client,name,await SpeechFiles.create(root));while(await speech.next(p._id)){}
    assert.equal((await new SourcePurgeService(client,name).purge(p._id)).sourceRecordsRemoved,true);assert.equal(await db.collection('execution_cleanup_tasks').countDocuments({state:'cleaned'}),2);assert.equal(await db.collection('speech_cleanup_tasks').countDocuments({state:'removed'}),3);assert.equal(await fs.access(path.join(root,'output','dashboard-renders',execution.runId,execution.artifactId!)).then(()=>true,()=>false),false);await checkDatabase(db);
    // A second independent fixture exercises the real API cancellation path,
    // including confirmation after the owned preflight Job stopped.
    const p2=projectFixture(),plan2=randomUUID();p2.brief={...fixture.brief,idea:'Disposable cancellation diagnostic'};p2.settings=fixture.settings;p2.currentPlanVersionId=p2.planningRequestId=plan2;p2.nextPlanVersionNumber=Long.ONE;await db.collection<Row>('projects').insertOne(p2);
    await db.collection<PlanVersion>('plan_versions').insertOne({_id:plan2,workspaceId:testWorkspaceId,projectId:p2._id,schemaVersion:1,versionNumber:Long.ONE,sourceBriefRevision:Long.ONE,sourcePlanningRequestId:plan2,inputHash:digest(JSON.stringify({brief:p2.brief,settings:p2.settings})),settingsSnapshot:p2.settings,plan:fixture.proposal,plannerModelId:'fixture',promptContractVersion:'educational-diagrams-v1',createdAt:new Date(),createdBy:testUserId});
    child=spawn(process.execPath,['--import','tsx','tests/fixtures/crash-generation-worker.ts',uri,name,root],{cwd:process.cwd(),windowsHide:true,env:{...process.env,GEMINI_API_KEY:'',GOOGLE_API_KEY:'',ELEVENLABS_API_KEY:''},stdio:['pipe','pipe','pipe']});
    const closed2=new Promise(resolve=>child!.once('close',resolve));
    await new Promise<void>((resolve,reject)=>{let output='';child!.stdout.on('data',bytes=>{output+=bytes.toString();if(output.includes('worker_ready'))resolve();});child!.once('error',reject);child!.once('exit',()=>reject(new Error('Cancellation fixture exited before admission')));});
    const commands=new GenerationService(client,name,context,providerEnv,async()=>pins),accepted=await commands.approve(p2._id,{expectedProjectRevision:1,planVersionId:plan2,generationInputHash:generationHash(buildRenderPlan(fixture.proposal,p2.brief,p2.settings,pins))},randomUUID());child.stdin.write('go\n');
    for(let n=0;n<500;n++){if(await db.collection<Execution>('generation_executors').findOne({runId:accepted.job.generationRunId,stage:'preflight',state:'running'}))break;await wait(100);if(n===499)assert.fail('No cancellation preflight');}
    const active=(await db.collection<GenerationRun>('generation_runs').findOne({_id:accepted.job.generationRunId}))!;
    const requested=await commands.cancel(active.jobId,{expectedRevision:active.statusRevision.toNumber()},randomUUID());assert.equal(requested.job.cancellationConfirmed,false);await closed2;
    const cancelled=(await db.collection<GenerationRun>('generation_runs').findOne({_id:active._id}))!;assert.equal(cancelled.state,'cancelled');assert.equal(cancelled.error?.code,'CANCELLED');assert.equal((await commands.job(active.jobId))!.cancellationConfirmed,true);assert.equal(await db.collection('generation_speech_attempts').countDocuments({runId:active._id}),0);
    while(await cleanup.next(p2._id)){}const deletion=await projects.get(p2._id);await projects.delete(p2._id,{expectedProjectRevision:deletion.revision},randomUUID());assert.equal((await new SourcePurgeService(client,name).purge(p2._id)).sourceRecordsRemoved,true);await checkDatabase(db);
  }finally{
    let safe=true;
    if(child&&child.exitCode===null&&child.signalCode===null){const closed=new Promise(resolve=>child!.once('close',resolve));child.kill();await closed;}
    try{for(const e of await client.db(name).collection<Execution>('generation_executors').find({}).toArray())if(!await inspectWindowsExecutor({root,id:e._id.replaceAll('-',''),jobName:e.jobName},true))safe=false;}catch{safe=false;}
    if(safe&&/^videocraft_executor_crash_[a-f0-9]{32}$/.test(name))await client.db(name).dropDatabase();await client.close();
    if(!safe)throw new Error('Controlled fixture metadata retained because executor termination could not be confirmed.');
  }
});
