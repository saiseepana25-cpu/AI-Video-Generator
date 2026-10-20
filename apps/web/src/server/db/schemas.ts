import type {Document, IndexDescription} from 'mongodb';

type Schema = Document;
const text = (maxLength: number, minLength = 1): Schema => ({bsonType: 'string', minLength, maxLength});
const nullable = (schema: Schema): Schema => ({oneOf: [{bsonType: 'null'}, schema]});
const object = (properties: Record<string, Schema>, optional: string[] = []): Schema => ({
  bsonType: 'object', additionalProperties: false,
  required: Object.keys(properties).filter(key => !optional.includes(key)), properties,
});
const date: Schema = {bsonType: 'date'};
const counter: Schema = {bsonType: 'long', minimum: 0};
const uuid: Schema = {bsonType: 'string', pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'};
const userId: Schema = {bsonType: 'string', pattern: '^[0-9a-f]{24}$'};
const hash: Schema = {bsonType: 'string', pattern: '^[0-9a-f]{64}$'};
const version: Schema = {bsonType: 'int', enum: [1]};
const language: Schema = {enum: ['en', 'te']};
const actor: Schema = {oneOf: [object({kind: {enum: ['user']}, userId}), object({kind: {enum: ['system']}, service: text(80)})]};
const catalogId = text(120);
// MongoDB length is not a grapheme count. Domain commands apply the stricter
// API grapheme/UTF-8 limits (including Telugu); these are generous storage ceilings.
const title = text(4800);
const settings = object({
  language, targetSeconds: {bsonType: 'int', enum: [30, 60, 90]}, accentId: catalogId,
  voiceCatalogId: catalogId, brandKitRevisionId: nullable(uuid), themeId: catalogId, captionStyleId: catalogId,
});

export type CollectionContract = {name: string; validator: Document; indexes: IndexDescription[]};

export const migrationSchema = object({
  _id: {bsonType: 'string', pattern: '^[0-9]{3}_[a-z0-9_]+$'}, checksum: hash, description: text(240),
  state: {enum: ['prepared', 'running', 'applied', 'failed']}, lockName: {enum: ['schema']},
  owner: uuid, leaseEpoch: counter, startedAt: nullable(date), finishedAt: nullable(date),
  safeError: nullable(object({
    code: {enum: ['MIGRATION_FAILED']}, message: text(240), retryable: {bsonType: 'bool'},
    action: text(240), requestId: uuid, classification: {enum: ['database']},
  })),
});

export const migrationCollection: CollectionContract = {
  name: 'schema_migrations', validator: {$jsonSchema: migrationSchema},
  indexes: [{key: {lockName: 1}, name: 'one_running_schema_migration_v1', unique: true, partialFilterExpression: {state: 'running'}}],
};

export const ownedCollections: CollectionContract[] = [
  {
    name: 'workspaces',
    validator: {$jsonSchema: object({
      _id: uuid, schemaVersion: version, name: title, timezone: text(100),
      defaults: object({language, targetSeconds: {bsonType: 'int', enum: [30, 60, 90]}, preferredAccentId: catalogId,
        preferredVoiceCatalogId: nullable(catalogId), themeId: catalogId, captionStyleId: catalogId}),
      settingsRevision: counter, brandKitRevisionId: nullable(uuid), brandRevision: counter,
      nextActivitySequence: counter, createdAt: date, updatedAt: date, updatedBy: actor,
    })}, indexes: [],
  },
  {
    name: 'memberships',
    validator: {$jsonSchema: object({
      _id: uuid, schemaVersion: version, workspaceId: uuid, userId, normalizedEmail: text(254),
      status: {enum: ['active', 'disabled']}, joinedAt: date, disabledAt: nullable(date), disabledBy: nullable(actor),
      preferences: object({language: nullable(language), voiceCatalogId: nullable(catalogId), timezone: nullable(text(100))}),
      preferencesRevision: counter, activityReadThroughSequence: counter, createdAt: date, updatedAt: date,
    })},
    indexes: [
      {key: {workspaceId: 1, userId: 1}, unique: true, name: 'membership_workspace_user'},
      {key: {workspaceId: 1, status: 1}, name: 'membership_workspace_status'},
    ],
  },
  {
    name: 'projects',
    validator: {$jsonSchema: object({
      _id: uuid, schemaVersion: version, workspaceId: uuid, displayTitle: title, searchTitle: title,
      brief: object({idea: text(64000), audience: text(8000), references: {
        bsonType: 'array', maxItems: 10, items: object({
          referenceId: {bsonType: 'string', pattern: '^[a-z][a-z0-9_-]{0,63}$'},
          text: text(640000), suppliedUrl: nullable(text(2048)),
        }),
      }}),
      settings, revision: counter, briefRevision: counter, guardRevision: counter,
      currentPlanVersionId: nullable(uuid), latestReadyVideoId: nullable(uuid), latestRunId: nullable(uuid),
      activePlanningJobId: nullable(uuid), planningRequestId: nullable(uuid),
      nextPlanVersionNumber: counter, nextVideoVersionNumber: counter, nextMessageSequence: counter,
      createdBy: actor, updatedBy: actor, createdAt: date, updatedAt: date,
      deletedAt: nullable(date), deletedBy: nullable(actor), cleanupJobId: nullable(uuid),
      // The deletion feature adds its bounded receipt shape in a later migration.
      deletionReceipt: {bsonType: 'null'},
      sourceProjectId: nullable(uuid),
    })},
    indexes: [{key: {workspaceId: 1, deletedAt: 1, updatedAt: -1, _id: -1}, name: 'project_library_v1'}],
  },
];

// Adapter-owned documents keep the pinned Auth.js format; no custom validator.
export const authIndexes: CollectionContract[] = [
  {name: 'users', validator: {}, indexes: [{key: {email: 1}, unique: true, name: 'auth_user_email'}]},
  {name: 'accounts', validator: {}, indexes: [{key: {provider: 1, providerAccountId: 1}, unique: true, name: 'auth_provider_subject'}]},
  {name: 'sessions', validator: {}, indexes: [
    {key: {sessionToken: 1}, unique: true, name: 'auth_session_token'},
    {key: {userId: 1}, name: 'auth_session_user'},
    {key: {expires: 1}, expireAfterSeconds: 0, name: 'auth_session_expiry'},
  ]},
];
