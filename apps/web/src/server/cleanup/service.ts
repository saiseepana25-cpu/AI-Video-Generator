import {Long,type ClientSession,type Db,type MongoClient} from 'mongodb';
import {isDeepStrictEqual} from 'node:util';
import {databaseTransaction} from '../db/transactions';
import {requireProjectId} from '../projects/contracts';
import type {ProjectRecord} from '../projects/service';
import {inspectDeletionWork} from '../projects/deletion-work';
import type {VideoAsset,ReadyVideo} from '../videos/contracts';
import {storageFiles,storageKinds,type StorageBundle} from '../storage/contracts';
import type {GenerationRun} from '../generation/contracts';
import {CleanupFault,type CleanupStore,type CleanupTask,type MediaCleanupStatus} from './contracts';
const fault=()=>new CleanupFault('CLEANUP_OWNERSHIP_UNAVAILABLE');
const advance=(value:Long)=>{if(!Long.isLong(value)||value.isNegative()||value.greaterThanOrEqual(Long.fromNumber(Number.MAX_SAFE_INTEGER)))throw fault();return value.add(Long.ONE);};
export async function mediaCleanupStatus(db:Db,workspaceId:string,projectId:string):Promise<MediaCleanupStatus>{
  const scope={workspaceId,projectId},totalAssets=await db.collection('video_assets').countDocuments(scope),deletedAssets=await db.collection('video_assets').countDocuments({...scope,lifecycleState:'deleted',refCount:0});
  const retry=await db.collection('media_cleanup_tasks').findOne({...scope,state:'retry'},{projection:{_id:1}}),pending=await db.collection('media_cleanup_tasks').findOne({...scope,state:'pending'},{projection:{_id:1}});
  return {state:totalAssets===0?'no_ready_media':deletedAssets===totalAssets?'ready_media_removed':retry?'retry_required':pending?'pending':deletedAssets?'partial':'not_started',totalAssets,deletedAssets,retainedContent:true};
}
/** Operator-local deterministic object cleanup. No provider calls or local file deletion. */
export class MediaCleanupService{
  private busy=false;
  private skipped=new Map<string,number>();
  constructor(private client:MongoClient,private name:string,private store:CleanupStore){}
  private get db(){return this.client.db(this.name);}
  private async proof(db:Db,session:ClientSession,asset:VideoAsset){
    if(asset.configHash!==this.store.configHash||asset.bucket!==this.store.bucket)throw fault();
    const project=await db.collection<ProjectRecord>('projects').findOne({_id:asset.projectId,workspaceId:asset.workspaceId,deletedAt:{$ne:null}},{session});
    if(!project?.deletionReceipt)throw fault();
    const work=await inspectDeletionWork(db,session,project);if(!work.impact.canDelete||work.planning.length||work.generation.length)throw fault();
    const video=await db.collection<ReadyVideo>('ready_videos').findOne({_id:asset.videoId,workspaceId:asset.workspaceId,projectId:asset.projectId,bundleId:asset.bundleId},{session});
    const bundle=await db.collection<StorageBundle>('generation_storage_bundles').findOne({_id:asset.bundleId,workspaceId:asset.workspaceId,projectId:asset.projectId,state:'stored',configHash:asset.configHash,bucket:asset.bucket},{session});
    if(!video||!bundle||video.bundleId!==bundle._id||video.runId!==bundle.runId||video.configHash!==asset.configHash||video.bucket!==asset.bucket||bundle.artifactId!==bundle._id||video.assets[asset.object.kind]!==asset._id)throw fault();
    const run=await db.collection<GenerationRun>('generation_runs').findOne({_id:bundle.runId,workspaceId:asset.workspaceId,projectId:asset.projectId,state:'rendered_local',artifactId:bundle.artifactId,approvalId:bundle.approvalId,inputHash:bundle.inputHash},{session});
    const kind=asset.object.kind,file=storageFiles[kind];
    const expected=`workspaces/${asset.workspaceId}/projects/${asset.projectId}/runs/${bundle.runId}/bundles/${bundle.artifactId}/${file?.name}`;
    if(!run||!file||asset.object.key!==expected||asset.object.mime!==file.mime||asset.object.size<1||asset.object.size>file.max||!Number.isSafeInteger(asset.object.size)||!/^[a-f0-9]{64}$/.test(asset.object.sha256)||bundle.objects.length!==5||new Set(bundle.objects.map(o=>o.kind)).size!==5||!isDeepStrictEqual(bundle.objects.find(o=>o.kind===kind),asset.object))throw fault();
    // Sole implemented owner is this immutable ready video. Unknown/future
    // ownership/publication is retained until its lifecycle is integrated.
    if(await db.collection<ReadyVideo>('ready_videos').findOne({_id:{$ne:video._id},$or:storageKinds.map(k=>({[`assets.${k}`]:asset._id}))},{session,projection:{_id:1}})
      ||await db.collection<VideoAsset>('video_assets').findOne({_id:{$ne:asset._id},bucket:asset.bucket,'object.key':asset.object.key},{session,projection:{_id:1}})
      ||await db.collection('asset_refs').findOne({assetId:asset._id},{session,projection:{_id:1}})
      ||await db.collection('publishing_payloads').findOne({},{session,projection:{_id:1}}))throw fault();
    return project;
  }
  private async checkpoint(id:string){
    return databaseTransaction(this.client,this.name,async(db,session)=>{
      const asset=await db.collection<VideoAsset>('video_assets').findOne({_id:id},{session});if(!asset)throw fault();
      const prior=await db.collection<CleanupTask>('media_cleanup_tasks').findOne({_id:id},{session});
      if(asset.lifecycleState==='deleted'){if(prior?.state!=='deleted')throw fault();return null;}
      const project=await this.proof(db,session,asset);
      if(!['available','unavailable','deleting'].includes(asset.lifecycleState)||asset.refCount!==(asset.lifecycleState==='deleting'?0:1))throw fault();
      if(prior&&(prior.workspaceId!==asset.workspaceId||prior.projectId!==asset.projectId||prior.videoId!==asset.videoId||prior.bundleId!==asset.bundleId||prior.configHash!==asset.configHash||prior.bucket!==asset.bucket||!isDeepStrictEqual(prior.object,asset.object)||prior.state==='deleted'||!prior.referenceRevision.equals(asset.referenceRevision)))throw fault();
      if(asset.lifecycleState==='deleting'&&!prior)throw fault();
      const now=new Date(),referenceRevision=advance(asset.referenceRevision),task:CleanupTask={_id:id,workspaceId:asset.workspaceId,projectId:asset.projectId,videoId:asset.videoId,bundleId:asset.bundleId,configHash:asset.configHash,bucket:asset.bucket,object:asset.object,referenceRevision,attempts:prior?advance(prior.attempts):Long.ONE,state:'pending',error:null,createdAt:prior?.createdAt??now,updatedAt:now,deletedAt:null,nextAttemptAt:now};
      if(!(await db.collection<VideoAsset>('video_assets').updateOne({_id:id,referenceRevision:asset.referenceRevision,lifecycleState:asset.lifecycleState,refCount:asset.refCount},{$set:{lifecycleState:'deleting',refCount:0,referenceRevision}},{session})).matchedCount)throw fault();
      advance(project.guardRevision);if(!(await db.collection<ProjectRecord>('projects').updateOne({_id:project._id,workspaceId:project.workspaceId,deletedAt:project.deletedAt,guardRevision:project.guardRevision},{$inc:{guardRevision:Long.ONE}},{session})).matchedCount)throw fault();
      if(prior){if(!(await db.collection<CleanupTask>('media_cleanup_tasks').replaceOne({_id:id,referenceRevision:prior.referenceRevision},task,{session})).matchedCount)throw fault();}else await db.collection<CleanupTask>('media_cleanup_tasks').insertOne(task,{session});
      return task;
    });
  }
  async clean(id:string){
    requireProjectId(id);const task=await this.checkpoint(id);if(!task)return false;
    try{await this.store.remove(task.object);}catch{
      await this.db.collection<CleanupTask>('media_cleanup_tasks').updateOne({_id:id,state:'pending',referenceRevision:task.referenceRevision},{$set:{state:'retry',error:'OBJECT_REMOVAL_FAILED',updatedAt:new Date(),nextAttemptAt:new Date(Date.now()+60000)}});
      throw new CleanupFault('OBJECT_REMOVAL_FAILED');
    }
    return databaseTransaction(this.client,this.name,async(db,session)=>{
      const asset=await db.collection<VideoAsset>('video_assets').findOne({_id:id,lifecycleState:'deleting',refCount:0,referenceRevision:task.referenceRevision},{session});
      const current=await db.collection<CleanupTask>('media_cleanup_tasks').findOne({_id:id,state:'pending',referenceRevision:task.referenceRevision},{session});if(!asset||!current)return false;
      if(!isDeepStrictEqual(asset.object,task.object)||!isDeepStrictEqual(current.object,task.object)||asset.videoId!==task.videoId||asset.bundleId!==task.bundleId||asset.workspaceId!==task.workspaceId||asset.projectId!==task.projectId)throw fault();
      const project=await this.proof(db,session,asset);advance(project.guardRevision);
      if(!(await db.collection<ProjectRecord>('projects').updateOne({_id:project._id,workspaceId:project.workspaceId,deletedAt:project.deletedAt,guardRevision:project.guardRevision},{$inc:{guardRevision:Long.ONE}},{session})).matchedCount)throw fault();
      const now=new Date();if(!(await db.collection<VideoAsset>('video_assets').updateOne({_id:id,referenceRevision:task.referenceRevision,lifecycleState:'deleting',refCount:0},{$set:{lifecycleState:'deleted',referenceRevision:advance(asset.referenceRevision)}},{session})).matchedCount)throw fault();
      if(!(await db.collection<CleanupTask>('media_cleanup_tasks').updateOne({_id:id,state:'pending',referenceRevision:task.referenceRevision},{$set:{state:'deleted',deletedAt:now,updatedAt:now,error:null}},{session})).matchedCount)throw fault();return true;
    });
  }
  async next(projectId?:string){
    if(this.busy)return false;this.busy=true;
    try{
      if(projectId)requireProjectId(projectId);
      for(const [id,until] of this.skipped)if(until<=Date.now())this.skipped.delete(id);
      const [candidate]=await this.db.collection<VideoAsset>('video_assets').aggregate<VideoAsset>([
        {$match:{_id:{$nin:[...this.skipped.keys()]},...(projectId?{projectId}:{}),configHash:this.store.configHash,bucket:this.store.bucket,lifecycleState:{$in:['available','unavailable','deleting']}}},
        {$lookup:{from:'projects',localField:'projectId',foreignField:'_id',as:'project'}},{$match:{'project.0.deletedAt':{$type:'date'}}},
        {$lookup:{from:'media_cleanup_tasks',localField:'_id',foreignField:'_id',as:'task'}},{$match:{$or:[{'task.0':{$exists:false}},{'task.0.nextAttemptAt':{$lte:new Date()}}]}},{$sort:{createdAt:1,_id:1}},{$limit:1},
      ]).toArray();if(!candidate)return false;try{await this.clean(candidate._id);}catch(error){if(this.skipped.size>=1000)this.skipped.delete(this.skipped.keys().next().value!);this.skipped.set(candidate._id,Date.now()+60000);throw error;}return true;
    }finally{this.busy=false;}
  }
}
