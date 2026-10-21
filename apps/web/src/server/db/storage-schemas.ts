import type {Document} from 'mongodb';
import type {CollectionContract} from './schemas';
const uuid = {bsonType: 'string', pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'};
const hash = {bsonType: 'string', pattern: '^[a-f0-9]{64}$'}, date = {bsonType: 'date'};
const nullable = (v: Document) => ({oneOf: [v, {bsonType: 'null'}]});
const obj = (properties: Record<string, Document>) => ({bsonType: 'object', additionalProperties: false, required: Object.keys(properties), properties});
const long = {bsonType: 'long', minimum: 0, maximum: Number.MAX_SAFE_INTEGER};
export const storageCollections: CollectionContract[] = [{name: 'generation_storage_bundles', validator: {$jsonSchema: obj({
  _id: uuid, schemaVersion: {enum: [1]}, workspaceId: uuid, projectId: uuid, runId: uuid, approvalId: uuid, artifactId: uuid,
  inputHash: hash, manifestHash: hash, rendererBuildHash: hash, configHash: hash, bucket: {bsonType: 'string', minLength: 3, maxLength: 63},
  objects: {bsonType: 'array', minItems: 5, maxItems: 5, items: obj({kind: {enum: ['mp4', 'srt', 'input', 'timing', 'manifest']}, key: {bsonType: 'string', minLength: 1, maxLength: 512}, sha256: hash,
    size: {bsonType: ['int', 'long', 'double'], minimum: 1, maximum: 134217728}, mime: {enum: ['video/mp4', 'application/x-subrip', 'application/json']}})},
  state: {enum: ['pending', 'uploading', 'failed', 'stored']}, revision: long, owner: nullable(uuid), epoch: long, leaseUntil: nullable(date),
  createdAt: date, updatedAt: date, storedAt: nullable(date), error: nullable({bsonType: 'string', minLength: 1, maxLength: 80}),
}), $or: [
  {state: 'uploading', owner: {$type: 'string'}, epoch: {$gte: 1}, leaseUntil: {$type: 'date'}, storedAt: null},
  {state: {$in: ['pending', 'failed']}, owner: null, leaseUntil: null, storedAt: null},
  {state: 'stored', owner: null, leaseUntil: null, storedAt: {$type: 'date'}, error: null},
]}, indexes: [
  {key: {runId: 1}, name: 'storage_one_bundle_per_run_v1', unique: true},
  {key: {artifactId: 1}, name: 'storage_one_bundle_per_artifact_v1', unique: true},
  {key: {state: 1, leaseUntil: 1, createdAt: 1}, name: 'storage_dispatch_v1'},
  {key: {workspaceId: 1, projectId: 1, createdAt: -1}, name: 'storage_project_history_v1'},
]}];
