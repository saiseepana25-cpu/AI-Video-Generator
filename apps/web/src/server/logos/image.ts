import sharp from 'sharp';
import {createHash} from 'node:crypto';
import {MAX_LOGO_BYTES,type LogoFile} from './contracts';
export class InvalidLogo extends Error{constructor(){super('Use a complete, nonanimated PNG, JPEG or WebP within 4096 × 4096 pixels.');}}
export const logoHash=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
function signature(bytes:Buffer,type:LogoFile['contentType']){
  if(type==='image/png'){
    if(!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw new InvalidLogo();
    let position=8,chunks=0,finished=false;
    while(position+12<=bytes.length){
      const size=bytes.readUInt32BE(position),kind=bytes.toString('ascii',position+4,position+8),end=position+12+size;
      if(++chunks>4096||end>bytes.length||['acTL','fcTL','fdAT'].includes(kind))throw new InvalidLogo();
      if(kind==='IEND'){if(size!==0||end!==bytes.length)throw new InvalidLogo();finished=true;break;}position=end;
    }
    if(!finished)throw new InvalidLogo();
  }else if(type==='image/jpeg'){
    if(bytes.length<4||bytes.readUInt16BE(0)!==0xffd8||bytes.readUInt16BE(bytes.length-2)!==0xffd9)throw new InvalidLogo();
  }else{
    if(bytes.length<12||bytes.toString('ascii',0,4)!=='RIFF'||bytes.toString('ascii',8,12)!=='WEBP'||bytes.readUInt32LE(4)+8!==bytes.length)throw new InvalidLogo();
    let position=12,chunks=0;
    while(position+8<=bytes.length){const kind=bytes.toString('ascii',position,position+4),size=bytes.readUInt32LE(position+4),end=position+8+size+(size%2);if(++chunks>4096||end>bytes.length||['ANIM','ANMF'].includes(kind))throw new InvalidLogo();position=end;}
    if(position!==bytes.length)throw new InvalidLogo();
  }
}
export async function canonicalLogo(bytes:Buffer,file:LogoFile){
  if(bytes.length!==file.sizeBytes||bytes.length>MAX_LOGO_BYTES||logoHash(bytes)!==file.sha256)throw new InvalidLogo();
  signature(bytes,file.contentType);
  try{
    const input=sharp(bytes,{failOn:'warning',limitInputPixels:4096*4096,sequentialRead:true});
    const metadata=await input.metadata();
    if(!metadata.width||!metadata.height||metadata.width>4096||metadata.height>4096||(metadata.pages??1)!==1||metadata.format!==({'image/png':'png','image/jpeg':'jpeg','image/webp':'webp'} as const)[file.contentType])throw new InvalidLogo();
    const {data,info}=await input.rotate().resize(1024,1024,{fit:'inside',withoutEnlargement:true}).toColourspace('srgb').png({compressionLevel:9}).timeout({seconds:10}).toBuffer({resolveWithObject:true});
    if(!data.length||data.length>MAX_LOGO_BYTES||info.width>1024||info.height>1024)throw new InvalidLogo();
    return {bytes:data,width:info.width,height:info.height,sha256:logoHash(data)};
  }catch{throw new InvalidLogo();}
}
