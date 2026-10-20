import {MongoClient} from 'mongodb';
import {databaseClientOptions, inspectDatabaseSettings} from '../src/server/db/connection';
import {assertDatabaseReady} from '../src/server/db/migrations';
import {attestBudget} from '../src/server/planning/budget';
import {PlanningWorker} from '../src/server/planning/worker';
import type {Row} from '../src/server/planning/service';

async function main() {
  const settings = inspectDatabaseSettings(process.env); if (!settings) throw new Error('DATABASE_CONFIGURATION_REQUIRED');
  const [command, ...args] = process.argv.slice(2);
  if (!['worker', 'budget', 'status'].includes(command) || command === 'budget' && (args.length !== 2 || args.some(a => !/^\d+$/.test(a))) || command !== 'budget' && args.length) throw new Error('Use planning worker | planning budget REMAINING EXPECTED_REVISION | planning status');
  const client = new MongoClient(settings.mongoUri, databaseClientOptions);
  try {
    await client.connect(); const db = client.db(settings.databaseName); await assertDatabaseReady(db);
    if (command === 'budget') {console.log(await attestBudget(db, process.env, Number(args[0]), Number(args[1]))); return;}
    if (command === 'status') {const row = await db.collection<Row>('planning_budget').findOne({_id: 'gemini'}); console.log(row ? {remaining: row.remaining, revision: row.revision.toString(), expiresAt: row.expiresAt.toISOString(), paused: row.paused, uncertain: row.uncertain} : {configured: false}); return;}
    const worker = new PlanningWorker(client, settings.databaseName, process.env);
    let stopped = false; process.on('SIGINT', () => {stopped = true;}); process.on('SIGTERM', () => {stopped = true;});
    console.log('Planning worker started. Free-only; persisted jobs; no automatic provider retries.');
    try {while (!stopped) {await worker.tick(); if (!stopped) await new Promise(resolve => setTimeout(resolve, 2000));}}
    finally {await worker.release();}
  } finally {await client.close();}
}
main().catch(() => {console.error('Planning command stopped. Check database readiness, free budget and worker ownership. Provider/credential details are redacted.'); process.exitCode = 1;});
