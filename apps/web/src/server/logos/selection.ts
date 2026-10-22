import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {Long,type Db,type ClientSession} from 'mongodb';
import type {Row} from '../planning/service';
import {ProjectError,uuidPattern} from '../projects/contracts';
import {isRenderLogo,type RenderLogo} from '../brand/logo';
import type {LogoObject} from './contracts';
const unavailable=()=>new ProjectError('LOGO_UNAVAILABLE',422,'The selected logo is unavailable. Prepare a replacement and save a new brand revision.');
export const logoIdentity=(id:string,o:LogoObject):RenderLogo=>({assetId:id,sha256:o.sha256,size:o.size,width:o.width,height:o.height,contentType:'image/png'});
export async function availableLogo(db:Db,s:ClientSession,workspaceId:string,id:string){
  const row=uuidPattern.test(id)?await db.collection<Row>('logo_assets').findOne({_id:id,workspaceId,lifecycleState:'available'},{session:s}):null;
  const upload=row&&await db.collection<Row>('logo_uploads').findOne({_id:row.uploadId,workspaceId,state:'ready',assetId:id},{session:s});
  if(!row||!upload||!isDeepStrictEqual(row.object,upload.object)||row.object.key!==`workspaces/${workspaceId}/logos/${row.uploadId}/${id}.png`||!isRenderLogo(logoIdentity(id,row.object)))throw unavailable();
  return row;
}
export async function pinnedLogo(db:Db,s:ClientSession,workspaceId:string,id:string,ownerType:'brand_kit'|'generation_run',ownerId:string){
  const row=await availableLogo(db,s,workspaceId,id);
  if(!await db.collection<Row>('logo_asset_refs').findOne({workspaceId,assetId:id,ownerType,ownerId,purpose:'brand_logo'},{session:s}))throw unavailable();
  return row;
}
/** Same asset guard is required for every new pin and any future lifecycle/cleanup writer. */
export async function pinLogo(db:Db,s:ClientSession,workspaceId:string,id:string,ownerType:'brand_kit'|'generation_run',ownerId:string){
  const row=await availableLogo(db,s,workspaceId,id);
  if(await db.collection<Row>('logo_asset_refs').findOne({workspaceId,assetId:id,ownerType,ownerId,purpose:'brand_logo'},{session:s}))return;
  if(!Long.isLong(row.referenceRevision)||row.referenceRevision.greaterThanOrEqual(Long.fromNumber(Number.MAX_SAFE_INTEGER))||!Number.isSafeInteger(row.refCount)||row.refCount>=Number.MAX_SAFE_INTEGER)throw unavailable();
  const updated=await db.collection<Row>('logo_assets').updateOne({_id:id,workspaceId,lifecycleState:'available',referenceRevision:row.referenceRevision,refCount:row.refCount},{$inc:{referenceRevision:Long.ONE,refCount:1}},{session:s});
  if(!updated.matchedCount)throw unavailable();
  await db.collection<Row>('logo_asset_refs').insertOne({_id:randomUUID(),schemaVersion:1,workspaceId,assetId:id,ownerType,ownerId,purpose:'brand_logo',createdAt:new Date()},{session:s});
}
