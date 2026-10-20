import {inspectAuthSettings} from '../src/server/configuration/auth';
import {MongoClient} from 'mongodb';

async function main() {
  const report = inspectAuthSettings(process.env);
  if (!report.ready) {
    console.log('Authentication setup is incomplete. Missing or invalid setting names only:');
    for (const key of report.issues) console.log(`- ${key}`);
    console.log('See ../../AUTH_SETUP.md. No credential values were printed.');
    process.exitCode = 1;
  } else {
    console.log('All required authentication settings are present and well-formed. Values are not printed.');
    if (process.argv.includes('--database')) {
      const settings = report.settings!;
      const client = new MongoClient(settings.mongoUri,{serverSelectionTimeoutMS:5000,connectTimeoutMS:5000,maxPoolSize:1});
      try {
        await client.connect();
        await client.db(settings.databaseName).command({ping:1});
        console.log('MongoDB ping succeeded. OAuth and database write permissions are not verified by this check.');
      } catch {
        console.log('MongoDB connection failed. Check the URI, database user and IP access list; diagnostic details are redacted.');
        process.exitCode=1;
      } finally { await client.close(); }
    }
  }
}

main().catch(()=>{console.error('Authentication check failed; details redacted.');process.exitCode=1;});
