import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Readable} from 'node:stream';
import sharp from 'sharp';
import {PutObjectCommand,GetObjectCommand,type S3Client} from '@aws-sdk/client-s3';
import {canonicalLogo,logoHash} from '../src/server/logos/image';
import {parseLogoFile,type LogoFile,type LogoObject} from '../src/server/logos/contracts';
import {recoverLogoCommand} from '../src/lib/logo-command';
import {readLogoBody} from '../src/server/logos/http';
import {LogoObjectStore} from '../src/server/logos/store';
const metadata=(bytes:Buffer,type:LogoFile['contentType']='image/png'):LogoFile=>({filename:'team-logo.png',contentType:type,sizeBytes:bytes.length,sha256:logoHash(bytes)});
test('supported images fully decode to deterministic metadata-free PNG, preserve alpha/proportions, bound dimensions',async()=>{
  for(const format of ['png','jpeg','webp'] as const){
    const source=await sharp({create:{width:1600,height:800,channels:4,background:{r:100,g:40,b:240,alpha:.5}}}).toFormat(format).withMetadata({exif:{IFD0:{ImageDescription:'private metadata'}}}).toBuffer();
    const file=metadata(source,format==='jpeg'?'image/jpeg':format==='webp'?'image/webp':'image/png'),a=await canonicalLogo(source,file),b=await canonicalLogo(source,file),decoded=await sharp(a.bytes).metadata();
    assert.equal(a.width,1024);assert.equal(a.height,512);assert.equal(a.sha256,b.sha256);assert.deepEqual(a.bytes,b.bytes);assert.equal(decoded.format,'png');assert.equal(decoded.exif,undefined);assert.equal(decoded.icc,undefined);if(format!=='jpeg')assert.equal(decoded.hasAlpha,true);
  }
  const oriented=await sharp({create:{width:80,height:40,channels:3,background:'#B7A4FF'}}).jpeg().withMetadata({orientation:6}).toBuffer(),result=await canonicalLogo(oriented,metadata(oriented,'image/jpeg'));assert.equal(result.width,40);assert.equal(result.height,80);
});
test('mislabeled, truncated, active/vector, animated PNG, oversized decoded images and appended payloads fail closed',async()=>{
  const png=await sharp({create:{width:30,height:20,channels:4,background:'#B7A4FF'}}).png().toBuffer(),large=await sharp({create:{width:4097,height:1,channels:3,background:'#ffffff'}}).png().toBuffer();
  const animation=Buffer.alloc(20);animation.writeUInt32BE(8,0);animation.write('acTL',4);
  for(const bytes of [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),png.subarray(0,png.length-5),Buffer.concat([png,Buffer.from('<script>bad</script>')]),Buffer.concat([png.subarray(0,8),animation,png.subarray(8)]),large])await assert.rejects(canonicalLogo(bytes,metadata(bytes)));
  await assert.rejects(canonicalLogo(png,metadata(png,'image/jpeg')));await assert.rejects(canonicalLogo(png,{...metadata(png),sha256:'0'.repeat(64)}));
  const webp=await sharp(png).webp().toBuffer(),animatedWebp=Buffer.concat([webp,Buffer.from([65,78,73,77,0,0,0,0])]);animatedWebp.writeUInt32LE(animatedWebp.length-8,4);await assert.rejects(canonicalLogo(animatedWebp,metadata(animatedWebp,'image/webp')));
});
test('logo metadata and recovery reject arbitrary fields, unsafe names/types/sizes while preserving original upload identity',()=>{
  const file:LogoFile={filename:'team logo.png',contentType:'image/png',sizeBytes:100,sha256:'a'.repeat(64)},command={id:randomUUID(),file};assert.deepEqual(recoverLogoCommand(JSON.stringify(command)),command);
  for(const patch of [{filename:'../logo.png'},{filename:'a\n.png'},{filename:'<svg>'},{contentType:'image/svg+xml'},{sizeBytes:5_000_001},{sizeBytes:0},{sizeBytes:1.1},{sha256:'bad'},{key:'object-path'}])assert.throws(()=>parseLogoFile({...file,...patch}));
  for(const raw of ['bad','x'.repeat(4001),JSON.stringify({...command,id:'bad'}),JSON.stringify({...command,bytes:'private'})])assert.equal(recoverLogoCommand(raw),null);
});
test('raw upload reader enforces type, bytes, encoding, length, checksum metadata and streaming cap',async()=>{
  const bytes=Buffer.from('small image bytes'),file=metadata(bytes),headers={'Content-Type':file.contentType,'X-Logo-Filename':encodeURIComponent(file.filename),'X-Logo-Sha256':file.sha256,'Content-Length':String(bytes.length)};
  const request=(patch:Record<string,string>={})=>new Request('http://127.0.0.1/api',{method:'PUT',headers:{...headers,...patch},body:new Uint8Array(bytes)});
  assert.deepEqual(await readLogoBody(request()),{file,bytes});
  const invalidHeaders:Record<string,string>[]=[{'Content-Type':'image/svg+xml'},{'Content-Encoding':'gzip'},{'Content-Length':'5000001'},{'Content-Length':'2'},{'X-Logo-Filename':'%bad'},{'X-Logo-Sha256':'bad'}];
  for(const patch of invalidHeaders)await assert.rejects(readLogoBody(request(patch)));
  const stream=new ReadableStream<Uint8Array>({start(c){c.enqueue(new Uint8Array(5_000_001));c.close();}});
  await assert.rejects(readLogoBody(new Request('http://127.0.0.1/api',{method:'PUT',headers:{...headers,'Content-Length':'5000000'},body:stream,duplex:'half'} as RequestInit)),/at most 5 MB/);
});
test('R2 logo writes are create-only and reconcile lost PUT acknowledgements with verified bytes',async()=>{
  const png=await sharp({create:{width:10,height:5,channels:3,background:'#B7A4FF'}}).png().toBuffer(),calls:unknown[]=[];
  const env={R2_ACCOUNT_ID:'a'.repeat(32),R2_ENDPOINT:`https://${'a'.repeat(32)}.r2.cloudflarestorage.com`,R2_BUCKET_NAME:'test-logo-bucket',R2_REGION:'auto',R2_ACCESS_KEY_ID:'test-access-key',R2_SECRET_ACCESS_KEY:'test-secret-key'};
  let corrupt=false;
  const client={send:async(command:PutObjectCommand|GetObjectCommand)=>{calls.push(command);if(command instanceof PutObjectCommand){assert.equal(command.input.IfNoneMatch,'*');assert.deepEqual(command.input.Body,png);throw new Error('private unknown write');}return {Body:Readable.from([corrupt?Buffer.alloc(png.length):png]),ContentLength:png.length,ContentType:'image/png'};},destroy(){}} as unknown as S3Client;
  const store=new LogoObjectStore(env,client),object:LogoObject={key:`workspaces/${randomUUID()}/logos/${randomUUID()}/${randomUUID()}.png`,sha256:logoHash(png),size:png.length,width:10,height:5,configHash:store.configHash,bucket:store.bucket};
  await store.ensure(object,png);assert.equal(calls.length,2);corrupt=true;await assert.rejects(store.read(object));await assert.rejects(store.ensure({...object,key:'../private'},png));store.close();
});
