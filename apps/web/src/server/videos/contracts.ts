import type {Long} from 'mongodb';
import type {LocalArtifact} from '../generation/contracts';
import type {StorageKind, StorageObject} from '../storage/contracts';
export type ReadyVideo = {_id: string; schemaVersion: 1; workspaceId: string; projectId: string; runId: string; approvalId: string; planVersionId: string; bundleId: string;
  inputHash: string; manifestHash: string; mp4Sha256: string; rendererBuildHash: string; configHash: string; bucket: string; versionNumber: Long;
  sourceRunCreatedAt: Date; readyAt: Date; language: 'en'|'te'; captionLanguage: 'en'|'te'; narrator: string; usagePolicy: 'evaluation_only';
  assets: Record<StorageKind, string>; media: LocalArtifact['media']; transcript: {segmentId: string; text: string; startSeconds: number; endSeconds: number}[]};
export type VideoAsset = {_id: string; workspaceId: string; projectId: string; videoId: string; bundleId: string; configHash: string; bucket: string; object: StorageObject;
  lifecycleState: 'available'|'unavailable'|'deleting'|'deleted'; referenceRevision: Long; refCount: number; createdAt: Date};
export function videoView(video: ReadyVideo) {
  return {id: video._id, projectId: video.projectId, versionNumber: video.versionNumber.toNumber(), planVersionId: video.planVersionId, generationRunId: video.runId,
    language: video.language, captionLanguage: video.captionLanguage, narrator: video.narrator, usagePolicy: video.usagePolicy, media: {...video.media, fps: 30},
    transcript: video.transcript, readyAt: video.readyAt.toISOString(), playbackUrl: `/api/v1/videos/${video._id}/playback`, capabilities: {playback: true, download: false, publish: false, publishBlockedReason: 'MEDIA_USAGE_RESTRICTED'}};
}
export type VideoView = ReturnType<typeof videoView>;
