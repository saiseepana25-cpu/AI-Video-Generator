import {ProjectError} from '../projects/contracts';
export const MAX_LOGO_BYTES=5_000_000;
export type LogoFile={filename:string;contentType:'image/png'|'image/jpeg'|'image/webp';sizeBytes:number;sha256:string};
export type LogoObject={key:string;sha256:string;size:number;width:number;height:number;configHash:string;bucket:string};
export type LogoView={id:string;state:'validating'|'ready'|'rejected'|'expired';filename:string;expiresAt:string;retryAfterSeconds:number;assetId:string|null;previewUrl:string|null;error:string|null};
export interface LogoStore{configHash:string;bucket:string;ensure(object:LogoObject,bytes:Buffer):Promise<void>;read(object:LogoObject):Promise<Buffer>;close():void;}
export function parseLogoFile(raw:unknown):LogoFile{
  const fail=():never=>{throw new ProjectError('INVALID_LOGO',422,'Choose a PNG, JPEG or WebP up to 5 MB with a plain filename.');};
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return fail();
  const v=raw as LogoFile;
  if(Object.keys(v).sort().join(',')!=='contentType,filename,sha256,sizeBytes'||typeof v.filename!=='string'||!v.filename.trim()||v.filename.length>120||/[<>/\\\u0000-\u001f\u007f\uD800-\uDFFF]/u.test(v.filename)||!['image/png','image/jpeg','image/webp'].includes(v.contentType)||!Number.isSafeInteger(v.sizeBytes)||v.sizeBytes<1||v.sizeBytes>MAX_LOGO_BYTES||typeof v.sha256!=='string'||!/^[a-f0-9]{64}$/.test(v.sha256))return fail();
  return {filename:v.filename,contentType:v.contentType,sizeBytes:v.sizeBytes,sha256:v.sha256};
}
