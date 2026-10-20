import type {Document} from 'mongodb';
import {ownedCollections, type CollectionContract} from './schemas';

const text = (maxLength: number) => ({bsonType: 'string', minLength: 1, maxLength});
const uuid = {bsonType: 'string', pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'};
const object = (properties: Record<string, Document>) => ({bsonType: 'object', additionalProperties: false, required: Object.keys(properties), properties});
const nullable = (schema: Document) => ({oneOf: [{bsonType: 'null'}, schema]});
const hash = {bsonType: 'string', pattern: '^[a-f0-9]{64}$'};
const userId = {bsonType: 'string', pattern: '^[a-f0-9]{24}$'};
const date = {bsonType: 'date'};
const project = ownedCollections.find(contract => contract.name === 'projects')!;
// Do not mutate migration 001's manifest: applied checksums remain stable.
const projectValidator = structuredClone(project.validator);
const fields = projectValidator.$jsonSchema.properties;
fields.settings.properties.accentId = nullable(fields.settings.properties.accentId);
fields.settings.properties.voiceCatalogId = nullable(fields.settings.properties.voiceCatalogId);
const summary = object({id: nullable(userId), name: text(8000)});
const number = {bsonType: ['int', 'long', 'double'], minimum: 0, maximum: Number.MAX_SAFE_INTEGER};
const iso = {bsonType: 'string', maxLength: 30};
const snapshot = object({
  id: uuid, displayTitle: text(4800), language: {enum: ['en', 'te']}, targetSeconds: {enum: [30, 60, 90]},
  revision: number, briefRevision: number, createdAt: iso, updatedAt: iso, createdBy: summary, updatedBy: summary,
  draftState: {enum: ['draft']}, latestRun: {bsonType: 'null'}, latestReadyVideo: {bsonType: 'null'},
  publishing: {bsonType: 'array', maxItems: 0},
  brief: fields.brief, settings: fields.settings,
  currentPlanVersionId: {bsonType: 'null'}, currentPlanInputHash: {bsonType: 'null'}, activePlanningJobId: {bsonType: 'null'},
  allowedActions: {bsonType: 'array', maxItems: 0},
  blockedReasons: {bsonType: 'array', maxItems: 8, items: object({action: text(80), code: text(80), message: text(240)})},
});

export const projectCollections: CollectionContract[] = [
  {...project, validator: projectValidator},
  {
    name: 'idempotency_records', validator: {$jsonSchema: object({
      _id: uuid, schemaVersion: {bsonType: 'int', enum: [1]}, workspaceId: uuid, userId,
      routeScope: {enum: ['POST /api/v1/projects']}, keyHash: hash, requestHash: hash,
      committedHttpStatus: {enum: [201]}, safeResultRef: object({kind: {enum: ['project']}, id: uuid}),
      safeResponseSnapshot: snapshot, createdAt: date, expiresAt: date,
    })}, indexes: [
      {key: {workspaceId: 1, userId: 1, routeScope: 1, keyHash: 1}, name: 'command_replay_identity_v1', unique: true},
      {key: {expiresAt: 1}, name: 'http_replay_expiry_v1', expireAfterSeconds: 0},
    ],
  },
  {
    name: 'activity_events', validator: {$jsonSchema: object({
      _id: uuid, schemaVersion: {bsonType: 'int', enum: [1]}, workspaceId: uuid, projectId: uuid,
      sequence: {bsonType: 'long', minimum: 1}, dedupeKey: text(160), type: {enum: ['project_created']},
      actor: object({kind: {enum: ['user']}, userId}), resourceRefs: object({projectId: uuid}),
      message: text(240), actionNeeded: {enum: [false]}, safeActionRoute: text(120), createdAt: date,
    })}, indexes: [
      {key: {dedupeKey: 1}, name: 'activity_dedupe_v1', unique: true},
      {key: {workspaceId: 1, sequence: -1}, name: 'activity_workspace_sequence_v1', unique: true},
      {key: {workspaceId: 1, projectId: 1, sequence: -1}, name: 'activity_project_sequence_v1'},
    ],
  },
];
