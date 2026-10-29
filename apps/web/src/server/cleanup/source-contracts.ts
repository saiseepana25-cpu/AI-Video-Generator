import {createHash} from 'node:crypto';
import {Long, type Db} from 'mongodb';
import {CleanupFault} from './contracts';
export const sourceCollections = ['projects', 'jobs', 'plan_versions', 'approvals', 'ready_videos', 'idempotency_records', 'project_duplicate_commands'] as const;
export type SourceCollection = typeof sourceCollections[number];
export type PurgedRecord = {collection: SourceCollection; id: string; mode: 'removed'|'redacted'; beforeHash: string; afterHash: string|null};
export type SourcePurgeReceipt = {_id: string; workspaceId: string; projectId: string; deletedAt: Date; completedAt: Date;
  policy: 'deleted-project-source-v1'; guardRevision: Long; projectPayloadHash: string; records: PurgedRecord[]};
/** Typed recursive encoding pins nested BSON counters/dates and every field. */
export function sourceRecordHash(value: unknown): string {
  const encode = (v: unknown): unknown => {
    if (Long.isLong(v)) return ['long', v.toString()];
    if (v instanceof Date) {
      if (!Number.isFinite(v.getTime())) throw new CleanupFault('SOURCE_PURGE_UNAVAILABLE');
      return ['date', v.toISOString()];
    }
    if (v === null) return ['null'];
    if (typeof v === 'string' || typeof v === 'boolean') return [typeof v, v];
    if (typeof v === 'number' && Number.isFinite(v)) return ['number', v];
    if (Array.isArray(v)) return ['array', v.map(encode)];
    if (v && typeof v === 'object') return ['object', Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, encode(item)])];
    throw new CleanupFault('SOURCE_PURGE_UNAVAILABLE');
  };
  return createHash('sha256').update(JSON.stringify(encode(value))).digest('hex');
}
export function projectPayload(value: Record<string, unknown>) {
  return {id: value._id, workspaceId: value.workspaceId, deletedAt: value.deletedAt, displayTitle: value.displayTitle, searchTitle: value.searchTitle,
    brief: value.brief, currentPlanVersionId: value.currentPlanVersionId ?? null, planningRequestId: value.planningRequestId ?? null,
    latestReadyVideoId: value.latestReadyVideoId ?? null, latestRunId: value.latestRunId ?? null, activePlanningJobId: value.activePlanningJobId ?? null};
}
export async function sourceCleanupStatus(db: Db, workspaceId: string, projectId: string) {
  const receipt = await db.collection<SourcePurgeReceipt>('source_purge_receipts').findOne({_id: projectId, workspaceId, projectId});
  return receipt ? {state: 'source_records_removed' as const, completedAt: receipt.completedAt.toISOString(), records: receipt.records.length,
    retainedMetadata: true, allDataErased: false} : {state: 'not_started' as const, completedAt: null, records: 0, retainedMetadata: true, allDataErased: false};
}
