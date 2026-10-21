import type {Document} from 'mongodb';
import type {CollectionContract} from './schemas';
import {generationWorkerCollections} from './generation-worker-schemas';
import {storageCollections} from './storage-schemas';
const uuid = {bsonType: 'string', pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'}, hash = {bsonType: 'string', pattern: '^[a-f0-9]{64}$'};
const obj = (properties: Record<string, Document>) => ({bsonType: 'object', additionalProperties: false, required: Object.keys(properties), properties});
const counter = {bsonType: 'long', minimum: 1, maximum: Number.MAX_SAFE_INTEGER}, date = {bsonType: 'date'};
const text = (maxLength: number) => ({bsonType: 'string', minLength: 1, maxLength});
const media = structuredClone(generationWorkerCollections.find(c => c.name === 'generation_local_artifacts')!.validator.$jsonSchema.properties.media);
const object = structuredClone(storageCollections[0].validator.$jsonSchema.properties.objects.items);
export const videoCollections: CollectionContract[] = [{name: 'ready_videos', validator: {$jsonSchema: obj({
  _id: uuid, schemaVersion: {enum: [1]}, workspaceId: uuid, projectId: uuid, runId: uuid, approvalId: uuid, planVersionId: uuid, bundleId: uuid,
  inputHash: hash, manifestHash: hash, mp4Sha256: hash, rendererBuildHash: hash, configHash: hash, bucket: text(63), versionNumber: counter,
  sourceRunCreatedAt: date, readyAt: date, language: {enum: ['en','te']}, captionLanguage: {enum: ['en','te']}, narrator: text(120), usagePolicy: {enum: ['evaluation_only']},
  assets: obj({mp4: uuid, srt: uuid, input: uuid, timing: uuid, manifest: uuid}), media,
  transcript: {bsonType: 'array', minItems: 1, maxItems: 8, items: obj({segmentId: text(80), text: text(1200), startSeconds: {bsonType: ['int','double'], minimum: 0, maximum: 90}, endSeconds: {bsonType: ['int','double'], minimum: 0, maximum: 90}})},
})}, indexes: [
  {key: {runId: 1}, name: 'ready_video_run_v1', unique: true}, {key: {bundleId: 1}, name: 'ready_video_bundle_v1', unique: true},
  {key: {workspaceId: 1, projectId: 1, versionNumber: 1}, name: 'ready_video_version_v1', unique: true},
]}, {name: 'video_assets', validator: {$jsonSchema: obj({_id: uuid, workspaceId: uuid, projectId: uuid, videoId: uuid, bundleId: uuid, configHash: hash, bucket: text(63), object,
  lifecycleState: {enum: ['available','unavailable','deleting','deleted']}, referenceRevision: counter, refCount: {enum: [1]}, createdAt: date})}, indexes: [
  {key: {videoId: 1, 'object.kind': 1}, name: 'video_asset_role_v1', unique: true}, {key: {'object.key': 1, configHash: 1}, name: 'video_asset_object_v1', unique: true},
]}];
