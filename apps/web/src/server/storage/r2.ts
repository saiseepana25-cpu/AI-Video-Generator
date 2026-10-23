import {createHash} from 'node:crypto';
import {S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand, HeadObjectCommand} from '@aws-sdk/client-s3';
import {Readable} from 'node:stream';
import {StorageFault, storageFiles, type ObjectStore, type StorageObject} from './contracts';
export const sha256 = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
export function r2Settings(env: Record<string, string | undefined>) {
  const account = env.R2_ACCOUNT_ID?.trim(), endpoint = env.R2_ENDPOINT?.trim(), bucket = env.R2_BUCKET_NAME?.trim();
  const accessKeyId = env.R2_ACCESS_KEY_ID?.trim(), secretAccessKey = env.R2_SECRET_ACCESS_KEY?.trim();
  if (!account || !/^[a-f0-9]{32}$/.test(account) || endpoint !== `https://${account}.r2.cloudflarestorage.com` || !bucket || !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket)
    || !accessKeyId || !secretAccessKey || env.R2_REGION !== 'auto') throw new StorageFault('STORAGE_CONFIGURATION_REQUIRED');
  return {endpoint, bucket, accessKeyId, secretAccessKey, configHash: sha256(JSON.stringify({endpoint, bucket, accessKeyId}))};
}
export function verifyObject(object: StorageObject, bytes: Buffer) {
  const file = storageFiles[object.kind];
  if (!file || object.mime !== file.mime || bytes.length < 1 || bytes.length > file.max || object.size !== bytes.length || sha256(bytes) !== object.sha256
    || !/^workspaces\/[a-f0-9-]{36}\/projects\/[a-f0-9-]{36}\/runs\/[a-f0-9-]{36}\/bundles\/[a-f0-9-]{36}\/[a-z0-9.]+$/.test(object.key)
    || !object.key.endsWith('/' + file.name)) throw new StorageFault('STORAGE_BYTES_CHANGED');
}
export class R2ObjectStore implements ObjectStore {
  readonly configHash: string; readonly bucket: string; private client: S3Client;
  constructor(env: Record<string, string | undefined>, client?: S3Client) {
    const s = r2Settings(env); this.configHash = s.configHash; this.bucket = s.bucket;
    this.client = client ?? new S3Client({region: 'auto', endpoint: s.endpoint, forcePathStyle: true, maxAttempts: 1, followRegionRedirects: false,
      requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED', credentials: {accessKeyId: s.accessKeyId, secretAccessKey: s.secretAccessKey}});
  }
  close() {this.client.destroy();}
  async remove(object:StorageObject){
    const file=storageFiles[object.kind];
    if(!file||object.mime!==file.mime||!Number.isSafeInteger(object.size)||object.size<1||object.size>file.max||!/^[a-f0-9]{64}$/.test(object.sha256)||!/^workspaces\/[a-f0-9-]{36}\/projects\/[a-f0-9-]{36}\/runs\/[a-f0-9-]{36}\/bundles\/[a-f0-9-]{36}\/[a-z0-9.]+$/.test(object.key)||!object.key.endsWith('/'+file.name))throw new StorageFault('STORAGE_BYTES_CHANGED');
    try{
      await this.client.send(new DeleteObjectCommand({Bucket:this.bucket,Key:object.key}),{abortSignal:AbortSignal.timeout(30000)});
      try{await this.client.send(new HeadObjectCommand({Bucket:this.bucket,Key:object.key}),{abortSignal:AbortSignal.timeout(30000)});}catch(error){
        if(error&&typeof error==='object'&&'$metadata'in error&&'name'in error&&['NotFound','NoSuchKey'].includes(String(error.name))&&(error.$metadata as {httpStatusCode?:number})?.httpStatusCode===404)return;
        throw error;
      }
    }catch{throw new StorageFault('OBJECT_REMOVAL_FAILED');}
    throw new StorageFault('OBJECT_REMOVAL_FAILED');
  }
  async ensure(object: StorageObject, bytes: Buffer) {
    verifyObject(object, bytes);
    // Every retry is create-only at the same immutable key. A negative read
    // cannot prove an earlier PUT failed; late writes still carry identical bytes.
    try {await this.client.send(new PutObjectCommand({Bucket: this.bucket, Key: object.key, Body: bytes, ContentLength: bytes.length, ContentType: object.mime,
      IfNoneMatch: '*', Metadata: {sha256: object.sha256}}), {abortSignal: AbortSignal.timeout(60000)});} catch { /* Reconcile by actual read-back, never ETag alone. */ }
    await this.read(object);
  }
  async read(object: StorageObject): Promise<Buffer> {
    if (!storageFiles[object.kind] || object.size < 1 || object.size > storageFiles[object.kind].max || object.mime !== storageFiles[object.kind].mime) throw new StorageFault('STORAGE_BYTES_CHANGED');
    try {
      const signal = AbortSignal.timeout(60000);
      const result = await this.client.send(new GetObjectCommand({Bucket: this.bucket, Key: object.key}), {abortSignal: signal});
      if (!(result.Body instanceof Readable) || result.ContentLength !== object.size || result.ContentType !== object.mime) {if (result.Body instanceof Readable) result.Body.destroy(); throw new Error();}
      const stream = result.Body, abort = () => stream.destroy(new Error('Storage read timed out'));
      signal.addEventListener('abort', abort, {once: true});
      const chunks: Buffer[] = []; let length = 0;
      try {
        if (signal.aborted) throw new Error();
        for await (const chunk of stream as AsyncIterable<Uint8Array>) {length += chunk.length; if (length > object.size) {stream.destroy(); throw new Error();} chunks.push(Buffer.from(chunk));}
      } finally {signal.removeEventListener('abort', abort); if (!stream.readableEnded) stream.destroy();}
      const bytes = Buffer.concat(chunks); verifyObject(object, bytes); return bytes;
    } catch {throw new StorageFault('STORAGE_VERIFICATION_FAILED');}
  }
}
