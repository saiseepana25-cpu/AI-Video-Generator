import {randomUUID} from 'node:crypto';
import {Long,type MongoClient,type Db,type ClientSession} from 'mongodb';
import {databaseTransaction} from '../db/transactions';
import {ProjectError,requireProjectId,type ProjectContext} from '../projects/contracts';
import type {Row} from '../planning/service';
import {digest} from '../providers/config';
import {parseLogoFile,type LogoFile,type LogoObject,type LogoStore,type LogoView} from './contracts';
import {canonicalLogo,InvalidLogo,logoHash} from './image';
const busy=()=>new ProjectError('UPLOAD_BUSY',409,'This upload is still being checked. Check its status before retrying.');
const unavailable=()=>new ProjectError('LOGO_STORAGE_UNAVAILABLE',503,'The upload is unconfirmed. Check its status, then retry the same file.',[],true);
const previewUnavailable=()=>new ProjectError('LOGO_PREVIEW_UNAVAILABLE',503,'The prepared logo could not be verified. Ask the operator to check storage or prepare a replacement.',[],true);
export class LogoService{
  constructor(private client:MongoClient,private name:string,private context:ProjectContext,private makeStore:()=>LogoStore){}
  private tx<T>(work:(db:Db,session:ClientSession)=>Promise<T>){return databaseTransaction(this.client,this.name,work);}
  private async authorize(db:Db,session:ClientSession,fence=false){
    const query={workspaceId:this.context.workspaceId,userId:this.context.userId,status:'active'};
    const allowed=fence?(await db.collection('memberships').updateOne(query,{$inc:{generationGuardRevision:Long.ONE}},{session})).matchedCount:await db.collection('memberships').findOne(query,{session});
    if(!allowed)throw new ProjectError('TEAM_ACCESS_DENIED',403,'This account does not have team access.');
    if(!await db.collection<Row>('workspaces').findOne({_id:this.context.workspaceId},{session}))throw new ProjectError('RESOURCE_NOT_FOUND',404,'This workspace could not be found.');
  }
  private query(id:string){return {_id:id,workspaceId:this.context.workspaceId,userId:this.context.userId};}
  private view(row:Row):LogoView{
    const expired=!['ready','rejected'].includes(row.state)&&row.expiresAt<=new Date();
    return {id:row._id,state:expired?'expired':row.state,filename:row.file.filename,expiresAt:row.expiresAt.toISOString(),retryAfterSeconds:row.state==='validating'&&!expired?Math.max(0,Math.ceil(((row.leaseUntil?.getTime()??0)-Date.now())/1000)):0,assetId:row.state==='ready'?row.assetId:null,previewUrl:row.state==='ready'?`/api/v1/workspace/logo-assets/${row.assetId}`:null,error:row.error};
  }
  async get(id:string){requireProjectId(id);return this.tx(async(db,s)=>{await this.authorize(db,s);const row=await db.collection<Row>('logo_uploads').findOne(this.query(id),{session:s});if(!row)throw new ProjectError('RESOURCE_NOT_FOUND',404,'This upload could not be found.');return this.view(row);});}
  private async owned(db:Db,s:ClientSession,id:string,owner:string,epoch:Long){
    await this.authorize(db,s,true);const now=new Date();
    const row=await db.collection<Row>('logo_uploads').findOneAndUpdate({...this.query(id),state:'validating',owner,epoch,leaseUntil:{$gt:now},expiresAt:{$gt:now}},{$set:{updatedAt:now}},{session:s,returnDocument:'after'});
    if(!row)throw busy();return row;
  }
  async put(id:string,raw:unknown,bytes:Buffer){
    requireProjectId(id);const file=parseLogoFile(raw);
    if(bytes.length!==file.sizeBytes||logoHash(bytes)!==file.sha256)throw new ProjectError('UPLOAD_BYTES_MISMATCH',422,'Reselect the original file; its size and checksum must match.');
    const requestHash=digest(JSON.stringify(file)),owner=randomUUID(),assetId=randomUUID(),now=new Date();
    const claimed=await this.tx(async(db,s)=>{
      await this.authorize(db,s);const collection=db.collection<Row>('logo_uploads'),row=await collection.findOne({_id:id},{session:s});
      if(row&&(row.workspaceId!==this.context.workspaceId||row.userId!==this.context.userId))throw new ProjectError('RESOURCE_NOT_FOUND',404,'This upload could not be found.');
      if(row&&row.requestHash!==requestHash)throw new ProjectError('IDEMPOTENCY_MISMATCH',409,'This upload ID belongs to a different file.');
      if(row&&['ready','rejected','expired'].includes(row.state))return {row,terminal:true};
      if(row&&row.expiresAt<=now){await this.authorize(db,s,true);await collection.updateOne(this.query(id),{$set:{state:'expired',owner:null,leaseUntil:null,updatedAt:now}},{session:s});return {row:{...row,state:'expired'},terminal:true};}
      if(row&&row.leaseUntil>now)throw busy();
      const epoch=row?row.epoch.add(Long.ONE):Long.ONE;
      if(epoch.greaterThan(Long.fromNumber(Number.MAX_SAFE_INTEGER)))throw busy();
      await this.authorize(db,s,true);
      const next:Row=row?{...row,owner,epoch,leaseUntil:new Date(now.getTime()+90000),updatedAt:now}:{_id:id,schemaVersion:1,workspaceId:this.context.workspaceId,userId:this.context.userId,file,requestHash,assetId,state:'validating',owner,epoch,leaseUntil:new Date(now.getTime()+90000),object:null,error:null,createdAt:now,updatedAt:now,expiresAt:new Date(now.getTime()+15*60000)};
      if(row)await collection.replaceOne({...this.query(id),epoch:row.epoch},next,{session:s});else await collection.insertOne(next,{session:s});
      return {row:next,terminal:false};
    });
    if(claimed.terminal)return this.view(claimed.row);
    const epoch=claimed.row.epoch as Long;let store:LogoStore|undefined;
    try{
      let canonical;
      try{canonical=await canonicalLogo(bytes,file);}catch(error){if(!(error instanceof InvalidLogo))throw error;
        return await this.tx(async(db,s)=>{const row=await this.owned(db,s,id,owner,epoch);const next={...row,state:'rejected',owner:null,leaseUntil:null,error:error.message,updatedAt:new Date()};await db.collection<Row>('logo_uploads').replaceOne(this.query(id),next,{session:s});return this.view(next);});}
      store=this.makeStore();
      const object:LogoObject={key:`workspaces/${this.context.workspaceId}/logos/${id}/${claimed.row.assetId}.png`,sha256:canonical.sha256,size:canonical.bytes.length,width:canonical.width,height:canonical.height,configHash:store.configHash,bucket:store.bucket};
      await this.tx(async(db,s)=>{const row=await this.owned(db,s,id,owner,epoch);if(row.object&&JSON.stringify(row.object)!==JSON.stringify(object))throw new ProjectError('LOGO_SOURCE_CHANGED',409,'The upload destination or decoder changed. Ask the operator to check this upload.');await db.collection<Row>('logo_uploads').updateOne(this.query(id),{$set:{object}},{session:s});});
      await store.ensure(object,canonical.bytes);
      return await this.tx(async(db,s)=>{const row=await this.owned(db,s,id,owner,epoch),createdAt=new Date();await db.collection<Row>('logo_assets').insertOne({_id:row.assetId,schemaVersion:1,workspaceId:this.context.workspaceId,uploadId:id,createdBy:this.context.userId,object,lifecycleState:'available',referenceRevision:Long.ONE,refCount:1,createdAt},{session:s});const next={...row,state:'ready',owner:null,leaseUntil:null,error:null,updatedAt:createdAt};await db.collection<Row>('logo_uploads').replaceOne(this.query(id),next,{session:s});return this.view(next);});
    }catch(error){
      await this.client.db(this.name).collection<Row>('logo_uploads').updateOne({...this.query(id),owner,epoch,state:'validating'},{$set:{leaseUntil:new Date(0)}}).catch(()=>{});
      if(error instanceof ProjectError)throw error;throw unavailable();
    }finally{store?.close();}
  }
  async preview(id:string){
    requireProjectId(id);
    const resolve=()=>this.tx(async(db,s)=>{await this.authorize(db,s);const row=await db.collection<Row>('logo_assets').findOne({_id:id,workspaceId:this.context.workspaceId,lifecycleState:'available'},{session:s});if(!row||!await db.collection<Row>('logo_uploads').findOne({_id:row.uploadId,workspaceId:this.context.workspaceId,state:'ready',assetId:id},{session:s}))throw new ProjectError('RESOURCE_NOT_FOUND',404,'This logo could not be found.');return row;});
    const row=await resolve();if(row.object.key!==`workspaces/${this.context.workspaceId}/logos/${row.uploadId}/${id}.png`)throw previewUnavailable();let store:LogoStore|undefined;
    try{store=this.makeStore();const bytes=await store.read(row.object);const current=await resolve();if(JSON.stringify(current.object)!==JSON.stringify(row.object))throw previewUnavailable();return bytes;}catch(error){if(error instanceof ProjectError)throw error;throw previewUnavailable();}finally{store?.close();}
  }
}
