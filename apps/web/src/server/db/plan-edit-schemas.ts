import {planningCollections} from './planning-schemas';
import type {CollectionContract} from './schemas';

const uuid = {bsonType: 'string', pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'};
const hash = {bsonType: 'string', pattern: '^[a-f0-9]{64}$'};
const plan = structuredClone(planningCollections.find(c => c.name === 'plan_versions')!);
// Optional on legacy AI rows. No mutation of migration 006 or historical rows.
Object.assign(plan.validator.$jsonSchema.properties, {source: {enum: ['ai', 'direct_edit']}, parentPlanVersionId: {oneOf: [uuid, {bsonType: 'null'}]}, contentHash: hash});
export const planEditCollections: CollectionContract[] = [plan, {
  name: 'plan_edit_commands', validator: {$jsonSchema: {bsonType: 'object', additionalProperties: false,
    required: ['_id', 'workspaceId', 'userId', 'basePlanVersionId', 'projectId', 'keyHash', 'requestHash', 'planVersionId', 'projectRevision', 'createdAt'], properties: {
      _id: uuid, workspaceId: uuid, userId: {bsonType: 'string', pattern: '^[a-f0-9]{24}$'}, basePlanVersionId: uuid, projectId: uuid, keyHash: hash, requestHash: hash, planVersionId: uuid,
      projectRevision: {bsonType: 'long', minimum: 1}, createdAt: {bsonType: 'date'},
    }}}, indexes: [{key: {workspaceId: 1, userId: 1, basePlanVersionId: 1, keyHash: 1}, name: 'plan_edit_replay_v1', unique: true}],
}];
