import type {Document} from 'mongodb';
import type {CollectionContract} from './schemas';
const uuid={bsonType:'string',pattern:'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'},hash={bsonType:'string',pattern:'^[a-f0-9]{64}$'},date={bsonType:'date'},long={bsonType:'long',minimum:1,maximum:Number.MAX_SAFE_INTEGER};
const object=(properties:Record<string,Document>)=>({bsonType:'object',additionalProperties:false,required:Object.keys(properties),properties});
export const speechCleanupCollections:CollectionContract[]=[{
  name:'speech_cleanup_tasks',
  validator:{$and:[
    {$jsonSchema:object({_id:uuid,workspaceId:uuid,projectId:uuid,
      source:object({runId:uuid,attemptId:uuid,audioHash:hash,byteLength:{bsonType:'int',minimum:4844,maximum:4320044},sampleRate:{enum:[24000]},inputHash:hash,providerConfigHash:hash,textHash:hash,segmentId:{bsonType:'string',pattern:'^segment_scene_[1-8]$'}}),
      rootHash:hash,state:{enum:['pending','retry','removed']},revision:long,attempts:long,error:{enum:[null,'SPEECH_REMOVAL_FAILED']},createdAt:date,updatedAt:date,removedAt:{bsonType:['date','null']}})},
    {$expr:{$eq:['$_id','$source.attemptId']}},
    {$or:[{state:'pending',error:null,removedAt:null},{state:'retry',error:'SPEECH_REMOVAL_FAILED',removedAt:null},{state:'removed',error:null,removedAt:{$type:'date'}}]},
  ]},
  indexes:[{key:{workspaceId:1,projectId:1,state:1},name:'speech_cleanup_project_v1'},{key:{'source.runId':1},name:'speech_cleanup_run_v1'}],
}];
