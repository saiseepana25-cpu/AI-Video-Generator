import path from 'node:path';
import {MongoClient} from 'mongodb';
import {databaseClientOptions, inspectDatabaseSettings} from '../src/server/db/connection';
import {assertDatabaseReady} from '../src/server/db/migrations';
import {StorageService} from '../src/server/storage/service';
import {R2ObjectStore} from '../src/server/storage/r2';
import {StorageFault, type StorageBundle} from '../src/server/storage/contracts';
import {LocalArtifactReader} from '../../../src/pipeline/storage-reader';
import {requireProjectId} from '../src/server/projects/contracts';
import {promoteStoredVideo} from '../src/server/videos/service';
async function main() {
  const [command, runId, ...rest] = process.argv.slice(2);
  if (rest.length || !['worker', 'status', 'store', 'retry', 'promote'].includes(command) || (['store', 'retry', 'promote'].includes(command) ? !runId : !!runId)) throw new StorageFault('Use storage worker | status | store <run-id> | retry <run-id> | promote <run-id>');
  if (runId) requireProjectId(runId);
  const settings = inspectDatabaseSettings(process.env); if (!settings) throw new StorageFault('DATABASE_CONFIGURATION_REQUIRED');
  const client = new MongoClient(settings.mongoUri, databaseClientOptions); let store: R2ObjectStore | undefined;
  try {
    await client.connect(); const db = client.db(settings.databaseName); await assertDatabaseReady(db);
    if (command === 'status') {console.log(Object.fromEntries(await Promise.all(['pending', 'uploading', 'failed', 'stored'].map(async state => [state, await db.collection<StorageBundle>('generation_storage_bundles').countDocuments({state: state as StorageBundle['state']})])))); return;}
    store = new R2ObjectStore(process.env);
    const service = new StorageService(client, settings.databaseName, store, new LocalArtifactReader(path.resolve(process.cwd(), '../..')));
    if (command === 'promote') {await promoteStoredVideo(client, settings.databaseName, store, runId!); console.log('Stored video reconciled for private playback. No speech/render was submitted.'); return;}
    if (command === 'store') {await service.prepare(runId!); await service.tick(runId); console.log('Storage command finished. Use storage status to inspect durable state. No speech or render was submitted.'); return;}
    if (command === 'retry') {await service.retry(runId!); await service.tick(runId); console.log('Storage-only retry finished. No speech or render was submitted.'); return;}
    let stopping = false; const stop = () => {stopping = true;}; process.once('SIGINT', stop); process.once('SIGTERM', stop);
    console.log('Private storage worker started. Validated local artifacts only; no speech/render fallback. Ctrl+C finishes the current bounded storage operation.');
    const skipped = new Set<string>();
    try {while (!stopping) {
      try {await service.tick(); if (!stopping) await service.discover();
        if (!stopping && skipped.size < 1000) {
          const [candidate] = await db.collection<StorageBundle>('generation_storage_bundles').aggregate<StorageBundle>([
            {$match: {state: 'stored', configHash: store.configHash, runId: {$nin: [...skipped]}}},
            {$lookup: {from: 'ready_videos', localField: 'runId', foreignField: 'runId', as: 'ready'}}, {$match: {'ready.0': {$exists: false}}}, {$sort: {createdAt: 1}}, {$limit: 1},
          ]).toArray();
          if (candidate) try {await promoteStoredVideo(client, settings.databaseName, store, candidate.runId);} catch (error) {skipped.add(candidate.runId); throw error;}
        }
      }
      catch (error) {console.error(error instanceof StorageFault ? error.code : 'STORAGE_FAILED');}
      if (!stopping) await new Promise(resolve => setTimeout(resolve, 5000));
    }} finally {process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);}
  } finally {store?.close(); await client.close();}
}
main().catch(error => {console.error(error instanceof StorageFault ? error.code : 'Storage command failed. Private details redacted.'); process.exitCode = 1;});
