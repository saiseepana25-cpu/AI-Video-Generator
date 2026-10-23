import {after, before, describe, test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Long, MongoClient, ObjectId, type CommandStartedEvent, type Db} from 'mongodb';
import {databaseClientOptions} from '../src/server/db/connection';
import {assertDatabaseReady, checkDatabase, foundationChecksum, foundationMigration, projectMigration, migrateDatabase} from '../src/server/db/migrations';
import {databaseTransaction} from '../src/server/db/transactions';
import {membershipFixture, projectFixture, workspaceFixture, testWorkspaceId, type Row} from './fixtures/database';
import {migrationCollection, ownedCollections} from '../src/server/db/schemas';

// Intentionally does NOT load .env.local or use MONGODB_URI. Never drop an app DB.
const uri = process.env.MONGODB_TEST_URI ?? 'mongodb://127.0.0.1:27028/?replicaSet=vcF03';
if (!/^mongodb:\/\/(127\.0\.0\.1|localhost):\d+\/(?:\?[^\s]*)?$/.test(uri)) throw new Error('Database tests require a loopback-only replica set URI with no database path or credentials.');
const client = new MongoClient(uri, {...databaseClientOptions, monitorCommands: true});
const databases: string[] = [];
function isolatedDb(): Db {
  const name = `videocraft_f03_test_${randomUUID().replaceAll('-', '')}`;
  databases.push(name);
  return client.db(name);
}
const errorCode = (code: number) => (error: unknown) => !!error && typeof error === 'object' && 'code' in error && error.code === code;
const writeCommands = new Set(['create', 'createIndexes', 'collMod', 'insert', 'update', 'delete', 'findAndModify', 'drop', 'dropIndexes', 'dropDatabase']);
async function captureWrites(db: Db, work: () => Promise<void>) {
  const writes: string[] = [];
  const listener = (event: CommandStartedEvent) => {
    if (event.databaseName === db.databaseName && writeCommands.has(event.commandName)) writes.push(event.commandName);
  };
  client.on('commandStarted', listener);
  try {await work();} finally {client.off('commandStarted', listener);}
  return writes;
}

