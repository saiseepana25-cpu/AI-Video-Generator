import {MongoClient, type MongoClientOptions} from 'mongodb';

export type DatabaseSettings = {mongoUri: string; databaseName: string};

export function inspectDatabaseSettings(env: Record<string, string | undefined>): DatabaseSettings | null {
  const mongoUri = env.MONGODB_URI?.trim() ?? '';
  const databaseName = env.MONGODB_DB?.trim() ?? '';
  if (!/^mongodb(?:\+srv)?:\/\/[^\s<>]+$/.test(mongoUri) || /[?&](?:tls|ssl)=false(?:&|$)/i.test(mongoUri)) return null;
  if (!/^[a-zA-Z0-9_-]{1,63}$/.test(databaseName) || ['admin', 'local', 'config'].includes(databaseName.toLowerCase())) return null;
  return {mongoUri, databaseName};
}

export const databaseClientOptions: MongoClientOptions = {
  promoteLongs: false,
  serverSelectionTimeoutMS: 5000,
  connectTimeoutMS: 5000,
  maxPoolSize: 5,
  appName: 'VideoCraft-web',
};

type Connection = {key: string; client: MongoClient; ready?: Promise<void>};
const globalDb = globalThis as typeof globalThis & {videoCraftDatabase?: Connection};

// Server/CLI infrastructure only. Never serialize settings or client errors to a DTO/log.
export function mongoClient(settings: DatabaseSettings): Connection {
  const key = `${settings.mongoUri}\n${settings.databaseName}`;
  if (globalDb.videoCraftDatabase?.key !== key) {
    const previous = globalDb.videoCraftDatabase;
    if (previous) void previous.client.close().catch(() => {});
    globalDb.videoCraftDatabase = {key, client: new MongoClient(settings.mongoUri, databaseClientOptions)};
  }
  return globalDb.videoCraftDatabase;
}

export async function applicationDatabase(settings: DatabaseSettings) {
  const connection = mongoClient(settings);
  await connection.client.connect();
  return connection.client.db(settings.databaseName);
}
