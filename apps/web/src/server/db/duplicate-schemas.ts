import {planHistoryCollections} from './plan-history-schemas';
import {planningCollections} from './planning-schemas';
import type {CollectionContract} from './schemas';
const uuid={bsonType:'string',pattern:'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'},hash={bsonType:'string',pattern:'^[a-f0-9]{64}$'};
const plan=structuredClone(planHistoryCollections[0]);
plan.validator.$jsonSchema.properties.source={enum:['ai','direct_edit','duplicate']};
plan.validator.$jsonSchema.properties.duplicatedFromPlanVersionId=uuid;
const snapshot=structuredClone(planningCollections.find(c=>c.name==='idempotency_records')!.validator.$jsonSchema.properties.safeResponseSnapshot);
export const duplicateCollections:CollectionContract[]=[plan,{
  name:'project_duplicate_commands',validator:{$jsonSchema:{bsonType:'object',additionalProperties:false,required:['_id','workspaceId','userId','sourceProjectId','sourceRevision','keyHash','requestHash','projectId','snapshot','createdAt'],properties:{
    _id:uuid,workspaceId:uuid,userId:{bsonType:'string',pattern:'^[a-f0-9]{24}$'},sourceProjectId:uuid,sourceRevision:{bsonType:'long',minimum:1,maximum:Number.MAX_SAFE_INTEGER},keyHash:hash,requestHash:hash,projectId:uuid,snapshot,createdAt:{bsonType:'date'},
  }}},indexes:[{key:{workspaceId:1,userId:1,sourceProjectId:1,keyHash:1},name:'project_duplicate_replay_v1',unique:true}],
}];
