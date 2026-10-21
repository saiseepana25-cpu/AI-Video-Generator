import {Long, type ClientSession, type Db} from 'mongodb';
import {canonicalJson, generationHash, validateRenderPlan} from '../rendering/contract';
import {sha256, verifyObject} from '../storage/r2';
import {storageKinds, StorageFault, type StorageBundle, type StorageKind, type StorageSource} from '../storage/contracts';
import {verifyCompletedMp4} from '../storage/provenance';
import type {Row} from '../planning/service';
import type {ReadyVideo, VideoAsset} from './contracts';

export function readyProof(source: StorageSource, bundle: StorageBundle, bytes: Record<StorageKind, Buffer>) {
  verifyCompletedMp4(bytes, source);
  if (bundle.runId !== source.run._id || bundle.workspaceId !== source.run.workspaceId || bundle.projectId !== source.run.projectId || bundle.approvalId !== source.approval._id
    || source.run.approvalId !== source.approval._id || source.artifact.approvalId !== source.approval._id || source.artifact.runId !== source.run._id || source.approval.planVersionId !== source.run.planVersionId
    || bundle._id !== source.artifact._id || bundle.artifactId !== source.artifact._id || bundle.manifestHash !== source.artifact.manifestHash || bundle.inputHash !== source.run.inputHash || bundle.rendererBuildHash !== source.artifact.rendererBuildHash
    || bundle.objects.length !== 5 || new Set(bundle.objects.map(o => o.kind)).size !== 5) throw new StorageFault('VIDEO_PROVENANCE_INVALID');
  for (const object of bundle.objects) {verifyObject(object, bytes[object.kind]);
    if (!object.key.startsWith(`workspaces/${bundle.workspaceId}/projects/${bundle.projectId}/runs/${bundle.runId}/bundles/${bundle.artifactId}/`)) throw new StorageFault('VIDEO_PROVENANCE_INVALID');}
  const plan = validateRenderPlan(JSON.parse(bytes.input.toString('utf8'))), manifest = JSON.parse(bytes.manifest.toString('utf8')), timing = JSON.parse(bytes.timing.toString('utf8'));
  if (canonicalJson(plan) !== source.approval.inputCanonical || generationHash(plan) !== source.run.inputHash || manifest.state !== 'validated_local' || manifest.mode !== 'elevenlabs-evaluation'
    || manifest.diagnostic !== false || manifest.voicePinSatisfied !== true || manifest.publicationAllowed !== false || manifest.inputHash !== bundle.inputHash || manifest.rendererBuildHash !== bundle.rendererBuildHash
    || manifest.language !== plan.language || manifest.fps !== 30 || !Number.isInteger(manifest.durationInFrames) || manifest.durationInFrames < 1 || manifest.durationInFrames > 2700
    || canonicalJson(manifest.media) !== canonicalJson(source.artifact.media) || timing.audioHash !== manifest.audioHash || !Array.isArray(timing.cues) || timing.cues.length !== plan.narration.length) throw new StorageFault('VIDEO_PROVENANCE_INVALID');
  const stamp = (f: number) => {const n = Math.round(f * 1000 / 30); return `${String(Math.floor(n / 3600000)).padStart(2,'0')}:${String(Math.floor(n / 60000) % 60).padStart(2,'0')}:${String(Math.floor(n / 1000) % 60).padStart(2,'0')},${String(n % 1000).padStart(3,'0')}`;};
  let end = 0; const srt: string[] = [];
  const transcript = plan.narration.map((segment, i) => {
    const cue = timing.cues[i], lines = timing.layout?.scenes?.[i]?.caption?.lines;
    if (cue.segmentId !== segment.segmentId || cue.sceneId !== plan.scenes[i].sceneId || cue.text !== segment.text || ![cue.startFrame,cue.speechEndFrame,cue.endFrame].every(Number.isSafeInteger)
      || cue.startFrame < end || cue.speechEndFrame <= cue.startFrame || cue.endFrame < cue.speechEndFrame || cue.endFrame > manifest.durationInFrames
      || !Array.isArray(lines) || lines.length < 1 || lines.length > 2 || !lines.every((s: unknown) => typeof s === 'string') || lines.join('').replace(/\s/gu,'') !== segment.text.replace(/\s/gu,'')) throw new StorageFault('VIDEO_PROVENANCE_INVALID');
    end = cue.endFrame; srt.push(`${i + 1}\n${stamp(cue.startFrame)} --> ${stamp(cue.endFrame)}\n${lines.join('\n')}\n`);
    return {segmentId: segment.segmentId, text: segment.text, startSeconds: cue.startFrame / 30, endSeconds: cue.endFrame / 30};
  });
  if (bytes.srt.toString('utf8') !== srt.join('\n')) throw new StorageFault('VIDEO_PROVENANCE_INVALID');
  return {plan, manifest, transcript};
}
function assetId(bundle: string, role: StorageKind|'activity') {const h = sha256(`${bundle}:${role}`); return `${h.slice(0,8)}-${h.slice(8,12)}-5${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}`;}
/** Pure validation and Mongo work only. Caller must have verified remote bytes
 * and fenced the storage/project guards in this same transaction. */
