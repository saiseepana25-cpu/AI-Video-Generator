import {brandCollections} from './brand-schemas';
import {logoCollections} from './logo-schemas';
import type {CollectionContract} from './schemas';
const uuid={bsonType:'string',pattern:'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'};
const brand=structuredClone(brandCollections.find(c=>c.name==='brand_kits')!);
brand.validator.$jsonSchema.properties.logoAssetId={oneOf:[uuid,{bsonType:'null'}]};
const receipts=structuredClone(brandCollections.find(c=>c.name==='workspace_brand_commands')!);
receipts.validator.$jsonSchema.properties.snapshot.properties.brandKit.properties.logoAssetId={oneOf:[uuid,{bsonType:'null'}]};
const assets=structuredClone(logoCollections.find(c=>c.name==='logo_assets')!);
assets.validator.$jsonSchema.properties.refCount={bsonType:['int','double'],minimum:1,maximum:Number.MAX_SAFE_INTEGER};
assets.indexes.push({key:{workspaceId:1,lifecycleState:1,createdAt:-1,_id:-1},name:'logo_library_v1'});
export const brandLogoCollections:CollectionContract[]=[brand,receipts,assets,
  {name:'logo_asset_refs',validator:{$jsonSchema:{bsonType:'object',additionalProperties:false,required:['_id','schemaVersion','workspaceId','assetId','ownerType','ownerId','purpose','createdAt'],properties:{_id:uuid,schemaVersion:{enum:[1]},workspaceId:uuid,assetId:uuid,ownerType:{enum:['brand_kit','generation_run']},ownerId:uuid,purpose:{enum:['brand_logo']},createdAt:{bsonType:'date'}}}},indexes:[{key:{assetId:1,ownerType:1,ownerId:1,purpose:1},name:'logo_owner_pin_v1',unique:true},{key:{workspaceId:1,ownerType:1,ownerId:1},name:'logo_owner_lookup_v1'}]},
];
