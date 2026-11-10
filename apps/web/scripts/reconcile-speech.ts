import {MongoClient} from 'mongodb';
import {databaseClientOptions,inspectDatabaseSettings} from '../src/server/db/connection';
import {assertDatabaseReady} from '../src/server/db/migrations';
import {SpeechAllowanceReconciliation} from '../src/server/providers/reconciliation';
import {ProviderFault} from '../src/server/providers/gateway';
async function main(){
  const [balance,revision,commandId,...rest]=process.argv.slice(2);if(rest.length||!/^\d+$/.test(balance??'')||!/^\d+$/.test(revision??'')||!commandId)throw new ProviderFault('INVALID_RECONCILIATION_INPUT');
  const cfg=inspectDatabaseSettings(process.env);if(!cfg)throw new ProviderFault('DATABASE_CONFIGURATION_REQUIRED');const client=new MongoClient(cfg.mongoUri,databaseClientOptions);
  try{await client.connect();await assertDatabaseReady(client.db(cfg.databaseName));console.log(await new SpeechAllowanceReconciliation(client,cfg.databaseName,process.env).reconcile({confirmedRemaining:Number(balance),expectedRevision:Number(revision),commandId}));}finally{await client.close();}
}
main().catch(e=>{console.error(e instanceof ProviderFault?e.code:'RECONCILIATION_FAILED');process.exitCode=1;});
