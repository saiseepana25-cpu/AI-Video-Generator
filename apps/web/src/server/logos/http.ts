import {ProjectError} from '../projects/contracts';
import {MAX_LOGO_BYTES,parseLogoFile} from './contracts';
export async function readLogoBody(request:Request){
  const contentType=request.headers.get('content-type');
  if(!['image/png','image/jpeg','image/webp'].includes(contentType??'')||!['identity',null].includes(request.headers.get('content-encoding')))throw new ProjectError('UNSUPPORTED_MEDIA_TYPE',415,'Send uncompressed PNG, JPEG or WebP bytes.');
  const declared=request.headers.get('content-length');
  if(declared!==null&&(!/^\d+$/.test(declared)||Number(declared)>MAX_LOGO_BYTES))throw new ProjectError('INPUT_TOO_LARGE',413,'Logos must be at most 5 MB.');
  let filename='';try{filename=decodeURIComponent(request.headers.get('x-logo-filename')??'');}catch{throw new ProjectError('INVALID_LOGO',422,'Use an encoded plain filename.');}
  if(!request.body)throw new ProjectError('INVALID_LOGO',422,'Choose an image to upload.');
  const reader=request.body.getReader(),chunks:Uint8Array[]=[];let size=0,timedOut=false;
  const timer=setTimeout(()=>{timedOut=true;void reader.cancel().catch(()=>{});},30000);
  try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>MAX_LOGO_BYTES)throw new ProjectError('INPUT_TOO_LARGE',413,'Logos must be at most 5 MB.');chunks.push(part.value);}}
  finally{clearTimeout(timer);await reader.cancel().catch(()=>{});reader.releaseLock();}
  if(timedOut||declared!==null&&Number(declared)!==size)throw new ProjectError('INVALID_LOGO',422,'The image upload was incomplete.');
  const file=parseLogoFile({filename,contentType,sizeBytes:size,sha256:request.headers.get('x-logo-sha256')});
  return {file,bytes:Buffer.concat(chunks)};
}
