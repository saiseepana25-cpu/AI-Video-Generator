import {Long,type ClientSession,type Db,type MongoClient} from 'mongodb';
import {isDeepStrictEqual} from 'node:util';
import {databaseTransaction} from '../db/transactions';
import {requireProjectId} from '../projects/contracts';
import type {ProjectRecord} from '../projects/service';
import {inspectDeletionWork} from '../projects/deletion-work';
import type {GenerationRun,LocalArtifact} from '../generation/contracts';
import type {StorageBundle} from '../storage/contracts';
import {storageKinds,storageFiles} from '../storage/contracts';
import type {ReadyVideo,VideoAsset} from '../videos/contracts';
import type {CleanupTask} from './contracts';
import {CleanupFault} from './contracts';
import type {LocalTask,LocalFileCleaner,LocalStatus,LocalSource} from './local-contracts';
const fault=()=>new CleanupFault('LOCAL_CLEANUP_OWNERSHIP_UNAVAILABLE');
const advance=(n:Long)=>{if(!Long.isLong(n)||n.isNegative()||n.greaterThanOrEqual(Long.fromNumber(Number.MAX_SAFE_INTEGER)))throw fault();return n.add(Long.ONE);};
export async function localRenderStatus(db:Db,workspaceId:string,projectId:string):Promise<LocalStatus>{
  const scope={workspaceId,projectId},totalArtifacts=await db.collection('generation_runs').countDocuments({...scope,state:'rendered_local',artifactId:{$type:'string'}}),cleanedArtifacts=await db.collection('local_render_cleanup_tasks').countDocuments({...scope,state:'cleaned'});
  const retry=await db.collection('local_render_cleanup_tasks').findOne({...scope,state:'retry'},{projection:{_id:1}}),pending=await db.collection('local_render_cleanup_tasks').findOne({...scope,state:'pending'},{projection:{_id:1}});
  return {state:!totalArtifacts?'no_completed_artifacts':cleanedArtifacts===totalArtifacts?'known_files_removed':retry?'retry_required':pending?'pending':cleanedArtifacts?'partial':'not_started',totalArtifacts,cleanedArtifacts,retainedContent:true};
}
/** Explicit operator command only. Speech/reuse records and scratch files are retained. */
export class LocalCleanupService{
  constructor(private client:MongoClient,private name:string,private files:LocalFileCleaner){}
  private get db(){return this.client.db(this.name);}
  static async proof(db:Db,session:ClientSession,runId:string){
    const run=await db.collection<GenerationRun>('generation_runs').findOne({_id:runId,state:'rendered_local'},{session});
    if(!run?.artifactId||run.owner!==null||run.leaseUntil!==null||!(run.finishedAt instanceof Date))throw fault();
    const project=await db.collection<ProjectRecord>('projects').findOne({_id:run.projectId,workspaceId:run.workspaceId,deletedAt:{$type:'date'}},{session});if(!project?.deletionReceipt)throw fault();
    const work=await inspectDeletionWork(db,session,project);if(!work.impact.canDelete||work.planning.length||work.generation.length)throw fault();
    const artifact=await db.collection<LocalArtifact>('generation_local_artifacts').findOne({_id:run.artifactId,runId,workspaceId:run.workspaceId,approvalId:run.approvalId,inputHash:run.inputHash,rendererBuildHash:run.rendererBuildHash},{session});
    const bundle=await db.collection<StorageBundle>('generation_storage_bundles').findOne({_id:run.artifactId,artifactId:run.artifactId,runId,workspaceId:run.workspaceId,projectId:run.projectId,approvalId:run.approvalId,inputHash:run.inputHash,rendererBuildHash:run.rendererBuildHash,state:'stored'},{session});
    const video=await db.collection<ReadyVideo>('ready_videos').findOne({_id:run.artifactId,bundleId:run.artifactId,runId,workspaceId:run.workspaceId,projectId:run.projectId},{session});
    if(!artifact||!bundle||!video||artifact.manifestHash!==bundle.manifestHash||bundle.objects.length!==5||new Set(bundle.objects.map(o=>o.kind)).size!==5||await db.collection('publishing_payloads').findOne({},{session,projection:{_id:1}}))throw fault();
    for(const kind of storageKinds){
      const object=bundle.objects.find(o=>o.kind===kind),spec=storageFiles[kind],assetId=video.assets[kind];
      if(!object||object.key!==`workspaces/${run.workspaceId}/projects/${run.projectId}/runs/${runId}/bundles/${run.artifactId}/${spec.name}`||object.mime!==spec.mime||!Number.isSafeInteger(object.size)||object.size<1||object.size>spec.max||!/^[a-f0-9]{64}$/.test(object.sha256))throw fault();
      const asset=await db.collection<VideoAsset>('video_assets').findOne({_id:assetId,workspaceId:run.workspaceId,projectId:run.projectId,videoId:video._id,bundleId:bundle._id,lifecycleState:'deleted',refCount:0,bucket:bundle.bucket,configHash:bundle.configHash},{session});
      const task=await db.collection<CleanupTask>('media_cleanup_tasks').findOne({_id:assetId,workspaceId:run.workspaceId,projectId:run.projectId,videoId:video._id,bundleId:bundle._id,state:'deleted',bucket:bundle.bucket,configHash:bundle.configHash},{session});
      if(!asset||!task||!isDeepStrictEqual(asset.object,object)||!isDeepStrictEqual(task.object,object)||await db.collection('asset_refs').findOne({assetId},{session,projection:{_id:1}}))throw fault();
    }
    const source:LocalSource={runId,artifactId:artifact._id,manifestHash:artifact.manifestHash,inputHash:artifact.inputHash,rendererBuildHash:artifact.rendererBuildHash,objects:bundle.objects};return {project,source};
  }
  private async fence(db:Db,session:ClientSession,project:ProjectRecord){advance(project.guardRevision);if(!(await db.collection<ProjectRecord>('projects').updateOne({_id:project._id,workspaceId:project.workspaceId,deletedAt:project.deletedAt,guardRevision:project.guardRevision},{$inc:{guardRevision:Long.ONE}},{session})).matchedCount)throw fault();}
  async clean(runId:string){
    requireProjectId(runId);
    const initial=await databaseTransaction(this.client,this.name,async(db,session)=>{const proof=await LocalCleanupService.proof(db,session,runId),prior=await db.collection<LocalTask>('local_render_cleanup_tasks').findOne({_id:proof.source.artifactId},{session});return {...proof,prior};});
    const {source,project,prior}=initial;
    if(prior&&(prior.rootHash!==this.files.rootHash||prior.runId!==runId||prior.workspaceId!==project.workspaceId||prior.projectId!==project._id||!isDeepStrictEqual(prior.source,source)))throw fault();
    if(prior?.state==='cleaned')return false;
    const inventory=prior?.files??await this.files.inspect(source);
    const task=await databaseTransaction(this.client,this.name,async(db,session)=>{
      const current=await LocalCleanupService.proof(db,session,runId);if(!isDeepStrictEqual(current.source,source))throw fault();
      const old=await db.collection<LocalTask>('local_render_cleanup_tasks').findOne({_id:source.artifactId},{session});
      if(old&&(old.rootHash!==this.files.rootHash||!isDeepStrictEqual(old.source,source)||!isDeepStrictEqual(old.files,inventory)||old.workspaceId!==project.workspaceId||old.projectId!==project._id))throw fault();
      if(old?.state==='cleaned')return null;
      const now=new Date(),task:LocalTask={_id:source.artifactId,workspaceId:project.workspaceId,projectId:project._id,runId,rootHash:this.files.rootHash,source,files:inventory,state:'pending',revision:old?advance(old.revision):Long.ONE,attempts:old?advance(old.attempts):Long.ONE,error:null,createdAt:old?.createdAt??now,updatedAt:now,cleanedAt:null};
      await this.fence(db,session,current.project);
      if(old){if(!(await db.collection<LocalTask>('local_render_cleanup_tasks').replaceOne({_id:old._id,revision:old.revision},task,{session})).matchedCount)throw fault();}else await db.collection<LocalTask>('local_render_cleanup_tasks').insertOne(task,{session});return task;
    });if(!task)return false;
    try{await this.files.remove(task.source,task.files);}catch{await this.db.collection<LocalTask>('local_render_cleanup_tasks').updateOne({_id:task._id,state:'pending',revision:task.revision},{$set:{state:'retry',error:'LOCAL_REMOVAL_FAILED',updatedAt:new Date()}});throw new CleanupFault('LOCAL_REMOVAL_FAILED');}
    return databaseTransaction(this.client,this.name,async(db,session)=>{const proof=await LocalCleanupService.proof(db,session,runId);if(!isDeepStrictEqual(proof.source,task.source))throw fault();const current=await db.collection<LocalTask>('local_render_cleanup_tasks').findOne({_id:task._id,revision:task.revision,state:'pending'},{session});if(!current)return false;if(!isDeepStrictEqual(current,task))throw fault();await this.fence(db,session,proof.project);const now=new Date();return !!(await db.collection<LocalTask>('local_render_cleanup_tasks').updateOne({_id:task._id,revision:task.revision,state:'pending'},{$set:{state:'cleaned',cleanedAt:now,updatedAt:now,error:null}},{session})).matchedCount;});
  }
  async next(projectId:string){requireProjectId(projectId);const [run]=await this.db.collection<GenerationRun>('generation_runs').aggregate<GenerationRun>([{$match:{projectId,state:'rendered_local',artifactId:{$type:'string'}}},{$lookup:{from:'local_render_cleanup_tasks',localField:'artifactId',foreignField:'_id',as:'task'}},{$match:{'task.0.state':{$ne:'cleaned'}}},{$sort:{createdAt:1,_id:1}},{$limit:1}]).toArray();if(!run)return false;await this.clean(run._id);return true;}
}
