import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual as equal} from 'node:util';
import {Long,type ClientSession,type Db,type MongoClient} from 'mongodb';
import {databaseTransaction} from '../db/transactions';
import type {Row} from '../planning/service';
import {ProjectError,type ProjectContext} from '../projects/contracts';
import {requireIdempotencyKey} from '../projects/validation';
import {assertVoiceSelection} from '../providers/catalog';
import type {Env} from '../providers/contracts';
import {digest} from '../providers/config';
import {effectiveDefaults,parseSettingsPatch,type WorkspaceDefaults} from './validation';
export type SettingsView={revision:number;timezone:string;defaults:WorkspaceDefaults;brandKitRevisionId:string|null};
function view(row:Row):SettingsView{
  if(!Long.isLong(row.settingsRevision)||row.settingsRevision.lessThan(Long.ONE)||row.settingsRevision.greaterThan(Long.fromNumber(Number.MAX_SAFE_INTEGER)))throw new Error('SETTINGS_REVISION_INVALID');
  return {revision:row.settingsRevision.toNumber(),timezone:row.timezone,defaults:effectiveDefaults(row.defaults),brandKitRevisionId:row.brandKitRevisionId};
}
export class SettingsService{
  constructor(private client:MongoClient,private name:string,private context:ProjectContext,private env:Env){}
  private async authorize(db:Db,session:ClientSession,fence=false){
    const query={workspaceId:this.context.workspaceId,userId:this.context.userId,status:'active'};
    const allowed=fence?(await db.collection('memberships').updateOne(query,{$inc:{generationGuardRevision:Long.ONE}},{session})).matchedCount:await db.collection('memberships').findOne(query,{session});
    if(!allowed)throw new ProjectError('TEAM_ACCESS_DENIED',403,'This account does not have team access.');
  }
  private async workspace(db:Db,session:ClientSession){const row=await db.collection<Row>('workspaces').findOne({_id:this.context.workspaceId},{session});if(!row)throw new ProjectError('RESOURCE_NOT_FOUND',404,'This workspace could not be found.');return row;}
  async get(){return databaseTransaction(this.client,this.name,async(db,session)=>{await this.authorize(db,session);return view(await this.workspace(db,session));});}
  async patch(raw:unknown,key:string){
    requireIdempotencyKey(key);const input=parseSettingsPatch(raw),requestHash=digest(JSON.stringify(input)),identity={workspaceId:this.context.workspaceId,userId:this.context.userId,keyHash:digest(key)};
    const now=new Date(),id=randomUUID(),eventId=randomUUID();
    return databaseTransaction(this.client,this.name,async(db,session)=>{
      await this.authorize(db,session);const workspace=await this.workspace(db,session);
      const receipt=await db.collection<Row>('workspace_settings_commands').findOne(identity,{session});
      if(receipt){if(receipt.requestHash!==requestHash)throw new ProjectError('IDEMPOTENCY_MISMATCH',409,'This save key was used with different settings.');return {settings:receipt.snapshot as SettingsView,replayed:true};}
      const current=view(workspace);
      if(current.revision!==input.expectedRevision)throw new ProjectError('STALE_REVISION',409,'Workspace settings changed. Your edits are retained; reload saved settings before saving again.');
      const next={...current,...input.patch,revision:current.revision+1};
      if(equal({...current,revision:next.revision},next))throw new ProjectError('NO_CHANGES',422,'Change a default or timezone before saving.');
      if(current.revision>=Number.MAX_SAFE_INTEGER||!Long.isLong(workspace.nextActivitySequence)||workspace.nextActivitySequence.greaterThanOrEqual(Long.fromNumber(Number.MAX_SAFE_INTEGER)))throw new ProjectError('REVISION_LIMIT',409,'This workspace has reached its settings limit.');
      if(input.patch.defaults)await assertVoiceSelection(db,{language:next.defaults.language,targetSeconds:next.defaults.targetSeconds,voiceCatalogId:next.defaults.preferredVoiceCatalogId,accentId:next.defaults.preferredAccentId,brandKitRevisionId:null,themeId:next.defaults.themeId,captionStyleId:next.defaults.captionStyleId},this.env,session);
      await this.authorize(db,session,true);
      const updated=await db.collection<Row>('workspaces').findOneAndUpdate({_id:this.context.workspaceId,settingsRevision:workspace.settingsRevision},{$set:{...(input.patch.timezone?{timezone:input.patch.timezone}:{}),...(input.patch.defaults?{defaults:input.patch.defaults}:{}),updatedAt:now,updatedBy:{kind:'user',userId:this.context.userId}},$inc:{settingsRevision:Long.ONE,nextActivitySequence:Long.ONE}},{session,returnDocument:'after'});
      if(!updated)throw new ProjectError('STALE_REVISION',409,'Workspace settings changed. Reload before saving.');
      const snapshot=view(updated);
      await db.collection<Row>('workspace_settings_commands').insertOne({_id:id,...identity,requestHash,snapshot,createdAt:now},{session});
      await db.collection<Row>('activity_events').insertOne({_id:eventId,schemaVersion:1,workspaceId:this.context.workspaceId,projectId:null,sequence:updated.nextActivitySequence,dedupeKey:`workspace_settings:${id}`,type:'workspace_settings_changed',actor:{kind:'user',userId:this.context.userId},resourceRefs:{workspaceId:this.context.workspaceId},message:'Shared video defaults were updated.',actionNeeded:false,safeActionRoute:'/settings',createdAt:now},{session});
      return {settings:snapshot,replayed:false};
    });
  }
}
