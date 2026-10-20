import {MongoClient} from 'mongodb';
import {databaseClientOptions, inspectDatabaseSettings} from '../src/server/db/connection';
import {assertDatabaseReady} from '../src/server/db/migrations';
import {ProviderStore} from '../src/server/providers/store';
import {ProviderFault} from '../src/server/providers/gateway';
import {isOperatorDisabled, type Provider, type ProviderControl} from '../src/server/providers/contracts';

async function main() {
  const [command, provider, rawRevision, ...extra] = process.argv.slice(2);
  if (!['status', 'disable', 'enable'].includes(command) || !['elevenlabs', 'gemini'].includes(provider) || extra.length
    || (command === 'status' ? rawRevision !== undefined : !/^[1-9][0-9]{0,15}$/.test(rawRevision ?? ''))) throw new ProviderFault('INVALID_COMMAND');
  const settings = inspectDatabaseSettings(process.env); if (!settings) throw new ProviderFault('DATABASE_NOT_CONFIGURED');
  const client = new MongoClient(settings.mongoUri, databaseClientOptions);
  try {
    await client.connect(); const db = client.db(settings.databaseName); await assertDatabaseReady(db);
    if (command !== 'status') await new ProviderStore(db, process.env).setOperatorEnabled(provider as Provider, command === 'enable', Number(rawRevision));
    const row = await db.collection<ProviderControl>('provider_controls').findOne({_id: provider as Provider});
    if (!row) throw new ProviderFault('CAPABILITY_UNVERIFIED');
    console.log(JSON.stringify({provider, revision: row.revision.toString(), operatorDisabled: isOperatorDisabled(row), metadataRefreshed: false}));
  } finally {await client.close();}
}
main().catch(error => {console.error(`Provider policy command stopped (${error instanceof ProviderFault ? error.code : 'PROVIDER_POLICY_FAILED'}). Details redacted.`); process.exitCode = 1;});