export async function recordReadyVideo(db: Db, session: ClientSession, source: StorageSource, bundle: StorageBundle, bytes: Record<StorageKind, Buffer>) {
  const proof = readyProof(source, bundle, bytes);
  const existing = await db.collection<ReadyVideo>('ready_videos').findOne({runId: source.run._id}, {session});
  if (existing) {if (existing._id !== bundle._id || existing.manifestHash !== bundle.manifestHash || existing.mp4Sha256 !== proof.manifest.mp4Sha256) throw new StorageFault('VIDEO_PROVENANCE_INVALID'); return existing;}
  const project = await db.collection<Row>('projects').findOne({_id: bundle.projectId, workspaceId: bundle.workspaceId, deletedAt: null}, {session});
  if (!project || project.nextVideoVersionNumber.greaterThanOrEqual(Long.fromNumber(Number.MAX_SAFE_INTEGER)) || project.revision.greaterThanOrEqual(Long.fromNumber(Number.MAX_SAFE_INTEGER))) throw new StorageFault('VIDEO_PROJECT_UNAVAILABLE');
  const prior = project.latestReadyVideoId ? await db.collection<ReadyVideo>('ready_videos').findOne({_id: project.latestReadyVideoId, workspaceId: bundle.workspaceId, projectId: bundle.projectId}, {session}) : null;
  if (project.latestReadyVideoId && !prior) throw new StorageFault('VIDEO_PROVENANCE_INVALID');
  const now = new Date(), assets = Object.fromEntries(storageKinds.map(kind => [kind, assetId(bundle._id, kind)])) as ReadyVideo['assets'];
  const video: ReadyVideo = {_id: bundle._id, schemaVersion: 1, workspaceId: bundle.workspaceId, projectId: bundle.projectId, runId: source.run._id, approvalId: source.approval._id,
    planVersionId: source.run.planVersionId, bundleId: bundle._id, inputHash: bundle.inputHash, manifestHash: bundle.manifestHash, mp4Sha256: proof.manifest.mp4Sha256,
    rendererBuildHash: bundle.rendererBuildHash, configHash: bundle.configHash, bucket: bundle.bucket, versionNumber: project.nextVideoVersionNumber.add(Long.ONE),
    sourceRunCreatedAt: source.run.createdAt, readyAt: now, language: proof.plan.language, captionLanguage: proof.plan.language, narrator: 'Alice · evaluation voice', usagePolicy: 'evaluation_only',
    assets, media: source.artifact.media, transcript: proof.transcript};
  await db.collection<ReadyVideo>('ready_videos').insertOne(video, {session});
  for (const object of bundle.objects) await db.collection<VideoAsset>('video_assets').insertOne({_id: assets[object.kind], workspaceId: video.workspaceId, projectId: video.projectId, videoId: video._id,
    bundleId: bundle._id, configHash: bundle.configHash, bucket: bundle.bucket, object, lifecycleState: 'available', referenceRevision: Long.ONE, refCount: 1, createdAt: now}, {session});
  const newest = !prior || video.sourceRunCreatedAt > prior.sourceRunCreatedAt || (+video.sourceRunCreatedAt === +prior.sourceRunCreatedAt && video.runId > prior.runId);
  await db.collection<Row>('projects').updateOne({_id: project._id, workspaceId: video.workspaceId, deletedAt: null}, {$set: {...(newest ? {latestReadyVideoId: video._id} : {}), updatedAt: now},
    $inc: {nextVideoVersionNumber: Long.ONE, revision: Long.ONE, guardRevision: Long.ONE}}, {session});
  const workspace = await db.collection<Row>('workspaces').findOneAndUpdate({_id: video.workspaceId}, {$inc: {nextActivitySequence: Long.ONE}}, {session, returnDocument: 'after'});
  if (!workspace) throw new StorageFault('VIDEO_PROJECT_UNAVAILABLE');
  await db.collection<Row>('activity_events').insertOne({_id: assetId(bundle._id,'activity'), schemaVersion: 1, workspaceId: video.workspaceId, projectId: video.projectId,
    sequence: workspace.nextActivitySequence, dedupeKey: `video:${video._id}:ready`, type: 'generation_changed', actor: {kind: 'user', userId: source.run.createdBy}, resourceRefs: {projectId: video.projectId},
    message: 'The video is ready for private playback. Evaluation use only.', actionNeeded: false, safeActionRoute: `/projects/${video.projectId}`, createdAt: now}, {session});
  return video;
}
