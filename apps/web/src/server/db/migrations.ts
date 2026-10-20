import {createHash, randomUUID} from 'node:crypto';
import {Long, type Db, type Document, type IndexDescription} from 'mongodb';
import {authIndexes, migrationCollection, ownedCollections, type CollectionContract} from './schemas';

export class DatabaseSetupError extends Error {
  constructor(public readonly code: string) { super(code); }
}

export const foundationMigration = {
  id: '001_database_foundation', description: 'Workspace, membership, project validators and authentication indexes',
  contracts: [...ownedCollections, ...authIndexes],
};
export const foundationChecksum = createHash('sha256').update(JSON.stringify({
  ...foundationMigration, migrationCollection,
})).digest('hex');

type Migration = {
  _id: string; checksum: string; description: string; state: 'prepared' | 'running' | 'applied' | 'failed';
  lockName: 'schema'; owner: string; leaseEpoch: Long; startedAt: Date | null; finishedAt: Date | null;
  safeError: Document | null;
};

function equivalent(a: unknown, b: unknown): boolean {
  const canonical = (value: unknown): string => {
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
    if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
    return JSON.stringify(value) ?? 'undefined';
  };
  return canonical(a) === canonical(b);
}

export function indexMatches(actual: Document, expected: IndexDescription): boolean {
  // Compound key order is semantic and must NOT be sorted for comparison.
  return JSON.stringify(actual.key) === JSON.stringify(expected.key)
    && actual.name === expected.name && Boolean(actual.unique) === Boolean(expected.unique)
    && Boolean(actual.sparse) === Boolean(expected.sparse) && !actual.hidden
    && actual.expireAfterSeconds === expected.expireAfterSeconds
    && equivalent(actual.partialFilterExpression ?? {}, expected.partialFilterExpression ?? {})
    && (!actual.collation || actual.collation.locale === 'simple');
}

async function info(db: Db, name: string) {
  return (await db.listCollections({name}, {nameOnly: false}).toArray())[0];
}

async function auditRows(db: Db, contract: CollectionContract) {
  if (!await info(db, contract.name)) return;
  if (Object.keys(contract.validator).length) {
    const invalid = await db.collection(contract.name).findOne({$nor: [contract.validator]}, {projection: {_id: 1}, maxTimeMS: 10000});
    if (invalid) throw new DatabaseSetupError(`INVALID_EXISTING_ROWS:${contract.name}`);
  }
  for (const index of contract.indexes.filter(index => index.unique)) {
    const pipeline: Document[] = [];
    if (index.partialFilterExpression) pipeline.push({$match: index.partialFilterExpression});
    pipeline.push({$group: {_id: Object.fromEntries(Object.keys(index.key).map(key => [key, `$${key}`])), count: {$sum: 1}}}, {$match: {count: {$gt: 1}}}, {$limit: 1});
    if ((await db.collection(contract.name).aggregate(pipeline, {maxTimeMS: 10000}).toArray()).length) {
      throw new DatabaseSetupError(`DUPLICATE_EXISTING_KEYS:${contract.name}`);
    }
  }
}

async function verifyContract(db: Db, contract: CollectionContract) {
  const collection = await info(db, contract.name);
  if (!collection) throw new DatabaseSetupError(`COLLECTION_MISSING:${contract.name}`);
  if (Object.keys(contract.validator).length && (
    !equivalent(collection.options?.validator, contract.validator)
    || collection.options?.validationLevel !== 'strict' || collection.options?.validationAction !== 'error'
  )) throw new DatabaseSetupError(`VALIDATOR_DRIFT:${contract.name}`);
  const indexes = await db.collection(contract.name).listIndexes().toArray();
  for (const expected of contract.indexes) {
    const actual = indexes.find(index => index.name === expected.name);
    if (!actual || !indexMatches(actual, expected)) throw new DatabaseSetupError(`INDEX_DRIFT:${contract.name}:${expected.name}`);
  }
}

function hasCode(error: unknown, code: number) {
  return !!error && typeof error === 'object' && 'code' in error && error.code === code;
}

async function createIfMissing(db: Db, contract: CollectionContract) {
  if (await info(db, contract.name)) return;
  const options = Object.keys(contract.validator).length
    ? {validator: contract.validator, validationLevel: 'strict' as const, validationAction: 'error' as const} : {};
  try { await db.createCollection(contract.name, options); }
  catch (error) { if (!hasCode(error, 48)) throw error; } // Concurrent bootstrap created the namespace.
}

export async function verifyTransactionTopology(db: Db) {
  const hello = await db.command({hello: 1});
  if ((!hello.setName && hello.msg !== 'isdbgrid') || hello.logicalSessionTimeoutMinutes == null) {
    throw new DatabaseSetupError('TRANSACTIONS_REQUIRE_REPLICA_SET');
  }
}

