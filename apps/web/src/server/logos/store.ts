import {S3Client,GetObjectCommand,PutObjectCommand} from '@aws-sdk/client-s3';
import {Readable} from 'node:stream';
import {r2Settings} from '../storage/r2';
import {MAX_LOGO_BYTES,type LogoObject,type LogoStore} from './contracts';
import {logoHash} from './image';
export function verifyLogoObject(object:LogoObject,bytes:Buffer){
  if(!/^workspaces\/[a-f0-9-]{36}\/logos\/[a-f0-9-]{36}\/[a-f0-9-]{36}\.png$/.test(object.key)||object.size<1||object.size>MAX_LOGO_BYTES||object.width<1||object.height<1||object.width>1024||object.height>1024||bytes.length!==object.size||logoHash(bytes)!==object.sha256||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw new Error('LOGO_BYTES_INVALID');
}
export class LogoObjectStore implements LogoStore{
  readonly configHash:string;readonly bucket:string;private client:S3Client;
  constructor(env:Record<string,string|undefined>,client?:S3Client){const s=r2Settings(env);this.configHash=s.configHash;this.bucket=s.bucket;this.client=client??new S3Client({region:'auto',endpoint:s.endpoint,forcePathStyle:true,maxAttempts:1,followRegionRedirects:false,requestChecksumCalculation:'WHEN_REQUIRED',responseChecksumValidation:'WHEN_REQUIRED',credentials:{accessKeyId:s.accessKeyId,secretAccessKey:s.secretAccessKey}});}
  close(){this.client.destroy();}
  async ensure(object:LogoObject,bytes:Buffer){
    verifyLogoObject(object,bytes);if(object.configHash!==this.configHash||object.bucket!==this.bucket)throw new Error('LOGO_DESTINATION_CHANGED');
    try{await this.client.send(new PutObjectCommand({Bucket:this.bucket,Key:object.key,Body:bytes,ContentLength:bytes.length,ContentType:'image/png',IfNoneMatch:'*',Metadata:{sha256:object.sha256}}),{abortSignal:AbortSignal.timeout(25000)});}catch{/* Reconcile unknown writes by verified bytes at the immutable key. */}
    await this.read(object);
  }
  async read(object:LogoObject){
    if(object.configHash!==this.configHash||object.bucket!==this.bucket||object.size<1||object.size>MAX_LOGO_BYTES)throw new Error('LOGO_DESTINATION_CHANGED');
    const result=await this.client.send(new GetObjectCommand({Bucket:this.bucket,Key:object.key}),{abortSignal:AbortSignal.timeout(25000)});
    if(!(result.Body instanceof Readable)||result.ContentLength!==object.size||result.ContentType!=='image/png'){if(result.Body instanceof Readable)result.Body.destroy();throw new Error('LOGO_READ_INVALID');}
    const stream=result.Body,chunks:Buffer[]=[];let size=0;
    const timer=setTimeout(()=>stream.destroy(new Error('LOGO_READ_TIMEOUT')),25000);
    try{for await(const part of stream){size+=part.length;if(size>object.size)throw new Error('LOGO_READ_INVALID');chunks.push(Buffer.from(part));}}finally{clearTimeout(timer);if(!stream.readableEnded)stream.destroy();}
    const bytes=Buffer.concat(chunks);verifyLogoObject(object,bytes);return bytes;
  }
}
