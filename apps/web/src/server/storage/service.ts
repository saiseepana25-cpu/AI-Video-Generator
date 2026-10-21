import {randomUUID} from 'node:crypto';
import {Long, type ClientSession, type Db, type MongoClient} from 'mongodb';
import {databaseTransaction} from '../db/transactions';
import type {Row} from '../planning/service';
import type {Approval, GenerationRun, LocalArtifact} from '../generation/contracts';
import {canonicalJson, generationHash, validateRenderPlan} from '../rendering/contract';
import {maxBundleBytes, storageFiles, storageKinds, StorageFault, type ArtifactReader, type ObjectStore, type StorageBundle, type StorageSource} from './contracts';
import {sha256, verifyObject} from './r2';

export class StorageService {
  readonly owner = randomUUID(); private busy = false;
  private unreadableSources = new Set<string>();
  constructor(private client: MongoClient, private name: string, private store: ObjectStore, private reader: ArtifactReader) {}
  private get db() {return this.client.db(this.name);}
  private async source(db: Db, runId: string, session?: ClientSession): Promise<StorageSource> {
    const run = await db.collection<GenerationRun>('generation_runs').findOne({_id: runId, state: 'rendered_local'}, {session});
    if (!run?.artifactId) throw new StorageFault('STORAGE_SOURCE_UNAVAILABLE');
    const project = await db.collection<Row>('projects').findOne({_id: run.projectId, workspaceId: run.workspaceId, deletedAt: null}, {session});
    const artifact = await db.collection<LocalArtifact>('generation_local_artifacts').findOne({_id: run.artifactId, runId, workspaceId: run.workspaceId, approvalId: run.approvalId, inputHash: run.inputHash, rendererBuildHash: run.rendererBuildHash}, {session});
    const approval = await db.collection<Approval>('approvals').findOne({_id: run.approvalId, projectId: run.projectId, workspaceId: run.workspaceId, inputHash: run.inputHash, planVersionId: run.planVersionId}, {session});
    if (!project || !artifact || !approval) throw new StorageFault('STORAGE_SOURCE_UNAVAILABLE');
    const plan = validateRenderPlan(JSON.parse(approval.inputCanonical));
    if (generationHash(plan) !== run.inputHash || canonicalJson(plan) !== approval.inputCanonical) throw new StorageFault('STORAGE_SOURCE_CHANGED');
    return {run, artifact, approval};
  }
  private async guard(db: Db, session: ClientSession, bundle: StorageBundle) {
    const source = await this.source(db, bundle.runId, session);
    if (source.run.workspaceId !== bundle.workspaceId || source.run.projectId !== bundle.projectId || source.run.approvalId !== bundle.approvalId
      || source.artifact._id !== bundle.artifactId || source.artifact.manifestHash !== bundle.manifestHash || source.run.inputHash !== bundle.inputHash
      || source.run.rendererBuildHash !== bundle.rendererBuildHash || this.store.configHash !== bundle.configHash || this.store.bucket !== bundle.bucket) throw new StorageFault('STORAGE_SOURCE_CHANGED');
    await db.collection<Row>('projects').updateOne({_id: bundle.projectId, workspaceId: bundle.workspaceId, deletedAt: null}, {$inc: {guardRevision: Long.ONE}}, {session});
    return source;
  }
  async prepare(runId: string) {
    const existing = await this.db.collection<StorageBundle>('generation_storage_bundles').findOne({runId}); if (existing) return existing;
    const source = await this.source(this.db, runId), bytes = await this.reader.read(source), id = source.artifact._id;
    if (sha256(bytes.manifest) !== source.artifact.manifestHash || bytes.input.toString('utf8') !== source.approval.inputCanonical) throw new StorageFault('STORAGE_SOURCE_CHANGED');
    const prefix = `workspaces/${source.run.workspaceId}/projects/${source.run.projectId}/runs/${runId}/bundles/${id}`;
    const objects = storageKinds.map(kind => ({kind, key: `${prefix}/${storageFiles[kind].name}`, mime: storageFiles[kind].mime, size: bytes[kind].length, sha256: sha256(bytes[kind])}));
    for (const object of objects) verifyObject(object, bytes[object.kind]);
    if (objects.reduce((sum, o) => sum + o.size, 0) > maxBundleBytes) throw new StorageFault('STORAGE_TOO_LARGE');
    const now = new Date();
    const bundle: StorageBundle = {_id: id, schemaVersion: 1, workspaceId: source.run.workspaceId, projectId: source.run.projectId, runId, approvalId: source.run.approvalId, artifactId: id,
      inputHash: source.run.inputHash, manifestHash: source.artifact.manifestHash, rendererBuildHash: source.artifact.rendererBuildHash, configHash: this.store.configHash, bucket: this.store.bucket, objects,
      state: 'pending', revision: Long.ONE, owner: null, epoch: Long.ZERO, leaseUntil: null, createdAt: now, updatedAt: now, storedAt: null, error: null};
    try {return await databaseTransaction(this.client, this.name, async (db, session) => {
      await this.guard(db, session, bundle);
      const winner = await db.collection<StorageBundle>('generation_storage_bundles').findOne({runId}, {session}); if (winner) return winner;
      await db.collection<StorageBundle>('generation_storage_bundles').insertOne(bundle, {session}); return bundle;
    });} catch (error) {const winner = await this.db.collection<StorageBundle>('generation_storage_bundles').findOne({runId}); if (winner) return winner; throw error;}
  }
  async retry(runId: string) {
    return databaseTransaction(this.client, this.name, async (db, session) => {
      const bundle = await db.collection<StorageBundle>('generation_storage_bundles').findOne({runId}, {session});
      if (!bundle || bundle.state !== 'failed') throw new StorageFault('STORAGE_RETRY_UNAVAILABLE');
      await this.guard(db, session, bundle);
      await db.collection<StorageBundle>('generation_storage_bundles').updateOne({_id: bundle._id, revision: bundle.revision, state: 'failed'}, {$set: {state: 'pending', error: null, updatedAt: new Date()}, $inc: {revision: Long.ONE}}, {session});
    });
  }
  private async fence(bundle: StorageBundle, finish = false) {
    return databaseTransaction(this.client, this.name, async (db, session) => {
      const source = await this.guard(db, session, bundle), now = new Date();
      const result = await db.collection<StorageBundle>('generation_storage_bundles').updateOne({_id: bundle._id, state: 'uploading', owner: this.owner, epoch: bundle.epoch, leaseUntil: {$gt: now}},
        {$set: finish ? {state: 'stored', owner: null, leaseUntil: null, storedAt: now, updatedAt: now, error: null} : {leaseUntil: new Date(now.getTime() + 180000), updatedAt: now}, $inc: {revision: Long.ONE}}, {session});
      if (!result.matchedCount) throw new StorageFault('STORAGE_OWNERSHIP_LOST');
      if (finish) {
        const workspace = await db.collection<Row>('workspaces').findOneAndUpdate({_id: bundle.workspaceId}, {$inc: {nextActivitySequence: Long.ONE}}, {session, returnDocument: 'after'});
        if (!workspace) throw new StorageFault('STORAGE_SOURCE_UNAVAILABLE');
        await db.collection<Row>('activity_events').insertOne({_id: bundle._id, schemaVersion: 1, workspaceId: bundle.workspaceId, projectId: bundle.projectId,
          sequence: workspace.nextActivitySequence, dedupeKey: `storage:${bundle._id}:stored`, type: 'generation_changed', actor: {kind: 'user', userId: source.run.createdBy}, resourceRefs: {projectId: bundle.projectId},
          message: 'Validated video and subtitles were saved to private storage. Dashboard delivery is pending.', actionNeeded: false, safeActionRoute: `/projects/${bundle.projectId}`, createdAt: now}, {session});
      }
      return source;
    });
  }
  async tick(runId?: string) {
    if (this.busy) return false; this.busy = true;
    let bundle: StorageBundle | null = null;
    try {
      const now = new Date();
      bundle = await this.db.collection<StorageBundle>('generation_storage_bundles').findOneAndUpdate({...(runId ? {runId} : {}), configHash: this.store.configHash, bucket: this.store.bucket,
        $or: [{state: 'pending'}, {state: 'uploading', leaseUntil: {$lte: now}}]}, {$set: {state: 'uploading', owner: this.owner, leaseUntil: new Date(now.getTime() + 180000), error: null, updatedAt: now},
        $inc: {epoch: Long.ONE, revision: Long.ONE}}, {sort: {createdAt: 1, _id: 1}, returnDocument: 'after'});
      if (!bundle) return false;
      const source = await this.fence(bundle), bytes = await this.reader.read(source);
      if (sha256(bytes.manifest) !== bundle.manifestHash || bytes.input.toString('utf8') !== source.approval.inputCanonical) throw new StorageFault('STORAGE_SOURCE_CHANGED');
      if (bundle.objects.length !== storageKinds.length || new Set(bundle.objects.map(o => o.kind)).size !== storageKinds.length) throw new StorageFault('STORAGE_SOURCE_CHANGED');
      for (const object of bundle.objects) {
        const expected = `workspaces/${bundle.workspaceId}/projects/${bundle.projectId}/runs/${bundle.runId}/bundles/${bundle._id}/${storageFiles[object.kind].name}`;
        if (object.key !== expected) throw new StorageFault('STORAGE_SOURCE_CHANGED');
        verifyObject(object, bytes[object.kind]);
      }
      for (const object of bundle.objects) {await this.fence(bundle); await this.store.ensure(object, bytes[object.kind]);}
      await this.fence(bundle, true); return true;
    } catch (error) {
      if (bundle) await this.db.collection<StorageBundle>('generation_storage_bundles').updateOne({_id: bundle._id, owner: this.owner, epoch: bundle.epoch, state: 'uploading', leaseUntil: {$gt: new Date()}},
        {$set: {state: 'failed', owner: null, leaseUntil: null, updatedAt: new Date(), error: error instanceof StorageFault ? error.code : 'STORAGE_FAILED'}, $inc: {revision: Long.ONE}});
      throw new StorageFault(error instanceof StorageFault ? error.code : 'STORAGE_FAILED');
    } finally {this.busy = false;}
  }
  async discover() {
    const [candidate] = await this.db.collection<GenerationRun>('generation_runs').aggregate<GenerationRun>([
      {$match: {state: 'rendered_local', _id: {$nin: [...this.unreadableSources]}}},
      {$lookup: {from: 'projects', let: {project: '$projectId', workspace: '$workspaceId'}, pipeline: [{$match: {deletedAt: null, $expr: {$and: [{$eq: ['$_id', '$$project']}, {$eq: ['$workspaceId', '$$workspace']}]}}}], as: 'liveProject'}},
      {$match: {'liveProject.0': {$exists: true}}}, {$lookup: {from: 'generation_storage_bundles', localField: '_id', foreignField: 'runId', as: 'bundle'}},
      {$match: {'bundle.0': {$exists: false}}}, {$sort: {createdAt: 1, _id: 1}}, {$limit: 1}, {$unset: 'bundle'},
    ]).toArray();
    if (!candidate) return false;
    // A missing/corrupt local folder must not starve unrelated completed runs.
    // Fix the source and use explicit store, or restart discovery to reconsider.
    if (this.unreadableSources.size >= 1000) throw new StorageFault('STORAGE_DISCOVERY_PAUSED');
    try {await this.prepare(candidate._id); return true;}
    catch (error) {this.unreadableSources.add(candidate._id); throw error;}
  }
}
