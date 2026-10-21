import {generationCollections} from './generation-schemas';
import type {CollectionContract} from './schemas';
import type {Document} from 'mongodb';
const obj = (properties: Record<string, Document>) => ({bsonType: 'object', additionalProperties: false, required: Object.keys(properties), properties});
const uuid = {bsonType: 'string', pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'}, hash = {bsonType: 'string', pattern: '^[a-f0-9]{64}$'};
const date = {bsonType: 'date'}, count = {bsonType: 'long', minimum: 0, maximum: Number.MAX_SAFE_INTEGER};
const number = {bsonType: ['int', 'long', 'double'], minimum: 0, maximum: Number.MAX_SAFE_INTEGER}, nullable = (value: Document) => ({oneOf: [value, {bsonType: 'null'}]});
const text = (maxLength: number) => ({bsonType: 'string', minLength: 1, maxLength});
const runs = structuredClone(generationCollections.find(c => c.name === 'generation_runs')!);
runs.validator.$jsonSchema.properties.state = {enum: ['queued', 'running', 'cancellation_requested', 'cancelled', 'failed', 'rendered_local']};
// Optional only on legacy unclaimed/cancelled 009 rows. Every claim fills these fields.
Object.assign(runs.validator.$jsonSchema.properties, {owner: nullable(uuid), leaseEpoch: count, leaseUntil: nullable(date), startedAt: nullable(date),
  stage: {enum: ['plan_validation', 'speech', 'rendering', 'validating']}, submissionCount: {bsonType: 'int', minimum: 0, maximum: 8}, artifactId: nullable(uuid),
  error: nullable(obj({code: text(80), message: text(240), retryable: {enum: [false]}}))});
runs.validator.$or = [
  {state: {$in: ['queued', 'cancelled']}}, // Legacy 009 shapes remain readable.
  {state: {$in: ['running', 'cancellation_requested']}, owner: {$type: 'string'}, leaseEpoch: {$gte: 1}, leaseUntil: {$type: 'date'}, startedAt: {$type: 'date'}, finishedAt: null,
    $jsonSchema: {required: ['stage', 'submissionCount', 'artifactId', 'error']}},
  {state: {$in: ['failed', 'rendered_local']}, owner: null, leaseUntil: null, finishedAt: {$type: 'date'},
    $jsonSchema: {required: ['leaseEpoch', 'startedAt', 'stage', 'submissionCount', 'artifactId', 'error']}},
];
runs.indexes.push({key: {workspaceId: 1, projectId: 1}, name: 'generation_active_project_v2', unique: true, partialFilterExpression: {state: {$in: ['queued', 'running', 'cancellation_requested']}}},
  {key: {state: 1, leaseUntil: 1}, name: 'generation_expired_leases_v1'});
export const generationWorkerCollections: CollectionContract[] = [runs, {
  name: 'generation_speech_attempts', validator: {$jsonSchema: obj({_id: uuid, runId: uuid, workspaceId: uuid, segmentId: {bsonType: 'string', pattern: '^segment_scene_[1-8]$'},
    inputHash: hash, textHash: hash, providerConfigHash: hash, owner: uuid, leaseEpoch: count, state: {enum: ['submitted', 'settled', 'refused', 'uncertain']},
    audioHash: nullable(hash), byteLength: nullable(number), sampleRate: nullable({enum: [24000]}), createdAt: date, finishedAt: nullable(date)})},
  indexes: [{key: {runId: 1, segmentId: 1}, name: 'generation_speech_once_v1', unique: true}, {key: {state: 1, runId: 1}, name: 'generation_submitted_attempts_v1'}],
}, {
  name: 'generation_local_artifacts', validator: {$jsonSchema: obj({_id: uuid, runId: uuid, workspaceId: uuid, approvalId: uuid, inputHash: hash, rendererBuildHash: hash, manifestHash: hash,
    media: obj({width: {enum: [1080]}, height: {enum: [1920]}, videoCodec: {enum: ['h264']}, audioCodec: {enum: ['aac']}, durationSeconds: {...number, maximum: 90.2}, audioSampleRate: {enum: [48000]}, meanVolumeDb: {bsonType: ['double', 'int', 'long'], minimum: -55, maximum: 0}}), createdAt: date})},
  indexes: [{key: {runId: 1}, name: 'generation_one_local_artifact_v1', unique: true}],
}];
