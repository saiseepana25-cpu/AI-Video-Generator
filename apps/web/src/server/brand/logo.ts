/** Public content identity only. Storage addresses and credentials never enter approvals. */
export type RenderLogo={assetId:string;sha256:string;size:number;width:number;height:number;contentType:'image/png'};
export function isRenderLogo(raw:unknown):raw is RenderLogo{
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return false;
  const v=raw as RenderLogo,keys=['assetId','sha256','size','width','height','contentType'];
  return Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k))&&typeof v.assetId==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v.assetId)&&typeof v.sha256==='string'&&/^[a-f0-9]{64}$/.test(v.sha256)&&Number.isSafeInteger(v.size)&&v.size>0&&v.size<=5_000_000&&[v.width,v.height].every(n=>Number.isSafeInteger(n)&&n>0&&n<=1024)&&v.contentType==='image/png';
}
