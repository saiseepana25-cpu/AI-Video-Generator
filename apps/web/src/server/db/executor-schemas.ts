import type {Document} from 'mongodb';
import type {CollectionContract} from './schemas';
import {generationWorkerCollections} from './generation-worker-schemas';
const uuid={bsonType:'string',pattern:'^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'},hash={bsonType:'string',pattern:'^[a-f0-9]{64}$'},date={bsonType:'date'},long={bsonType:'long',minimum:1,maximum:Number.MAX_SAFE_INTEGER};
const nullable=(v:Document)=>({oneOf:[v,{bsonType:'null'}]});
const properties={_id:uuid,workspaceId:uuid,projectId:uuid,runId:uuid,inputHash:hash,rendererBuildHash:hash,hostHash:hash,rootHash:hash,owner:uuid,leaseEpoch:long,
  stage:{enum:['preflight','render']},artifactId:nullable(uuid),jobName:{bsonType:'string',pattern:'^Local\\\\VideoCraft_[a-f0-9]{32}$'},protocol:{enum:['windows-job-v1']},state:{enum:['prepared','running','recovering','stopped']},revision:long,
  createdAt:date,updatedAt:date,stoppedAt:nullable(date),exitCode:nullable({bsonType:['int','long','double'],minimum:0,maximum:4294967295}),stopReason:{enum:[null,'completed','cancelled','recovered']}};
const runs=structuredClone(generationWorkerCollections.find(c=>c.name==='generation_runs')!);
runs.validator.$jsonSchema.properties.executorProtocol={enum:['windows-job-v1']};
export const executorCollections:CollectionContract[]=[{name:'generation_executors',validator:{$jsonSchema:{bsonType:'object',additionalProperties:false,required:Object.keys(properties),properties},
  $or:[{state:'stopped',stoppedAt:{$type:'date'},exitCode:{$ne:null},stopReason:{$ne:null}},{state:{$in:['prepared','running','recovering']},stoppedAt:null,exitCode:null,stopReason:null}],
  $expr:{$and:[
    {$eq:['$jobName',{$concat:['Local\\VideoCraft_',{$replaceAll:{input:'$_id',find:'-',replacement:''}}]}]},
    {$cond:[{$eq:['$stage','preflight']},{$eq:['$artifactId',null]},{$ne:['$artifactId',null]}]},
  ]}},
  indexes:[{key:{runId:1,leaseEpoch:1,stage:1},unique:true,name:'one_executor_per_stage_v1'},{key:{jobName:1},unique:true,name:'executor_job_identity_v1'},{key:{workspaceId:1,projectId:1,state:1},name:'executor_cleanup_scope_v1'}]},runs];
