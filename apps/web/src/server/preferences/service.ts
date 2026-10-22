import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {Long,type ClientSession,type Db,type MongoClient} from 'mongodb';
import {databaseTransaction} from '../db/transactions';
import type {Row} from '../planning/service';
import {ProjectError,type ProjectContext} from '../projects/contracts';
import {requireIdempotencyKey} from '../projects/validation';
import {assertVoiceSelection} from '../providers/catalog';
import type {Env} from '../providers/contracts';
import {digest} from '../providers/config';
import {parsePreferencesPatch,validatePreferencePair,type Preferences} from './validation';
export type PreferencesView={revision:number;preferences:Preferences};
export function preferenceView(row:Row):PreferencesView{
  const n=row.preferencesRevision;if(!Long.isLong(n)||n.lessThan(Long.ONE)||n.greaterThan(Long.fromNumber(Number.MAX_SAFE_INTEGER)))throw new Error('PREFERENCES_REVISION_INVALID');
  return {revision:n.toNumber(),preferences:{language:row.preferences.language,voiceCatalogId:row.preferences.voiceCatalogId,accentId:row.preferences.accentId??null,timezone:row.preferences.timezone}};
}
export class PreferencesService{
  constructor(private client:MongoClient,private name:string,private context:ProjectContext,private env:Env){}
  private async member(db:Db,s:ClientSession){
    const member=await db.collection<Row>('memberships').findOne({workspaceId:this.context.workspaceId,userId:this.context.userId,status:'active'},{session:s});
    if(!member)throw new ProjectError('TEAM_ACCESS_DENIED',403,'This account does not have team access.');
    if(!await db.collection<Row>('workspaces').findOne({_id:this.context.workspaceId},{session:s}))throw new ProjectError('RESOURCE_NOT_FOUND',404,'This workspace could not be found.');
    return member;
  }
  async get(){return databaseTransaction(this.client,this.name,async(db,s)=>preferenceView(await this.member(db,s)));}
  async patch(raw:unknown,key:string){
    requireIdempotencyKey(key);const input=parsePreferencesPatch(raw),identity={workspaceId:this.context.workspaceId,userId:this.context.userId,keyHash:digest(key)},requestHash=digest(JSON.stringify(input)),id=randomUUID();
    return databaseTransaction(this.client,this.name,async(db,s)=>{
      const row=await this.member(db,s),receipt=await db.collection<Row>('member_preferences_commands').findOne(identity,{session:s});
      if(receipt){if(receipt.requestHash!==requestHash)throw new ProjectError('IDEMPOTENCY_MISMATCH',409,'This save key belongs to different preferences.');return {preferences:receipt.snapshot as PreferencesView,replayed:true};}
      const current=preferenceView(row);if(current.revision!==input.expectedRevision)throw new ProjectError('STALE_REVISION',409,'Your preferences changed in another tab. Edits are retained; reload saved preferences before saving again.');
      const preferences=validatePreferencePair({...current.preferences,...input.patch});
      if(isDeepStrictEqual(preferences,current.preferences))throw new ProjectError('NO_CHANGES',422,'Change a personal preference before saving.');
      if(current.revision>=Number.MAX_SAFE_INTEGER)throw new ProjectError('REVISION_LIMIT',409,'Your preferences have reached their revision limit.');
      if(preferences.voiceCatalogId&&(['language','voiceCatalogId','accentId'] as const).some(k=>preferences[k]!==current.preferences[k]))await assertVoiceSelection(db,{language:preferences.language!,voiceCatalogId:preferences.voiceCatalogId,accentId:preferences.accentId,targetSeconds:60,brandKitRevisionId:null,themeId:'clean-educational-v1',captionStyleId:'readable-default-v1'},this.env,s);
      const updated=await db.collection<Row>('memberships').findOneAndUpdate({_id:row._id,workspaceId:this.context.workspaceId,userId:this.context.userId,status:'active',preferencesRevision:row.preferencesRevision},{$set:{preferences,updatedAt:new Date()},$inc:{preferencesRevision:Long.ONE}},{session:s,returnDocument:'after'});
      if(!updated)throw new ProjectError('STALE_REVISION',409,'Reload your saved preferences before saving.');
      const snapshot=preferenceView(updated);await db.collection<Row>('member_preferences_commands').insertOne({_id:id,...identity,requestHash,snapshot,createdAt:new Date()},{session:s});
      return {preferences:snapshot,replayed:false};
    });
  }
}
