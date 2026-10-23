import type {Long} from 'mongodb';
import type {ProjectDetail, ProjectSettings} from '../projects/contracts';

export type Kind = 'brainstorm' | 'plan';
export type JobState = 'queued' | 'running' | 'ready' | 'failed' | 'paused' | 'cancelled' | 'superseded' | 'cancellation_requested';
export type Angle = {id: string; title: string; hook: string; learningObjective: string};
export type Scene = {sceneId: string; heading: string; narration: string; labels: string[]; layout: 'sequence' | 'cycle' | 'comparison'};
// Trusted text/diagram proposals only. No generated markup, code or media URLs.
export type Plan = {schemaVersion: 2; title: string; learningObjective: string; language: 'en' | 'te'; targetSeconds: 30 | 60 | 90;
  scenes: Scene[]; captions: {captionId: string; sourceSegmentId: string; text: string}[]; reviewNotes: string[]};
export type JobResult = {angles: Angle[]; sourceBriefRevision: number} | {planVersionId: string} | null;
export type SafeError = {code: string; message: string; retryable: boolean};
export type Job = {_id: string; schemaVersion: 1; workspaceId: string; projectId: string; userId: string; kind: Kind;
  keyHash: string; requestHash: string; requestId: string; inputHash: string; sourceBriefRevision: Long;
  input: {brief: ProjectDetail['brief']; settings: ProjectSettings}; state: JobState; statusRevision: Long;
  attempt: number; submission: 'none' | 'submitted' | 'settled' | 'uncertain'; owner: string | null; leaseUntil: Date | null;
  createdAt: Date; updatedAt: Date; startedAt: Date | null; finishedAt: Date | null; result: JobResult; error: SafeError | null};
export type PlanVersion = {_id: string; schemaVersion: 1; workspaceId: string; projectId: string; versionNumber: Long;
  sourceBriefRevision: Long; sourcePlanningRequestId: string; inputHash: string; settingsSnapshot: ProjectSettings;
  plan: Plan; plannerModelId: string; promptContractVersion: 'educational-diagrams-v1'; createdAt: Date; createdBy: string;
  source?: 'ai' | 'direct_edit' | 'duplicate'; parentPlanVersionId?: string | null; restoredFromPlanVersionId?: string | null; duplicatedFromPlanVersionId?:string; contentHash?: string};
export type JobView = {id: string; projectId: string; kind: Kind; state: JobState; statusRevision: number; sourceBriefRevision: number;
  stage: 'planning'; progress: null; result: JobResult; error: SafeError | null; allowedActions: string[];
  createdAt: string; updatedAt: string; finishedAt: string | null};
export const jobView = (row: Job): JobView => ({id: row._id, projectId: row.projectId, kind: row.kind, state: row.state,
  statusRevision: row.statusRevision.toNumber(), sourceBriefRevision: row.sourceBriefRevision.toNumber(), stage: 'planning', progress: null,
  result: row.result, error: row.error, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(), finishedAt: row.finishedAt?.toISOString() ?? null,
  allowedActions: ['queued', 'running'].includes(row.state) ? ['cancel'] : ['failed', 'paused'].includes(row.state) && row.error?.retryable && row.attempt < 3 && row.submission !== 'uncertain' ? ['retry'] : []});
