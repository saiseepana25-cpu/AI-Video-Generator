import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual as equal} from 'node:util';
import {Long,type ClientSession,type Db,type MongoClient} from 'mongodb';
import {databaseTransaction} from '../db/transactions';
import type {Row} from '../planning/service';
import {ProjectError,type ProjectContext} from '../projects/contracts';
import {requireIdempotencyKey} from '../projects/validation';
import {digest} from '../providers/config';
import {parseBrandPut,type BrandKit} from './validation';
export type BrandView={revision:number;brandKit:(BrandKit&{id:string;revision:number;createdAt:string;createdBy:{id:string}})|null};
function counter(value:unknown){if(!Long.isLong(value)||value.isNegative()||value.greaterThan(Long.fromNumber(Number.MAX_SAFE_INTEGER)))throw new Error('BRAND_REVISION_INVALID');return value.toNumber();}
function palette(row:BrandKit|Row):BrandKit{return {logoAssetId:row.logoAssetId,primaryColor:row.primaryColor,secondaryColor:row.secondaryColor,backgroundColor:row.backgroundColor,englishFontId:row.englishFontId,teluguFontId:row.teluguFontId,themeId:row.themeId};}
export class BrandService{
  constructor(private client:MongoClient,private name:string,private context:ProjectContext){}
  private async authorize(db:Db,session:ClientSession,fence=false){
    const query={workspaceId:this.context.workspaceId,userId:this.context.userId,status:'active'};
    const allowed=fence?(await db.collection('memberships').updateOne(query,{$inc:{generationGuardRevision:Long.ONE}},{session})).matchedCount:await db.collection('memberships').findOne(query,{session});
    if(!allowed)throw new ProjectError('TEAM_ACCESS_DENIED',403,'This account does not have team access.');
  }
  private async workspace(db:Db,session:ClientSession){const row=await db.collection<Row>('workspaces').findOne({_id:this.context.workspaceId},{session});if(!row)throw new ProjectError('RESOURCE_NOT_FOUND',404,'This workspace could not be found.');return row;}
  private async view(db:Db,session:ClientSession,workspace:Row):Promise<BrandView>{
    const revision=counter(workspace.brandRevision);
    if(!revision&&workspace.brandKitRevisionId===null)return {revision:0,brandKit:null};
    const row=await db.collection<Row>('brand_kits').findOne({_id:workspace.brandKitRevisionId,workspaceId:this.context.workspaceId,revision:workspace.brandRevision},{session});
    if(!row)throw new ProjectError('BRAND_UNAVAILABLE',409,'The saved brand revision is unavailable. Ask the operator to check it.');
    return {revision,brandKit:{...palette(row),id:row._id,revision,createdAt:row.createdAt.toISOString(),createdBy:{id:row.createdBy.userId}}};
  }
  async get(){return databaseTransaction(this.client,this.name,async(db,session)=>{await this.authorize(db,session);return this.view(db,session,await this.workspace(db,session));});}
  async put(raw:unknown,key:string){
    requireIdempotencyKey(key);const input=parseBrandPut(raw),requestHash=digest(JSON.stringify(input)),identity={workspaceId:this.context.workspaceId,userId:this.context.userId,keyHash:digest(key)};
    const now=new Date(),id=randomUUID(),receiptId=randomUUID(),eventId=randomUUID();
    return databaseTransaction(this.client,this.name,async(db,session)=>{
      await this.authorize(db,session);const workspace=await this.workspace(db,session);
      const receipt=await db.collection<Row>('workspace_brand_commands').findOne(identity,{session});
      if(receipt){if(receipt.requestHash!==requestHash)throw new ProjectError('IDEMPOTENCY_MISMATCH',409,'This save key was used with different branding.');return {brand:receipt.snapshot as BrandView,replayed:true};}
      const current=await this.view(db,session,workspace);
      if(current.revision!==input.expectedRevision)throw new ProjectError('STALE_REVISION',409,'Shared branding changed. Your edits are retained; reload saved branding before saving again.');
      if(current.brandKit&&equal(palette(current.brandKit),input.brandKit))throw new ProjectError('NO_CHANGES',422,'Change a palette color before saving.');
      if(current.revision>=Number.MAX_SAFE_INTEGER||counter(workspace.nextActivitySequence)>=Number.MAX_SAFE_INTEGER)throw new ProjectError('REVISION_LIMIT',409,'This workspace has reached its brand revision limit.');
      await this.authorize(db,session,true);
      const updated=await db.collection<Row>('workspaces').findOneAndUpdate({_id:this.context.workspaceId,brandRevision:workspace.brandRevision,brandKitRevisionId:workspace.brandKitRevisionId},{$set:{brandKitRevisionId:id,updatedAt:now,updatedBy:{kind:'user',userId:this.context.userId}},$inc:{brandRevision:Long.ONE,nextActivitySequence:Long.ONE}},{session,returnDocument:'after'});
      if(!updated)throw new ProjectError('STALE_REVISION',409,'Shared branding changed. Reload before saving.');
      await db.collection<Row>('brand_kits').insertOne({_id:id,schemaVersion:1,workspaceId:this.context.workspaceId,revision:updated.brandRevision,...input.brandKit,parentBrandKitRevisionId:workspace.brandKitRevisionId,createdAt:now,createdBy:{kind:'user',userId:this.context.userId}},{session});
      const snapshot=await this.view(db,session,updated);
      await db.collection<Row>('workspace_brand_commands').insertOne({_id:receiptId,...identity,requestHash,snapshot,createdAt:now},{session});
      await db.collection<Row>('activity_events').insertOne({_id:eventId,schemaVersion:1,workspaceId:this.context.workspaceId,projectId:null,sequence:updated.nextActivitySequence,dedupeKey:`workspace_brand:${receiptId}`,type:'workspace_brand_changed',actor:{kind:'user',userId:this.context.userId},resourceRefs:{workspaceId:this.context.workspaceId},message:'Shared brand palette was updated.',actionNeeded:false,safeActionRoute:'/settings',createdAt:now},{session});
      return {brand:snapshot,replayed:false};
    });
  }
}
