import {Long, type ClientSession, type Db, type Document, type MongoClient} from 'mongodb';
import {isDeepStrictEqual} from 'node:util';
import {databaseTransaction} from '../db/transactions';
import {requireProjectId} from '../projects/contracts';
import type {ProjectRecord} from '../projects/service';
import {inspectDeletionWork} from '../projects/deletion-work';
import type {Row} from '../planning/service';
import {LocalCleanupService} from './local-service';
import {hasRetainedSpeechPin, matchesReuseRelease, type ReuseRelease} from './reuse-pins';
import {CleanupFault} from './contracts';
import {sourceRecordHash, projectPayload, type SourceCollection, type SourcePurgeReceipt, type PurgedRecord} from './source-contracts';
const removed = ['jobs', 'plan_versions', 'approvals', 'ready_videos'] as const;
const redacted = ['idempotency_records', 'project_duplicate_commands'] as const;
const fail = () => new CleanupFault('SOURCE_PURGE_UNAVAILABLE');
const blankBrief = () => ({idea: 'Source removed', audience: 'Source removed', references: []});
function redactSnapshot(raw: unknown, projectId: string) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw fail();
  const value = raw as Record<string, any>;
  if (value.id !== projectId || !value.brief || !value.createdBy || !value.updatedBy) throw fail();
  return {...value, displayTitle: 'Deleted project', brief: blankBrief(), createdBy: {...value.createdBy, name: 'Team member'},
    updatedBy: {...value.updatedBy, name: 'Team member'}, currentPlanVersionId: null, currentPlanInputHash: null,
    activePlanningJobId: null, latestRun: null, latestReadyVideo: null, publishing: [], allowedActions: [], blockedReasons: []};
}
/** DB content only, after ownership/physical-cleanup checkpoints. No external I/O. */
export class SourcePurgeService {
  constructor(private client: MongoClient, private name: string) {}
  private async rows(db: Db, session: ClientSession, collection: string, filter: Document) {
    const rows = await db.collection<Row>(collection).find(filter, {session, batchSize: 101}).limit(101).toArray();
    if (rows.length > 100) throw new CleanupFault('SOURCE_PURGE_LIMIT');
    for (const row of rows) requireProjectId(row._id);
    return rows;
  }
  private filters(project: ProjectRecord) {
    const scope = {workspaceId: project.workspaceId, projectId: project._id};
    return {jobs: scope, plan_versions: scope, approvals: scope, ready_videos: scope,
      idempotency_records: {workspaceId: project.workspaceId, 'safeResultRef.id': project._id},
      project_duplicate_commands: scope} satisfies Record<typeof removed[number]|typeof redacted[number], Document>;
  }
  private async replay(db: Db, session: ClientSession, project: ProjectRecord, receipt: SourcePurgeReceipt) {
    if (receipt.projectId !== project._id || receipt.workspaceId !== project.workspaceId || receipt.policy !== 'deleted-project-source-v1'
      || receipt.deletedAt.getTime() !== project.deletedAt.getTime() || receipt.projectPayloadHash !== sourceRecordHash(projectPayload(project))) throw new CleanupFault('SOURCE_PURGE_DRIFT');
    const filters = this.filters(project);
    for (const collection of removed) if (await db.collection(collection).findOne(filters[collection], {session, projection: {_id: 1}})) throw new CleanupFault('SOURCE_PURGE_DRIFT');
    for (const collection of redacted) for (const row of await this.rows(db, session, collection, filters[collection])) {
      const entry = receipt.records.find(r => r.collection === collection && r.id === row._id && r.mode === 'redacted');
      if (!entry || sourceRecordHash(row) !== entry.afterHash) throw new CleanupFault('SOURCE_PURGE_DRIFT');
    }
    return {projectId: project._id, replayed: true, sourceRecordsRemoved: true, retainedMetadata: true, allDataErased: false,
      records: receipt.records.length, completedAt: receipt.completedAt.toISOString()};
  }
  async purge(projectId: string) {
    requireProjectId(projectId);
    return databaseTransaction(this.client, this.name, async (db, session) => {
      const project = await db.collection<ProjectRecord>('projects').findOne({_id: projectId, deletedAt: {$type: 'date'}}, {session});
      if (!project?.deletionReceipt || project.deletionReceipt.projectId !== projectId || project.deletionReceipt.accessRemoved !== true) throw fail();
      const prior = await db.collection<SourcePurgeReceipt>('source_purge_receipts').findOne({_id: projectId}, {session});
      if (prior) return this.replay(db, session, project, prior);
      const scope = {workspaceId: project.workspaceId, projectId};
      const work = await inspectDeletionWork(db, session, project);
      if (!work.impact.canDelete || work.planning.length || work.generation.length || project.activePlanningJobId || project.latestRunId) throw fail();
      if (await db.collection('publishing_payloads').findOne({}, {session, projection: {_id: 1}})
        || await db.collection('publishing_intents').findOne(scope, {session, projection: {_id: 1}})
        || await db.collection('asset_refs').findOne({}, {session, projection: {_id: 1}})) throw fail();
      for (const [collection, completed] of [['media_cleanup_tasks', 'deleted'], ['local_render_cleanup_tasks', 'cleaned'], ['speech_cleanup_tasks', 'removed']])
        if (await db.collection(collection).findOne({...scope, state: {$ne: completed}}, {session, projection: {_id: 1}})) throw fail();
      const filters = this.filters(project), sources = new Map<SourceCollection, Row[]>();
      for (const collection of [...removed, ...redacted]) {
        if (await db.collection(collection).findOne({projectId, workspaceId: {$ne: project.workspaceId}}, {session, projection: {_id: 1}})) throw fail();
        sources.set(collection, await this.rows(db, session, collection, filters[collection]));
      }
      if (await db.collection('idempotency_records').findOne({'safeResultRef.id': projectId, workspaceId: {$ne: project.workspaceId}}, {session, projection: {_id: 1}})) throw fail();
      const plans = sources.get('plan_versions')!;
      if (await db.collection('plan_versions').findOne({duplicatedFromPlanVersionId: {$in: plans.map(p => p._id)}, projectId: {$ne: projectId}}, {session, projection: {_id: 1}})
        || await db.collection('project_duplicate_commands').findOne({sourceProjectId: projectId, projectId: {$ne: projectId}}, {session, projection: {_id: 1}})
        || await db.collection<Row>('projects').findOne({sourceProjectId: projectId, _id: {$ne: projectId}}, {session, projection: {_id: 1}})) throw fail();
      const runs = await this.rows(db, session, 'generation_runs', scope);
      if (await db.collection('generation_runs').findOne({projectId, workspaceId: {$ne: project.workspaceId}}, {session, projection: {_id: 1}})) throw fail();
      const jobs = sources.get('jobs')!;
      if (jobs.some(j => !['ready', 'failed', 'cancelled', 'superseded'].includes(j.state) || j.owner != null || j.leaseUntil != null || !['none', 'settled'].includes(j.submission))) throw fail();
      const stages = await this.rows(db, session, 'stage_attempts', {jobId: {$in: jobs.map(j => j._id)}});
      if (stages.some(s => s.state !== 'settled')) throw fail();
      const attempts = await this.rows(db, session, 'generation_speech_attempts', {runId: {$in: runs.map(r => r._id)}});
      if (sources.get('approvals')!.some(a => !runs.some(r => r.approvalId === a._id))
        || sources.get('ready_videos')!.some(v => !runs.some(r => r._id === v.runId && r.artifactId === v._id && r.state === 'rendered_local'))) throw fail();
      const references = await this.rows(db, session, 'generation_speech_reuses', {$or: [scope, {runId: {$in: runs.map(r => r._id)}}, {sourceRunId: {$in: runs.map(r => r._id)}}, {sourceAttemptId: {$in: attempts.map(a => a._id)}}]});
      for (const ref of references) if (ref.workspaceId !== project.workspaceId || ref.projectId !== projectId
        || !runs.some(r => r._id === ref.runId) || !runs.some(r => r._id === ref.sourceRunId)
        || !matchesReuseRelease(ref, await db.collection<ReuseRelease>('speech_reuse_releases').findOne({_id: ref._id}, {session}))) throw fail();
      for (const run of runs) {
        if (!['cancelled', 'failed', 'rendered_local'].includes(run.state) || run.owner != null || run.leaseUntil != null || !(run.finishedAt instanceof Date)) throw fail();
        if (run.state !== 'rendered_local' && (run.startedAt != null || run.artifactId || run.submissionCount > 0)) throw new CleanupFault('SOURCE_LIFECYCLE_UNRESOLVED');
        if (run.state === 'rendered_local') {
          const proof = await LocalCleanupService.proof(db, session, run._id);
          const local = await db.collection<Row>('local_render_cleanup_tasks').findOne({_id: run.artifactId, ...scope, runId: run._id, state: 'cleaned'}, {session});
          if (!local || !isDeepStrictEqual(local.source, proof.source)) throw fail();
        }
      }
      if (await db.collection('provider_controls').findOne({reservations: {$elemMatch: {id: {$in: runs.map(r => r.reservationId)}, state: {$ne: 'settled'}}}}, {session, projection: {_id: 1}})) throw fail();
      for (const attempt of attempts) {
        if (attempt.workspaceId !== project.workspaceId || !['settled', 'refused'].includes(attempt.state)) throw fail();
        if (attempt.state === 'settled') {
          const task = await db.collection<Row>('speech_cleanup_tasks').findOne({_id: attempt._id, ...scope, state: 'removed'}, {session});
          if (!task || task.source.runId !== attempt.runId || task.source.attemptId !== attempt._id
            || !['audioHash', 'byteLength', 'sampleRate', 'inputHash', 'providerConfigHash', 'textHash', 'segmentId'].every(key => task.source[key] === attempt[key])
            || await hasRetainedSpeechPin(db, attempt._id, session)) throw fail();
        }
      }
      // Final sources are consumed only after all proofs, on this same snapshot.
      if (!Long.isLong(project.guardRevision) || project.guardRevision.isNegative() || project.guardRevision.greaterThanOrEqual(Long.fromNumber(Number.MAX_SAFE_INTEGER))) throw fail();
      const next = {...project, displayTitle: 'Deleted project', searchTitle: 'deleted project', brief: blankBrief(), currentPlanVersionId: null,
        planningRequestId: null, latestReadyVideoId: null, latestRunId: null, activePlanningJobId: null, guardRevision: project.guardRevision.add(Long.ONE)};
      const records: PurgedRecord[] = [{collection: 'projects', id: projectId, mode: 'redacted', beforeHash: sourceRecordHash(projectPayload(project)), afterHash: sourceRecordHash(projectPayload(next))}];
      if (!(await db.collection<ProjectRecord>('projects').replaceOne({_id: projectId, workspaceId: project.workspaceId, deletedAt: project.deletedAt, guardRevision: project.guardRevision}, next, {session})).matchedCount) throw fail();
      for (const collection of removed) {
        const rows = sources.get(collection)!;
        records.push(...rows.map(row => ({collection, id: row._id, mode: 'removed' as const, beforeHash: sourceRecordHash(row), afterHash: null})));
        const result = await db.collection<Row>(collection).deleteMany({...filters[collection], _id: {$in: rows.map(r => r._id)}}, {session});
        if (result.deletedCount !== rows.length) throw fail();
      }
      for (const collection of redacted) for (const row of sources.get(collection)!) {
        const field = collection === 'idempotency_records' ? 'safeResponseSnapshot' : 'snapshot';
        const after = {...row, [field]: redactSnapshot(row[field], projectId)};
        records.push({collection, id: row._id, mode: 'redacted', beforeHash: sourceRecordHash(row), afterHash: sourceRecordHash(after)});
        if (!(await db.collection<Row>(collection).replaceOne({_id: row._id, workspaceId: project.workspaceId}, after, {session})).matchedCount) throw fail();
      }
      const now = new Date();
      await db.collection<SourcePurgeReceipt>('source_purge_receipts').insertOne({_id: projectId, ...scope, deletedAt: project.deletedAt, completedAt: now,
        policy: 'deleted-project-source-v1', guardRevision: next.guardRevision, projectPayloadHash: sourceRecordHash(projectPayload(next)), records}, {session});
      return {projectId, replayed: false, sourceRecordsRemoved: true, retainedMetadata: true, allDataErased: false, records: records.length, completedAt: now.toISOString()};
    });
  }
}
