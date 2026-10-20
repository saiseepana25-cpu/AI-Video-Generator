import {MongoClient} from 'mongodb';

// Fixed disposable loopback test service, entirely separate from .env.local.
const client = new MongoClient('mongodb://127.0.0.1:27028/?directConnection=true', {serverSelectionTimeoutMS: 5000});
async function main() {
  try {
    await client.connect();
    const admin = client.db('admin');
    const hello = await admin.command({hello: 1});
    if (hello.setName && hello.setName !== 'vcF03') throw new Error('WRONG_TEST_REPLICA_SET');
    if (!hello.setName) {
      // An uninitialized replica-set member identifies itself as isreplicaset.
      if (!hello.isreplicaset) throw new Error('NOT_AN_UNINITIALIZED_TEST_REPLICA_SET');
      await admin.command({replSetInitiate: {_id: 'vcF03', members: [{_id: 0, host: '127.0.0.1:27028'}]}});
    }
    for (let attempt = 0; attempt < 60; attempt++) {
      const status = await admin.command({hello: 1});
      if (status.setName === 'vcF03' && status.isWritablePrimary) {
        console.log('Isolated local test replica set is ready. Application credentials were not read.');
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    throw new Error('TEST_PRIMARY_NOT_READY');
  } catch {
    console.error('Local test replica set is unavailable or has unexpected configuration. See DATABASE_SETUP.md; details redacted.');
    process.exitCode = 1;
  } finally { await client.close(); }
}
main().catch(() => {console.error('Test initialization failed; details redacted.'); process.exitCode = 1;});
