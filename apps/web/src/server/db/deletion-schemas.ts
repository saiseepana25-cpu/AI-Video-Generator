import type {Document} from 'mongodb';
import type {CollectionContract} from './schemas';
import {projectCollections} from './project-schemas';
import {brandCollections} from './brand-schemas';
const uuid={bsonType:'string',pattern:'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'},hash={bsonType:'string',pattern:'^[a-f0-9]{64}$'};
const obj=(properties:Record<string,Document>)=>({bsonType:'object',additionalProperties:false,required:Object.keys(properties),properties});
const receipt=obj({projectId:uuid,accessRemoved:{enum:[true]},cleanupState:{enum:['retained']},cleanupJobId:{bsonType:'null'},externalPublicationState:{enum:['none_pending']},message:{bsonType:'string',minLength:1,maxLength:240}});
const project=structuredClone(projectCollections[0]);
project.validator.$jsonSchema.properties.deletionReceipt={oneOf:[{bsonType:'null'},receipt]};
const activity=structuredClone(brandCollections.find(c=>c.name==='activity_events')!);
activity.validator.$jsonSchema.properties.type.enum.push('project_deleted');
export const deletionCollections:CollectionContract[]=[project,activity,{
  name:'project_delete_commands',validator:{$jsonSchema:obj({_id:uuid,workspaceId:uuid,userId:{bsonType:'string',pattern:'^[a-f0-9]{24}$'},projectId:uuid,keyHash:hash,requestHash:hash,snapshot:receipt,createdAt:{bsonType:'date'}})},
  indexes:[{key:{workspaceId:1,userId:1,projectId:1,keyHash:1},name:'project_delete_replay_v1',unique:true}],
}];