describe('database foundation on a real local replica set', {concurrency: false}, () => {
  let db: Db;
  before(async () => {
    await client.connect();
    db = isolatedDb();
    await migrateDatabase(db);
    await db.collection<Row>('workspaces').insertOne(workspaceFixture());
  });
  after(async () => {
    try {
      for (const name of databases) {
        if (!/^videocraft_f03_test_[a-f0-9]{32}$/.test(name)) throw new Error('Unsafe test database cleanup refused.');
        await client.db(name).dropDatabase();
      }
    } finally { await client.close(); }
  });

  test('migration is idempotent, preserves data, stores BSON Long epoch and verifies actual metadata', async () => {
    const writes = await captureWrites(db, async () => {assert.equal(await migrateDatabase(db), 'already_applied');});
    assert.deepEqual(writes, [], 'An already-applied migration must issue no DDL or data writes.');
    await checkDatabase(db);
    assert.equal(await db.collection('workspaces').countDocuments(), 1);
    const history = await db.collection<Row>('schema_migrations').findOne({_id: foundationMigration.id});
    assert.equal(history?.checksum, foundationChecksum);
    assert.ok(Long.isLong(history?.leaseEpoch));
    assert.equal(history?.state, 'applied');
  });

  test('a dropped migration lock is reported as drift without recreating it or changing history', async () => {
    const drift = isolatedDb();
    await migrateDatabase(drift);
    const before = await drift.collection('schema_migrations').find().sort({_id: 1}).toArray();
    await drift.collection('schema_migrations').dropIndex('one_running_schema_migration_v1');
    const writes = await captureWrites(drift, async () => {
      await assert.rejects(migrateDatabase(drift), /INDEX_DRIFT:schema_migrations:one_running_schema_migration_v1/);
    });
    assert.deepEqual(writes, []);
    assert.ok(!(await drift.collection('schema_migrations').listIndexes().toArray()).some(index => index.name === 'one_running_schema_migration_v1'));
    assert.deepEqual(await drift.collection('schema_migrations').find().sort({_id: 1}).toArray(), before);
  });

  test('changed migration-lock definitions fail before any bootstrap write', async () => {
    for (const options of [{unique: false, partialFilterExpression: {state: 'running'}}, {unique: true, partialFilterExpression: {state: 'prepared'}}]) {
      const drift = isolatedDb();
      await migrateDatabase(drift);
      await drift.collection('schema_migrations').dropIndex('one_running_schema_migration_v1');
      await drift.collection('schema_migrations').createIndex({lockName: 1}, {name: 'one_running_schema_migration_v1', ...options});
      const writes = await captureWrites(drift, async () => {
        await assert.rejects(migrateDatabase(drift), /INDEX_DRIFT:schema_migrations:one_running_schema_migration_v1/);
      });
      assert.deepEqual(writes, []);
    }
  });

  test('initial setup can finish creating the lock for an empty, correctly validated history collection', async () => {
    const initial = isolatedDb();
    await initial.createCollection(migrationCollection.name, {validator: migrationCollection.validator, validationLevel: 'strict', validationAction: 'error'});
    assert.equal(await migrateDatabase(initial), 'applied');
    await checkDatabase(initial);
  });

  test('runtime readiness refuses an unmigrated database without creating collections', async () => {
    const empty = isolatedDb();
    await assert.rejects(assertDatabaseReady(empty), /MIGRATION_REQUIRED/);
    assert.equal((await empty.listCollections().toArray()).length, 0);
  });

  test('strict validators reject missing/unknown fields, incorrect BSON types and negative counters', async () => {
    const projects = db.collection<Row>('projects');
    const valid = projectFixture();
    await projects.insertOne(valid);
    const stored = await projects.findOne({_id: valid._id});
    assert.equal(stored?.displayTitle, 'నీటి చక్రం');
    assert.ok(Long.isLong(stored?.revision));
    const missing = projectFixture(); delete missing.workspaceId;
    for (const bad of [missing, {...projectFixture(), unexpected: true}, {...projectFixture(), revision: 1},
      {...projectFixture(), revision: Long.NEG_ONE}, {...projectFixture(), createdAt: new Date().toISOString()},
      {...projectFixture(), _id: 'not-a-uuid'}]) {
      await assert.rejects(projects.insertOne(bad), errorCode(121));
    }
    const translated = projectFixture(); translated.settings.captionLanguage = 'en';
    await assert.rejects(projects.insertOne(translated), errorCode(121));
    const unsupported = projectFixture(); unsupported.settings.language = 'hi';
    await assert.rejects(projects.insertOne(unsupported), errorCode(121));
    await assert.rejects(projects.updateOne({_id: valid._id}, {$set: {brief: {idea: 'Incomplete'}}}), errorCode(121));
  });

  test('unique membership index rejects duplicate workspace/user but permits a distinct user', async () => {
    const memberships = db.collection<Row>('memberships');
    await memberships.insertOne(membershipFixture());
    await assert.rejects(memberships.insertOne(membershipFixture()), errorCode(11000));
    await memberships.insertOne({...membershipFixture(), userId: new ObjectId().toHexString()});
    const invalid = membershipFixture(); invalid.status = 'invited';
    await assert.rejects(memberships.insertOne(invalid), errorCode(121));
  });

  test('Auth.js formats stay adapter-owned while identity/session indexes enforce uniqueness and TTL', async () => {
    const userId = new ObjectId();
    await db.collection('users').insertOne({_id: userId, email: 'adapter@example.com', emailVerified: null, name: 'Adapter test'});
    await assert.rejects(db.collection('users').insertOne({email: 'adapter@example.com'}), errorCode(11000));
    await db.collection('accounts').insertOne({userId, type: 'oauth', provider: 'google', providerAccountId: 'test-subject'});
    await assert.rejects(db.collection('accounts').insertOne({userId, provider: 'google', providerAccountId: 'test-subject'}), errorCode(11000));
    await db.collection('sessions').insertOne({userId, sessionToken: 'test-only-session', expires: new Date(Date.now() + 60000)});
    await assert.rejects(db.collection('sessions').insertOne({userId, sessionToken: 'test-only-session', expires: new Date()}), errorCode(11000));
    const ttl = (await db.collection('sessions').listIndexes().toArray()).find(index => index.name === 'auth_session_expiry');
    assert.equal(ttl?.expireAfterSeconds, 0);
    // TTL metadata is verified; no assertion that asynchronous cleanup is immediate.
  });

  test('transaction commits both writes and returns its result', async () => {
    const project = projectFixture();
    const result = await databaseTransaction(client, db.databaseName, async (tx, session) => {
      await tx.collection<Row>('projects').insertOne(project, {session});
      await tx.collection<Row>('workspaces').updateOne({_id: testWorkspaceId}, {$inc: {nextActivitySequence: Long.ONE}}, {session});
      return project._id;
    });
    assert.equal(result, project._id);
    assert.ok(await db.collection<Row>('projects').findOne({_id: project._id}));
    assert.equal((await db.collection<Row>('workspaces').findOne({_id: testWorkspaceId}))?.nextActivitySequence.toString(), '1');
  });

  test('transaction abort rolls back earlier writes on domain failure and validator rejection', async () => {
    const project = projectFixture();
    await assert.rejects(databaseTransaction(client, db.databaseName, async (tx, session) => {
      await tx.collection<Row>('projects').insertOne(project, {session});
      await tx.collection<Row>('workspaces').updateOne({_id: testWorkspaceId}, {$inc: {nextActivitySequence: Long.ONE}}, {session});
      throw new Error('CONTROLLED_DOMAIN_FAILURE');
    }), /CONTROLLED_DOMAIN_FAILURE/);
    assert.equal(await db.collection<Row>('projects').findOne({_id: project._id}), null);
    assert.equal((await db.collection<Row>('workspaces').findOne({_id: testWorkspaceId}))?.nextActivitySequence.toString(), '1');
    await assert.rejects(databaseTransaction(client, db.databaseName, async (tx, session) => {
      await tx.collection<Row>('projects').insertOne(project, {session});
      await tx.collection<Row>('workspaces').updateOne({_id: testWorkspaceId}, {$set: {settingsRevision: -1}}, {session});
    }), errorCode(121));
    assert.equal(await db.collection<Row>('projects').findOne({_id: project._id}), null);
  });

  test('concurrent same-revision transactions produce one winner without a lost update', async () => {
    const project = projectFixture();
    await db.collection<Row>('projects').insertOne(project);
    const change = () => databaseTransaction(client, db.databaseName, async (tx, session) => {
      const updated = await tx.collection<Row>('projects').updateOne({_id: project._id, revision: Long.ONE}, {$inc: {revision: Long.ONE}}, {session});
      return updated.modifiedCount;
    });
    const outcomes = await Promise.all([change(), change()]); // Separate sessions; never parallel work inside one session.
    assert.equal(outcomes.reduce((a, b) => a + b, 0), 1);
    assert.equal((await db.collection<Row>('projects').findOne({_id: project._id}))?.revision.toString(), '2');
  });

  test('invalid pre-existing rows fail migration before tightening schemas; explicit retry preserves repaired data', async () => {
    const dirty = isolatedDb();
    const broken = workspaceFixture(); broken.settingsRevision = 1;
    await dirty.collection<Row>('workspaces').insertOne(broken);
    await assert.rejects(migrateDatabase(dirty), /INVALID_EXISTING_ROWS:workspaces/);
    assert.equal((await dirty.listCollections({name: 'workspaces'}, {nameOnly: false}).toArray())[0].options?.validator, undefined);
    const failed = await dirty.collection<Row>('schema_migrations').findOne({_id: foundationMigration.id});
    assert.equal(failed?.state, 'failed');
    assert.equal(failed?.safeError.code, 'MIGRATION_FAILED');
    await assert.rejects(migrateDatabase(dirty), /MIGRATION_REQUIRES_EXPLICIT_RETRY/);
    await dirty.collection<Row>('workspaces').updateOne({_id: broken._id}, {$set: {settingsRevision: Long.ONE}});
    assert.equal(await migrateDatabase(dirty, {retryFailed: true}), 'applied');
    assert.equal((await dirty.collection<Row>('schema_migrations').findOne({_id: foundationMigration.id}))?.leaseEpoch.toString(), '2');
  });

  test('duplicate pre-existing adapter identities stop the migration without deleting records or creating project schema', async () => {
    const duplicates = isolatedDb();
    await duplicates.collection('users').insertMany([{email: 'duplicate@example.com'}, {email: 'duplicate@example.com'}]);
    await assert.rejects(migrateDatabase(duplicates), /DUPLICATE_EXISTING_KEYS:users/);
    assert.equal(await duplicates.collection('users').countDocuments(), 2);
    assert.equal((await duplicates.listCollections({name: 'projects'}).toArray()).length, 0);
  });

  test('migration ownership lock prevents concurrent runners and never steals a running record', async () => {
    const concurrent = isolatedDb();
    const results = await Promise.allSettled([migrateDatabase(concurrent), migrateDatabase(concurrent)]);
    assert.ok(results.some(result => result.status === 'fulfilled'));
    for (const result of results) if (result.status === 'rejected') assert.match(String(result.reason), /MIGRATION_OWNED/);
    await checkDatabase(concurrent);
    const locked = isolatedDb();
    await migrateDatabase(locked);
    await locked.collection<Row>('schema_migrations').updateOne({_id: foundationMigration.id}, {$set: {state: 'running'}});
    await assert.rejects(migrateDatabase(locked, {retryFailed: true}), /MIGRATION_OWNED/);
    const row = await locked.collection<Row>('schema_migrations').findOne({_id: foundationMigration.id});
    await assert.rejects(locked.collection<Row>('schema_migrations').insertOne({...row, _id: '002_conflicting_migration'} as Row), errorCode(11000));
  });

  test('checksum and index/validator drift fail checks without silently repairing an applied migration', async () => {
    const drift = isolatedDb();
    await migrateDatabase(drift);
    await drift.collection<Row>('schema_migrations').updateOne({_id: foundationMigration.id}, {$set: {checksum: 'a'.repeat(64)}});
    await assert.rejects(migrateDatabase(drift), /MIGRATION_CHECKSUM_MISMATCH/);
    await drift.collection<Row>('schema_migrations').updateOne({_id: foundationMigration.id}, {$set: {checksum: foundationChecksum}});
    await drift.collection('projects').dropIndex('project_library_v1');
    await assert.rejects(checkDatabase(drift), /INDEX_DRIFT:projects/);
    await assert.rejects(migrateDatabase(drift), /INDEX_DRIFT:projects/);
    const validatorDrift = isolatedDb();
    await migrateDatabase(validatorDrift);
    await validatorDrift.command({collMod: 'projects', validationAction: 'warn'});
    await assert.rejects(checkDatabase(validatorDrift), /VALIDATOR_DRIFT:projects/);
  });

  test('explicit failed-upgrade retry accepts its exact partially applied validator without rejecting valid new rows', async () => {
    const partial = isolatedDb();
    await migrateDatabase(partial);
    // Simulate failure after project validator DDL but before receipt collection DDL.
    await partial.collection<Row>('schema_migrations').deleteOne({_id: '006_ai_planning'});
    await partial.collection<Row>('schema_migrations').deleteOne({_id: '007_plan_text_edits'});
    await partial.collection<Row>('schema_migrations').deleteOne({_id: '008_plan_history'});
    await partial.collection<Row>('schema_migrations').deleteOne({_id: '009_generation_queue'});
    await partial.collection<Row>('schema_migrations').deleteOne({_id: '010_generation_worker'});
    await partial.collection<Row>('schema_migrations').deleteOne({_id: '011_private_media_storage'});
    await partial.collection<Row>('schema_migrations').deleteOne({_id: '012_ready_video_playback'});
    await partial.collection<Row>('schema_migrations').deleteOne({_id: '013_verified_speech_reuse'});
    await partial.collection<Row>('schema_migrations').deleteOne({_id: '014_workspace_settings'});
    await partial.collection<Row>('schema_migrations').deleteOne({_id: '015_workspace_brand'});
    await partial.collection<Row>('schema_migrations').deleteMany({_id:{$in:['016_logo_preparation','017_brand_logo_pins','018_personal_preferences','019_project_duplication']}});
    await partial.command({collMod:'workspaces',validator:ownedCollections.find(c=>c.name==='workspaces')!.validator});
    await partial.command({collMod: 'memberships', validator: ownedCollections.find(c => c.name === 'memberships')!.validator});
    await partial.collection<Row>('schema_migrations').deleteOne({_id: '003_project_editing'});
    await partial.collection<Row>('schema_migrations').updateOne({_id: projectMigration.id}, {$set: {state: 'failed'}});
    await partial.collection('idempotency_records').drop();
    const project = projectFixture(); project.settings.voiceCatalogId = null; project.settings.accentId = null;
    await partial.collection<Row>('projects').insertOne(project);
    assert.equal(await migrateDatabase(partial, {retryFailed: true}), 'applied');
    await checkDatabase(partial);
    assert.equal(await partial.collection('projects').countDocuments(), 1);
    assert.equal((await partial.collection<Row>('schema_migrations').findOne({_id: projectMigration.id}))?.leaseEpoch.toString(), '2');
  });
});
