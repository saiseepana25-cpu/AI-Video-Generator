import sharp from 'sharp';
import {BrandService} from '../src/server/brand/service';
import {initialBrand} from '../src/server/brand/palette';
import {LogoService} from '../src/server/logos/service';
import {logoHash} from '../src/server/logos/image';
import {readBrandSelection} from '../src/server/brand/selection';
import {databaseTransaction} from '../src/server/db/transactions';
import {RenderInputService} from '../src/server/rendering/service';
import {brandLogoCapability,brandPaletteCapability} from '../src/server/generation/contracts';
import {after, before, beforeEach, describe, test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Long, MongoClient, MongoNetworkError, MongoServerError, type Db} from 'mongodb';
import {runGenerationWorker,type GenerationLoopEvent} from '../src/server/generation/loop';
import {GenerationIdlePollError} from '../src/server/generation/poll-error';
import {databaseClientOptions} from '../src/server/db/connection';
import {checkDatabase, migrateDatabase} from '../src/server/db/migrations';
import {GenerationService} from '../src/server/generation/service';
import {GenerationWorker} from '../src/server/generation/worker';
import {OperationsService} from '../src/server/activity/operations';
import {GenerationFault, type GenerationEngine, type MeasuredSpeech} from '../src/server/generation/engine';
import {requiredCapabilities, type GenerationRun, type SpeechAttempt, type GenerationWorker as WorkerRow} from '../src/server/generation/contracts';
import type {PlanVersion} from '../src/server/planning/contracts';
import type {ProviderControl} from '../src/server/providers/contracts';
import {digest} from '../src/server/providers/config';
import {generationHash,buildRenderPlan} from '../src/server/rendering/contract';
import {membershipFixture, projectFixture, workspaceFixture, testWorkspaceId, testUserId, type Row} from './fixtures/database';
import {providerEnv, providerFixture} from './fixtures/providers';
import {pins, renderFixture} from './fixtures/rendering';
import {StorageService} from '../src/server/storage/service';
import {MediaCleanupService} from '../src/server/cleanup/service';
import {LocalCleanupService} from '../src/server/cleanup/local-service';
import {SpeechCleanupService,speechCleanupStatus} from '../src/server/cleanup/speech-service';
import {ReuseReleaseService} from '../src/server/cleanup/reuse-release';
import {hasRetainedSpeechPin,reuseReleaseStatus,type ReuseRelease} from '../src/server/cleanup/reuse-pins';
import {reuseReleaseCollections} from '../src/server/db/reuse-release-schemas';
import {speechCleanupCollections} from '../src/server/db/speech-cleanup-schemas';
import type {SpeechCleanupTask,SpeechSource} from '../src/server/cleanup/speech-contracts';
import {localCleanupCollections} from '../src/server/db/local-cleanup-schemas';
import type {LocalSource,LocalFile,LocalTask} from '../src/server/cleanup/local-contracts';
import {cleanupCollections} from '../src/server/db/cleanup-schemas';
import {ProjectService,type ProjectRecord} from '../src/server/projects/service';
import {storageFiles,storageKinds, StorageFault, type StorageBundle, type StorageKind, type StorageObject} from '../src/server/storage/contracts';
import {sha256, verifyObject} from '../src/server/storage/r2';
import {VideoService, promoteStoredVideo} from '../src/server/videos/service';
import type {ReadyVideo} from '../src/server/videos/contracts';
import {VideoHistoryService} from '../src/server/videos/history';
import {RevisionReviewService} from '../src/server/planning/revision-review';
import {PlanEditService} from '../src/server/planning/plan-edit-service';

