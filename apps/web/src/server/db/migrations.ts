import {createHash, randomUUID} from 'node:crypto';
import {Long, type Db, type Document, type IndexDescription} from 'mongodb';
import {authIndexes, migrationCollection, ownedCollections, type CollectionContract} from './schemas';
import {projectCollections} from './project-schemas';
import {editCollections} from './edit-schemas';
import {providerCollections} from './provider-schemas';
import {providerPolicyCollections} from './provider-policy-schemas';
import {planningCollections} from './planning-schemas';
import {planEditCollections} from './plan-edit-schemas';
import {planHistoryCollections} from './plan-history-schemas';
import {generationCollections} from './generation-schemas';
import {generationWorkerCollections} from './generation-worker-schemas';
import {storageCollections} from './storage-schemas';
import {videoCollections} from './video-schemas';
import {speechReuseCollections} from './speech-reuse-schemas';
import {workspaceSettingsCollections} from './workspace-settings-schemas';
import {brandCollections} from './brand-schemas';
import {preferencesCollections} from './preferences-schemas';
import {brandLogoCollections} from './brand-logo-schemas';
import {logoCollections} from './logo-schemas';
import {duplicateCollections} from './duplicate-schemas';
import {deletionCollections} from './deletion-schemas';

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

export const projectMigration = {id: '002_project_library', description: 'Draft voice selection, command replay and project activity', contracts: projectCollections};
export const projectChecksum = createHash('sha256').update(JSON.stringify(projectMigration)).digest('hex');
export const editMigration = {id: '003_project_editing', description: 'Revision-checked brief edits and replay snapshots', contracts: editCollections};
export const editChecksum = createHash('sha256').update(JSON.stringify(editMigration)).digest('hex');
const migrations = [
  {definition: foundationMigration, checksum: foundationChecksum},
  {definition: projectMigration, checksum: projectChecksum},
  {definition: editMigration, checksum: editChecksum},
  {definition: {id: '004_provider_catalog', description: 'Provider observations, voice tests and conservative free reservations', contracts: providerCollections}, checksum: createHash('sha256').update(JSON.stringify(providerCollections)).digest('hex')},
  {definition: {id: '005_provider_operator_policy', description: 'Independent operator disablement preserving legacy provider rows', contracts: providerPolicyCollections}, checksum: createHash('sha256').update(JSON.stringify(providerPolicyCollections)).digest('hex')},
  {definition: {id: '006_ai_planning', description: 'Durable planning jobs, immutable proposals, worker ownership and free budget', contracts: planningCollections}, checksum: createHash('sha256').update(JSON.stringify(planningCollections)).digest('hex')},
  {definition: {id: '007_plan_text_edits', description: 'Immutable direct plan edits, provenance and command replay', contracts: planEditCollections}, checksum: createHash('sha256').update(JSON.stringify(planEditCollections)).digest('hex')},
  {definition: {id: '008_plan_history', description: 'Plan restore provenance and durable restore receipts', contracts: planHistoryCollections}, checksum: createHash('sha256').update(JSON.stringify(planHistoryCollections)).digest('hex')},
  {definition: {id: '009_generation_queue', description: 'Exact-input approvals, generation command receipts and guarded queue admission', contracts: generationCollections}, checksum: createHash('sha256').update(JSON.stringify(generationCollections)).digest('hex')},
  {definition: {id: '010_generation_worker', description: 'Generation leases, durable speech attempts and validated local artifact records', contracts: generationWorkerCollections}, checksum: createHash('sha256').update(JSON.stringify(generationWorkerCollections)).digest('hex')},
  {definition: {id: '011_private_media_storage', description: 'Private immutable media bundles and storage-only recovery leases', contracts: storageCollections}, checksum: createHash('sha256').update(JSON.stringify(storageCollections)).digest('hex')},
  {definition: {id: '012_ready_video_playback', description: 'Immutable ready videos and owned private asset pins', contracts: videoCollections}, checksum: createHash('sha256').update(JSON.stringify(videoCollections)).digest('hex')},
  {definition: {id: '013_verified_speech_reuse', description: 'Verified local speech reuse provenance and source retention pins', contracts: speechReuseCollections}, checksum: createHash('sha256').update(JSON.stringify(speechReuseCollections)).digest('hex')},
  {definition: {id: '014_workspace_settings', description: 'Nullable shared voice defaults, workspace activity and settings replay receipts', contracts: workspaceSettingsCollections}, checksum: createHash('sha256').update(JSON.stringify(workspaceSettingsCollections)).digest('hex')},
  {definition: {id: '015_workspace_brand', description: 'Immutable brand palettes, independent revision CAS and replay receipts', contracts: brandCollections}, checksum: createHash('sha256').update(JSON.stringify(brandCollections)).digest('hex')},
  {definition: {id: '016_logo_preparation', description: 'Leased image validation receipts and immutable private prepared logos', contracts: logoCollections}, checksum: createHash('sha256').update(JSON.stringify(logoCollections)).digest('hex')},
  {definition:{id:'017_brand_logo_pins',description:'Immutable brand and generation logo ownership pins',contracts:brandLogoCollections},checksum:createHash('sha256').update(JSON.stringify(brandLogoCollections)).digest('hex')},
  {definition:{id:'018_personal_preferences',description:'Scoped personal preference replay and separate accent selection',contracts:preferencesCollections},checksum:createHash('sha256').update(JSON.stringify(preferencesCollections)).digest('hex')},
  {definition:{id:'019_project_duplication',description:'Permanent duplication receipts and independent copied plan provenance',contracts:duplicateCollections},checksum:createHash('sha256').update(JSON.stringify(duplicateCollections)).digest('hex')},
  {definition:{id:'020_project_tombstones',description:'Guarded idle project access removal and permanent minimal deletion receipts',contracts:deletionCollections},checksum:createHash('sha256').update(JSON.stringify(deletionCollections)).digest('hex')},
];
const currentContracts = [...new Map(migrations.flatMap(migration => migration.definition.contracts).map(contract => [contract.name, contract])).values()];

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
    pipeline.push({$group: {_id: Object.fromEntries(Object.keys(index.key).map((key, i) => [`key${i}`, `$${key}`])), count: {$sum: 1}}}, {$match: {count: {$gt: 1}}}, {$limit: 1});
    if ((await db.collection(contract.name).aggregate(pipeline, {maxTimeMS: 10000}).toArray()).length) {
      throw new DatabaseSetupError(`DUPLICATE_EXISTING_KEYS:${contract.name}`);
    }
  }
}

