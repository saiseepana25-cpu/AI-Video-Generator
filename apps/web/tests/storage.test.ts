import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {GetObjectCommand, PutObjectCommand, DeleteObjectCommand, HeadObjectCommand, type S3Client} from '@aws-sdk/client-s3';
import {R2ObjectStore, r2Settings, sha256} from '../src/server/storage/r2';
import type {StorageObject} from '../src/server/storage/contracts';
const env = {R2_ACCOUNT_ID: 'a'.repeat(32), R2_ENDPOINT: `https://${'a'.repeat(32)}.r2.cloudflarestorage.com`, R2_BUCKET_NAME: 'test-private', R2_ACCESS_KEY_ID: 'test-id', R2_SECRET_ACCESS_KEY: 'test-secret', R2_REGION: 'auto'};
const data = Buffer.from('test captions');
const object: StorageObject = {kind: 'srt', key: `workspaces/${'a'.repeat(36)}/projects/${'b'.repeat(36)}/runs/${'c'.repeat(36)}/bundles/${'d'.repeat(36)}/captions.srt`, sha256: sha256(data), size: data.length, mime: 'application/x-subrip'};
function gateway(send: (command: unknown) => Promise<unknown>) {return new R2ObjectStore(env, {send, destroy() {}} as unknown as S3Client);}
const body = (bytes = data) => ({Body: Readable.from([bytes]), ContentLength: data.length, ContentType: object.mime});
test('R2 settings refuse arbitrary endpoints, credentials in URLs and non-auto region', () => {
  assert.ok(r2Settings(env));
  for (const patch of [{R2_ENDPOINT: 'https://example.com'}, {R2_ENDPOINT: env.R2_ENDPOINT + '/path'}, {R2_REGION: 'us-east-1'}, {R2_BUCKET_NAME: '../private'}, {R2_SECRET_ACCESS_KEY: ''}]) assert.throws(() => r2Settings({...env, ...patch}), /STORAGE_CONFIGURATION_REQUIRED/);
});
test('R2 cleanup deletes only an exact key and requires a verified missing-object response',async()=>{
  const commands:unknown[]=[];await gateway(async command=>{commands.push(command);assert.ok(command instanceof DeleteObjectCommand||command instanceof HeadObjectCommand);assert.equal(command.input.Key,object.key);assert.equal(command.input.Bucket,'test-private');if(command instanceof HeadObjectCommand)throw {name:'NotFound',$metadata:{httpStatusCode:404}};return {};}).remove(object);assert.equal(commands.length,2);
});
test('R2 cleanup does not accept forbidden, unknown, missing-bucket or still-present outcomes',async()=>{
  for(const failure of [{name:'AccessDenied',$metadata:{httpStatusCode:403}},{name:'NoSuchBucket',$metadata:{httpStatusCode:404}},new Error('Private transport detail'),null])await assert.rejects(gateway(async command=>{if(command instanceof DeleteObjectCommand)return {};if(failure)throw failure;return {};}).remove(object),/^Error: OBJECT_REMOVAL_FAILED$/);
  await assert.rejects(gateway(async()=>{throw new Error('delete failed');}).remove(object),/OBJECT_REMOVAL_FAILED/);
});
test('R2 cleanup rejects unsafe keys and descriptors before network access',async()=>{
  let calls=0;const store=gateway(async()=>{calls++;return {};});for(const patch of [{key:'../captions.srt'},{key:object.key+'/other'},{size:NaN},{mime:'text/html'},{sha256:'invalid'}])await assert.rejects(store.remove({...object,...patch}));assert.equal(calls,0);
});
test('R2 uses a conditional single-key PUT then verifies actual read-back bytes', async () => {
  const commands: unknown[] = [];
  await gateway(async command => {commands.push(command); if (command instanceof PutObjectCommand) {assert.equal(command.input.IfNoneMatch, '*'); assert.equal(command.input.Key, object.key); assert.deepEqual(command.input.Body, data); return {};}
    assert.ok(command instanceof GetObjectCommand); return body();}).ensure(object, data);
  assert.equal(commands.length, 2);
});
test('lost PUT acknowledgement or conditional conflict reconciles by matching GET', async () => {
  for (const reason of ['lost response', 'already exists']) await gateway(async command => {if (command instanceof PutObjectCommand) throw new Error(reason); return body();}).ensure(object, data);
});
test('negative read after unknown write is not success and is safely retryable at the same key', async () => {
  const keys: string[] = [];
  const store = gateway(async command => {assert.ok(command instanceof PutObjectCommand || command instanceof GetObjectCommand); keys.push(command.input.Key!); throw new Error('private detail');});
  await assert.rejects(store.ensure(object, data), /^Error: STORAGE_VERIFICATION_FAILED$/); await assert.rejects(store.ensure(object, data)); assert.equal(new Set(keys).size, 1);
});
test('wrong, truncated, oversized or wrong-type remote bytes never verify', async () => {
  for (const response of [body(Buffer.from('wrong')), body(Buffer.concat([data, data])), {...body(), ContentLength: 0}, {...body(), ContentType: 'text/html'}]) {
    await assert.rejects(gateway(async command => command instanceof PutObjectCommand ? {} : response).ensure(object, data), /STORAGE_VERIFICATION_FAILED/);
  }
});
test('changed local bytes, unsafe keys and wrong MIME are refused before any network effect', async () => {
  let calls = 0; const store = gateway(async () => {calls++; return {};});
  await assert.rejects(store.ensure(object, Buffer.from('changed')), /STORAGE_BYTES_CHANGED/);
  await assert.rejects(store.ensure({...object, key: '../captions.srt'}, data)); await assert.rejects(store.ensure({...object, mime: 'text/html'}, data)); assert.equal(calls, 0);
});
