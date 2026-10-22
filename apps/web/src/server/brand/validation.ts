import {uuidPattern,ProjectError} from '../projects/contracts';
import {initialBrand,isColor,contrast,type BrandKit} from './palette';
export {initialBrand,isColor,contrast,brandTextColor,type BrandKit} from './palette';
export type BrandPut={expectedRevision:number;brandKit:BrandKit};
const invalid=(message:string):never=>{throw new ProjectError('VALIDATION_FAILED',422,message);};
function object(value:unknown,keys:string[]):Record<string,unknown>{
  if(!value||typeof value!=='object'||Array.isArray(value))return invalid('Use a complete brand palette object.');
  if(Object.keys(value).some(k=>!keys.includes(k)))throw new ProjectError('UNKNOWN_FIELD',400,'Remove unsupported brand fields.');
  return value as Record<string,unknown>;
}
export function parseBrandPut(raw:unknown):BrandPut{
  const body=object(raw,['expectedRevision','brandKit']);
  if(body.expectedRevision===undefined)throw new ProjectError('PRECONDITION_REQUIRED',428,'Include the saved brand revision.');
  if(!Number.isSafeInteger(body.expectedRevision)||(body.expectedRevision as number)<0)return invalid('Use a nonnegative safe brand revision.');
  const kit=object(body.brandKit,Object.keys(initialBrand));
  if(kit.logoAssetId!==null&&(typeof kit.logoAssetId!=='string'||!uuidPattern.test(kit.logoAssetId)))return invalid('Choose a prepared logo or no logo.');
  if(kit.englishFontId!==initialBrand.englishFontId||kit.teluguFontId!==initialBrand.teluguFontId||kit.themeId!==initialBrand.themeId)return invalid('Use the supported Inter, Noto Sans Telugu and educational theme.');
  const {primaryColor,secondaryColor,backgroundColor}=kit;
  if(!isColor(primaryColor)||!isColor(secondaryColor)||!isColor(backgroundColor))return invalid('Use six-digit hex colors, such as #B7A4FF.');
  if(contrast(primaryColor,backgroundColor)<3||contrast(secondaryColor,backgroundColor)<3)return invalid('Each diagram color needs at least 3:1 contrast against the background. Choose brighter colors or a darker background.');
  return {expectedRevision:body.expectedRevision as number,brandKit:{...initialBrand,logoAssetId:kit.logoAssetId as string|null,primaryColor:primaryColor.toUpperCase(),secondaryColor:secondaryColor.toUpperCase(),backgroundColor:backgroundColor.toUpperCase()}};
}
