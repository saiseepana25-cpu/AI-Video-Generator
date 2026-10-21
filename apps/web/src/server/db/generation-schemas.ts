import {ownedCollections, type CollectionContract} from './schemas';
import {planningCollections} from './planning-schemas';
import type {Document} from 'mongodb';
const obj = (properties: Record<string, Document>) => ({bsonType: 'object', additionalProperties: false, required: Object.keys(properties), properties});
const uuid = {bsonType: 'string', pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'};
const hash = {bsonType: 'string', pattern: '^[a-f0-9]{64}$'}, user = {bsonType: 'string', pattern: '^[a-f0-9]{24}$'};
const long = {bsonType: 'long', minimum: 1, maximum: Number.MAX_SAFE_INTEGER}, date = {bsonType: 'date'}, version = {bsonType: 'int', enum: [1]};
const text = (maxLength: number) => ({bsonType: 'string', minLength: 1, maxLength});
const nullable = (value: Document) => ({oneOf: [value, {bsonType: 'null'}]});
const member = structuredClone(ownedCollections.find(c => c.name === 'memberships')!);
member.validator.$jsonSchema.properties.generationGuardRevision = {...long, minimum: 0};
const activity = structuredClone(planningCollections.find(c => c.name === 'activity_events')!);
activity.validator.$jsonSchema.properties.type.enum.push('generation_changed');
export const generationCollections: CollectionContract[] = [member, activity, {
  name: 'approvals', validator: {$jsonSchema: obj({_id: uuid, schemaVersion: version, workspaceId: uuid, projectId: uuid, planVersionId: uuid,
    inputHash: hash, settingsSnapshotHash: hash, sourceBriefRevision: long, approvedProjectRevision: long,
    // Strict semantic validation and canonical hashing happen before insertion.
    inputCanonical: text(524288), approvedAt: date, approvedBy: user})},
  indexes: [{key: {workspaceId: 1, planVersionId: 1, inputHash: 1}, name: 'generation_approval_input_v1', unique: true}],
}, {
  name: 'generation_runs', validator: {$jsonSchema: obj({_id: uuid, schemaVersion: version, workspaceId: uuid, projectId: uuid, planVersionId: uuid,
    approvalId: uuid, jobId: uuid, inputHash: hash, settingsSnapshotHash: hash, sourceBriefRevision: long, providerConfigHash: hash,
    reservationId: uuid, reservationPeriodId: nullable(text(80)), rendererBuildHash: hash, state: {enum: ['queued', 'cancelled']},
    statusRevision: long, createdAt: date, updatedAt: date, finishedAt: nullable(date), createdBy: user})},
  indexes: [
    {key: {workspaceId: 1, planVersionId: 1, inputHash: 1}, name: 'generation_exact_input_v1', unique: true},
    {key: {jobId: 1}, name: 'generation_job_v1', unique: true},
    {key: {approvalId: 1}, name: 'generation_approval_v1', unique: true},
    {key: {workspaceId: 1, projectId: 1}, name: 'generation_active_project_v1', unique: true, partialFilterExpression: {state: 'queued'}},
    {key: {state: 1, createdAt: 1, _id: 1}, name: 'generation_queue_v1'},
    {key: {workspaceId: 1, projectId: 1, createdAt: -1, _id: -1}, name: 'generation_project_history_v1'},
  ],
}, {
  name: 'generation_commands', validator: {$jsonSchema: obj({_id: uuid, workspaceId: uuid, userId: user, scope: text(100), keyHash: hash, requestHash: hash,
    projectId: uuid, runId: uuid, snapshotCanonical: text(16000), createdAt: date})},
  indexes: [{key: {workspaceId: 1, userId: 1, scope: 1, keyHash: 1}, name: 'generation_command_replay_v1', unique: true}],
}, {
  name: 'generation_workers', validator: {$jsonSchema: obj({_id: {enum: ['generation:local']}, owner: uuid, revision: long,
    state: {enum: ['healthy', 'draining', 'disabled']}, contract: text(100), compilerVersion: text(100), rendererBuildHash: hash,
    capabilities: {bsonType: 'array', maxItems: 10, uniqueItems: true, items: text(100)}, fonts: obj({heading: hash, body: hash, telugu: hash}), heartbeatAt: date, expiresAt: date})}, indexes: [],
}];