const uri = process.env.MONGODB_TEST_URI ?? 'mongodb://127.0.0.1:27028/?replicaSet=vcF03';
if (!/^mongodb:\/\/(127\.0\.0\.1|localhost):\d+\/(?:\?[^\s]*)?$/.test(uri)) throw new Error('Isolated loopback database required.');
const name = `videocraft_f10_test_${randomUUID().replaceAll('-', '')}`, client = new MongoClient(uri, databaseClientOptions), context = {workspaceId: testWorkspaceId, userId: testUserId, userName: 'Tester'};
const audio = (): MeasuredSpeech => ({sampleRate: 24000, samples: Float32Array.from({length: 24000}, (_, i) => Math.sin(i / 10) * .2)});
const deferred = <T>() => {let resolve!: (value: T) => void; const promise = new Promise<T>(r => {resolve = r;}); return {promise, resolve};};
class FakeEngine implements GenerationEngine {
  capabilities:string[] = [...requiredCapabilities]; logoBytes:Buffer|undefined; receivedLogo:Buffer|undefined;
  logo=async()=>{if(!this.logoBytes)throw new Error('missing logo');return this.logoBytes;}; build = 'd'.repeat(64); speechCalls = 0; renderCalls = 0; remaining = 10000;
  beforeObservation?: () => Promise<void>; duringSpeech?: () => Promise<MeasuredSpeech>; duringRender?: () => Promise<void>; persistFailure = false; renderFailure = false;
  reuseEnabled=false; reuseReads=0; duringRead?:()=>Promise<MeasuredSpeech>;
  readSpeech=async()=>{this.reuseReads++;if(!this.reuseEnabled)throw new Error('missing');return this.duringRead?this.duringRead():audio();};
  inspect = async () => ({rendererBuildHash: this.build, fonts: pins});
  preflightCalls = 0; duringPreflight?: (signal: AbortSignal) => Promise<void>;
  preflight = async (_plan:unknown,_hash:string,signal:AbortSignal) => {this.preflightCalls++; await this.duringPreflight?.(signal); return {rendererBuildHash:this.build};};
  observe = async () => {await this.beforeObservation?.(); return {state: 'enabled' as const, reasonCode: null, languages: ['en', 'te'] as ('en'|'te')[], remaining: this.remaining, periodId: 'test-period'};};
  speech = async () => {this.speechCalls++; return this.duringSpeech ? this.duringSpeech() : audio();};
  persistSpeech = async () => {if (this.persistFailure) throw new Error('disk'); return {audioHash: 'e'.repeat(64), byteLength: 48044};};
  render = async (_run:string,_plan:unknown,_hash:string,_clips:unknown,_signal:AbortSignal,logo?:Buffer) => {this.receivedLogo=logo;this.renderCalls++; await this.duringRender?.(); if (this.renderFailure) throw new Error('render'); return {_id: randomUUID(), rendererBuildHash: this.build, manifestHash: 'f'.repeat(64), media: {width: 1080, height: 1920, videoCodec: 'h264', audioCodec: 'aac', durationSeconds: 30.016, audioSampleRate: 48000, meanVolumeDb: -20.1}};};
}
describe('generation worker ownership, submission fencing and recovery', {concurrency: false}, () => {
  let db: Db, engine: FakeEngine, worker: GenerationWorker, service: GenerationService, projectId: string, planId: string;
  before(async () => {await client.connect(); db = client.db(name); await migrateDatabase(db);});
  beforeEach(async () => {
    for (const n of ['speech_reuse_releases','speech_cleanup_tasks','local_render_cleanup_tasks','media_cleanup_tasks','asset_refs','publishing_payloads','project_delete_commands','logo_uploads','logo_assets','logo_asset_refs','brand_kits','workspace_brand_commands','projects', 'workspaces', 'memberships', 'provider_controls', 'plan_versions', 'plan_edit_commands', 'activity_events', 'approvals', 'generation_runs', 'generation_workers', 'generation_commands', 'generation_speech_attempts', 'generation_speech_reuses', 'generation_local_artifacts', 'generation_storage_bundles', 'ready_videos', 'video_assets']) await db.collection(n).deleteMany({});
    await db.collection<Row>('workspaces').insertOne(workspaceFixture()); await db.collection<Row>('memberships').insertOne(membershipFixture());
    const provider = providerFixture(); provider.allowance.observedRemaining = 10000; await db.collection<ProviderControl>('provider_controls').insertOne(provider);
    const f = renderFixture(), project = projectFixture(); planId = randomUUID(); projectId = project._id;
    project.brief = {...f.brief, idea: 'Explain water'}; project.settings = f.settings; project.currentPlanVersionId = project.planningRequestId = planId; project.nextPlanVersionNumber = Long.ONE;
    await db.collection<Row>('projects').insertOne(project);
    await db.collection<PlanVersion>('plan_versions').insertOne({_id: planId, schemaVersion: 1, workspaceId: testWorkspaceId, projectId, versionNumber: Long.ONE, sourceBriefRevision: Long.ONE, sourcePlanningRequestId: planId,
      inputHash: digest(JSON.stringify({brief: project.brief, settings: project.settings})), settingsSnapshot: f.settings, plan: f.proposal, plannerModelId: 'test-model', promptContractVersion: 'educational-diagrams-v1', createdAt: new Date(), createdBy: testUserId});
    engine = new FakeEngine(); worker = new GenerationWorker(client, name, providerEnv, engine); assert.equal(await worker.heartbeat(), true);
    service = new GenerationService(client, name, context, providerEnv, async () => pins);
  });
  after(async () => {try {if (!/^videocraft_f10_test_[a-f0-9]{32}$/.test(name)) throw new Error('Unsafe cleanup'); await db.dropDatabase();} finally {await client.close();}});
  const body = () => ({expectedProjectRevision: 1, planVersionId: planId, generationInputHash: generationHash(renderFixture().plan)});
  const approve = () => service.approve(projectId, body(), randomUUID());
  const run = () => db.collection<GenerationRun>('generation_runs').findOne({projectId});
  const provider = () => db.collection<ProviderControl>('provider_controls').findOne({_id: 'elevenlabs'});
  async function approveRevision(changeNarration=false){
    const project=(await db.collection<Row>('projects').findOne({_id:projectId}))!;
    const edited=await new PlanEditService(client,name,context).edit(planId,{expectedProjectRevision:project.revision.toNumber(),edits:changeNarration?{narration:[{segmentId:'scene_1',text:'Clouds form above rivers.'}]}:{headings:[{sceneId:'scene_1',text:'A clearer diagram'}]}},randomUUID());
    const current=(await db.collection<Row>('projects').findOne({_id:projectId}))!;
    const result=await service.approve(projectId,{expectedProjectRevision:current.revision.toNumber(),planVersionId:edited.plan.id,generationInputHash:generationHash(buildRenderPlan(edited.plan.plan,current.brief,current.settings,pins))},randomUUID());
    return (await db.collection<GenerationRun>('generation_runs').findOne({_id:result.job.generationRunId}))!;
  }
  async function cancelCurrent() {const current = (await run())!; return service.cancel(current.jobId, {expectedRevision: current.statusRevision.toNumber()}, randomUUID());}

  async function logoPlan(){
    const png=await sharp({create:{width:160,height:80,channels:4,background:{r:10,g:20,b:30,alpha:1}}}).png().toBuffer(),objects=new Map<string,Buffer>();
    const store={configHash:'a'.repeat(64),bucket:'test-logo-bucket',ensure:async(o:any,b:Buffer)=>{objects.set(o.key,b);},read:async(o:any)=>objects.get(o.key)!,close(){}};
    const ready=await new LogoService(client,name,context,()=>store).put(randomUUID(),{filename:'test.png',contentType:'image/png',sizeBytes:png.length,sha256:logoHash(png)},png);
    const brand=(await new BrandService(client,name,context).put({expectedRevision:0,brandKit:{...initialBrand,logoAssetId:ready.assetId}},randomUUID())).brand.brandKit!;
    const settings={...renderFixture().settings,brandKitRevisionId:brand.id},project=(await db.collection<Row>('projects').findOne({_id:projectId}))!;
    await db.collection<Row>('projects').updateOne({_id:projectId},{$set:{settings}});await db.collection<PlanVersion>('plan_versions').updateOne({_id:planId},{$set:{settingsSnapshot:settings,inputHash:digest(JSON.stringify({brief:project.brief,settings}))}});
    engine.capabilities.push(brandPaletteCapability,brandLogoCapability);engine.logoBytes=[...objects.values()][0];await worker.heartbeat();
    return {ready,body:{expectedProjectRevision:1,planVersionId:planId,generationInputHash:(await new RenderInputService(client,name,context,providerEnv,async()=>pins).prepare(planId)).generationInputHash!}};
  }
  test('logo approval pins exact asset and worker supplies verified bytes to renderer',async()=>{
    const f=await logoPlan();await service.approve(projectId,f.body,randomUUID());assert.equal(await db.collection('logo_asset_refs').countDocuments(),2);assert.equal((await db.collection<Row>('logo_assets').findOne({}))!.refCount,3);
    await new BrandService(client,name,context).put({expectedRevision:1,brandKit:initialBrand},randomUUID());
    assert.equal(await worker.tick(),true);assert.equal((await run())!.state,'rendered_local');assert.deepEqual(engine.receivedLogo,engine.logoBytes);assert.equal(engine.speechCalls,3);await checkDatabase(db);
  });
  test('old worker cannot admit a logo job and reservations remain unchanged',async()=>{
    const f=await logoPlan(),before=await provider();engine.capabilities=engine.capabilities.filter(c=>c!==brandLogoCapability);await worker.heartbeat();await assert.rejects(service.approve(projectId,f.body,randomUUID()),/compatible running worker/);assert.deepEqual(await provider(),before);assert.equal(await db.collection('generation_runs').countDocuments(),0);
  });
  test('replaced logo bytes fail before speech and release the unused allowance hold',async()=>{
    const f=await logoPlan(),before=(await provider())!.allowance.observedRemaining;await service.approve(projectId,f.body,randomUUID());engine.logoBytes=Buffer.alloc(engine.logoBytes!.length);
    assert.equal(await worker.tick(),true);assert.equal((await run())!.state,'failed');assert.equal(engine.speechCalls,0);assert.equal(engine.renderCalls,0);assert.equal((await provider())!.allowance.observedRemaining,before);assert.equal((await provider())!.reservations.length,0);
  });
  test('unavailable or unpinned logo fails before speech after queue admission',async()=>{
    const f=await logoPlan();await service.approve(projectId,f.body,randomUUID());await db.collection('logo_asset_refs').deleteOne({ownerType:'generation_run'});
    assert.equal(await worker.tick(),true);assert.equal((await run())!.state,'failed');assert.equal(engine.speechCalls,0);assert.equal(engine.renderCalls,0);
  });
  test('one worker owns the slot and explicit disabled policy survives expiry/startup', async () => {
    const other = new GenerationWorker(client, name, providerEnv, new FakeEngine()); assert.equal(await other.heartbeat(), false);
    await db.collection<WorkerRow>('generation_workers').updateOne({_id: 'generation:local'}, {$set: {state: 'disabled', expiresAt: new Date(0)}});
    assert.equal(await worker.heartbeat(), false); assert.equal(await other.heartbeat(), false); assert.equal(engine.speechCalls, 0);
    assert.equal((await db.collection<WorkerRow>('generation_workers').findOne({}))!.state, 'disabled');
  });
  test('approved input produces three settled attempts and one local artifact, not a ready/public video', async () => {
    const accepted = await approve(); assert.equal(await worker.tick(), true);
    const current = (await run())!; assert.equal(current.state, 'rendered_local'); assert.equal(current.submissionCount, 3); assert.equal(current.owner, null);
    const attempts = await db.collection<SpeechAttempt>('generation_speech_attempts').find({runId: current._id}).toArray(); assert.equal(attempts.length, 3); assert.ok(attempts.every(a => a.state === 'settled' && a.audioHash));
    assert.equal(await db.collection('generation_local_artifacts').countDocuments(), 1); assert.equal(engine.speechCalls, 3); assert.equal(engine.renderCalls, 1);
    assert.equal((await provider())!.reservations[0].state, 'settled'); assert.ok((await provider())!.reservations[0].units > 0);
    assert.equal((await db.collection<Row>('projects').findOne({_id: projectId}))!.latestRunId, null);
    const view = await service.job(accepted.job.jobId); assert.equal(view!.result, null); assert.equal(JSON.stringify(view).includes('localArtifact'), false); assert.equal(view!.allowedActions.length, 0); await checkDatabase(db);
  });
  test('an idle heartbeat outage is retried without speech before the approved run completes',async()=>{
    await approve();const stop=new AbortController(),events:GenerationLoopEvent[]=[];let calls=0;
    const heartbeat=worker.heartbeat.bind(worker);worker.heartbeat=async()=>{if(++calls===1)throw new MongoNetworkError('private database address');return heartbeat();};
    engine.duringRender=async()=>{stop.abort();};
    await runGenerationWorker(worker,{signal:stop.signal,report:e=>events.push(e),sleep:async()=>{assert.equal(engine.speechCalls,0);assert.equal(await db.collection('generation_speech_attempts').countDocuments(),0);}});
    assert.equal((await run())!.state,'rendered_local');assert.equal(engine.speechCalls,3);assert.equal(engine.renderCalls,1);
    assert.equal(events[0].event,'generation_idle_retry');assert.equal(events[1].event,'generation_idle_recovered');
    const slot=(await db.collection<WorkerRow>('generation_workers').findOne({_id:'generation:local'}))!;assert.equal(slot.state,'draining');assert.equal(slot.expiresAt.getTime(),0);
  });
  test('an unresolved post-claim database failure is not treated as idle or dispatched again',async()=>{
    await approve();const collection=db.collection('generation_runs'),validator=(await collection.options()).validator;
    await db.command({collMod:'generation_runs',validator:{$and:[validator,{state:{$nin:['failed','cancelled','rendered_local']}}]}});
    try {
      const events:GenerationLoopEvent[]=[];
      await assert.rejects(runGenerationWorker(worker,{signal:new AbortController().signal,report:e=>events.push(e),sleep:async()=>assert.fail('post-claim failures must stop')}),e=>e instanceof MongoServerError&&!(e instanceof GenerationIdlePollError));
      assert.deepEqual(events,[]);assert.equal(engine.speechCalls,3);assert.equal(engine.renderCalls,1);assert.equal((await run())!.state,'running');assert.equal((await run())!.stage,'rendering');
      assert.equal(await db.collection('generation_local_artifacts').countDocuments(),0);assert.equal(await db.collection('generation_runs').countDocuments(),1);
    } finally {await db.command({collMod:'generation_runs',validator});}
  });
  test('released ownership cannot be refreshed by a stale registry revision or a later heartbeat',async()=>{
    const registry=db.collection<WorkerRow>('generation_workers'),before=(await registry.findOne({_id:'generation:local'}))!;
    await worker.release();const released=(await registry.findOne({_id:'generation:local'}))!;
    const delayed=await registry.updateOne({_id:'generation:local',owner:worker.owner,revision:before.revision},{$set:{state:'healthy',expiresAt:new Date(Date.now()+45000)},$inc:{revision:Long.ONE}});
    assert.equal(delayed.matchedCount,0);assert.equal(await worker.heartbeat(),false);assert.equal(await worker.tick(),false);
    assert.deepEqual(await registry.findOne({_id:'generation:local'}),released);
  });
  test('shutdown joins an in-flight heartbeat before releasing the registry slot',{timeout:25000},async()=>{
    await approve();const heartbeatStarted=deferred<void>(),allowHeartbeat=deferred<void>(),renderStarted=deferred<void>(),allowRender=deferred<void>();
    const stop=new AbortController(),heartbeat=worker.heartbeat.bind(worker);let heartbeatCalls=0,finished=false;
    worker.heartbeat=async()=>{if(++heartbeatCalls===2){heartbeatStarted.resolve();await allowHeartbeat.promise;}return heartbeat();};
    engine.duringRender=async()=>{renderStarted.resolve();await allowRender.promise;};
    const running=runGenerationWorker(worker,{signal:stop.signal,report:()=>{}}).then(()=>{finished=true;});
    try {
      await renderStarted.promise;await heartbeatStarted.promise;stop.abort();allowRender.resolve();
      const deadline=Date.now()+5000;while((await run())!.state!=='rendered_local'&&Date.now()<deadline)await new Promise(r=>setTimeout(r,20));
      assert.equal((await run())!.state,'rendered_local');assert.equal(finished,false);
      allowHeartbeat.resolve();await running;
      const slot=(await db.collection<WorkerRow>('generation_workers').findOne({_id:'generation:local'}))!;assert.equal(slot.state,'draining');assert.equal(slot.expiresAt.getTime(),0);
    } finally {allowRender.resolve();allowHeartbeat.resolve();await running;}
  });
  test('verified speech reuse avoids all new submissions for a visual-only revision and refunds its unused hold',async()=>{
    await approve();await worker.tick();const first=(await run())!,remaining=(await provider())!.allowance.observedRemaining;
    engine.reuseEnabled=true;const next=await approveRevision();await worker.tick();
    const completed=(await db.collection<GenerationRun>('generation_runs').findOne({_id:next._id}))!;
    assert.equal(completed.state,'rendered_local');assert.equal(completed.submissionCount,0);assert.equal(engine.speechCalls,3);assert.equal(engine.renderCalls,2);
    const refs=await db.collection<Row>('generation_speech_reuses').find({runId:next._id}).toArray();assert.equal(refs.length,3);assert.ok(refs.every(r=>r.sourceRunId===first._id&&r.sourceAttemptId&&r.audioHash==='e'.repeat(64)));
    assert.equal(await db.collection('generation_speech_attempts').countDocuments({runId:next._id}),0);
    assert.equal((await provider())!.allowance.observedRemaining,remaining);assert.equal((await provider())!.reservations.some(r=>r.id===next.reservationId),false);
    await assert.rejects(db.collection<Row>('generation_speech_reuses').insertOne({...refs[0],_id:randomUUID()}), (e:unknown)=>!!e&&typeof e==='object'&&'code'in e&&e.code===11000);
  });
  for (const code of ['TEXT_LAYOUT_EXCEEDED','LAYOUT_CHECK_UNAVAILABLE']) test(`pre-speech ${code} releases unused reservation and exposes safe recovery without submission/reuse`,async()=>{
    await approve();engine.duringPreflight=async()=>{throw new GenerationFault(code);};
    await worker.tick();const failed=(await run())!;
    assert.equal(failed.state,'failed');assert.equal(failed.stage,'plan_validation');assert.equal(failed.error?.code,code);
    assert.ok(failed.error!.message.length<=240);assert.equal(failed.error!.retryable,false);
    assert.equal(engine.preflightCalls,1);assert.equal(engine.speechCalls,0);assert.equal(engine.reuseReads,0);assert.equal(engine.renderCalls,0);
    assert.equal(await db.collection('generation_speech_attempts').countDocuments(),0);assert.equal(await db.collection('generation_local_artifacts').countDocuments(),0);
    assert.equal((await provider())!.reservations.length,0);assert.equal((await provider())!.allowance.observedRemaining,10000);assert.equal((await provider())!.state,'enabled');
    const status=await service.job(failed.jobId);assert.deepEqual(status!.error,failed.error);
    const recovery=await new OperationsService(client,name,context,providerEnv).read();assert.equal(recovery.recovery.items.length,1);assert.match(recovery.recovery.items[0].message,code==='TEXT_LAYOUT_EXCEEDED'?/Shorten narration/:/fonts and browser/);
    await approve();await worker.tick();assert.equal(engine.preflightCalls,1);assert.equal(await db.collection('generation_runs').countDocuments(),1);
  });
  test('speech waits for successful preflight; the approved input then completes normally',async()=>{
    const started=deferred<void>(),release=deferred<void>();await approve();
    engine.duringPreflight=async()=>{started.resolve();await release.promise;};const ticking=worker.tick();await started.promise;
    assert.equal((await run())!.stage,'plan_validation');assert.equal(engine.speechCalls,0);assert.equal(await db.collection('generation_speech_attempts').countDocuments(),0);
    release.resolve();await ticking;assert.equal((await run())!.state,'rendered_local');assert.equal(engine.speechCalls,3);assert.equal(engine.preflightCalls,1);
  });
  test('cancellation during preflight stops before speech or artifact creation',async()=>{
    const started=deferred<void>(),release=deferred<void>();await approve();engine.duringPreflight=async()=>{started.resolve();await release.promise;};
    const ticking=worker.tick();await started.promise;await cancelCurrent();release.resolve();await ticking;
    assert.equal((await run())!.state,'cancelled');assert.equal(engine.speechCalls,0);assert.equal(engine.renderCalls,0);assert.equal((await provider())!.reservations.length,0);
  });
  test('preflight build mismatch is fenced before speech',async()=>{
    await approve();engine.duringPreflight=async()=>{engine.build='e'.repeat(64);};await worker.tick();
    assert.equal((await run())!.error?.code,'RENDERER_CHANGED');assert.equal(engine.speechCalls,0);assert.equal((await provider())!.reservations.length,0);
  });
  test('a final renderer text-fit refusal retains consumed speech and reports correction rather than automatic retry',async()=>{
    await approve();engine.duringRender=async()=>{throw new GenerationFault('TEXT_LAYOUT_EXCEEDED');};await worker.tick();
    const failed=(await run())!;assert.equal(failed.error?.code,'TEXT_LAYOUT_EXCEEDED');assert.match(failed.error!.message,/new plan version/);
    assert.equal(failed.stage,'rendering');assert.equal((await provider())!.reservations[0].state,'settled');assert.equal(engine.speechCalls,3);assert.equal(await db.collection('generation_local_artifacts').countDocuments(),0);
  });
  async function checkpointSpeech(attempt:SpeechAttempt){const now=new Date();await db.collection<SpeechCleanupTask>('speech_cleanup_tasks').insertOne({_id:attempt._id,workspaceId:testWorkspaceId,projectId,source:{runId:attempt.runId,attemptId:attempt._id,audioHash:attempt.audioHash!,byteLength:attempt.byteLength!,sampleRate:24000,inputHash:attempt.inputHash,providerConfigHash:attempt.providerConfigHash,textHash:attempt.textHash,segmentId:attempt.segmentId},rootHash:'c'.repeat(64),state:'pending',revision:Long.ONE,attempts:Long.ONE,error:null,createdAt:now,updatedAt:now,removedAt:null});}
  test('speech reuse skips cleanup-checkpointed sources before reading their audio',async()=>{
    await approve();await worker.tick();const first=(await run())!,attempt=(await db.collection<SpeechAttempt>('generation_speech_attempts').findOne({runId:first._id}))!;await checkpointSpeech(attempt);engine.reuseEnabled=true;const next=await approveRevision();await worker.tick();assert.equal((await db.collection<GenerationRun>('generation_runs').findOne({_id:next._id}))!.state,'rendered_local');assert.equal(engine.reuseReads,2);assert.equal(engine.speechCalls,4);assert.equal(await db.collection('generation_speech_reuses').countDocuments({sourceAttemptId:attempt._id}),0);
  });
  test('speech reuse refuses a cleanup checkpoint appearing during the audio read',async()=>{
    await approve();await worker.tick();const first=(await run())!,attempts=await db.collection<SpeechAttempt>('generation_speech_attempts').find({runId:first._id}).toArray();engine.reuseEnabled=true;engine.duringRead=async()=>{for(const a of attempts)await checkpointSpeech(a);return audio();};const next=await approveRevision();await worker.tick();assert.equal((await db.collection<GenerationRun>('generation_runs').findOne({_id:next._id}))!.state,'failed');assert.equal(await db.collection('generation_speech_reuses').countDocuments({runId:next._id}),0);assert.equal(engine.speechCalls,3);assert.equal(engine.renderCalls,1);
  });
  test('verified speech reuse synthesizes only changed narration and never counts reused phrases as submissions',async()=>{
    await approve();await worker.tick();engine.reuseEnabled=true;const next=await approveRevision(true);await worker.tick();
    const completed=(await db.collection<GenerationRun>('generation_runs').findOne({_id:next._id}))!;
    assert.equal(completed.state,'rendered_local');assert.equal(completed.submissionCount,1);assert.equal(engine.speechCalls,4);
    assert.equal(await db.collection('generation_speech_reuses').countDocuments({runId:next._id}),2);
    assert.equal(await db.collection('generation_speech_attempts').countDocuments({runId:next._id,state:'settled'}),1);
    assert.equal((await provider())!.reservations.find(r=>r.id===next.reservationId)!.state,'settled');
  });
  test('missing or corrupt reusable audio follows normal approved synthesis without a false reuse receipt',async()=>{
    await approve();await worker.tick();const next=await approveRevision();await worker.tick();
    assert.equal((await db.collection<GenerationRun>('generation_runs').findOne({_id:next._id}))!.state,'rendered_local');assert.equal(engine.speechCalls,6);assert.equal(await db.collection('generation_speech_reuses').countDocuments(),0);
  });
  test('reuse refuses changed source provider configuration',async()=>{
    await approve();await worker.tick();const first=(await run())!;engine.reuseEnabled=true;
    await db.collection<GenerationRun>('generation_runs').updateOne({_id:first._id},{$set:{providerConfigHash:'b'.repeat(64)}});
    const next=await approveRevision();await worker.tick();assert.equal(engine.speechCalls,6);assert.equal(await db.collection('generation_speech_reuses').countDocuments({runId:next._id}),0);
  });
  test('reuse never imports speech from a different project even for identical narration',async()=>{
    await approve();await worker.tick();const first=(await run())!,other=projectFixture();await db.collection<Row>('projects').insertOne(other);engine.reuseEnabled=true;
    await db.collection<GenerationRun>('generation_runs').updateOne({_id:first._id},{$set:{projectId:other._id}});
    const next=await approveRevision();await worker.tick();assert.equal(engine.speechCalls,6);assert.equal(await db.collection('generation_speech_reuses').countDocuments({runId:next._id}),0);
  });
  test('operator disablement during reusable audio retrieval fences reuse and new speech',async()=>{
    await approve();await worker.tick();engine.reuseEnabled=true;const next=await approveRevision();
    engine.duringRead=async()=>{await db.collection<ProviderControl>('provider_controls').updateOne({_id:'elevenlabs'},{$set:{operatorDisabled:true,state:'disabled'}});return audio();};
    await worker.tick();assert.equal((await db.collection<GenerationRun>('generation_runs').findOne({_id:next._id}))!.state,'failed');assert.equal(engine.speechCalls,3);assert.equal(await db.collection('generation_speech_reuses').countDocuments(),0);
  });
  test('cancellation during reusable audio retrieval wins before reuse receipt or render',async()=>{
    await approve();await worker.tick();engine.reuseEnabled=true;const next=await approveRevision();
    engine.duringRead=async()=>{const live=(await db.collection<GenerationRun>('generation_runs').findOne({_id:next._id}))!;await service.cancel(live.jobId,{expectedRevision:live.statusRevision.toNumber()},randomUUID());return audio();};
    await worker.tick();assert.equal((await db.collection<GenerationRun>('generation_runs').findOne({_id:next._id}))!.state,'cancelled');assert.equal(engine.speechCalls,3);assert.equal(engine.renderCalls,1);assert.equal(await db.collection('generation_speech_reuses').countDocuments(),0);
  });
  test('source settlement changes after retrieval refuse reuse without silently submitting speech',async()=>{
    await approve();await worker.tick();engine.reuseEnabled=true;const first=(await run())!,next=await approveRevision();
    engine.duringRead=async()=>{await db.collection<SpeechAttempt>('generation_speech_attempts').updateOne({runId:first._id,segmentId:'segment_scene_1'},{$set:{state:'uncertain'}});return audio();};
    await worker.tick();assert.equal((await db.collection<GenerationRun>('generation_runs').findOne({_id:next._id}))!.state,'failed');assert.equal(engine.speechCalls,3);assert.equal(await db.collection('generation_speech_reuses').countDocuments(),0);
  });
  test('overlapping ticks and competing workers cannot duplicate submissions or local artifacts', async () => {
    await approve(); const secondEngine = new FakeEngine(), second = new GenerationWorker(client, name, providerEnv, secondEngine);
    await Promise.all([worker.tick(), worker.tick(), second.tick()]); assert.equal(engine.speechCalls, 3); assert.equal(secondEngine.speechCalls, 0); assert.equal(await db.collection('generation_local_artifacts').countDocuments(), 1);
    await worker.tick(); assert.equal(engine.speechCalls, 3);
  });
  test('a fully reserved account can finish its phrases without releasing consumed holds to other jobs', async () => {
    const plan = renderFixture().plan, phrase = plan.narration[0].text.length * 2 + 100, units = phrase * 3;
    await db.collection<ProviderControl>('provider_controls').updateOne({_id: 'elevenlabs'}, {$set: {'allowance.observedRemaining': units}}); await approve();
    engine.beforeObservation = async () => {engine.remaining = units - engine.speechCalls * phrase;};
    engine.duringSpeech = async () => {assert.equal((await provider())!.allowance.observedRemaining, 0); return audio();};
    await worker.tick(); assert.equal(engine.speechCalls, 3); assert.equal((await run())!.state, 'rendered_local'); assert.equal((await provider())!.reservations[0].units, units);
  });
  test('new active states require ownership/lease metadata and cannot be forged from a legacy queued row', async () => {
    await approve(); await assert.rejects(db.collection<GenerationRun>('generation_runs').updateOne({projectId}, {$set: {state: 'running'}}), e => !!e && typeof e === 'object' && 'code' in e && e.code === 121);
    assert.equal((await run())!.state, 'queued');
  });
  test('jobs approved by a later-disabled member continue as shared team work', async () => {
    await approve(); await db.collection<Row>('memberships').updateOne({userId: testUserId}, {$set: {status: 'disabled'}});
    await worker.tick(); assert.equal((await run())!.state, 'rendered_local');
  });
  test('changed renderer pins refuse before speech and release an unused reservation', async () => {
    await approve(); engine.build = 'c'.repeat(64); await worker.tick(); assert.equal((await run())!.state, 'failed'); assert.equal(engine.speechCalls, 0); assert.equal((await provider())!.reservations.length, 0);
  });
  test('operator disablement between live observation and submission wins without re-enablement', async () => {
    await approve(); engine.beforeObservation = async () => {await db.collection<Row>('provider_controls').updateOne({_id: 'elevenlabs'}, {$set: {operatorDisabled: true}, $inc: {revision: Long.ONE}});};
    await worker.tick(); assert.equal(engine.speechCalls, 0); assert.equal((await run())!.state, 'failed'); assert.equal((await provider())!.operatorDisabled, true); assert.equal((await provider())!.reservations.length, 0);
  });
  test('configuration/period changes and missing confirmed account capacity cannot dispatch', async () => {
    await approve(); engine.beforeObservation = async () => {await db.collection<Row>('provider_controls').updateOne({_id: 'elevenlabs'}, {$set: {configHash: 'a'.repeat(64), 'allowance.periodId': 'changed'}});};
    await worker.tick(); assert.equal(engine.speechCalls, 0); assert.equal((await run())!.state, 'failed');
  });
  test('running cancellation before the first durable submission is confirmed with full unused release', async () => {
    await approve(); engine.beforeObservation = async () => {const result = await cancelCurrent(); assert.equal(result.job.state, 'cancellation_requested'); assert.equal(result.job.cancellationConfirmed, false);};
    await worker.tick(); assert.equal(engine.speechCalls, 0); assert.equal((await run())!.state, 'cancelled'); assert.equal((await provider())!.allowance.observedRemaining, 10000);
  });
  test('cancellation after a known speech response stores its outcome and prevents later phrases/render', async () => {
    await approve(); engine.duringSpeech = async () => {await cancelCurrent(); return audio();};
    await worker.tick(); assert.equal(engine.speechCalls, 1); assert.equal(engine.renderCalls, 0); assert.equal((await run())!.state, 'cancelled');
    assert.equal((await db.collection<SpeechAttempt>('generation_speech_attempts').findOne({}))!.state, 'settled'); assert.equal((await provider())!.reservations[0].state, 'settled');
  });
  test('cancellation during rendering cannot commit a successful local artifact', async () => {
    await approve(); engine.duringRender = async () => {await cancelCurrent();}; await worker.tick();
    assert.equal((await run())!.state, 'cancelled'); assert.equal(await db.collection('generation_local_artifacts').countDocuments(), 0); assert.equal((await provider())!.reservations[0].state, 'settled');
  });
  test('unknown speech outcome retains uncertain usage, pauses future requests and never auto-retries', async () => {
    const input = body(); await approve(); engine.duringSpeech = async () => {throw new GenerationFault('SPEECH_OUTCOME_UNKNOWN', true);}; await worker.tick();
    assert.equal((await run())!.error!.code, 'SPEECH_OUTCOME_UNKNOWN'); assert.equal((await provider())!.reservations[0].state, 'uncertain'); assert.equal((await provider())!.state, 'paused');
    assert.equal((await service.approve(projectId, input, randomUUID())).job.state, 'failed'); await worker.tick(); assert.equal(engine.speechCalls, 1);
  });
  test('unknown usage cannot overwrite a legacy operator disablement written during speech', async () => {
    await approve(); engine.duringSpeech = async () => {await db.collection<ProviderControl>('provider_controls').updateOne({_id: 'elevenlabs'}, {$set: {state: 'disabled'}}); throw new GenerationFault('SPEECH_OUTCOME_UNKNOWN', true);};
    await worker.tick(); assert.equal((await provider())!.state, 'disabled'); assert.equal((await provider())!.reservations[0].state, 'uncertain');
  });
  test('a lost local speech write after submission is uncertain and is not refunded', async () => {
    await approve(); const remaining = (await provider())!.allowance.observedRemaining; engine.persistFailure = true; await worker.tick();
    assert.equal((await run())!.error!.code, 'SPEECH_OUTCOME_UNKNOWN'); assert.equal((await provider())!.allowance.observedRemaining, remaining); assert.equal(engine.speechCalls, 1);
  });
  test('a definite provider refusal is recorded once and pauses access without calling renderer', async () => {
    await approve(); engine.duringSpeech = async () => {throw new GenerationFault('SPEECH_ACCESS_REFUSED');}; await worker.tick();
    assert.equal((await db.collection<SpeechAttempt>('generation_speech_attempts').findOne({}))!.state, 'refused'); assert.equal((await provider())!.state, 'paused'); assert.equal(engine.speechCalls, 1); assert.equal(engine.renderCalls, 0);
  });
  test('renderer failure preserves known settled speech without claiming provider uncertainty', async () => {
    await approve(); engine.renderFailure = true; await worker.tick(); assert.equal((await run())!.state, 'failed'); assert.equal((await provider())!.state, 'enabled'); assert.equal((await provider())!.reservations[0].state, 'settled'); assert.equal(await db.collection('generation_local_artifacts').countDocuments(), 0);
  });
  test('measured duration failure retains settled speech and returns actionable status without retrying', async () => {
    await approve(); engine.duringRender = async () => {throw new GenerationFault('NARRATION_DURATION_EXCEEDED');};
    await worker.tick();
    const failed = (await run())!;
    assert.equal(failed.state, 'failed'); assert.equal(failed.stage, 'rendering');
    assert.deepEqual(failed.error, {code: 'NARRATION_DURATION_EXCEEDED', retryable: false, message: 'Generated narration is too long for the selected duration. Shorten it, save a new plan version, check and approve it before generating again. Existing speech may have used free allowance. No automatic retry.'});
    const status = await service.job(failed.jobId); assert.ok(status);
    assert.deepEqual(status.error, failed.error);
    const recovery=await new OperationsService(client,name,context,providerEnv).read();
    assert.equal(recovery.recovery.items.length,1);assert.equal(recovery.recovery.items[0].kind,'generation');assert.match(recovery.recovery.items[0].message,/Shorten it/);
    assert.equal(recovery.recovery.items[0].safeActionRoute,`/projects/${projectId}`);
    assert.equal((await provider())!.state, 'enabled'); assert.equal((await provider())!.reservations[0].state, 'settled');
    assert.equal(await db.collection('generation_speech_attempts').countDocuments({state: 'settled'}), 3);
    assert.equal(await db.collection('generation_local_artifacts').countDocuments(), 0);
    const calls = engine.speechCalls; await worker.tick(); await approve(); await worker.tick();
    assert.equal(engine.speechCalls, calls); assert.equal(engine.renderCalls, 1);
    assert.equal(await db.collection('generation_runs').countDocuments(), 1);
    await approveRevision();
    assert.deepEqual((await new OperationsService(client,name,context,providerEnv).read()).recovery.items,[]);
  });
  test('short narration keeps settled speech and requires an expanded approved version without retrying',async()=>{
    await approve();engine.duringRender=async()=>{throw new GenerationFault('NARRATION_TOO_SHORT');};await worker.tick();
    const failed=(await run())!;assert.equal(failed.error?.code,'NARRATION_TOO_SHORT');assert.equal(failed.error!.retryable,false);assert.ok(failed.error!.message.length<=240);assert.match(failed.error!.message,/Expand the plan/);
    assert.equal(failed.stage,'rendering');assert.deepEqual((await service.job(failed.jobId))!.error,failed.error);assert.equal((await provider())!.reservations[0].state,'settled');assert.equal(await db.collection('generation_speech_attempts').countDocuments({state:'settled'}),3);assert.equal(await db.collection('generation_local_artifacts').countDocuments(),0);
    const recovery=await new OperationsService(client,name,context,providerEnv).read();assert.match(recovery.recovery.items[0].message,/too short/);
    await approve();await worker.tick();assert.equal(engine.speechCalls,3);assert.equal(engine.renderCalls,1);assert.equal(await db.collection('generation_runs').countDocuments(),1);
  });
  test('a replacement recovers a submitted expired lease as uncertain and fences the old owner', async () => {
    await approve(); const started = deferred<void>(), release = deferred<MeasuredSpeech>(); engine.duringSpeech = async () => {started.resolve(); return release.promise;};
    const old = worker.tick(); await started.promise;
    assert.equal((await db.collection<SpeechAttempt>('generation_speech_attempts').findOne({}))!.state, 'submitted');
    await db.collection<GenerationRun>('generation_runs').updateOne({projectId}, {$set: {leaseUntil: new Date(0)}}); await db.collection<WorkerRow>('generation_workers').updateOne({_id: 'generation:local'}, {$set: {expiresAt: new Date(0)}});
    const replacementEngine = new FakeEngine(), replacement = new GenerationWorker(client, name, providerEnv, replacementEngine); assert.equal(await replacement.heartbeat(), true); assert.equal(await replacement.recoverExpired(), 1);
    release.resolve(audio()); await old; assert.equal((await run())!.state, 'failed'); assert.equal((await provider())!.reservations[0].state, 'uncertain'); assert.equal(await db.collection('generation_local_artifacts').countDocuments(), 0); assert.equal(replacementEngine.speechCalls, 0);
  });
  test('lease loss before any submission fails safely without consumption or resubmission', async () => {
    await approve(); const started = deferred<void>(), release = deferred<void>(); engine.beforeObservation = async () => {started.resolve(); await release.promise;};
    const old = worker.tick(); await started.promise;
    await db.collection<GenerationRun>('generation_runs').updateOne({projectId}, {$set: {leaseUntil: new Date(0)}}); await db.collection<WorkerRow>('generation_workers').updateOne({_id: 'generation:local'}, {$set: {expiresAt: new Date(0)}});
    const replacement = new GenerationWorker(client, name, providerEnv, new FakeEngine()); await replacement.heartbeat(); await replacement.recoverExpired(); release.resolve(); await old;
    assert.equal(engine.speechCalls, 0); assert.equal((await run())!.state, 'failed'); assert.equal((await provider())!.reservations.length, 0); assert.equal((await provider())!.allowance.observedRemaining, 10000);
  });
  for (const stage of ['rendering', 'validating'] as const) for (const cancelling of [false, true]) {
    test(`expired ${stage} lease ${cancelling ? 'with cancellation' : 'without cancellation'} retains the physical slot without executor-stop evidence`, async () => {
      await approve();
      // A second, independently approved project must not start while the old
      // renderer ignores abort/loses DB connectivity, even after slot takeover.
      const secondProjectId = randomUUID(), secondPlanId = randomUUID();
      const firstProject = (await db.collection<Row>('projects').findOne({_id: projectId}))!;
      await db.collection<Row>('projects').insertOne({...firstProject, _id: secondProjectId, revision: Long.ONE, latestRunId: null, currentPlanVersionId: secondPlanId, planningRequestId: secondPlanId});
      const firstPlan = (await db.collection<PlanVersion>('plan_versions').findOne({_id: planId}))!;
      await db.collection<PlanVersion>('plan_versions').insertOne({...firstPlan, _id: secondPlanId, projectId: secondProjectId, sourcePlanningRequestId: secondPlanId});
      const second = await service.approve(secondProjectId, {...body(), planVersionId: secondPlanId}, randomUUID());
      const started = deferred<void>(), release = deferred<void>();
      engine.duringRender = async () => {
        if (stage === 'validating') await db.collection<GenerationRun>('generation_runs').updateOne({projectId}, {$set: {stage}});
        started.resolve(); await release.promise;
      };
      const old = worker.tick(); await started.promise;
      try {
        if (cancelling) await cancelCurrent();
        await db.collection<GenerationRun>('generation_runs').updateOne({projectId}, {$set: {leaseUntil: new Date(0)}});
        await db.collection<WorkerRow>('generation_workers').updateOne({_id: 'generation:local'}, {$set: {expiresAt: new Date(0)}});
        const beforeRun = await run(), beforeProvider = await provider();
        const beforeProject = await db.collection<Row>('projects').findOne({_id: projectId});
        const operations=await new OperationsService(client,name,context,providerEnv).read();
        assert.equal(operations.worker.activeRenders,1);
        assert.match(operations.recovery.items.find(item=>item.projectId===projectId)!.message,/confirm that it has stopped/);
        const replacementEngine = new FakeEngine(), replacement = new GenerationWorker(client, name, providerEnv, replacementEngine);
        assert.equal(await replacement.heartbeat(), true);
        assert.equal(await replacement.recoverExpired(), 0);
        assert.equal(await replacement.tick(), false);
        assert.deepEqual(await run(), beforeRun); assert.deepEqual(await provider(), beforeProvider);
        assert.deepEqual(await db.collection<Row>('projects').findOne({_id: projectId}), beforeProject);
        assert.equal((await service.job(second.job.jobId))!.state, 'queued');
        assert.equal(engine.renderCalls, 1); assert.equal(replacementEngine.speechCalls, 0); assert.equal(replacementEngine.renderCalls, 0);
        release.resolve(); await old;
        // Even a late result/file is not durable process-tree stop evidence.
        assert.equal(await replacement.recoverExpired(), 0); assert.equal(await replacement.tick(), false);
        assert.deepEqual(await run(), beforeRun); assert.equal(await db.collection('generation_local_artifacts').countDocuments(), 0);
        assert.equal((await service.job(second.job.jobId))!.state, 'queued');
        assert.equal(replacementEngine.speechCalls, 0); assert.equal(replacementEngine.renderCalls, 0);
      } finally {release.resolve(); await old;}
    });
  }
  test('project deletion after claim prevents any subsequent external request and cannot resurrect the project', async () => {
    await approve(); engine.beforeObservation = async () => {await db.collection<Row>('projects').updateOne({_id: projectId}, {$set: {deletedAt: new Date()}});};
    await worker.tick(); assert.equal(engine.speechCalls, 0); assert.equal((await run())!.state, 'failed'); assert.ok((await db.collection<Row>('projects').findOne({_id: projectId}))!.deletedAt);
  });
  async function storageSetup(existing?:GenerationRun) {
    if(!existing){await approve(); await worker.tick();} const current = existing??(await run())!;
    const bytes = Object.fromEntries(storageKinds.map(k => [k, Buffer.from(k)])) as Record<StorageKind, Buffer>;
    bytes.input = Buffer.from((await db.collection<Row>('approvals').findOne({_id: current.approvalId}))!.inputCanonical);
    const plan = JSON.parse(bytes.input.toString()), media = (await db.collection<Row>('generation_local_artifacts').findOne({_id: current.artifactId!}))!.media;
    const cues = plan.narration.map((n: {text: string; segmentId: string}, i: number) => ({segmentId: n.segmentId, sceneId: plan.scenes[i].sceneId, text: n.text, startFrame: i * 300, speechEndFrame: i * 300 + 250, endFrame: (i + 1) * 300}));
    bytes.manifest = Buffer.from(JSON.stringify({mp4Sha256: sha256(bytes.mp4), state: 'validated_local', mode: 'elevenlabs-evaluation', diagnostic: false, voicePinSatisfied: true, publicationAllowed: false,
      inputHash: current.inputHash, rendererBuildHash: current.rendererBuildHash, language: plan.language, fps: 30, durationInFrames: 900, audioHash: 'a'.repeat(64), media}));
    bytes.timing = Buffer.from(JSON.stringify({cues, audioHash: 'a'.repeat(64), layout: {scenes: cues.map((c: {text: string}) => ({caption: {lines: [c.text]}}))}}));
    bytes.srt = Buffer.from(cues.map((c: {text: string}, i: number) => `${i+1}\n00:00:${String(i*10).padStart(2,'0')},000 --> 00:00:${String((i+1)*10).padStart(2,'0')},000\n${c.text}\n`).join('\n'));
    await db.collection<Row>('generation_local_artifacts').updateOne({_id: current.artifactId!}, {$set: {manifestHash: sha256(bytes.manifest)}});
    const reader = {read: async () => bytes}, store = {configHash: 'a'.repeat(64), bucket: 'test-private', calls: 0, objects: new Map<string, Buffer>(), hook: undefined as undefined | (() => Promise<void>),
      async read(object: StorageObject) {const data = this.objects.get(object.key); if (!data) throw new Error('missing'); return Buffer.from(data);},
      async ensure(object: StorageObject, data: Buffer) {this.calls++; verifyObject(object, data); await this.hook?.(); const old = this.objects.get(object.key); if (old) assert.deepEqual(old, data); else this.objects.set(object.key, data);}};
    return {current, bytes, reader, store, storage: new StorageService(client, name, store, reader)};
  }
  test('private storage preparation is unique and atomically creates evaluation-only ready playback metadata', async () => {
    const {storage, store, current} = await storageSetup();
    await Promise.all([storage.prepare(current._id), storage.prepare(current._id)]);
    assert.equal(await db.collection('generation_storage_bundles').countDocuments(), 1);
    assert.equal(await storage.tick(), true); assert.equal(await storage.tick(), false);
    const bundle = (await db.collection<StorageBundle>('generation_storage_bundles').findOne({}))!;
    assert.equal(bundle.state, 'stored'); assert.equal(bundle.objects.length, 5); assert.equal(store.objects.size, 5); assert.equal(bundle.owner, null);
    assert.equal((await run())!.state, 'rendered_local'); assert.equal((await service.job(current.jobId))!.result, null);
    const latest = await new VideoService(client, name, context, store).latest(projectId);
    assert.equal(latest.video!.id, bundle._id); assert.equal(latest.video!.capabilities.publish, false); assert.equal(latest.video!.capabilities.download, true);
    assert.equal(await db.collection('video_assets').countDocuments({videoId: bundle._id, refCount: 1}), 5);
    assert.equal(engine.speechCalls, 3); assert.equal(engine.renderCalls, 1);
    assert.equal(await db.collection('activity_events').countDocuments({dedupeKey: `storage:${bundle._id}:stored`}), 1); await checkDatabase(db);
  });
  async function cleanupSetup(deleted=true){
    const setup=await storageSetup();await setup.storage.prepare(setup.current._id);await setup.storage.tick();
    const projects=new ProjectService(client,name,context,'cleanup-test-secret-'.repeat(3));
    if(deleted){const current=await projects.get(projectId);await projects.delete(projectId,{expectedProjectRevision:current.revision},randomUUID());}
    const removed:string[]=[],adapter={configHash:setup.store.configHash,bucket:setup.store.bucket,hook:undefined as undefined|(()=>Promise<void>),async remove(object:StorageObject){removed.push(object.key);setup.store.objects.delete(object.key);await this.hook?.();}};
    const cleanup=new MediaCleanupService(client,name,adapter),assets=await db.collection<Row>('video_assets').find({projectId}).sort({_id:1}).toArray();return {...setup,projects,adapter,removed,cleanup,assets};
  }
  async function localSetup(removed=true){
    const setup=await cleanupSetup();if(removed)while(await setup.cleanup.next(projectId)){}
    const adapter={rootHash:'c'.repeat(64),inspections:0,removals:0,hook:undefined as undefined|(()=>Promise<void>),async inspect(source:LocalSource){this.inspections++;return source.objects.map(o=>({name:storageFiles[o.kind].name,sha256:o.sha256,size:o.size}));},async remove(_source:LocalSource,_files:LocalFile[]){this.removals++;await this.hook?.();}};
    return {...setup,files:adapter,local:new LocalCleanupService(client,name,adapter)};
  }
  async function speechCleanupSetup(cleaned=true){
    const setup=await localSetup();if(cleaned)await setup.local.next(projectId);
    const files={rootHash:setup.files.rootHash,inspections:0,removals:[] as string[],hook:undefined as undefined|(()=>Promise<void>),async inspect(_source:SpeechSource){this.inspections++;},async remove(source:SpeechSource){this.removals.push(source.attemptId);await this.hook?.();}};
    const attempts=await db.collection<SpeechAttempt>('generation_speech_attempts').find({runId:setup.current._id,state:'settled'}).sort({_id:1}).toArray();return {...setup,speechFiles:files,speechCleanup:new SpeechCleanupService(client,name,files),attempts};
  }
  async function reuseReleaseSetup(cleaned=true){
    const first=await storageSetup();await first.storage.prepare(first.current._id);await first.storage.tick();engine.reuseEnabled=true;const next=await approveRevision();await worker.tick();const target=(await db.collection<GenerationRun>('generation_runs').findOne({_id:next._id}))!,second=await storageSetup(target);await second.storage.prepare(target._id);await second.storage.tick();
    const projects=new ProjectService(client,name,context,'release-test-secret-'.repeat(3)),current=await projects.get(projectId);await projects.delete(projectId,{expectedProjectRevision:current.revision},randomUUID());
    const remote=new MediaCleanupService(client,name,{configHash:first.store.configHash,bucket:first.store.bucket,async remove(){}});while(await remote.next(projectId)){}
    const files={rootHash:'c'.repeat(64),async inspect(source:LocalSource){return source.objects.map(o=>({name:storageFiles[o.kind].name,sha256:o.sha256,size:o.size}));},async remove(){}};
    const local=new LocalCleanupService(client,name,files);if(cleaned)while(await local.next(projectId)){}
    const refs=await db.collection<Row>('generation_speech_reuses').find({runId:target._id}).sort({_id:1}).toArray(),removed:string[]=[],speechFiles={rootHash:files.rootHash,async inspect(){},async remove(source:SpeechSource){removed.push(source.attemptId);}};
    return {first,target,projects,local,refs,removed,release:new ReuseReleaseService(client,name),speech:new SpeechCleanupService(client,name,speechFiles)};
  }
  test('reuse release retires cleaned deleted-target pins without deleting original evidence',async()=>{
    const {release,speech,refs,removed,first}=await reuseReleaseSetup();const original=await db.collection<Row>('generation_speech_reuses').find({}).sort({_id:1}).toArray();assert.equal(refs.length,3);assert.equal(await speech.next(projectId),false);while(await release.next(projectId)){}assert.deepEqual(await db.collection<Row>('generation_speech_reuses').find({}).sort({_id:1}).toArray(),original);assert.equal(await release.next(projectId),false);assert.equal((await reuseReleaseStatus(db,testWorkspaceId,projectId)).releaseReceipts,3);assert.equal((await speechCleanupStatus(db,testWorkspaceId,projectId)).pinnedAttempts,0);while(await speech.next(projectId)){}assert.equal(removed.length,3);assert.equal(await db.collection('generation_speech_attempts').countDocuments({runId:first.current._id}),3);assert.equal(await db.collection('approvals').countDocuments(),2);assert.equal(engine.speechCalls,3);assert.equal(engine.renderCalls,2);await checkDatabase(db);
  });
  test('reuse release refuses live projects and targets before verified local cleanup',async()=>{
    const {release,refs,local}=await reuseReleaseSetup(false);await assert.rejects(release.release(refs[0]._id));assert.equal(await db.collection('speech_reuse_releases').countDocuments(),0);while(await local.next(projectId)){}const project=(await db.collection<ProjectRecord>('projects').findOne({_id:projectId}))!;await db.collection<ProjectRecord>('projects').updateOne({_id:projectId},{$set:{deletedAt:null,deletedBy:null,deletionReceipt:null}});await assert.rejects(release.release(refs[0]._id));await db.collection<ProjectRecord>('projects').replaceOne({_id:projectId},project);assert.equal(await release.release(refs[0]._id),true);
  });
  test('reuse release refuses unknown owners and source drift; mismatched receipts cannot unpin speech',async()=>{
    const {release,refs,speech}=await reuseReleaseSetup(),ref=refs[0];await db.collection('asset_refs').insertOne({assetId:ref.sourceAttemptId,owner:'unknown'});await assert.rejects(release.release(ref._id));await db.collection('asset_refs').deleteMany({});assert.equal(await release.release(ref._id),true);await db.collection<ReuseRelease>('speech_reuse_releases').updateOne({_id:ref._id},{$set:{reuseHash:'f'.repeat(64)}});assert.equal(await hasRetainedSpeechPin(db,ref.sourceAttemptId),true);await assert.rejects(release.release(ref._id));await assert.rejects(speech.clean(ref.sourceAttemptId));assert.equal(await db.collection('speech_cleanup_tasks').countDocuments(),0);
  });
  test('reuse release transaction rolls back its project fence if the receipt write fails',async()=>{
    const {release,refs}=await reuseReleaseSetup(),before=(await db.collection<Row>('projects').findOne({_id:projectId}))!.guardRevision.toString();await db.command({collMod:'speech_reuse_releases',validator:{$and:[reuseReleaseCollections[0].validator,{reason:{$ne:'deleted_target_render_cleaned'}}]}});try{await assert.rejects(release.release(refs[0]._id));}finally{await db.command({collMod:'speech_reuse_releases',validator:reuseReleaseCollections[0].validator});}assert.equal(await db.collection('speech_reuse_releases').countDocuments(),0);assert.equal((await db.collection<Row>('projects').findOne({_id:projectId}))!.guardRevision.toString(),before);assert.equal(await release.release(refs[0]._id),true);
  });
  test('concurrent reuse releases produce one permanent receipt and replay detects source changes',async()=>{
    const {release,refs}=await reuseReleaseSetup(),ref=refs[0];const results=await Promise.all([release.release(ref._id),new ReuseReleaseService(client,name).release(ref._id)]);assert.equal(results.filter(Boolean).length,1);assert.equal(await db.collection<Row>('speech_reuse_releases').countDocuments({_id:ref._id}),1);await db.collection<Row>('generation_speech_reuses').updateOne({_id:ref._id},{$set:{audioHash:'d'.repeat(64)}});await assert.rejects(release.release(ref._id));assert.equal(await hasRetainedSpeechPin(db,ref.sourceAttemptId),true);
  });
  test('reuse release refuses unsettled target ownership and changed source audio metadata',async()=>{
    const {release,refs,target}=await reuseReleaseSetup(),ref=refs[0];await db.collection<GenerationRun>('generation_runs').updateOne({_id:target._id},{$set:{owner:randomUUID()}},{bypassDocumentValidation:true});await assert.rejects(release.release(ref._id));await db.collection<GenerationRun>('generation_runs').updateOne({_id:target._id},{$set:{owner:null}});await db.collection<SpeechAttempt>('generation_speech_attempts').updateOne({_id:ref.sourceAttemptId},{$set:{audioHash:'b'.repeat(64)}});await assert.rejects(release.release(ref._id));assert.equal(await db.collection('speech_reuse_releases').countDocuments(),0);
  });
  test('one released reference cannot hide another surviving or unsupported owner',async()=>{
    const {release,refs,speech,removed}=await reuseReleaseSetup(),ref=refs[0],other={...ref,_id:randomUUID(),runId:randomUUID()};await db.collection<Row>('generation_speech_reuses').insertOne(other);assert.equal(await release.release(ref._id),true);assert.equal(await hasRetainedSpeechPin(db,ref.sourceAttemptId),true);await assert.rejects(release.release(other._id));await assert.rejects(speech.clean(ref.sourceAttemptId));assert.deepEqual(removed,[]);assert.equal((await speechCleanupStatus(db,testWorkspaceId,projectId)).pinnedAttempts,3);
  });
  test('speech cleanup follows local cleanup and preserves all source records',async()=>{
    const {speechCleanup,speechFiles,attempts,local}=await speechCleanupSetup(false);await assert.rejects(speechCleanup.clean(attempts[0]._id));assert.equal(speechFiles.inspections,0);await local.next(projectId);while(await speechCleanup.next(projectId)){}assert.equal(speechFiles.removals.length,3);assert.equal((await speechCleanupStatus(db,testWorkspaceId,projectId)).removedAttempts,3);assert.equal(await db.collection('generation_speech_attempts').countDocuments(),3);assert.equal(await db.collection('approvals').countDocuments(),1);assert.equal(await db.collection('generation_local_artifacts').countDocuments(),1);assert.equal(engine.renderCalls,1);await checkDatabase(db);
  });
  test('speech cleanup retains surviving reuse pins and unknown generic owners',async()=>{
    const {speechCleanup,speechFiles,attempts,current}=await speechCleanupSetup();const attempt=attempts[0];
    await db.collection<Row>('generation_speech_reuses').insertOne({_id:randomUUID(),workspaceId:testWorkspaceId,projectId,runId:randomUUID(),segmentId:attempt.segmentId,sourceRunId:current._id,sourceAttemptId:attempt._id,sourceApprovalId:current.approvalId,sourceInputHash:current.inputHash,inputHash:current.inputHash,identityHash:'a'.repeat(64),providerConfigHash:current.providerConfigHash,audioHash:attempt.audioHash,byteLength:attempt.byteLength,sampleRate:24000,owner:randomUUID(),leaseEpoch:Long.ONE,createdAt:new Date()});
    await assert.rejects(speechCleanup.clean(attempt._id));while(await speechCleanup.next(projectId)){}assert.equal(speechFiles.removals.length,2);assert.ok(!speechFiles.removals.includes(attempt._id));assert.equal((await speechCleanupStatus(db,testWorkspaceId,projectId)).pinnedAttempts,1);await db.collection('generation_speech_reuses').deleteMany({});await db.collection('asset_refs').insertOne({assetId:attempt._id,owner:'unknown'});await assert.rejects(speechCleanup.clean(attempt._id));assert.equal(await db.collection<Row>('speech_cleanup_tasks').countDocuments({_id:attempt._id}),0);
  });
  test('speech cleanup resumes failed removal with pinned identity and refuses a changed root',async()=>{
    const {speechCleanup,speechFiles,attempts}=await speechCleanupSetup();const id=attempts[0]._id;speechFiles.hook=async()=>{throw new Error('private filesystem path');};await assert.rejects(speechCleanup.clean(id),/SPEECH_REMOVAL_FAILED/);assert.equal((await speechCleanupStatus(db,testWorkspaceId,projectId)).retryAttempts,1);await assert.rejects(new SpeechCleanupService(client,name,{...speechFiles,rootHash:'f'.repeat(64)}).clean(id));speechFiles.hook=undefined;assert.equal(await speechCleanup.clean(id),true);assert.equal(speechFiles.inspections,1);assert.equal((await db.collection<SpeechCleanupTask>('speech_cleanup_tasks').findOne({_id:id}))!.attempts.toString(),'2');assert.equal(await speechCleanup.clean(id),false);
  });
  test('speech cleanup recovers an unacknowledged final commit using the same attempt',async()=>{
    const {speechCleanup,speechFiles,attempts}=await speechCleanupSetup();const id=attempts[0]._id;speechFiles.hook=async()=>{await db.command({collMod:'speech_cleanup_tasks',validator:{$and:[speechCleanupCollections[0].validator,{state:{$ne:'removed'}}]}});};try{await assert.rejects(speechCleanup.clean(id));}finally{await db.command({collMod:'speech_cleanup_tasks',validator:speechCleanupCollections[0].validator});}assert.equal((await db.collection<SpeechCleanupTask>('speech_cleanup_tasks').findOne({_id:id}))!.state,'pending');speechFiles.hook=undefined;assert.equal(await speechCleanup.clean(id),true);assert.deepEqual(speechFiles.removals,[id,id]);assert.equal(speechFiles.inspections,1);assert.equal(engine.renderCalls,1);
  });
  test('concurrent speech cleanup fences finalizers and schema rejects contradictory receipts',async()=>{
    const {speechCleanup,speechFiles,attempts}=await speechCleanupSetup();const id=attempts[0]._id;await Promise.all([speechCleanup.clean(id),new SpeechCleanupService(client,name,speechFiles).clean(id)]);assert.equal(await db.collection<Row>('speech_cleanup_tasks').countDocuments({_id:id,state:'removed'}),1);await assert.rejects(db.collection<SpeechCleanupTask>('speech_cleanup_tasks').updateOne({_id:id},{$set:{removedAt:null}}));await checkDatabase(db);
  });
  test('local cleanup requires confirmed remote cleanup and retains generation/speech source metadata',async()=>{
    const {local,files,current,projects,cleanup}=await localSetup(false);await assert.rejects(local.clean(current._id),/LOCAL_CLEANUP_OWNERSHIP_UNAVAILABLE/);assert.equal(files.inspections,0);while(await cleanup.next(projectId)){}
    assert.equal(await local.next(projectId),true);assert.equal(await local.next(projectId),false);assert.equal(files.inspections,1);assert.equal(files.removals,1);const status=await projects.deletionStatus(projectId);assert.equal(status.localRenderCleanup.state,'known_files_removed');assert.equal(await db.collection('generation_local_artifacts').countDocuments(),1);assert.equal(await db.collection('generation_speech_attempts').countDocuments(),3);assert.equal(engine.renderCalls,1);await checkDatabase(db);
  });
  test('local cleanup resumes immutable inventory after partial failure and refuses another root',async()=>{
    const {local,files,current,projects}=await localSetup();files.hook=async()=>{throw new Error('private filesystem path');};await assert.rejects(local.clean(current._id),/LOCAL_REMOVAL_FAILED/);assert.equal((await projects.deletionStatus(projectId)).localRenderCleanup.state,'retry_required');
    await assert.rejects(new LocalCleanupService(client,name,{...files,rootHash:'d'.repeat(64)}).clean(current._id));files.hook=undefined;assert.equal(await new LocalCleanupService(client,name,files).clean(current._id),true);assert.equal(files.inspections,1);assert.equal(files.removals,2);assert.equal((await db.collection<LocalTask>('local_render_cleanup_tasks').findOne({}))!.attempts.toString(),'2');
  });
  test('local cleanup retries a lost final commit without re-inspection or rendering',async()=>{
    const {local,files,current}=await localSetup();files.hook=async()=>{await db.command({collMod:'local_render_cleanup_tasks',validator:{$and:[localCleanupCollections[0].validator,{state:{$ne:'cleaned'}}]}});};try{await assert.rejects(local.clean(current._id));}finally{await db.command({collMod:'local_render_cleanup_tasks',validator:localCleanupCollections[0].validator});}files.hook=undefined;assert.equal((await db.collection<LocalTask>('local_render_cleanup_tasks').findOne({}))!.state,'pending');assert.equal(await local.clean(current._id),true);assert.equal(files.inspections,1);assert.equal(engine.renderCalls,1);
  });
  test('local cleanup refuses a surviving source pin and unsettled executor metadata',async()=>{
    const {local,files,current,assets}=await localSetup();await db.collection('asset_refs').insertOne({assetId:assets[0]._id,owner:'unknown'});await assert.rejects(local.clean(current._id));await db.collection('asset_refs').deleteMany({});await db.collection<GenerationRun>('generation_runs').updateOne({_id:current._id},{$set:{owner:'still-running'}},{bypassDocumentValidation:true});await assert.rejects(local.clean(current._id));assert.equal(files.inspections,0);assert.equal(files.removals,0);assert.equal(await db.collection('local_render_cleanup_tasks').countDocuments(),0);
  });
  test('concurrent local cleanup attempts fence finalization at the same immutable inventory',async()=>{
    const {local,files,current}=await localSetup();await Promise.all([local.clean(current._id),new LocalCleanupService(client,name,files).clean(current._id)]);assert.equal(await db.collection('local_render_cleanup_tasks').countDocuments({state:'cleaned'}),1);assert.ok(files.removals>=1&&files.removals<=2);assert.equal(await local.clean(current._id),false);await checkDatabase(db);
  });
  test('cleanup removes five owned ready objects while preserving source metadata and shared namespaces',async()=>{
    const {cleanup,store,removed,projects}=await cleanupSetup();store.objects.set('shared-brand/logo.png',Buffer.from('retained'));
    while(await cleanup.next(projectId)){}assert.equal(removed.length,5);assert.deepEqual([...store.objects.keys()],['shared-brand/logo.png']);assert.equal(await db.collection('video_assets').countDocuments({projectId,lifecycleState:'deleted',refCount:0}),5);assert.equal(await db.collection('media_cleanup_tasks').countDocuments({projectId,state:'deleted'}),5);
    const status=await projects.deletionStatus(projectId);assert.equal(status.mediaCleanup.state,'ready_media_removed');assert.equal(status.mediaCleanup.retainedContent,true);assert.ok(!JSON.stringify(status).includes('workspaces/'));assert.equal(await db.collection('generation_speech_attempts').countDocuments({}),3);assert.equal(await db.collection('generation_local_artifacts').countDocuments({}),1);assert.equal(engine.renderCalls,1);await checkDatabase(db);
  });
  test('cleanup refuses live projects, shared refs, wrong destination and redirected object keys',async()=>{
    const {cleanup,adapter,projects,assets,removed}=await cleanupSetup(false),asset=assets[0];await assert.rejects(cleanup.clean(asset._id),/CLEANUP_OWNERSHIP_UNAVAILABLE/);const p=await projects.get(projectId);await projects.delete(projectId,{expectedProjectRevision:p.revision},randomUUID());
    await db.collection('asset_refs').insertOne({assetId:asset._id,owner:'another-project'});await assert.rejects(cleanup.clean(asset._id));await db.collection('asset_refs').deleteMany({});await assert.rejects(new MediaCleanupService(client,name,{...adapter,configHash:'f'.repeat(64)}).clean(asset._id));
    await db.collection<Row>('video_assets').updateOne({_id:asset._id},{$set:{'object.key':'workspaces/other-project/video.mp4'}});await assert.rejects(cleanup.clean(asset._id));assert.deepEqual(removed,[]);assert.equal(await db.collection('media_cleanup_tasks').countDocuments(),0);
  });
  test('uncertain object removal leaves a retry checkpoint and reuses exactly the same immutable key',async()=>{
    const {cleanup,adapter,assets,removed,projects}=await cleanupSetup(),id=assets[0]._id;adapter.hook=async()=>{throw new Error('Private network detail');};await assert.rejects(cleanup.clean(id),/OBJECT_REMOVAL_FAILED/);assert.equal((await db.collection<Row>('video_assets').findOne({_id:id}))!.lifecycleState,'deleting');assert.equal((await db.collection<Row>('media_cleanup_tasks').findOne({_id:id}))!.error,'OBJECT_REMOVAL_FAILED');assert.equal((await projects.deletionStatus(projectId)).mediaCleanup.state,'retry_required');
    adapter.hook=undefined;assert.equal(await new MediaCleanupService(client,name,adapter).clean(id),true);assert.equal(await cleanup.clean(id),false);assert.equal(new Set(removed).size,1);assert.equal(removed.length,2);assert.equal((await db.collection<Row>('media_cleanup_tasks').findOne({_id:id}))!.attempts.toString(),'2');
  });
  test('a failed metadata finalization resumes removal without resurrecting bytes or rerendering',async()=>{
    const {cleanup,adapter,assets,removed}=await cleanupSetup(),id=assets[0]._id;adapter.hook=async()=>{await db.command({collMod:'media_cleanup_tasks',validator:{$and:[cleanupCollections[1].validator,{state:{$ne:'deleted'}}]}});};
    try{await assert.rejects(cleanup.clean(id));}finally{await db.command({collMod:'media_cleanup_tasks',validator:cleanupCollections[1].validator});}assert.equal((await db.collection<Row>('media_cleanup_tasks').findOne({_id:id}))!.state,'pending');adapter.hook=undefined;assert.equal(await new MediaCleanupService(client,name,adapter).clean(id),true);assert.equal(removed.length,2);assert.equal(engine.renderCalls,1);
  });
  test('concurrent cleanup checkpoints can only finish the same immutable object',async()=>{
    const {cleanup,adapter,assets,removed}=await cleanupSetup(),id=assets[0]._id;await Promise.all([cleanup.clean(id),new MediaCleanupService(client,name,adapter).clean(id)]);assert.ok(removed.length>=1&&removed.length<=2);assert.equal(new Set(removed).size,1);assert.equal((await db.collection<Row>('video_assets').findOne({_id:id}))!.lifecycleState,'deleted');assert.equal(await db.collection<Row>('media_cleanup_tasks').countDocuments({_id:id,state:'deleted'}),1);
  });
  test('partial storage failure retries the exact keys/bytes without new speech/rendering', async () => {
    const {storage, store, current} = await storageSetup(); const bundle = await storage.prepare(current._id);
    store.hook = async () => {if (store.calls === 3) throw new Error('Private provider details');};
    await assert.rejects(storage.tick(), /STORAGE_FAILED/); assert.equal(store.objects.size, 2);
    assert.equal((await db.collection<StorageBundle>('generation_storage_bundles').findOne({}))!.state, 'failed'); assert.equal(await storage.tick(), false);
    const holds = await provider(); store.hook = undefined; await storage.retry(current._id); await storage.tick();
    const saved = (await db.collection<StorageBundle>('generation_storage_bundles').findOne({}))!;
    assert.equal(saved.state, 'stored'); assert.deepEqual(saved.objects, bundle.objects); assert.equal(store.objects.size, 5); assert.deepEqual(await provider(), holds);
    assert.equal(engine.speechCalls, 3); assert.equal(engine.renderCalls, 1);
  });
  test('storage lease takeover fences a late owner and safely reuses immutable object identities', async () => {
    const {storage, store, reader, current} = await storageSetup(); await storage.prepare(current._id);
    const started = deferred<void>(), release = deferred<void>(); let first = true;
    store.hook = async () => {if (first) {first = false; started.resolve(); await release.promise;}};
    const old = storage.tick(); const handled = old.catch(error => error); await started.promise;
    try {
      await db.collection<StorageBundle>('generation_storage_bundles').updateOne({runId: current._id}, {$set: {leaseUntil: new Date(0)}});
      const replacement = new StorageService(client, name, store, reader); assert.equal(await replacement.tick(), true);
      release.resolve(); assert.match((await handled).message, /STORAGE_OWNERSHIP_LOST/);
      const bundle = (await db.collection<StorageBundle>('generation_storage_bundles').findOne({}))!;
      assert.equal(bundle.state, 'stored'); assert.equal(bundle.epoch.toNumber(), 2); assert.equal(store.objects.size, 5);
      assert.equal(await db.collection('activity_events').countDocuments({dedupeKey: `storage:${bundle._id}:stored`}), 1);
    } finally {release.resolve(); await handled;}
  });
  test('unexpired storage ownership prevents a competing uploader', async () => {
    const {storage, store, reader, current} = await storageSetup(); await storage.prepare(current._id);
    const started = deferred<void>(), release = deferred<void>(); let first = true;
    store.hook = async () => {if (first) {first = false; started.resolve(); await release.promise;}};
    const old = storage.tick(); await started.promise;
    try {assert.equal(await new StorageService(client, name, store, reader).tick(), false); assert.equal(await storage.tick(), false);}
    finally {release.resolve(); await old;}
    assert.equal(store.objects.size, 5);
  });
  test('project deletion during upload prevents stored finalization without rerendering or resurrection', async () => {
    const {storage, store, current} = await storageSetup(); await storage.prepare(current._id);
    store.hook = async () => {await db.collection<Row>('projects').updateOne({_id: projectId}, {$set: {deletedAt: new Date()}});};
    await assert.rejects(storage.tick(), /STORAGE_SOURCE_UNAVAILABLE/);
    assert.equal(store.objects.size, 1); assert.equal((await db.collection<StorageBundle>('generation_storage_bundles').findOne({}))!.state, 'failed');
    assert.equal(await db.collection('activity_events').countDocuments({message: /private storage/}), 0); assert.equal(engine.renderCalls, 1);
  });
  test('changed local bytes cannot reuse a reserved object key', async () => {
    const {storage, store, current, bytes} = await storageSetup(); await storage.prepare(current._id); bytes.srt = Buffer.from('changed captions');
    await assert.rejects(storage.tick(), /STORAGE_BYTES_CHANGED/); assert.equal(store.calls, 0); assert.equal(engine.renderCalls, 1);
  });
  test('completed MP4 checksum is required before bundle preparation even with a custom reader', async () => {
    const {storage, store, current, bytes} = await storageSetup(); bytes.mp4 = Buffer.from('replaced video with identical metrics');
    await assert.rejects(storage.prepare(current._id), /STORAGE_SOURCE_CHANGED/);
    assert.equal(await db.collection('generation_storage_bundles').countDocuments(), 0); assert.equal(store.calls, 0);
  });
  test('checksumless legacy artifacts cannot be prepared or silently backfilled', async () => {
    const {storage, store, current, bytes} = await storageSetup(); bytes.manifest = Buffer.from('{}');
    await db.collection<Row>('generation_local_artifacts').updateOne({_id: current.artifactId!}, {$set: {manifestHash: sha256(bytes.manifest)}});
    await assert.rejects(storage.prepare(current._id), /STORAGE_VIDEO_CHECKSUM_REQUIRED/);
    assert.equal(await db.collection('generation_storage_bundles').countDocuments(), 0); assert.equal(store.calls, 0);
  });
  test('destination changes cannot migrate or retry a bundle into another bucket silently', async () => {
    const {storage, store, reader, current} = await storageSetup(); await storage.prepare(current._id);
    const changed = new StorageService(client, name, {...store, bucket: 'other', configHash: 'b'.repeat(64)}, reader);
    assert.equal(await changed.tick(), false);
    store.hook = async () => {throw new StorageFault('STORAGE_VERIFICATION_FAILED');}; await assert.rejects(storage.tick());
    await assert.rejects(changed.retry(current._id), /STORAGE_SOURCE_CHANGED/); assert.equal(store.objects.size, 0);
  });
  test('missing or foreign local provenance refuses storage before object writes', async () => {
    const {storage, store, current} = await storageSetup();
    await db.collection<Row>('generation_local_artifacts').updateOne({_id: current.artifactId!}, {$set: {workspaceId: randomUUID()}});
    await assert.rejects(storage.prepare(current._id), /STORAGE_SOURCE_UNAVAILABLE/); assert.equal(store.calls, 0); assert.equal(await db.collection('generation_storage_bundles').countDocuments(), 0);
  });
  test('discovery queues valid output, skips broken folders until explicit correction and excludes deleted projects', async () => {
    const {storage, store, reader, current} = await storageSetup();
    const read = reader.read; reader.read = async () => {throw new Error('missing local folder');};
    await assert.rejects(storage.discover()); assert.equal(await storage.discover(), false); assert.equal(store.calls, 0);
    reader.read = read; await storage.prepare(current._id); assert.equal(store.objects.size, 0);
    await db.collection('generation_storage_bundles').deleteMany({});
    await db.collection<Row>('projects').updateOne({_id: projectId}, {$set: {deletedAt: new Date()}});
    const replacement = new StorageService(client, name, store, reader); assert.equal(await replacement.discover(), false);
    await db.collection<Row>('projects').updateOne({_id: projectId}, {$set: {deletedAt: null}});
    assert.equal(await replacement.discover(), true); assert.equal(await replacement.tick(), true); assert.equal(store.objects.size, 5);
  });
  test('playback verifies private bytes and supports bounded full, single-range and HEAD responses', async () => {
    const {storage, store, current, bytes} = await storageSetup(); await storage.prepare(current._id); await storage.tick();
    const videos = new VideoService(client, name, context, store), view = (await videos.latest(projectId)).video!;
    const full = await videos.playback(view.id, null); assert.equal(full.status, 200); assert.deepEqual(Buffer.from(full.body!), bytes.mp4); assert.equal(full.headers['Cache-Control'], 'private, no-store');
    const part = await videos.playback(view.id, 'bytes=1-1'); assert.equal(part.status, 206); assert.deepEqual(Buffer.from(part.body!), bytes.mp4.subarray(1,2));
    assert.equal((await videos.playback(view.id, null, true)).body, null);
    await assert.rejects(videos.playback(view.id, 'bytes=999-'), (e: unknown) => !!e && typeof e === 'object' && 'status' in e && e.status === 416);
    assert.equal(JSON.stringify(view).includes('workspaces/'), false); assert.equal(JSON.stringify(view).includes(store.configHash), false);
  });
  test('downloads return exact MP4 and matching UTF-8 SRT with safe attachment headers, ranges and HEAD', async () => {
    const {storage, store, current, bytes} = await storageSetup(); await storage.prepare(current._id); await storage.tick();
    const videos = new VideoService(client, name, context, store), view = (await videos.latest(projectId)).video!;
    assert.equal(view.capabilities.download, true); assert.equal(view.capabilities.publish, false);
    for (const kind of ['mp4','srt'] as const) {
      assert.equal(view.downloadUrls[kind], `/api/v1/videos/${view.id}/downloads/${kind}`);
      const result = await videos.download(view.id, kind, null);
      assert.deepEqual(Buffer.from(result.body!), bytes[kind]); assert.equal(result.status, 200);
      assert.equal(result.headers['Content-Disposition'], `attachment; filename="videocraft-v1-${view.language}.${kind}"`);
      assert.equal(result.headers['Content-Length'], String(bytes[kind].length));
      assert.equal(result.headers['Cache-Control'], 'private, no-store'); assert.equal(result.headers.Vary, 'Cookie');
      assert.equal(result.headers['X-Content-Type-Options'], 'nosniff');
      assert.equal(result.headers['Content-Type'], kind === 'mp4' ? 'video/mp4' : 'application/x-subrip; charset=utf-8');
      assert.equal((await videos.download(view.id, kind, null, true)).body, null);
      const part = await videos.download(view.id, kind, 'bytes=0-1'); assert.equal(part.status, 206); assert.deepEqual(Buffer.from(part.body!), bytes[kind].subarray(0,2));
      await assert.rejects(videos.download(view.id, kind, 'bytes=0-1,3-4'), (e: unknown) => e instanceof Error && 'status' in e && e.status === 416);
    }
    for (const kind of ['input','manifest','timing','../srt','']) await assert.rejects(videos.download(view.id,kind,null), /could not be found/);
  });
  test('downloads reject corrupt or unavailable subtitle assets independently of playable MP4', async () => {
    const {storage, store, current} = await storageSetup(); await storage.prepare(current._id); await storage.tick();
    const videos = new VideoService(client,name,context,store), id = (await videos.latest(projectId)).video!.id;
    const bundle = (await db.collection<StorageBundle>('generation_storage_bundles').findOne({}))!, key = bundle.objects.find(o => o.kind === 'srt')!.key;
    const original = store.objects.get(key)!; store.objects.set(key, Buffer.from('substituted captions'));
    await assert.rejects(videos.download(id,'srt',null), /temporarily unavailable/); store.objects.set(key,original);
    await db.collection<Row>('video_assets').updateOne({videoId:id,'object.kind':'srt'},{$set:{lifecycleState:'deleting',refCount:0}});
    await assert.rejects(videos.download(id,'srt',null), /temporarily unavailable/);
    assert.equal((await videos.download(id,'mp4',null)).status,200);
  });
  test('downloads recheck subtitle pin revision after retrieval and deny changed access', async () => {
    const {storage,store,current} = await storageSetup(); await storage.prepare(current._id); await storage.tick();
    const videos = new VideoService(client,name,context,store), id = (await videos.latest(projectId)).video!.id, read = store.read;
    store.read = async function(object) {const bytes = await read.call(this,object); await db.collection<Row>('video_assets').updateOne({videoId:id,'object.kind':'srt'},{$inc:{referenceRevision:Long.ONE}}); return bytes;};
    await assert.rejects(videos.download(id,'srt',null), /temporarily unavailable/);
    store.read = async function(object) {const bytes = await read.call(this,object); await db.collection<Row>('memberships').updateOne({userId:testUserId},{$set:{status:'disabled'}}); return bytes;};
    await assert.rejects(videos.download(id,'mp4',null), /team access/);
  });
  test('downloads refuse foreign workspace, deleted project and changed destination', async () => {
    const {storage,store,current} = await storageSetup(); await storage.prepare(current._id); await storage.tick();
    const videos = new VideoService(client,name,context,store), id = (await videos.latest(projectId)).video!.id;
    await assert.rejects(new VideoService(client,name,{...context,workspaceId:randomUUID()},store).download(id,'srt',null));
    await assert.rejects(new VideoService(client,name,context,{...store,configHash:'b'.repeat(64)}).download(id,'srt',null), /temporarily unavailable/);
    await db.collection<Row>('projects').updateOne({_id:projectId},{$set:{deletedAt:new Date()}});
    await assert.rejects(videos.download(id,'mp4',null), /could not be found/);
  });
  test('foreign scope, inactive membership and deleted projects cannot resolve or play a video', async () => {
    const {storage, store, current} = await storageSetup(); await storage.prepare(current._id); await storage.tick();
    const videos = new VideoService(client, name, context, store), view = (await videos.latest(projectId)).video!;
    await assert.rejects(new VideoService(client, name, {...context, workspaceId: randomUUID()}, store).get(view.id));
    await db.collection<Row>('memberships').updateOne({userId: testUserId}, {$set: {status: 'disabled'}}); await assert.rejects(videos.playback(view.id,null), /team access/);
    await db.collection<Row>('memberships').updateOne({userId: testUserId}, {$set: {status: 'active'}});
    await db.collection<Row>('projects').updateOne({_id: projectId}, {$set: {deletedAt: new Date()}}); await assert.rejects(videos.get(view.id), /could not be found/);
  });
  test('corrupt remote bytes, changed destination and unavailable asset pins deny playback', async () => {
    const {storage, store, current} = await storageSetup(); await storage.prepare(current._id); await storage.tick();
    const videos = new VideoService(client, name, context, store), view = (await videos.latest(projectId)).video!;
    const bundle = (await db.collection<StorageBundle>('generation_storage_bundles').findOne({}))!, key = bundle.objects.find(o => o.kind === 'mp4')!.key;
    const original = store.objects.get(key)!; store.objects.set(key, Buffer.from('bad')); await assert.rejects(videos.playback(view.id,null), /temporarily unavailable/); store.objects.set(key,original);
    await assert.rejects(new VideoService(client,name,context,{...store,configHash:'b'.repeat(64)}).get(view.id), /temporarily unavailable/);
    await db.collection<Row>('video_assets').updateOne({videoId: view.id, 'object.kind':'mp4'}, {$set: {lifecycleState: 'deleting',refCount:0}}); await assert.rejects(videos.playback(view.id,null), /temporarily unavailable/);
  });
  test('revocation or deletion during remote retrieval wins before a playback body is returned', async () => {
    const {storage, store, current} = await storageSetup(); await storage.prepare(current._id); await storage.tick();
    const videos = new VideoService(client, name, context, store), id = (await videos.latest(projectId)).video!.id, read = store.read;
    store.read = async function(object) {const data = await read.call(this,object); await db.collection<Row>('memberships').updateOne({userId:testUserId},{$set:{status:'disabled'}}); return data;};
    await assert.rejects(videos.playback(id,null), /team access/);
  });
  test('stored reconciliation is idempotent and needs no local files or additional generation', async () => {
    const {storage, store, current, reader} = await storageSetup(); await storage.prepare(current._id); await storage.tick();
    const original = (await db.collection<ReadyVideo>('ready_videos').findOne({}))!;
    // Simulate a stored bundle from before migration 012, with local files lost.
    await db.collection('ready_videos').deleteMany({}); await db.collection('video_assets').deleteMany({});
    await db.collection<Row>('projects').updateOne({_id:projectId},{$set:{latestReadyVideoId:null,nextVideoVersionNumber:Long.ZERO}});
    await db.collection('activity_events').deleteOne({dedupeKey:`video:${original._id}:ready`});
    reader.read = async () => {throw new Error('local files no longer exist');};
    await Promise.all([promoteStoredVideo(client,name,store,current._id),promoteStoredVideo(client,name,store,current._id)]);
    assert.equal(await db.collection('ready_videos').countDocuments(),1); assert.equal(await db.collection('video_assets').countDocuments(),5);
    const before = (await db.collection<ReadyVideo>('ready_videos').findOne({}))!;
    await promoteStoredVideo(client,name,store,current._id);
    assert.deepEqual(await db.collection<ReadyVideo>('ready_videos').findOne({}),before); assert.equal(engine.renderCalls,1); assert.equal(engine.speechCalls,3);
    assert.equal(await db.collection('activity_events').countDocuments({dedupeKey:`video:${before._id}:ready`}),1);
  });
  test('an older render finishing storage late preserves the newer latest ready video', async () => {
    const {storage,store,current} = await storageSetup(); await storage.prepare(current._id); await storage.tick();
    const videos = new VideoService(client,name,context,store), first = (await videos.latest(projectId)).video!;
    const runId = randomUUID(), approvalId = randomUUID(), artifactId = randomUUID(), versionId = randomUUID();
    const approval = (await db.collection<Row>('approvals').findOne({_id:current.approvalId}))!;
    const artifact = (await db.collection<Row>('generation_local_artifacts').findOne({_id:current.artifactId!}))!;
    const plan = (await db.collection<PlanVersion>('plan_versions').findOne({_id:current.planVersionId}))!;
    await db.collection<PlanVersion>('plan_versions').insertOne({...plan,_id:versionId,versionNumber:Long.fromNumber(2),sourcePlanningRequestId:versionId});
    await db.collection<Row>('approvals').insertOne({...approval,_id:approvalId,planVersionId:versionId});
    await db.collection<Row>('generation_local_artifacts').insertOne({...artifact,_id:artifactId,runId,approvalId});
    await db.collection<GenerationRun>('generation_runs').insertOne({...current,_id:runId,jobId:randomUUID(),approvalId,planVersionId:versionId,artifactId,createdAt:new Date(current.createdAt.getTime()-60000)});
    await storage.prepare(runId); await storage.tick(runId);
    assert.equal((await videos.latest(projectId)).video!.id,first.id); assert.equal(await db.collection('ready_videos').countDocuments(),2);
    const historical = (await db.collection<ReadyVideo>('ready_videos').findOne({runId}))!;
    assert.equal(historical.versionNumber.toNumber(),2); assert.equal((await videos.get(historical._id)).generationRunId,runId);
    const history = await new VideoHistoryService(client,name,context,'test-history-secret').versions(projectId,new URLSearchParams('kind=video'));
    assert.deepEqual(history.items.map(v=>[v.versionNumber,v.isLatest]),[[2,false],[1,true]]);
    assert.equal((await videos.playback(historical._id,null)).status,200);
    assert.equal((await videos.download(historical._id,'srt',null)).status,200);
    assert.equal((await videos.latest(projectId)).video!.id,first.id);
  });
  test('latest-video lookup refuses a pointer to a different project in the same workspace', async () => {
    const {storage,store,current} = await storageSetup(); await storage.prepare(current._id); await storage.tick();
    const videos = new VideoService(client,name,context,store), video = (await videos.latest(projectId)).video!;
    const other = projectFixture(); other.latestReadyVideoId = video.id; await db.collection<Row>('projects').insertOne(other);
    await assert.rejects(videos.latest(other._id),/temporarily unavailable/);
  });
  test('video history is empty for a live draft and denies foreign, disabled and deleted scopes', async () => {
    const history = new VideoHistoryService(client,name,context,'test-history-secret'), query = new URLSearchParams('kind=video');
    assert.deepEqual(await history.versions(projectId,query),{items:[],page:{hasMore:false,nextCursor:null}});
    await assert.rejects(new VideoHistoryService(client,name,{...context,workspaceId:randomUUID()},'test-history-secret').versions(projectId,query));
    await db.collection<Row>('memberships').updateOne({userId:testUserId},{$set:{status:'disabled'}});
    await assert.rejects(history.versions(projectId,query), /team access/);
    await db.collection<Row>('memberships').updateOne({userId:testUserId},{$set:{status:'active'}});
    await db.collection<Row>('projects').updateOne({_id:projectId},{$set:{deletedAt:new Date()}});
    await assert.rejects(history.versions(projectId,query), /could not be found/);
  });
  test('revision review without completed output is read-only and requires fresh current input',async()=>{
    const reviews=new RevisionReviewService(client,name,context),before=await db.collection<Row>('projects').findOne({_id:projectId});
    const result=await reviews.review(planId);assert.equal(result.baseline,null);assert.equal(result.changes,null);assert.equal(result.speechReuse,'verified_clips_only');
    assert.deepEqual(await db.collection<Row>('projects').findOne({_id:projectId}),before);assert.equal(engine.speechCalls,0);
    await db.collection<Row>('projects').updateOne({_id:projectId},{$inc:{briefRevision:Long.ONE}});
    await assert.rejects(reviews.review(planId),/current plan/);
  });
  test('revision review compares edited plan to pinned completed approval and preserves playable old output',async()=>{
    const {storage,store,current}=await storageSetup();await storage.prepare(current._id);await storage.tick();
    const reviews=new RevisionReviewService(client,name,context),original=(await db.collection<ReadyVideo>('ready_videos').findOne({}))!;
    assert.equal((await reviews.review(planId)).changes!.hasChanges,false);
    const project=(await db.collection<Row>('projects').findOne({_id:projectId}))!;
    const body={expectedProjectRevision:project.revision.toNumber(),edits:{narration:[{segmentId:'scene_1',text:'Clouds form above rivers.'}],headings:[{sceneId:'scene_2',text:'River flow'}]}};
    const edited=await new PlanEditService(client,name,context).edit(planId,body,randomUUID());
    const result=await reviews.review(edited.plan.id);assert.equal(result.baseline!.videoId,original._id);assert.equal(result.requiresNewApproval,true);
    assert.deepEqual(result.changes!.scenes.map(s=>[s.sceneId,s.narrationChanged,s.headingChanged]),[['scene_1',true,false],['scene_2',false,true]]);
    assert.equal(result.speechReuse,'verified_clips_only');assert.deepEqual(await db.collection<ReadyVideo>('ready_videos').findOne({_id:original._id}),original);
    const videos=new VideoService(client,name,context,store);assert.equal((await videos.latest(projectId)).video!.id,original._id);
    assert.equal((await videos.download(original._id,'mp4',null)).status,200);assert.equal(engine.speechCalls,3);assert.equal(engine.renderCalls,1);
    await assert.rejects(reviews.review(planId),/current plan/);
  });
  test('revision review refuses inactive or foreign access, active work and deleted projects',async()=>{
    const reviews=new RevisionReviewService(client,name,context);
    await assert.rejects(new RevisionReviewService(client,name,{...context,workspaceId:randomUUID()}).review(planId));
    await db.collection<Row>('memberships').updateOne({userId:testUserId},{$set:{status:'disabled'}});await assert.rejects(reviews.review(planId),/team access/);
    await db.collection<Row>('memberships').updateOne({userId:testUserId},{$set:{status:'active'}});
    await db.collection<Row>('projects').updateOne({_id:projectId},{$set:{latestRunId:randomUUID()}});await assert.rejects(reviews.review(planId),/Finish active work/);
    await db.collection<Row>('projects').updateOne({_id:projectId},{$set:{latestRunId:null,deletedAt:new Date()}});await assert.rejects(reviews.review(planId),/could not be found/);
  });
  test('revision review refuses mismatched completed input and cross-project ready pointers',async()=>{
    const {storage,current}=await storageSetup();await storage.prepare(current._id);await storage.tick();const reviews=new RevisionReviewService(client,name,context);
    await db.collection<Row>('approvals').updateOne({_id:current.approvalId},{$set:{inputCanonical:'{}'}});await assert.rejects(reviews.review(planId),/could not be verified/);
    const other=projectFixture();await db.collection<Row>('projects').insertOne(other);
    await db.collection<Row>('ready_videos').updateOne({runId:current._id},{$set:{projectId:other._id}});await assert.rejects(reviews.review(planId),/could not be verified/);
  });
  test('video history keysets preserve completed versions through concurrent inserts without changing latest', async () => {
    const {storage,store,current} = await storageSetup(); await storage.prepare(current._id); await storage.tick();
    const original = (await db.collection<ReadyVideo>('ready_videos').findOne({}))!, before = await db.collection<Row>('projects').findOne({_id:projectId});
    // Additional isolated metadata fixtures exercise pagination; they never enter the application DB.
    for (let version=2;version<=4;version++) await db.collection<ReadyVideo>('ready_videos').insertOne({...original,_id:randomUUID(),runId:randomUUID(),bundleId:randomUUID(),versionNumber:Long.fromNumber(version)});
    const history = new VideoHistoryService(client,name,context,'test-history-secret'), first = await history.versions(projectId,new URLSearchParams('kind=video&limit=2'));
    assert.deepEqual(first.items.map(v=>v.versionNumber),[4,3]); assert.equal(first.page.hasMore,true);
    await db.collection<ReadyVideo>('ready_videos').insertOne({...original,_id:randomUUID(),runId:randomUUID(),bundleId:randomUUID(),versionNumber:Long.fromNumber(5)});
    const second = await history.versions(projectId,new URLSearchParams({kind:'video',limit:'2',cursor:first.page.nextCursor!}));
    assert.deepEqual(second.items.map(v=>v.versionNumber),[2,1]); assert.equal(second.page.nextCursor,null); assert.equal(second.items[1].isLatest,true);
    assert.deepEqual(await db.collection<Row>('projects').findOne({_id:projectId}),before);
    assert.equal((await history.versions(projectId,new URLSearchParams('kind=video&limit=2'))).items[0].versionNumber,5);
    const serialized = JSON.stringify(first); for (const privateValue of [original.bucket,original.configHash,original.mp4Sha256,'workspaces/','downloadUrls','transcript']) assert.equal(serialized.includes(privateValue),false);
    assert.equal(engine.renderCalls,1); assert.equal(engine.speechCalls,3);
    const other = projectFixture(); await db.collection<Row>('projects').insertOne(other);
    assert.equal((await history.versions(other._id,new URLSearchParams('kind=video'))).items.length,0);
    await assert.rejects(history.versions(other._id,new URLSearchParams({kind:'video',limit:'2',cursor:first.page.nextCursor!})), /expired or changed/);
  });
});