/** Read-only; runtime startup never creates collections, indexes or validators. */
export async function assertDatabaseReady(db: Db) {
  const row = await db.collection<Migration>('schema_migrations').findOne({_id: foundationMigration.id});
  if (!row || row.state !== 'applied') throw new DatabaseSetupError('MIGRATION_REQUIRED');
  if (row.checksum !== foundationChecksum) throw new DatabaseSetupError('MIGRATION_CHECKSUM_MISMATCH');
  await verifyTransactionTopology(db);
  await verifyContract(db, migrationCollection);
  for (const contract of foundationMigration.contracts) await verifyContract(db, contract);
}

/** Operator tooling only: audits document shapes without logging rows or values. */
export async function checkDatabase(db: Db) {
  await assertDatabaseReady(db);
  for (const contract of [migrationCollection, ...foundationMigration.contracts]) await auditRows(db, contract);
}

/** Non-destructive, explicit migration. Run with application/worker writes stopped.
 * DDL is not transactional. A failed migration is resumable only with retryFailed;
 * a running/crashed owner is never automatically stolen or timed out.
 */
export async function migrateDatabase(db: Db, options: {retryFailed?: boolean} = {}) {
  await verifyTransactionTopology(db);
  // Stable bootstrap contract precedes the migration's ownership record.
  await createIfMissing(db, migrationCollection);
  await auditRows(db, migrationCollection);
  for (const index of migrationCollection.indexes) await db.collection(migrationCollection.name).createIndex(index.key, index);
  await verifyContract(db, migrationCollection);
  const history = db.collection<Migration>('schema_migrations');
  const previous = await history.findOne({_id: foundationMigration.id});
  if (previous && previous.checksum !== foundationChecksum) throw new DatabaseSetupError('MIGRATION_CHECKSUM_MISMATCH');
  if (previous?.state === 'applied') { await checkDatabase(db); return 'already_applied' as const; }
  if (previous?.state === 'running') throw new DatabaseSetupError('MIGRATION_OWNED');
  if (previous && !(previous.state === 'failed' && options.retryFailed)) throw new DatabaseSetupError('MIGRATION_REQUIRES_EXPLICIT_RETRY');

  const owner = randomUUID();
  const epoch = previous ? previous.leaseEpoch.add(Long.ONE) : Long.ONE;
  try {
    if (previous) {
      const claim = await history.updateOne({_id: previous._id, state: 'failed', owner: previous.owner, leaseEpoch: previous.leaseEpoch}, {$set: {state: 'running', owner, leaseEpoch: epoch, startedAt: new Date(), finishedAt: null, safeError: null}}, {writeConcern: {w: 'majority'}});
      if (claim.modifiedCount !== 1) throw new DatabaseSetupError('MIGRATION_OWNED');
    } else {
      await history.insertOne({_id: foundationMigration.id, checksum: foundationChecksum,
        description: foundationMigration.description, state: 'running', lockName: 'schema', owner,
        leaseEpoch: epoch, startedAt: new Date(), finishedAt: null, safeError: null}, {writeConcern: {w: 'majority'}});
    }
  } catch (error) {
    if (hasCode(error, 11000)) throw new DatabaseSetupError('MIGRATION_OWNED');
    throw error;
  }

  const ownership = {_id: foundationMigration.id, state: 'running' as const, owner, leaseEpoch: epoch};
  try {
    // Audit all existing documents/unique keys before tightening any owned schema.
    for (const contract of foundationMigration.contracts) await auditRows(db, contract);
    for (const contract of foundationMigration.contracts) {
      if (!await history.findOne(ownership, {projection: {_id: 1}})) throw new DatabaseSetupError('MIGRATION_OWNERSHIP_LOST');
      await createIfMissing(db, contract);
      if (Object.keys(contract.validator).length) await db.command({collMod: contract.name, validator: contract.validator, validationLevel: 'strict', validationAction: 'error', writeConcern: {w: 'majority'}});
      for (const index of contract.indexes) await db.collection(contract.name).createIndex(index.key, index);
      await verifyContract(db, contract);
      await auditRows(db, contract);
    }
    const result = await history.updateOne(ownership, {$set: {state: 'applied', finishedAt: new Date()}}, {writeConcern: {w: 'majority'}});
    if (result.modifiedCount !== 1) throw new DatabaseSetupError('MIGRATION_OWNERSHIP_LOST');
    return 'applied' as const;
  } catch (error) {
    await history.updateOne(ownership, {$set: {state: 'failed', finishedAt: new Date(), safeError: {
      code: 'MIGRATION_FAILED', message: 'Database migration did not finish. Details are redacted.', retryable: false,
      action: 'Audit the database before explicitly retrying this migration.', requestId: owner, classification: 'database',
    }}}, {writeConcern: {w: 'majority'}}).catch(() => {});
    throw error;
  }
}
