import type {Document} from 'mongodb';
import type {CollectionContract} from './schemas';
import {executorCollections} from './executor-schemas';
import {reuseReleaseCollections} from './reuse-release-schemas';
import {storageCollections} from './storage-schemas';
import {localCleanupCollections} from './local-cleanup-schemas';
const uuid={bsonType:'string',pattern:'^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'},hash={bsonType:'string',pattern:'^[a-f0-9]{64}$'},date={bsonType:'date'},long={bsonType:'long',minimum:1,maximum:Number.MAX_SAFE_INTEGER};
const obj=(properties:Record<string,Document>)=>({bsonType:'object',additionalProperties:false,required:Object.keys(properties),properties});
const area={enum:['work','artifact']},name={bsonType:'string',minLength:1,maxLength:500,pattern:'^(?!.*[.][.])[A-Za-z0-9_@. ()+/-]+$'};
const properties={_id:uuid,workspaceId:uuid,projectId:uuid,runId:uuid,sourceHash:hash,rootHash:hash,
  source:obj({executionId:uuid,runId:uuid,artifactId:{oneOf:[uuid,{bsonType:'null'}]},includeArtifact:{bsonType:'bool'},stoppedAt:date,workOwnerHash:hash,artifactOwnerHash:{oneOf:[hash,{bsonType:'null'}]}}),
  inventory:obj({files:{bsonType:'array',maxItems:2048,items:obj({area,name,size:{bsonType:['int','long','double'],minimum:0,maximum:134217728},sha256:hash})},directories:{bsonType:'array',maxItems:2048,items:obj({area,name:{...name,minLength:0,pattern:'^(?!.*[.][.])[A-Za-z0-9_@. ()+/-]*$'}})}}),
  state:{enum:['pending','retry','cleaned']},revision:long,createdAt:date,updatedAt:date,cleanedAt:{bsonType:['date','null']},error:{enum:[null,'EXECUTION_REMOVAL_FAILED']}};
const executors=structuredClone(executorCollections[0]);executors.validator.$jsonSchema.properties.payloadSealedAt={bsonType:['date','null']};executors.indexes.push({key:{artifactId:1},name:'executor_artifact_identity_v1',unique:true,partialFilterExpression:{artifactId:{$type:'string'}}});
const releases=structuredClone(reuseReleaseCollections[0]);releases.validator.$jsonSchema.properties.reason.enum.push('deleted_target_executor_stopped');
const local=structuredClone(localCleanupCollections[0]);local.validator.$jsonSchema.properties.files.maxItems=15;local.validator.$jsonSchema.properties.files.items.properties.name.pattern='^(video[.]mp4|captions[.]srt|input[.]json|timing[.]json|manifest[.]json|narration[.]wav|scene-[1-8][.]png|[.]execution-owner[.]json)$';
export const executionCleanupCollections:CollectionContract[]=[executors,releases,local,{name:'unpromoted_cleanup_tasks',validator:{$jsonSchema:obj({_id:uuid,workspaceId:uuid,projectId:uuid,runId:uuid,sourceHash:hash,configHash:hash,bucket:{bsonType:'string',minLength:3,maxLength:63},objects:structuredClone(storageCollections[0].validator.$jsonSchema.properties.objects),removedKinds:{bsonType:'array',maxItems:5,uniqueItems:true,items:{enum:['mp4','srt','input','timing','manifest']}},state:{enum:['pending','retry','deleted']},revision:long,createdAt:date,updatedAt:date,deletedAt:{bsonType:['date','null']},error:{enum:[null,'UNPROMOTED_REMOVAL_FAILED']}}),$or:[{state:'deleted',deletedAt:{$type:'date'},'removedKinds.4':{$exists:true},error:null},{state:'pending',deletedAt:null,error:null},{state:'retry',deletedAt:null,error:'UNPROMOTED_REMOVAL_FAILED'}]},indexes:[{key:{workspaceId:1,projectId:1,state:1},name:'unpromoted_cleanup_project_v1'},{key:{runId:1},unique:true,name:'unpromoted_cleanup_run_v1'}]},{name:'execution_cleanup_tasks',validator:{$jsonSchema:obj(properties),
  $expr:{$and:[{$eq:['$_id','$source.executionId']},{$eq:['$runId','$source.runId']},{$lte:[{$add:[{$size:'$inventory.files'},{$size:'$inventory.directories'}]},2048]}]},
  $or:[{state:'cleaned',cleanedAt:{$type:'date'},error:null},{state:'pending',cleanedAt:null,error:null},{state:'retry',cleanedAt:null,error:'EXECUTION_REMOVAL_FAILED'}]},
  indexes:[{key:{workspaceId:1,projectId:1,state:1},name:'execution_cleanup_project_v1'},{key:{runId:1},name:'execution_cleanup_run_v1'}]}];
