import type {Document} from 'mongodb';
import type {CollectionContract} from './schemas';
import {workspaceSettingsCollections} from './workspace-settings-schemas';
const uuid={bsonType:'string',pattern:'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'},hash={bsonType:'string',pattern:'^[a-f0-9]{64}$'},userId={bsonType:'string',pattern:'^[a-f0-9]{24}$'};
const obj=(properties:Record<string,Document>)=>({bsonType:'object',additionalProperties:false,required:Object.keys(properties),properties});
const nullable=(value:Document)=>({oneOf:[value,{bsonType:'null'}]});
const color={bsonType:'string',pattern:'^#[0-9A-F]{6}$'},revision={bsonType:['int','double','long'],minimum:1,maximum:Number.MAX_SAFE_INTEGER};
const palette={logoAssetId:{bsonType:'null'},primaryColor:color,secondaryColor:color,backgroundColor:color,englishFontId:{enum:['inter-latin-400']},teluguFontId:{enum:['noto-sans-telugu-400']},themeId:{enum:['clean-educational-v1']}};
const activity=structuredClone(workspaceSettingsCollections.find(c=>c.name==='activity_events')!);
activity.validator.$jsonSchema.properties.type.enum.push('workspace_brand_changed');
export const brandCollections:CollectionContract[]=[activity,
  {name:'brand_kits',validator:{$jsonSchema:obj({_id:uuid,schemaVersion:{enum:[1]},workspaceId:uuid,revision:{bsonType:'long',minimum:1,maximum:Number.MAX_SAFE_INTEGER},...palette,parentBrandKitRevisionId:nullable(uuid),createdAt:{bsonType:'date'},createdBy:obj({kind:{enum:['user']},userId})})},indexes:[{key:{workspaceId:1,revision:1},name:'brand_workspace_revision_v1',unique:true}]},
  {name:'workspace_brand_commands',validator:{$jsonSchema:obj({_id:uuid,workspaceId:uuid,userId,keyHash:hash,requestHash:hash,snapshot:obj({revision,brandKit:obj({id:uuid,revision,...palette,createdAt:{bsonType:'string'},createdBy:obj({id:userId})})}),createdAt:{bsonType:'date'}})},indexes:[{key:{workspaceId:1,userId:1,keyHash:1},name:'workspace_brand_replay_v1',unique:true}]},
];
