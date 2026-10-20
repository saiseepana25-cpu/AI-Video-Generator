import type {Document} from 'mongodb';
import {projectCollections} from './project-schemas';
import {editCollections} from './edit-schemas';
import type {CollectionContract} from './schemas';

const str = (maxLength = 160) => ({bsonType: 'string', minLength: 1, maxLength});
const uuid = {bsonType: 'string', pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'};
const hash = {bsonType: 'string', pattern: '^[a-f0-9]{64}$'};
const user = {bsonType: 'string', pattern: '^[a-f0-9]{24}$'};
const date = {bsonType: 'date'}, long = {bsonType: 'long', minimum: 0};
const number = {bsonType: ['int', 'long', 'double'], minimum: 0, maximum: Number.MAX_SAFE_INTEGER};
const obj = (properties: Record<string, Document>) => ({bsonType: 'object', additionalProperties: false, required: Object.keys(properties), properties});
const nullable = (schema: Document) => ({oneOf: [{bsonType: 'null'}, schema]});
const array = (items: Document, maxItems: number, minItems = 0) => ({bsonType: 'array', items, maxItems, minItems});
const project = projectCollections[0].validator.$jsonSchema.properties;
const input = obj({brief: project.brief, settings: project.settings});
const error = nullable(obj({code: str(100), message: str(300), retryable: {bsonType: 'bool'}}));
const result = nullable({oneOf: [obj({angles: array(obj({id: str(64), title: str(160), hook: str(300), learningObjective: str(300)}), 3, 3), sourceBriefRevision: number}), obj({planVersionId: uuid})]});
const scene = obj({sceneId: str(64), heading: str(140), narration: str(1000), labels: array(str(100), 5, 2), layout: {enum: ['sequence', 'cycle', 'comparison']}});
const plan = obj({schemaVersion: {enum: [2]}, title: str(160), learningObjective: str(400), language: {enum: ['en', 'te']}, targetSeconds: {enum: [30, 60, 90]},
  scenes: array(scene, 8, 3), captions: array(obj({captionId: str(80), sourceSegmentId: str(64), text: str(1000)}), 8, 3), reviewNotes: array(str(300), 5)});
// Widen only new replay snapshots; old migration manifests/checksums stay immutable.
const receipts = structuredClone(editCollections.find(c => c.name === 'idempotency_records')!);
const snapshot = receipts.validator.$jsonSchema.properties.safeResponseSnapshot.properties;
snapshot.currentPlanVersionId = nullable(uuid); snapshot.activePlanningJobId = nullable(uuid);
const activity = structuredClone(editCollections.find(c => c.name === 'activity_events')!);
activity.validator.$jsonSchema.properties.type = {enum: ['project_created', 'project_updated', 'planning_changed']};

export const planningCollections: CollectionContract[] = [receipts, activity,
  {name: 'jobs', validator: {$jsonSchema: obj({
    _id: uuid, schemaVersion: {enum: [1]}, workspaceId: uuid, projectId: uuid, userId: user, kind: {enum: ['brainstorm', 'plan']},
    keyHash: hash, requestHash: hash, requestId: uuid, inputHash: hash, sourceBriefRevision: long, input,
    state: {enum: ['queued', 'running', 'ready', 'failed', 'paused', 'cancelled', 'superseded', 'cancellation_requested']}, statusRevision: long,
    attempt: {bsonType: 'int', minimum: 0, maximum: 3}, submission: {enum: ['none', 'submitted', 'settled', 'uncertain']},
    owner: nullable(uuid), leaseUntil: nullable(date), createdAt: date, updatedAt: date, startedAt: nullable(date), finishedAt: nullable(date), result, error,
  })}, indexes: [
    {key: {workspaceId: 1, userId: 1, projectId: 1, kind: 1, keyHash: 1}, name: 'planning_request_identity_v1', unique: true},
    {key: {state: 1, createdAt: 1}, name: 'planning_queue_v1'},
    {key: {workspaceId: 1, projectId: 1, createdAt: -1, _id: -1}, name: 'planning_project_jobs_v1'},
  ]},
  {name: 'plan_versions', validator: {$jsonSchema: obj({
    _id: uuid, schemaVersion: {enum: [1]}, workspaceId: uuid, projectId: uuid, versionNumber: long, sourceBriefRevision: long,
    sourcePlanningRequestId: uuid, inputHash: hash, settingsSnapshot: project.settings, plan, plannerModelId: str(), promptContractVersion: {enum: ['educational-diagrams-v1']}, createdAt: date, createdBy: user,
  })}, indexes: [{key: {workspaceId: 1, projectId: 1, versionNumber: 1}, name: 'plan_version_number_v1', unique: true}, {key: {sourcePlanningRequestId: 1}, name: 'one_plan_per_request_v1', unique: true}]},
  {name: 'planning_commands', validator: {$jsonSchema: obj({_id: uuid, workspaceId: uuid, userId: user, scope: str(), keyHash: hash, requestHash: hash,
    jobId: uuid, snapshot: obj({jobId: uuid, kind: {enum: ['brainstorm', 'plan']}, state: str(40), statusUrl: str(100), sourceBriefRevision: number, pollAfterSeconds: number}), createdAt: date})},
    indexes: [{key: {workspaceId: 1, userId: 1, scope: 1, keyHash: 1}, name: 'planning_command_replay_v1', unique: true}]},
  {name: 'planning_budget', validator: {$jsonSchema: obj({_id: {enum: ['gemini']}, configHash: hash, revision: long, observedAt: date, expiresAt: date,
    remaining: {bsonType: 'int', minimum: 0, maximum: 500}, nextRequestAt: date, paused: {bsonType: 'bool'}, uncertain: {bsonType: 'bool'}})}, indexes: []},
  {name: 'worker_slots', validator: {$jsonSchema: obj({_id: {enum: ['planning:global']}, owner: uuid, expiresAt: date, heartbeatAt: date})}, indexes: []},
  {name: 'stage_attempts', validator: {$jsonSchema: obj({_id: uuid, jobId: uuid, attempt: {bsonType: 'int', minimum: 1, maximum: 3}, owner: uuid,
    state: {enum: ['submitted', 'settled', 'uncertain']}, submittedAt: date, finishedAt: nullable(date)})}, indexes: [{key: {jobId: 1, attempt: 1}, name: 'planning_stage_attempt_v1', unique: true}]},
];
