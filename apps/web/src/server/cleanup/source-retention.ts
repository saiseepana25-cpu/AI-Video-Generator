import {Long, type ClientSession, type Db, type Document, type MongoClient} from 'mongodb';
import {databaseTransaction} from '../db/transactions';
import {requireProjectId} from '../projects/contracts';
import type {ProjectRecord} from '../projects/service';
import type {Row} from '../planning/service';
import {CleanupFault} from './contracts';
import {matchesReuseRelease, type ReuseRelease} from './reuse-pins';

const limit = 200;
const faults = {
  unresolved_work: 'Resolve queued, running, leased or uncertain work; lease expiry is not stop evidence.',
  incomplete_media_cleanup: 'Stored media or completed render cleanup still requires review.',
  incomplete_speech_cleanup: 'Settled speech has no matching completed removal checkpoint.',
  retained_reuse: 'A speech reuse reference has no exact release receipt.',
  external_reference: 'Generic asset or publishing references require a separate ownership policy.',
  copied_plan_provenance: 'Another plan or duplication receipt still refers to this source.',
  scope_mismatch: 'Related metadata has inconsistent workspace/project scope.',
  inventory_limit: 'A bounded inventory was truncated; no complete assessment is possible.',
} as const;
type Blocker = keyof typeof faults;
type Count = {count: number; truncated: boolean};

