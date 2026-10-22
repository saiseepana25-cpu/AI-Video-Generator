// Pure palette rules shared by the form and the isolated renderer.
export type BrandKit={logoAssetId:string|null;primaryColor:string;secondaryColor:string;backgroundColor:string;englishFontId:'inter-latin-400';teluguFontId:'noto-sans-telugu-400';themeId:'clean-educational-v1'};
export const initialBrand:BrandKit={logoAssetId:null,primaryColor:'#B7A4FF',secondaryColor:'#7EDDCF',backgroundColor:'#101218',englishFontId:'inter-latin-400',teluguFontId:'noto-sans-telugu-400',themeId:'clean-educational-v1'};
export const isColor=(value:unknown):value is string=>typeof value==='string'&&/^#[0-9a-fA-F]{6}$/.test(value);
function luminance(color:string){return [1,3,5].map(n=>parseInt(color.slice(n,n+2),16)/255).map(n=>n<=0.04045?n/12.92:((n+0.055)/1.055)**2.4).reduce((sum,n,i)=>sum+n*[0.2126,0.7152,0.0722][i],0);}
export function contrast(a:string,b:string){const x=luminance(a),y=luminance(b);return (Math.max(x,y)+0.05)/(Math.min(x,y)+0.05);}
export function brandTextColor(background:string){return contrast('#FFFFFF',background)>=contrast('#000000',background)?'#FFFFFF':'#000000';}
export function isBrandPalette(value:unknown):value is BrandKit{
  if(!value||typeof value!=='object'||Array.isArray(value))return false;
  const p=value as BrandKit;
  return Object.keys(p).length===Object.keys(initialBrand).length&&Object.keys(initialBrand).every(k=>Object.hasOwn(p,k))&&(p.logoAssetId===null||typeof p.logoAssetId==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(p.logoAssetId))&&p.englishFontId===initialBrand.englishFontId&&p.teluguFontId===initialBrand.teluguFontId&&p.themeId===initialBrand.themeId&&isColor(p.primaryColor)&&isColor(p.secondaryColor)&&isColor(p.backgroundColor)&&contrast(p.primaryColor,p.backgroundColor)>=3&&contrast(p.secondaryColor,p.backgroundColor)>=3;
}
