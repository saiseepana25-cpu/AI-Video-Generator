import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {Long,type MongoClient,type Db,type ClientSession} from 'mongodb';
import {databaseTransaction} from '../db/transactions';
import type {GenerationRun} from './contracts';
import {GenerationFault} from './engine';
import {executorLocation,type Execution} from './executor-contracts';
import {WindowsExecutor,inspectWindowsExecutor,type ExecutorIdentity} from '../../../../../src/pipeline/windows-executor';
import {ExecutorStopUnconfirmed} from '../../../../../src/pipeline/executor-stop';
const fault=()=>new GenerationFault('EXECUTOR_STOP_UNCONFIRMED',true);
type Handle={prepared:Promise<void>;stopped:Promise<number>;admit():void;cancel():void};
export type ExecutorHost={start(identity:ExecutorIdentity):Handle;inspect(identity:ExecutorIdentity,terminate:boolean):Promise<boolean>};
const windowsHost:ExecutorHost={start:identity=>new WindowsExecutor(identity),inspect:inspectWindowsExecutor};
export class DatabaseExecutor {
  private location:ReturnType<typeof executorLocation>;
  constructor(private client:MongoClient,private name:string,private root:string,private owner:string,private host:ExecutorHost=windowsHost){this.root=path.resolve(root);this.location=executorLocation(this.root);}
  private identity(row:Execution){if(row.protocol!=='windows-job-v1'||row.hostHash!==this.location.hostHash||row.rootHash!==this.location.rootHash||row.jobName!==`Local\\VideoCraft_${row._id.replaceAll('-','')}`)throw fault();return {id:row._id.replaceAll('-',''),root:this.root,jobName:row.jobName};}
  private async owned(db:Db,session:ClientSession,runId:string,stage:Execution['stage']){
    const run=await db.collection<GenerationRun>('generation_runs').findOne({_id:runId,owner:this.owner,state:'running',leaseUntil:{$gt:new Date()},stage:stage==='preflight'?'validating':'rendering'},{session});
    if(!run?.leaseEpoch)throw new GenerationFault('WORKER_OWNERSHIP_LOST');
    if(!(await db.collection<GenerationRun>('generation_runs').updateOne({_id:runId,owner:this.owner,leaseEpoch:run.leaseEpoch,leaseUntil:run.leaseUntil},{$inc:{statusRevision:Long.ONE}},{session})).matchedCount)throw fault();
    return run;
  }
  private async stopped(row:Execution,code:number,reason:Execution['stopReason']){
    return databaseTransaction(this.client,this.name,async(db,session)=>{
      const current=await db.collection<Execution>('generation_executors').findOne({_id:row._id},{session});if(!current)throw fault();this.identity(current);
      if(current.runId!==row.runId||current.owner!==row.owner||!current.leaseEpoch.equals(row.leaseEpoch)||current.inputHash!==row.inputHash)throw fault();
      if(current.state==='stopped')return;
      if(!(await db.collection<Execution>('generation_executors').updateOne({_id:row._id,revision:current.revision,state:current.state},{$set:{state:'stopped',exitCode:code,stopReason:reason,stoppedAt:new Date(),updatedAt:new Date()},$inc:{revision:Long.ONE}},{session})).matchedCount)throw fault();
    });
  }
  async execute(runId:string,stage:Execution['stage'],input:Record<string,unknown>,signal:AbortSignal,prepare?:(folder:string)=>Promise<void>){
    signal.throwIfAborted();
    const row=await databaseTransaction(this.client,this.name,async(db,session)=>{
      const run=await this.owned(db,session,runId,stage);if(input.hash!==run.inputHash)throw fault();
      const id=randomUUID(),now=new Date();const row:Execution={_id:id,workspaceId:run.workspaceId,projectId:run.projectId,runId,inputHash:run.inputHash,rendererBuildHash:run.rendererBuildHash,...this.location,
        owner:this.owner,leaseEpoch:run.leaseEpoch!,stage,artifactId:stage==='render'?randomUUID():null,jobName:`Local\\VideoCraft_${id.replaceAll('-','')}`,protocol:'windows-job-v1',state:'prepared',revision:Long.ONE,createdAt:now,updatedAt:now,stoppedAt:null,exitCode:null,stopReason:null};
      await db.collection<Execution>('generation_executors').insertOne(row,{session});return row;
    });
    const identity=this.identity(row),folder=path.join(this.root,'.cache','executors',identity.id);let handle:Handle|undefined;
    const abort=()=>handle?.cancel();
    try{
      await fs.mkdir(folder,{recursive:true});if(await fs.realpath(this.root)!==this.root||await fs.realpath(folder)!==folder)throw fault();
      await prepare?.(folder);
      await fs.writeFile(path.join(folder,'input.json'),JSON.stringify({...input,protocol:row.protocol,kind:stage,runId,artifactId:row.artifactId}),{flag:'wx'});
      signal.throwIfAborted();handle=this.host.start(identity);signal.addEventListener('abort',abort,{once:true});
      await handle.prepared;
      if(signal.aborted){handle.cancel();}else{
        await databaseTransaction(this.client,this.name,async(db,session)=>{
          const run=await this.owned(db,session,runId,stage);if(!run.leaseEpoch!.equals(row.leaseEpoch))throw fault();
          if(!(await db.collection<Execution>('generation_executors').updateOne({_id:row._id,state:'prepared',revision:Long.ONE},{$set:{state:'running',updatedAt:new Date()},$inc:{revision:Long.ONE}},{session})).matchedCount)throw fault();
        });
        if(signal.aborted)handle.cancel();else handle.admit();
      }
      const code=await handle.stopped;if(!await this.host.inspect(identity,false))throw fault();
      await this.stopped(row,code,signal.aborted?'cancelled':'completed');
      signal.throwIfAborted();
      let result:any;try{const stat=await fs.lstat(path.join(folder,'result.json'));if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>1048576)throw fault();result=JSON.parse(await fs.readFile(path.join(folder,'result.json'),'utf8'));}catch{throw new GenerationFault('LOCAL_EXECUTOR_FAILED');}
      if(!result.ok||code!==0)throw new GenerationFault(['TEXT_LAYOUT_EXCEEDED','NARRATION_TOO_SHORT','NARRATION_DURATION_EXCEEDED'].includes(result.code)?result.code:'LOCAL_EXECUTOR_FAILED');
      if(result.result?.rendererBuildHash!==row.rendererBuildHash||stage==='render'&&(result.result?.folder!==path.join(this.root,'output','dashboard-renders',runId,row.artifactId!)||!/^[a-f0-9]{64}$/.test(result.result?.manifestHash??'')))throw new GenerationFault('LOCAL_EXECUTOR_FAILED');
      return result.result;
    }catch(error){
      handle?.cancel();
      // A failed transport/admission/DB write cannot silently release a Job.
      try{if(await this.host.inspect(identity,true))await this.stopped(row,130,'cancelled');else throw fault();}catch{throw fault();}
      if(error instanceof ExecutorStopUnconfirmed)throw fault();throw error;
    }finally{signal.removeEventListener('abort',abort);}
  }
  async recover(runId:string){
    const rows=await databaseTransaction(this.client,this.name,async(db,session)=>{
      const run=await db.collection<GenerationRun>('generation_runs').findOne({_id:runId,state:{$in:['running','cancellation_requested']},stage:{$in:['validating','rendering']},leaseUntil:{$lte:new Date()}},{session});if(!run)return null;
      const rows=await db.collection<Execution>('generation_executors').find({runId},{session}).limit(3).toArray();
      if(!rows.length||rows.length>2||!rows.some(row=>row.stage===(run.stage==='validating'?'preflight':'render')))return null;
      for(const row of rows){this.identity(row);if(row.workspaceId!==run.workspaceId||row.projectId!==run.projectId||row.inputHash!==run.inputHash||row.rendererBuildHash!==run.rendererBuildHash||row.owner!==run.owner||!row.leaseEpoch.equals(run.leaseEpoch!))throw fault();}
      // Write contention fences a concurrent old heartbeat/admission. Once
      // recovering, a suspended child can never receive durable permission.
      if(!(await db.collection<GenerationRun>('generation_runs').updateOne({_id:runId,owner:run.owner,leaseEpoch:run.leaseEpoch,leaseUntil:run.leaseUntil},{$inc:{statusRevision:Long.ONE}},{session})).matchedCount)throw fault();
      for(const row of rows)if(row.state!=='stopped')await db.collection<Execution>('generation_executors').updateOne({_id:row._id,revision:row.revision},{$set:{state:'recovering',updatedAt:new Date()},$inc:{revision:Long.ONE}},{session});
      return rows;
    });
    if(!rows)return false;
    for(const row of rows){try{if(!await this.host.inspect(this.identity(row),true))throw fault();}catch{throw fault();}await this.stopped(row,130,'recovered');}
    return true;
  }
}
