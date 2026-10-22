import {createHash} from 'node:crypto';
import {isRenderLogo,type RenderLogo} from '../brand/logo';
/** Approved canonical PNGs only; never accept a remote URL or a caller's filesystem path. */
export function verifiedLogoBytes(logo:RenderLogo|null,bytes?:Buffer):Buffer|null{
  if(!logo){if(bytes)throw new Error('Unexpected logo bytes.');return null;}
  if(!isRenderLogo(logo)||!Buffer.isBuffer(bytes)||bytes.length!==logo.size||createHash('sha256').update(bytes).digest('hex')!==logo.sha256||bytes.length<33||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||bytes.toString('ascii',12,16)!=='IHDR'||bytes.readUInt32BE(16)!==logo.width||bytes.readUInt32BE(20)!==logo.height)throw new Error('Approved logo bytes could not be verified.');
  return Buffer.from(bytes);
}
