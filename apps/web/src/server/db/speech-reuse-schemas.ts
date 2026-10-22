import type {Document} from 'mongodb';
import type {CollectionContract} from './schemas';
const uuid={bsonType:'string',pattern:'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'},hash={bsonType:'string',pattern:'^[a-f0-9]{64}$'};
const fields:Record<string,Document>={_id:uuid,workspaceId:uuid,projectId:uuid,runId:uuid,segmentId:{bsonType:'string',pattern:'^segment_scene_[1-8]$'},
  sourceRunId:uuid,sourceAttemptId:uuid,sourceApprovalId:uuid,sourceInputHash:hash,inputHash:hash,identityHash:hash,providerConfigHash:hash,audioHash:hash,
  byteLength:{bsonType:'int',minimum:4844,maximum:4320044},sampleRate:{enum:[24000]},owner:uuid,leaseEpoch:{bsonType:'long',minimum:1,maximum:Number.MAX_SAFE_INTEGER},createdAt:{bsonType:'date'}};
export const speechReuseCollections:CollectionContract[]=[{name:'generation_speech_reuses',validator:{$jsonSchema:{bsonType:'object',additionalProperties:false,required:Object.keys(fields),properties:fields}},
  indexes:[{key:{runId:1,segmentId:1},name:'generation_reuse_once_v1',unique:true},{key:{sourceAttemptId:1},name:'generation_reuse_source_pin_v1'}]}];