/** Operator-only snapshot. This is never a purge token or proof of physical absence. */
export async function sourceRetentionAudit(client: MongoClient, name: string, projectId: string) {
  requireProjectId(projectId);
  return databaseTransaction(client, name, async (db, session) => {
    const project = await db.collection<ProjectRecord>('projects').findOne({_id: projectId}, {
      session, projection: {_id: 1, workspaceId: 1, deletedAt: 1, deletionReceipt: 1, revision: 1, guardRevision: 1,
        activePlanningJobId: 1, latestRunId: 1},
    });
    if (!(project?.deletedAt instanceof Date) || project.deletionReceipt?.projectId !== projectId || project.deletionReceipt.accessRemoved !== true)
      throw new CleanupFault('DELETED_PROJECT_REQUIRED');
    const counter = (value: Long) => {
      if (!Long.isLong(value) || value.isNegative() || value.greaterThan(Long.fromNumber(Number.MAX_SAFE_INTEGER)))
        throw new CleanupFault('SOURCE_AUDIT_UNAVAILABLE');
      return value.toNumber();
    };
    const revision = counter(project.revision), guardRevision = counter(project.guardRevision);
    const scope = {workspaceId: project.workspaceId, projectId};
    const blockers = new Set<Blocker>();
    const counts: Record<string, Count> = {};
    // No content, canonical payloads, paths, object keys, error messages or credentials
    // are returned. Reads are serial on one snapshot transaction.
    const read = async (collection: string, filter: Document, fields: Document = {_id: 1}) => {
      // The transaction's 15-second deadline bounds the whole report. Do not
      // inherit find maxTimeMS onto non-awaitData getMore in this driver.
      const rows = await db.collection<Row>(collection).find(filter, {session, projection: fields, batchSize: limit + 1}).limit(limit + 1).toArray();
      const truncated = rows.length > limit;
      counts[collection] = {count: Math.min(rows.length, limit), truncated};
      if (truncated) blockers.add('inventory_limit');
      return rows.slice(0, limit);
    };
    const scoped = async (collection: string, fields?: Document) => {
      if (await db.collection(collection).findOne({projectId, workspaceId: {$ne: project.workspaceId}}, {session, projection: {_id: 1}, maxTimeMS: 3000})) blockers.add('scope_mismatch');
      return read(collection, scope, fields);
    };
    const jobs = await scoped('jobs', {_id: 1, state: 1, submission: 1, owner: 1, leaseUntil: 1});
    const runs = await scoped('generation_runs', {_id: 1, state: 1, owner: 1, leaseUntil: 1, finishedAt: 1, artifactId: 1});
    const plans = await scoped('plan_versions');
    for (const collection of ['approvals', 'generation_commands', 'plan_edit_commands', 'plan_restore_commands', 'project_delete_commands', 'activity_events']) await scoped(collection);
    await read('idempotency_records', {workspaceId: project.workspaceId, 'safeResultRef.id': projectId});
    await read('project_duplicate_commands', {workspaceId: project.workspaceId, $or: [{projectId}, {sourceProjectId: projectId}]});
    const jobIds = jobs.map(row => row._id), runIds = runs.map(row => row._id);
    const attempts = await read('generation_speech_attempts', {runId: {$in: runIds}}, {_id: 1, runId: 1, workspaceId: 1, state: 1,
      audioHash: 1, inputHash: 1, providerConfigHash: 1, textHash: 1, segmentId: 1, byteLength: 1, sampleRate: 1});
    const stages = await read('stage_attempts', {jobId: {$in: jobIds}}, {_id: 1, state: 1});
    await read('planning_commands', {workspaceId: project.workspaceId, jobId: {$in: jobIds}});
    const artifacts = await read('generation_local_artifacts', {runId: {$in: runIds}}, {_id: 1, runId: 1, workspaceId: 1, manifestHash: 1, inputHash: 1, rendererBuildHash: 1});
    const bundles = await scoped('generation_storage_bundles', {_id: 1, state: 1});
    const assets = await scoped('video_assets', {_id: 1, lifecycleState: 1});
    const local = await scoped('local_render_cleanup_tasks', {_id: 1, runId: 1, state: 1, 'source.artifactId': 1,
      'source.runId': 1, 'source.manifestHash': 1, 'source.inputHash': 1, 'source.rendererBuildHash': 1});
    const speech = await scoped('speech_cleanup_tasks', {_id: 1, state: 1, source: 1});
    await scoped('ready_videos');
    await scoped('media_cleanup_tasks');
    await scoped('speech_reuse_releases');
    const reuses = await read('generation_speech_reuses', {$or: [scope, {runId: {$in: runIds}}, {sourceRunId: {$in: runIds}}, {sourceAttemptId: {$in: attempts.map(a => a._id)}}]}, {});
    for (const ref of reuses) {
      if (ref.workspaceId !== project.workspaceId || ref.projectId !== projectId) blockers.add('scope_mismatch');
      if (!matchesReuseRelease(ref, await db.collection<ReuseRelease>('speech_reuse_releases').findOne({_id: ref._id}, {session}))) blockers.add('retained_reuse');
    }
    if (project.activePlanningJobId || project.latestRunId || jobs.some(row => !['ready', 'failed', 'cancelled', 'superseded'].includes(row.state) || ['submitted', 'uncertain'].includes(row.submission) || row.owner != null || row.leaseUntil != null)
      || runs.some(row => !['failed', 'cancelled', 'rendered_local'].includes(row.state) || row.owner != null || row.leaseUntil != null)
      || stages.some(row => row.state !== 'settled') || attempts.some(row => !['settled', 'refused'].includes(row.state))) blockers.add('unresolved_work');
    if (attempts.some(a => a.workspaceId !== project.workspaceId) || artifacts.some(a => a.workspaceId !== project.workspaceId)) blockers.add('scope_mismatch');
    if (bundles.some(row => row.state !== 'stored') || assets.some(row => row.lifecycleState !== 'deleted') || local.some(row => row.state !== 'cleaned') || runs.some(run => {
      if (run.state !== 'rendered_local') return false;
      const artifact = artifacts.find(a => a._id === run.artifactId && a.runId === run._id);
      return !artifact || !local.some(t => t._id === artifact._id && t.runId === run._id && t.state === 'cleaned'
        && t.source?.artifactId === artifact._id && t.source?.runId === run._id && t.source?.manifestHash === artifact.manifestHash
        && t.source?.inputHash === artifact.inputHash && t.source?.rendererBuildHash === artifact.rendererBuildHash);
    })) blockers.add('incomplete_media_cleanup');
    if (speech.some(row => row.state !== 'removed') || attempts.some(a => a.state === 'settled' && !speech.some(t => t._id === a._id && t.state === 'removed'
      && t.source?.attemptId === a._id && t.source?.runId === a.runId
      && ['audioHash', 'inputHash', 'providerConfigHash', 'textHash', 'segmentId', 'byteLength', 'sampleRate'].every(key => t.source?.[key] === a[key])))) blockers.add('incomplete_speech_cleanup');
    // Existing cleanup deliberately refuses any unknown publication payload. An
    // audit keeps that conservative boundary; it cannot classify future owners.
    if (await exists(db, session, 'publishing_payloads', {}) || await exists(db, session, 'publishing_intents', scope)
      || await exists(db, session, 'asset_refs', {})) blockers.add('external_reference');
    if (await exists(db, session, 'plan_versions', {duplicatedFromPlanVersionId: {$in: plans.map(p => p._id)}, projectId: {$ne: projectId}})
      || await exists(db, session, 'project_duplicate_commands', {sourceProjectId: projectId, projectId: {$ne: projectId}})) blockers.add('copied_plan_provenance');
    return {schemaVersion: 1 as const, projectId, observedAt: new Date().toISOString(), revision, guardRevision,
      state: blockers.size ? 'blocked' as const : 'review_required' as const,
      retainedContent: true as const, purgeImplemented: true as const, perCollectionLimit: limit, counts,
      blockers: [...blockers].sort().map(code => ({code, message: faults[code]})),
      limitations: 'Read-only metadata snapshot. No purge permission, physical absence proof, complete orphan inventory or purge eligibility. This audit performs no cleanup; the separate purge-source command must re-prove its bounded source scope.'};
  });
}

async function exists(db: Db, session: ClientSession, collection: string, filter: Document) {
  return !!await db.collection(collection).findOne(filter, {session, projection: {_id: 1}, maxTimeMS: 3000});
}
