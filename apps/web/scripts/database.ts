import {MongoClient} from 'mongodb';
import {databaseClientOptions, inspectDatabaseSettings} from '../src/server/db/connection';
import {checkDatabase, DatabaseSetupError, migrateDatabase} from '../src/server/db/migrations';

async function main() {
  const [command, ...flags] = process.argv.slice(2);
  if (!['migrate', 'check'].includes(command) || flags.some(flag => flag !== '--retry-failed') || (command === 'check' && flags.length)) {
    console.error('Use db:migrate [--retry-failed] or db:check.');
    process.exitCode = 1;
    return;
  }
  const settings = inspectDatabaseSettings(process.env);
  if (!settings) {
    console.error('Missing or invalid MONGODB_URI / MONGODB_DB. Use a dedicated application database; values are not printed.');
    process.exitCode = 1;
    return;
  }
  const client = new MongoClient(settings.mongoUri, databaseClientOptions);
  try {
    await client.connect();
    const db = client.db(settings.databaseName);
    if (command === 'migrate') {
      const result = await migrateDatabase(db, {retryFailed: flags.includes('--retry-failed')});
      console.log(result === 'applied' ? 'Database foundation migration applied and verified.' : 'Database migration already applied; checks passed. No schema changes needed.');
    } else {
      await checkDatabase(db);
      console.log('Database checks passed: migration checksum, replica-set topology, strict validators, named indexes and existing row shapes/unique keys.');
    }
  } catch (error) {
    const code = error instanceof DatabaseSetupError ? error.code : 'DATABASE_OPERATION_FAILED';
    console.error(`Database setup failed (${code}). Details and credential values are redacted. See DATABASE_SETUP.md.`);
    process.exitCode = 1;
  } finally { await client.close(); }
}

main().catch(() => { console.error('Database setup failed; details redacted.'); process.exitCode = 1; });
