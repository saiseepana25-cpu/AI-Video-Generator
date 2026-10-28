import path from 'node:path';
import {config} from 'dotenv';
import {MongoClient} from 'mongodb';
import {databaseClientOptions, inspectDatabaseSettings} from '../src/server/db/connection';
import {assertDatabaseReady} from '../src/server/db/migrations';
import {GenerationWorker} from '../src/server/generation/worker';
import type {GenerationRun, GenerationWorker as WorkerRow} from '../src/server/generation/contracts';
import {LiveGenerationEngine} from '../../../src/pipeline/generation-engine';
import {GenerationFault} from '../src/server/generation/engine';
import {runGenerationWorker,GenerationLoopFailure} from '../src/server/generation/loop';
import {workerFailureCode} from '../src/server/generation/poll-error';
async function main() {
  const command = process.argv[2]; if (!['worker', 'status'].includes(command) || process.argv.length !== 3) throw new Error('Use generation worker | status');
  const root = path.resolve(process.cwd(), '../..'); config({path: path.join(root, '.env.local'), override: false, quiet: true} as Parameters<typeof config>[0]);
  const settings = inspectDatabaseSettings(process.env); if (!settings) throw new GenerationFault('DATABASE_CONFIGURATION_REQUIRED');
  const client = new MongoClient(settings.mongoUri, databaseClientOptions);
  try {
    await client.connect(); const db = client.db(settings.databaseName); await assertDatabaseReady(db);
    if (command === 'status') {
      const row = await db.collection<WorkerRow>('generation_workers').findOne({_id: 'generation:local'});
      console.log({state: row?.state ?? 'not_started', heartbeatFresh: !!row && row.heartbeatAt.getTime() > Date.now() - 30000 && row.expiresAt > new Date(),
        queued: await db.collection<GenerationRun>('generation_runs').countDocuments({state: 'queued'}), active: await db.collection<GenerationRun>('generation_runs').countDocuments({state: {$in: ['running', 'cancellation_requested']}})}); return;
    }
    const worker = new GenerationWorker(client, settings.databaseName, process.env, new LiveGenerationEngine(root, process.env));
    const shutdown=new AbortController();let stopTask:Promise<void>|undefined;
    const stop = () => {shutdown.abort();stopTask??=worker.stop().catch(error=>console.error(JSON.stringify({event:'generation_stop_signal_failed',reason:workerFailureCode(error)})));};
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
    console.log('Local generation worker started. Only explicitly approved jobs; free-account verification before every speech request; no automatic speech retries.');
    try {await runGenerationWorker(worker,{signal:shutdown.signal,report:event=>console.error(JSON.stringify(event))});}
    finally {process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);await stopTask;}
  } finally {await client.close().catch(()=>{console.error('Generation database client cleanup failed. Details redacted.');process.exitCode=1;});}
}
main().catch(error => {console.error(JSON.stringify({event:'generation_worker_stopped',reason:error instanceof GenerationLoopFailure?error.code:workerFailureCode(error)}));console.error('Check database/readiness, local renderer/license and retained job status before restarting. No automatic speech retry; private details redacted.'); process.exitCode = 1;});
