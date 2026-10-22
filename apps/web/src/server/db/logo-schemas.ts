import type {Document} from 'mongodb';
import type {CollectionContract} from './schemas';
const uuid={bsonType:'string',pattern:'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'},hash={bsonType:'string',pattern:'^[a-f0-9]{64}$'},user={bsonType:'string',pattern:'^[a-f0-9]{24}$'},date={bsonType:'date'};
const obj=(properties:Record<string,Document>)=>({bsonType:'object',additionalProperties:false,required:Object.keys(properties),properties});
const nullable=(value:Document)=>({oneOf:[value,{bsonType:'null'}]});
const file=obj({filename:{bsonType:'string',minLength:1,maxLength:120},contentType:{enum:['image/png','image/jpeg','image/webp']},sizeBytes:{bsonType:['int','double'],minimum:1,maximum:5_000_000},sha256:hash});
const object=obj({key:{bsonType:'string',maxLength:240},sha256:hash,size:{bsonType:['int','double'],minimum:1,maximum:5_000_000},width:{bsonType:['int','double'],minimum:1,maximum:1024},height:{bsonType:['int','double'],minimum:1,maximum:1024},configHash:hash,bucket:{bsonType:'string',minLength:3,maxLength:63}});
const counter={bsonType:'long',minimum:1,maximum:Number.MAX_SAFE_INTEGER};
export const logoCollections:CollectionContract[]=[
  {name:'logo_uploads',validator:{$jsonSchema:obj({_id:uuid,schemaVersion:{enum:[1]},workspaceId:uuid,userId:user,file,requestHash:hash,assetId:uuid,state:{enum:['validating','ready','rejected','expired']},owner:nullable(uuid),epoch:counter,leaseUntil:nullable(date),object:nullable(object),error:nullable({bsonType:'string',maxLength:300}),createdAt:date,updatedAt:date,expiresAt:date})},indexes:[{key:{workspaceId:1,userId:1,createdAt:-1},name:'logo_upload_owner_v1'}]},
  {name:'logo_assets',validator:{$jsonSchema:obj({_id:uuid,schemaVersion:{enum:[1]},workspaceId:uuid,uploadId:uuid,createdBy:user,object,lifecycleState:{enum:['available','unavailable']},referenceRevision:counter,refCount:{enum:[1]},createdAt:date})},indexes:[{key:{uploadId:1},name:'logo_asset_upload_v1',unique:true},{key:{'object.key':1,'object.configHash':1},name:'logo_asset_object_v1',unique:true}]},
];
