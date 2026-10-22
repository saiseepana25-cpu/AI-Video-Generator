import 'server-only';
import {randomUUID} from 'node:crypto';
import {Long, ObjectId} from 'mongodb';
import type {AuthSettings} from '../configuration/auth';
import {authorizeMembership} from '../auth/access-policy';
import {applicationDatabase, mongoClient} from './connection';
import {assertDatabaseReady} from './migrations';
export {mongoClient} from './connection';

export type Membership = {
  _id: string; schemaVersion: 1; workspaceId: string; userId: string; normalizedEmail: string;
  status: 'active' | 'disabled'; joinedAt: Date; disabledAt: Date | null; disabledBy: unknown;
  preferences: {language: 'en' | 'te' | null; voiceCatalogId: string | null; timezone: string | null};
  preferencesRevision: Long; activityReadThroughSequence: Long; createdAt: Date; updatedAt: Date;
};
export type Workspace = {
  _id: string; schemaVersion: 1; name: string; timezone: string;
  defaults: {language: 'en' | 'te'; targetSeconds: 30 | 60 | 90; preferredAccentId: string | null; preferredVoiceCatalogId: string | null; themeId: string; captionStyleId: string};
  settingsRevision: Long; brandKitRevisionId: string | null; brandRevision: Long; nextActivitySequence: Long;
  createdAt: Date; updatedAt: Date; updatedBy: {kind: 'system'; service: string}|{kind:'user';userId:string};
};

export const authDatabase = applicationDatabase;

export async function prepareAuthDatabase(settings: AuthSettings) {
  const connection = mongoClient(settings);
  if (!connection.ready) {
    connection.ready = authDatabase(settings).then(assertDatabaseReady).catch(error => {
      connection.ready = undefined;
      throw error;
    });
  }
  await connection.ready;
}

export async function enrollMember(settings: AuthSettings, userId: string, email: string) {
  await prepareAuthDatabase(settings);
  const db = await authDatabase(settings);
  const now = new Date();
  // Bootstrap is idempotent, and never overwrites existing workspace settings.
  await db.collection<Workspace>('workspaces').updateOne({_id:settings.workspaceId}, {$setOnInsert:{
    schemaVersion:1,name:settings.workspaceName,timezone:'Asia/Kolkata',
    defaults:{language:'en',targetSeconds:60,preferredAccentId:null,preferredVoiceCatalogId:null,themeId:'clean-educational-v1',captionStyleId:'readable-default-v1'},
    settingsRevision:Long.ONE,brandKitRevisionId:null,brandRevision:Long.ZERO,nextActivitySequence:Long.ZERO,
    createdAt:now,updatedAt:now,updatedBy:{kind:'system',service:'auth-bootstrap'},
  }}, {upsert:true});
  // $setOnInsert is intentional: signing in cannot reactivate a disabled record.
  try {
    await db.collection<Membership>('memberships').updateOne({workspaceId:settings.workspaceId,userId}, {$setOnInsert:{
      _id:randomUUID(),schemaVersion:1,normalizedEmail:email,status:'active',joinedAt:now,disabledAt:null,disabledBy:null,
      preferences:{language:null,voiceCatalogId:null,timezone:null},preferencesRevision:Long.ONE,activityReadThroughSequence:Long.ZERO,createdAt:now,updatedAt:now,
    }}, {upsert:true});
  } catch (error) {
    if (!(error && typeof error === 'object' && 'code' in error && error.code === 11000)) throw error;
    // Another approved login may have inserted the same unique membership.
  }
  const member = await db.collection<Membership>('memberships').findOne({workspaceId:settings.workspaceId,userId});
  authorizeMembership(member,userId,email,settings.workspaceId);
}

export async function revokeUserSessions(settings: AuthSettings, userId: string) {
  if (/^[a-f0-9]{24}$/.test(userId)) await (await authDatabase(settings)).collection('sessions').deleteMany({userId:new ObjectId(userId)});
}
