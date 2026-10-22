import {ProjectError} from '../projects/contracts';
export type BrandKit={logoAssetId:null;primaryColor:string;secondaryColor:string;backgroundColor:string;englishFontId:'inter-latin-400';teluguFontId:'noto-sans-telugu-400';themeId:'clean-educational-v1'};
export type BrandPut={expectedRevision:number;brandKit:BrandKit};
export const initialBrand:BrandKit={logoAssetId:null,primaryColor:'#B7A4FF',secondaryColor:'#7EDDCF',backgroundColor:'#101218',englishFontId:'inter-latin-400',teluguFontId:'noto-sans-telugu-400',themeId:'clean-educational-v1'};
export const isColor=(value:unknown):value is string=>typeof value==='string'&&/^#[0-9a-fA-F]{6}$/.test(value);
function luminance(color:string){return [1,3,5].map(n=>parseInt(color.slice(n,n+2),16)/255).map(n=>n<=0.04045?n/12.92:((n+0.055)/1.055)**2.4).reduce((sum,n,i)=>sum+n*[0.2126,0.7152,0.0722][i],0);}
export function contrast(a:string,b:string){const x=luminance(a),y=luminance(b);return (Math.max(x,y)+0.05)/(Math.min(x,y)+0.05);}
export function brandTextColor(background:string){return contrast('#FFFFFF',background)>=contrast('#000000',background)?'#FFFFFF':'#000000';}
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
  if(kit.logoAssetId!==null)return invalid('Logo uploads are not available yet. Keep logoAssetId null.');
  if(kit.englishFontId!==initialBrand.englishFontId||kit.teluguFontId!==initialBrand.teluguFontId||kit.themeId!==initialBrand.themeId)return invalid('Use the supported Inter, Noto Sans Telugu and educational theme.');
  const {primaryColor,secondaryColor,backgroundColor}=kit;
  if(!isColor(primaryColor)||!isColor(secondaryColor)||!isColor(backgroundColor))return invalid('Use six-digit hex colors, such as #B7A4FF.');
  if(contrast(primaryColor,backgroundColor)<3||contrast(secondaryColor,backgroundColor)<3)return invalid('Each diagram color needs at least 3:1 contrast against the background. Choose brighter colors or a darker background.');
  return {expectedRevision:body.expectedRevision as number,brandKit:{...initialBrand,primaryColor:primaryColor.toUpperCase(),secondaryColor:secondaryColor.toUpperCase(),backgroundColor:backgroundColor.toUpperCase()}};
}
