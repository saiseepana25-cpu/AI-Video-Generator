import 'server-only';
import {randomUUID} from 'node:crypto';
import {Long, MongoClient, ObjectId, type Db} from 'mongodb';
import type {AuthSettings} from '../configuration/auth';
import {AccessError, authorizeMembership} from '../auth/access-policy';

export type Membership = {
  _id: string; schemaVersion: 1; workspaceId: string; userId: string; normalizedEmail: string;
  status: 'active' | 'disabled'; joinedAt: Date; disabledAt: Date | null; disabledBy: unknown;
  preferences: {language: 'en' | 'te' | null; voiceCatalogId: string | null; timezone: string | null};
  preferencesRevision: Long; activityReadThroughSequence: Long; createdAt: Date; updatedAt: Date;
};
export type Workspace = {
  _id: string; schemaVersion: 1; name: string; timezone: string;
  defaults: {language: 'en' | 'te'; targetSeconds: 30 | 60 | 90; preferredAccentId: string; preferredVoiceCatalogId: string | null; themeId: string; captionStyleId: string};
  settingsRevision: Long; brandKitRevisionId: string | null; brandRevision: Long; nextActivitySequence: Long;
  createdAt: Date; updatedAt: Date; updatedBy: {kind: 'system'; service: string};
};

type Connection = {key: string; client: MongoClient; indexes?: Promise<void>};
const globalDb = globalThis as typeof globalThis & {videoCraftAuthDb?: Connection};

export function mongoClient(settings: AuthSettings) {
  // The key remains server memory only; no URI is logged.
  const key = `${settings.mongoUri}\n${settings.databaseName}`;
  if (globalDb.videoCraftAuthDb?.key !== key) {
    const previous = globalDb.videoCraftAuthDb;
    if (previous) void previous.client.close().catch(() => {});
    globalDb.videoCraftAuthDb = {key, client:new MongoClient(settings.mongoUri, {serverSelectionTimeoutMS:5000, connectTimeoutMS:5000, maxPoolSize:5, appName:'VideoCraft-web'})};
  }
  return globalDb.videoCraftAuthDb;
}

export async function authDatabase(settings: AuthSettings): Promise<Db> {
  const connection = mongoClient(settings);
  await connection.client.connect();
  return connection.client.db(settings.databaseName);
}

export async function prepareAuthDatabase(settings: AuthSettings) {
  const connection = mongoClient(settings);
  if (!connection.indexes) {
    connection.indexes = (async () => {
      const db = await authDatabase(settings);
      await db.collection('users').createIndex({email:1}, {unique:true, name:'auth_user_email'});
      await db.collection('accounts').createIndex({provider:1,providerAccountId:1}, {unique:true,name:'auth_provider_subject'});
      await db.collection('sessions').createIndex({sessionToken:1}, {unique:true,name:'auth_session_token'});
      await db.collection('sessions').createIndex({userId:1}, {name:'auth_session_user'});
      await db.collection('sessions').createIndex({expires:1}, {expireAfterSeconds:0,name:'auth_session_expiry'});
      await db.collection('memberships').createIndex({workspaceId:1,userId:1}, {unique:true,name:'membership_workspace_user'});
      await db.collection('memberships').createIndex({workspaceId:1,status:1}, {name:'membership_workspace_status'});
    })().catch(error => { connection.indexes = undefined; throw error; });
  }
  await connection.indexes;
}

export async function enrollMember(settings: AuthSettings, userId: string, email: string) {
  await prepareAuthDatabase(settings);
  const db = await authDatabase(settings);
  const now = new Date();
  // Bootstrap is idempotent, and never overwrites existing workspace settings.
  await db.collection<Workspace>('workspaces').updateOne({_id:settings.workspaceId}, {$setOnInsert:{
    schemaVersion:1,name:settings.workspaceName,timezone:'Asia/Kolkata',
    defaults:{language:'en',targetSeconds:60,preferredAccentId:'indian',preferredVoiceCatalogId:null,themeId:'clean-educational-v1',captionStyleId:'readable-default-v1'},
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
