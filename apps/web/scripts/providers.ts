import {mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {MongoClient} from 'mongodb';
import {databaseClientOptions, inspectDatabaseSettings} from '../src/server/db/connection';
import {assertDatabaseReady} from '../src/server/db/migrations';
import {ProviderStore} from '../src/server/providers/store';
import {ProviderFault} from '../src/server/providers/gateway';

async function main() {
  const [command, language, ...extra] = process.argv.slice(2);
  if ((command !== 'check' && command !== 'probe') || extra.length || (command === 'check' && language) || (command === 'probe' && !['en', 'te'].includes(language))) throw new ProviderFault('INVALID_COMMAND');
  const settings = inspectDatabaseSettings(process.env); if (!settings) throw new ProviderFault('DATABASE_NOT_CONFIGURED');
  const client = new MongoClient(settings.mongoUri, databaseClientOptions);
  try {
    await client.connect(); const db = client.db(settings.databaseName); await assertDatabaseReady(db);
    const store = new ProviderStore(db, process.env);
    if (command === 'check') {await Promise.all([store.refresh('elevenlabs', true), store.refresh('gemini', true)]);}
    else {
      const result = await store.probe(language as 'en' | 'te');
      if (result.tested && result.pcm) {const folder = path.resolve(process.cwd(), '../../.cache/provider-tests'); await mkdir(folder, {recursive: true}); await writeFile(path.join(folder, `${language}.pcm`), result.pcm);}
      console.log(JSON.stringify({speechTestPerformed: result.tested, language, bytes: result.bytes ?? 0}));
    }
    const catalog = await store.catalog({language: language === 'te' ? 'te' : 'en', accentId: null, intendedUse: 'evaluation', includeUnavailable: true});
    console.log(JSON.stringify(catalog));
  } finally {await client.close();}
}
main().catch(error => {console.error(`Provider check stopped (${error instanceof ProviderFault ? error.code : 'PROVIDER_CHECK_FAILED'}). Details redacted; no automatic retry or paid fallback.`); process.exitCode = 1;});
