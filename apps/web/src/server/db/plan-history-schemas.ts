import {planEditCollections} from './plan-edit-schemas';
const plan = structuredClone(planEditCollections[0]);
plan.validator.$jsonSchema.properties.restoredFromPlanVersionId = {oneOf: [
  {bsonType: 'string', pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'}, {bsonType: 'null'},
]};
const receipt = structuredClone(planEditCollections[1]);
receipt.name = 'plan_restore_commands';
receipt.indexes[0].name = 'plan_restore_replay_v1';
export const planHistoryCollections = [plan, receipt];
