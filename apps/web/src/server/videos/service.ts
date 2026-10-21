import {Long, type MongoClient} from 'mongodb';
import type {ProjectContext} from '../projects/contracts';
import {ProjectError, requireProjectId} from '../projects/contracts';
import type {Row} from '../planning/service';
import type {ObjectStore, StorageBundle, StorageKind, StorageSource} from '../storage/contracts';
import {StorageFault, storageKinds} from '../storage/contracts';
import type {Approval, GenerationRun, LocalArtifact} from '../generation/contracts';
import {databaseTransaction} from '../db/transactions';
import {canonicalJson} from '../rendering/contract';
import {verifyObject} from '../storage/r2';
import {recordReadyVideo} from './ready';
import {videoView, type ReadyVideo, type VideoAsset} from './contracts';
const missing = () => new ProjectError('RESOURCE_NOT_FOUND', 404, 'This video could not be found.');
const unavailable = () => new ProjectError('VIDEO_UNAVAILABLE', 503, 'Video playback is temporarily unavailable. Refresh and try again.', [], true);
export class VideoService {
  private get db() {return this.client.db(this.name);}
  constructor(private client: MongoClient, private name: string, private context: ProjectContext, private store: ObjectStore) {}
  private async authorize() {if (!await this.db.collection('memberships').findOne({workspaceId: this.context.workspaceId, userId: this.context.userId, status: 'active'})) throw new ProjectError('TEAM_ACCESS_DENIED', 403, 'This account does not have team access.');}
  private async resolve(id: string) {
    await this.authorize(); requireProjectId(id);
    const video = await this.db.collection<ReadyVideo>('ready_videos').findOne({_id: id, workspaceId: this.context.workspaceId});
    if (!video || !await this.db.collection<Row>('projects').findOne({_id: video.projectId, workspaceId: this.context.workspaceId, deletedAt: null})) throw missing();
    const bundle = await this.db.collection<StorageBundle>('generation_storage_bundles').findOne({_id: video.bundleId, runId: video.runId, workspaceId: video.workspaceId, projectId: video.projectId, state: 'stored', manifestHash: video.manifestHash, inputHash: video.inputHash, configHash: video.configHash, bucket: video.bucket});
    if (!bundle || this.store.configHash !== video.configHash || this.store.bucket !== video.bucket) throw unavailable();
    const asset = await this.db.collection<VideoAsset>('video_assets').findOne({_id: video.assets.mp4, workspaceId: video.workspaceId, projectId: video.projectId, videoId: video._id, bundleId: bundle._id,
      lifecycleState: 'available', refCount: 1, configHash: video.configHash, bucket: video.bucket});
    const object = bundle.objects.find(o => o.kind === 'mp4');
    if (!asset || !object || object.sha256 !== video.mp4Sha256 || canonicalJson(object) !== canonicalJson(asset.object)
      || object.key !== `workspaces/${video.workspaceId}/projects/${video.projectId}/runs/${video.runId}/bundles/${bundle.artifactId}/video.mp4`) throw unavailable();
    return {video, asset};
  }
  async get(id: string) {return videoView((await this.resolve(id)).video);}
  async latest(projectId: string) {
    await this.authorize(); requireProjectId(projectId);
    const project = await this.db.collection<Row>('projects').findOne({_id: projectId, workspaceId: this.context.workspaceId, deletedAt: null});
    if (!project) throw missing();
    const video = project.latestReadyVideoId ? await this.get(project.latestReadyVideoId) : null;
    if (video && video.projectId !== projectId) throw unavailable();
    return {video};
  }
  async playback(id: string, range: string | null, head = false) {
    const {video, asset} = await this.resolve(id), interval = parseRange(range, asset.object.size);
    let bytes: Buffer; try {bytes = await this.store.read(asset.object); verifyObject(asset.object, bytes);} catch {throw unavailable();}
    // Reauthorize after remote I/O; revocation, deletion or lifecycle changes
    // during retrieval must win before any bytes leave the application.
    const fresh = await this.resolve(id);
    if (fresh.asset.referenceRevision.toString() !== asset.referenceRevision.toString() || canonicalJson(fresh.asset.object) !== canonicalJson(asset.object)) throw unavailable();
    const headers = {'Content-Type': 'video/mp4', 'Content-Length': String(interval.end - interval.start + 1), 'Accept-Ranges': 'bytes',
      'Content-Disposition': 'inline; filename="videocraft.mp4"', 'Cache-Control': 'private, no-store', Vary: 'Cookie', 'X-Content-Type-Options': 'nosniff',
      'Cross-Origin-Resource-Policy': 'same-origin', ...(range ? {'Content-Range': `bytes ${interval.start}-${interval.end}/${asset.object.size}`} : {})};
    return {status: range ? 206 : 200, headers, body: head ? null : new Uint8Array(bytes.subarray(interval.start, interval.end + 1))};
  }
}
export function parseRange(value: string | null, size: number) {
  if (value === null) return {start: 0, end: size - 1};
  const invalid = () => new ProjectError('INVALID_RANGE', 416, 'Use one valid byte range.', [], false, {size});
  const match = /^bytes=(\d*)-(\d*)$/.exec(value); if (!match || !match[1] && !match[2]) throw invalid();
  const a = match[1] ? Number(match[1]) : null, b = match[2] ? Number(match[2]) : null;
  if (a !== null && !Number.isSafeInteger(a) || b !== null && !Number.isSafeInteger(b) || a === null && !b) throw invalid();
  const start = a === null ? Math.max(0, size - b!) : a, end = a === null || b === null ? size - 1 : Math.min(b, size - 1);
  if (start >= size || start > end) throw invalid(); return {start, end};
}
/** Reconcile earlier stored bundles without reading local files or rerendering. */
export async function promoteStoredVideo(client: MongoClient, name: string, store: ObjectStore, runId: string) {
  const db = client.db(name), bundle = await db.collection<StorageBundle>('generation_storage_bundles').findOne({runId, state: 'stored', configHash: store.configHash, bucket: store.bucket});
  if (!bundle) throw new StorageFault('VIDEO_SOURCE_UNAVAILABLE');
  const bytes = {} as Record<StorageKind, Buffer>;
  for (const kind of storageKinds) {const object = bundle.objects.find(o => o.kind === kind); if (!object) throw new StorageFault('VIDEO_PROVENANCE_INVALID'); bytes[kind] = await store.read(object);}
  return databaseTransaction(client, name, async (tx, session) => {
    const current = await tx.collection<StorageBundle>('generation_storage_bundles').findOne({_id: bundle._id, state: 'stored', revision: bundle.revision}, {session});
    const run = await tx.collection<GenerationRun>('generation_runs').findOne({_id: bundle.runId, state: 'rendered_local', workspaceId: bundle.workspaceId, projectId: bundle.projectId}, {session});
    const artifact = await tx.collection<LocalArtifact>('generation_local_artifacts').findOne({_id: bundle.artifactId, runId: bundle.runId, workspaceId: bundle.workspaceId, manifestHash: bundle.manifestHash}, {session});
    const approval = await tx.collection<Approval>('approvals').findOne({_id: bundle.approvalId, workspaceId: bundle.workspaceId, projectId: bundle.projectId}, {session});
    if (!current || !run || !artifact || !approval) throw new StorageFault('VIDEO_SOURCE_UNAVAILABLE');
    const touch = await tx.collection<Row>('projects').updateOne({_id: bundle.projectId, workspaceId: bundle.workspaceId, deletedAt: null}, {$inc: {guardRevision: Long.ONE}}, {session});
    if (!touch.matchedCount) throw new StorageFault('VIDEO_SOURCE_UNAVAILABLE');
    return recordReadyVideo(tx, session, {run, artifact, approval} as StorageSource, bundle, bytes);
  });
}
