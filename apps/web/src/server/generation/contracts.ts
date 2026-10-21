import type {Long} from 'mongodb';
import type {FontPins} from '../rendering/contract';
export type GenerationRun = {_id: string; schemaVersion: 1; workspaceId: string; projectId: string; planVersionId: string; approvalId: string; jobId: string;
  inputHash: string; settingsSnapshotHash: string; sourceBriefRevision: Long; providerConfigHash: string; reservationId: string; reservationPeriodId: string | null;
  rendererBuildHash: string; state: 'queued' | 'cancelled'; statusRevision: Long; createdAt: Date; updatedAt: Date; finishedAt: Date | null; createdBy: string};
export type Approval = {_id: string; schemaVersion: 1; workspaceId: string; projectId: string; planVersionId: string; inputHash: string; settingsSnapshotHash: string;
  sourceBriefRevision: Long; approvedProjectRevision: Long; inputCanonical: string; approvedAt: Date; approvedBy: string};
export type GenerationWorker = {_id: 'generation:local'; owner: string; revision: Long; state: 'healthy' | 'draining' | 'disabled'; contract: string; compilerVersion: string;
  rendererBuildHash: string; capabilities: string[]; fonts: FontPins; heartbeatAt: Date; expiresAt: Date};
export const requiredCapabilities = ['speech:elevenlabs-phrase-v1', 'render:educational-diagrams-v1', 'timing:measured-phrase-v1'];
export const generationView = (run: GenerationRun, projectRevision: number) => ({id: run.jobId, jobId: run.jobId, generationRunId: run._id, projectId: run.projectId, planVersionId: run.planVersionId,
  kind: 'generation' as const, state: run.state, statusRevision: run.statusRevision.toNumber(), stage: 'plan_validation' as const, progress: null,
  sourceBriefRevision: run.sourceBriefRevision.toNumber(), projectRevision, createdAt: run.createdAt.toISOString(), updatedAt: run.updatedAt.toISOString(), startedAt: null,
  finishedAt: run.finishedAt?.toISOString() ?? null, result: null, error: null, cancellationConfirmed: run.state === 'cancelled', allowedActions: run.state === 'queued' ? ['cancel'] : [],
  statusUrl: `/api/v1/jobs/${run.jobId}`, pollAfterSeconds: 3});
export type GenerationView = ReturnType<typeof generationView>;
