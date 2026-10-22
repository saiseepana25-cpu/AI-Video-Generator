import type {Long} from 'mongodb';
import type {FontPins} from '../rendering/contract';
export type GenerationRun = {_id: string; schemaVersion: 1; workspaceId: string; projectId: string; planVersionId: string; approvalId: string; jobId: string;
  inputHash: string; settingsSnapshotHash: string; sourceBriefRevision: Long; providerConfigHash: string; reservationId: string; reservationPeriodId: string | null;
  rendererBuildHash: string; state: 'queued' | 'running' | 'cancellation_requested' | 'cancelled' | 'failed' | 'rendered_local'; statusRevision: Long; createdAt: Date; updatedAt: Date; finishedAt: Date | null; createdBy: string;
  owner?: string | null; leaseEpoch?: Long; leaseUntil?: Date | null; startedAt?: Date | null; stage?: 'plan_validation' | 'speech' | 'rendering' | 'validating';
  submissionCount?: number; artifactId?: string | null; error?: {code: string; message: string; retryable: false} | null};
export type Approval = {_id: string; schemaVersion: 1; workspaceId: string; projectId: string; planVersionId: string; inputHash: string; settingsSnapshotHash: string;
  sourceBriefRevision: Long; approvedProjectRevision: Long; inputCanonical: string; approvedAt: Date; approvedBy: string};
export type GenerationWorker = {_id: 'generation:local'; owner: string; revision: Long; state: 'healthy' | 'draining' | 'disabled'; contract: string; compilerVersion: string;
  rendererBuildHash: string; capabilities: string[]; fonts: FontPins; heartbeatAt: Date; expiresAt: Date};
export const requiredCapabilities = ['speech:elevenlabs-phrase-v1', 'render:educational-diagrams-v1', 'timing:measured-phrase-v1', 'queue:leased-generation-v1'];
export const brandLogoCapability='render:brand-logo-v1';
export const brandPaletteCapability='render:brand-palette-v1';
export const generationView = (run: GenerationRun, projectRevision: number) => ({id: run.jobId, jobId: run.jobId, generationRunId: run._id, projectId: run.projectId, planVersionId: run.planVersionId,
  kind: 'generation' as const, state: run.state, statusRevision: run.statusRevision.toNumber(), stage: run.stage ?? 'plan_validation', progress: null,
  sourceBriefRevision: run.sourceBriefRevision.toNumber(), projectRevision, createdAt: run.createdAt.toISOString(), updatedAt: run.updatedAt.toISOString(), startedAt: run.startedAt?.toISOString() ?? null,
  finishedAt: run.finishedAt?.toISOString() ?? null, result: null, error: run.error ?? null, cancellationConfirmed: run.state === 'cancelled', allowedActions: ['queued', 'running'].includes(run.state) ? ['cancel'] : [],
  statusUrl: `/api/v1/jobs/${run.jobId}`, pollAfterSeconds: 3});
export type GenerationView = ReturnType<typeof generationView>;
export type SpeechAttempt = {_id: string; runId: string; workspaceId: string; segmentId: string; inputHash: string; textHash: string; providerConfigHash: string;
  owner: string; leaseEpoch: Long; state: 'submitted' | 'settled' | 'refused' | 'uncertain'; audioHash: string | null; byteLength: number | null; sampleRate: number | null; createdAt: Date; finishedAt: Date | null};
export type LocalArtifact = {_id: string; runId: string; workspaceId: string; approvalId: string; inputHash: string; rendererBuildHash: string; manifestHash: string;
  media: {width: number; height: number; videoCodec: string; audioCodec: string; durationSeconds: number; audioSampleRate: number; meanVolumeDb: number}; createdAt: Date};
