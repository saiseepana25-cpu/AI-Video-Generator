import type {Db,ClientSession} from 'mongodb';
import type {Row} from '../planning/service';
import {ProjectError,uuidPattern} from '../projects/contracts';
import {isBrandPalette} from './palette';
import type {RenderBrand} from '../rendering/contract';
/** Resolve the captured immutable revision, never the workspace's current pointer.
 * Brand rows have no deletion/cleanup path; future cleanup must preserve these references. */
export async function readBrandSelection(db:Db,session:ClientSession,workspaceId:string,id:string|null):Promise<RenderBrand|null>{
  if(id===null)return null;
  const row=uuidPattern.test(id)?await db.collection<Row>('brand_kits').findOne({_id:id,workspaceId},{session}):null;
  if(row){
    const palette={logoAssetId:row.logoAssetId,primaryColor:row.primaryColor,secondaryColor:row.secondaryColor,backgroundColor:row.backgroundColor,englishFontId:row.englishFontId,teluguFontId:row.teluguFontId,themeId:row.themeId};
    if(isBrandPalette(palette))return {revisionId:id,...palette};
  }
  throw new ProjectError('BRAND_UNAVAILABLE',422,'The selected brand palette is unavailable or unsupported. Choose no branding or a valid shared palette.');
}
