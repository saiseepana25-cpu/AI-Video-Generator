import {initialBrand,parseBrandPut,type BrandKit,type BrandPut} from '../server/brand/validation';
import {uuidPattern} from '../server/projects/contracts';
export type BrandCommand={key:string;body:BrandPut};
/** API brand revisions also carry response-only identity and audit metadata. */
export function editableBrandPalette(kit:BrandKit|null):BrandKit{
  const palette=kit??initialBrand;
  return {logoAssetId:palette.logoAssetId,primaryColor:palette.primaryColor,secondaryColor:palette.secondaryColor,backgroundColor:palette.backgroundColor,englishFontId:palette.englishFontId,teluguFontId:palette.teluguFontId,themeId:palette.themeId};
}
export function recoverBrandCommand(raw:string):BrandCommand|null{
  try{if(raw.length>16000)return null;const value=JSON.parse(raw);if(!value||Array.isArray(value)||Object.keys(value).some(k=>!['key','body'].includes(k))||typeof value.key!=='string'||!uuidPattern.test(value.key))return null;
    const body=parseBrandPut(value.body);return {key:value.key,body};
  }catch{return null;}
}