async function verifyContract(db: Db, contract: CollectionContract, allowMissingIndexes = false) {
  const collection = await info(db, contract.name);
  if (!collection) throw new DatabaseSetupError(`COLLECTION_MISSING:${contract.name}`);
  if (Object.keys(contract.validator).length && (
    !equivalent(collection.options?.validator, contract.validator)
    || collection.options?.validationLevel !== 'strict' || collection.options?.validationAction !== 'error'
  )) throw new DatabaseSetupError(`VALIDATOR_DRIFT:${contract.name}`);
  const indexes = await db.collection(contract.name).listIndexes().toArray();
  for (const expected of contract.indexes) {
    const actual = indexes.find(index => index.name === expected.name);
    if (!actual && allowMissingIndexes) continue;
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
  for (const migration of migrations) {
    const row = await db.collection<Migration>('schema_migrations').findOne({_id: migration.definition.id});
    if (!row || row.state !== 'applied') throw new DatabaseSetupError('MIGRATION_REQUIRED');
    if (row.checksum !== migration.checksum) throw new DatabaseSetupError('MIGRATION_CHECKSUM_MISMATCH');
  }
  await verifyTransactionTopology(db);
  await verifyContract(db, migrationCollection);
  for (const contract of currentContracts) await verifyContract(db, contract);
}

/** Operator tooling only: audits document shapes without logging rows or values. */
export async function checkDatabase(db: Db) {
  await assertDatabaseReady(db);
  for (const contract of [migrationCollection, ...currentContracts]) await auditRows(db, contract);
}

/** Non-destructive, explicit migration. Run with application/worker writes stopped.
 * DDL is not transactional. A failed migration is resumable only with retryFailed;
 * a running/crashed owner is never automatically stolen or timed out.
 */
export async function migrateDatabase(db: Db, options: {retryFailed?: boolean} = {}) {
  await verifyTransactionTopology(db);
  // Only an initial bootstrap may create the lock index. Recorded history turns
  // missing or changed lock metadata into drift, before any migration writes.
  if (!await info(db, migrationCollection.name)) await createIfMissing(db, migrationCollection);
  const history = db.collection<Migration>(migrationCollection.name);
  const hasHistory = await history.findOne({}, {projection: {_id: 1}});
  await verifyContract(db, migrationCollection, !hasHistory);
  await auditRows(db, migrationCollection);
  if (!hasHistory) {
    const indexes = await history.listIndexes().toArray();
    for (const index of migrationCollection.indexes) {
      if (indexes.some(existing => existing.name === index.name)) continue;
      // A concurrent first runner may have finished bootstrap in the meantime.
      if (await history.findOne({}, {projection: {_id: 1}})) break;
      await history.createIndex(index.key, index);
    }
  }
  await verifyContract(db, migrationCollection);
  let changed = false;
  const baseline = new Map<string, CollectionContract>();
  for (const migration of migrations) {
    const previous = await db.collection<Migration>('schema_migrations').findOne({_id: migration.definition.id});
    if (previous?.state !== 'applied') {
      // Refuse baseline drift before a new migration can overwrite its evidence.
      for (const contract of baseline.values()) {
        let expected = contract;
        try {await verifyContract(db, expected);}
        catch (error) {
          const pending = migration.definition.contracts.find(candidate => candidate.name === contract.name);
          if (!(previous?.state === 'failed' && options.retryFailed && pending && error instanceof DatabaseSetupError && error.code.startsWith('VALIDATOR_DRIFT:'))) throw error;
          // DDL may have committed this migration's new validator before failure.
          // Accept that exact validator on explicit retry, preserving baseline indexes.
          expected = {...contract, validator: pending.validator};
          await verifyContract(db, expected);
        }
        await auditRows(db, expected);
      }
    }
    if (await applyMigration(db, migration.definition, migration.checksum, options)) changed = true;
    for (const contract of migration.definition.contracts) baseline.set(contract.name, contract);
  }
  await checkDatabase(db);
  return changed ? 'applied' as const : 'already_applied' as const;
}

async function applyMigration(db: Db, migration: {id: string; description: string; contracts: CollectionContract[]}, checksum: string, options: {retryFailed?: boolean}) {
  const history = db.collection<Migration>('schema_migrations');
  const previous = await history.findOne({_id: migration.id});
  if (previous && previous.checksum !== checksum) throw new DatabaseSetupError('MIGRATION_CHECKSUM_MISMATCH');
  if (previous?.state === 'applied') return false;
  if (previous?.state === 'running') throw new DatabaseSetupError('MIGRATION_OWNED');
  if (previous && !(previous.state === 'failed' && options.retryFailed)) throw new DatabaseSetupError('MIGRATION_REQUIRES_EXPLICIT_RETRY');

  const owner = randomUUID();
  const epoch = previous ? previous.leaseEpoch.add(Long.ONE) : Long.ONE;
  try {
    if (previous) {
      const claim = await history.updateOne({_id: previous._id, state: 'failed', owner: previous.owner, leaseEpoch: previous.leaseEpoch}, {$set: {state: 'running', owner, leaseEpoch: epoch, startedAt: new Date(), finishedAt: null, safeError: null}}, {writeConcern: {w: 'majority'}});
      if (claim.modifiedCount !== 1) throw new DatabaseSetupError('MIGRATION_OWNED');
    } else {
      await history.insertOne({_id: migration.id, checksum,
        description: migration.description, state: 'running', lockName: 'schema', owner,
        leaseEpoch: epoch, startedAt: new Date(), finishedAt: null, safeError: null}, {writeConcern: {w: 'majority'}});
    }
  } catch (error) {
    if (hasCode(error, 11000)) throw new DatabaseSetupError('MIGRATION_OWNED');
    throw error;
  }

  const ownership = {_id: migration.id, state: 'running' as const, owner, leaseEpoch: epoch};
  try {
    // Audit all existing documents/unique keys before tightening any owned schema.
    for (const contract of migration.contracts) await auditRows(db, contract);
    for (const contract of migration.contracts) {
      if (!await history.findOne(ownership, {projection: {_id: 1}})) throw new DatabaseSetupError('MIGRATION_OWNERSHIP_LOST');
      await createIfMissing(db, contract);
      if (Object.keys(contract.validator).length) await db.command({collMod: contract.name, validator: contract.validator, validationLevel: 'strict', validationAction: 'error', writeConcern: {w: 'majority'}});
      for (const index of contract.indexes) await db.collection(contract.name).createIndex(index.key, index);
      await verifyContract(db, contract);
      await auditRows(db, contract);
    }
    const result = await history.updateOne(ownership, {$set: {state: 'applied', finishedAt: new Date()}}, {writeConcern: {w: 'majority'}});
    if (result.modifiedCount !== 1) throw new DatabaseSetupError('MIGRATION_OWNERSHIP_LOST');
    return true;
  } catch (error) {
    await history.updateOne(ownership, {$set: {state: 'failed', finishedAt: new Date(), safeError: {
      code: 'MIGRATION_FAILED', message: 'Database migration did not finish. Details are redacted.', retryable: false,
      action: 'Audit the database before explicitly retrying this migration.', requestId: owner, classification: 'database',
    }}}, {writeConcern: {w: 'majority'}}).catch(() => {});
    throw error;
  }
}
