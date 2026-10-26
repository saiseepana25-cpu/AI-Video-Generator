import type {Document} from 'mongodb';
import type {CollectionContract} from './schemas';
const uuid={bsonType:'string',pattern:'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'};
const fields:Record<string,Document>={_id:uuid,workspaceId:uuid,projectId:uuid,targetRunId:uuid,sourceRunId:uuid,sourceAttemptId:uuid,reuseHash:{bsonType:'string',pattern:'^[a-f0-9]{64}$'},reason:{enum:['deleted_target_render_cleaned']},releasedAt:{bsonType:'date'}};
export const reuseReleaseCollections:CollectionContract[]=[{name:'speech_reuse_releases',validator:{$jsonSchema:{bsonType:'object',additionalProperties:false,required:Object.keys(fields),properties:fields}},indexes:[{key:{workspaceId:1,projectId:1},name:'reuse_release_project_v1'},{key:{sourceAttemptId:1},name:'reuse_release_source_v1'}]}];
