import {before,beforeEach,after,describe,test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {MongoClient,type Db} from 'mongodb';
import sharp from 'sharp';
import {databaseClientOptions} from '../src/server/db/connection';
import {migrateDatabase,checkDatabase} from '../src/server/db/migrations';
import {logoCollections} from '../src/server/db/logo-schemas';
import {LogoService} from '../src/server/logos/service';
import {canonicalLogo,logoHash} from '../src/server/logos/image';
import {verifyLogoObject} from '../src/server/logos/store';
import type {LogoFile,LogoObject,LogoStore} from '../src/server/logos/contracts';
import {workspaceFixture,membershipFixture,testWorkspaceId,testUserId,type Row} from './fixtures/database';
const uri=process.env.MONGODB_TEST_URI??'mongodb://127.0.0.1:27028/?replicaSet=vcF03';
if(!/^mongodb:\/\/(127\.0\.0\.1|localhost):\d+\/(?:\?[^\s]*)?$/.test(uri))throw new Error('Isolated loopback database required.');
const name=`videocraft_logo_test_${randomUUID().replaceAll('-','')}`,client=new MongoClient(uri,databaseClientOptions),context={workspaceId:testWorkspaceId,userId:testUserId,userName:'Tester'};
class FakeStore implements LogoStore{
  configHash='a'.repeat(64);bucket='test-logo-bucket';objects=new Map<string,Buffer>();calls=0;fail=false;hook:(()=>Promise<void>)|null=null;readHook:(()=>Promise<void>)|null=null;
  async ensure(object:LogoObject,bytes:Buffer){this.calls++;verifyLogoObject(object,bytes);const old=this.objects.get(object.key);if(old)assert.deepEqual(old,bytes);this.objects.set(object.key,bytes);const hook=this.hook;this.hook=null;if(hook)await hook();if(this.fail)throw new Error('private storage failure');await this.read(object);}
  async read(object:LogoObject){const hook=this.readHook;this.readHook=null;if(hook)await hook();const bytes=this.objects.get(object.key);if(!bytes)throw new Error('private missing object');verifyLogoObject(object,bytes);return bytes;}
  close(){}
}
describe('prepared logo lifecycle on isolated MongoDB',{concurrency:false},()=>{
  let db:Db,store:FakeStore,service:LogoService,png:Buffer,file:LogoFile;
  before(async()=>{await client.connect();db=client.db(name);await migrateDatabase(db);png=await sharp({create:{width:160,height:80,channels:4,background:{r:183,g:164,b:255,alpha:.8}}}).png().withMetadata().toBuffer();file={filename:'team-logo.png',contentType:'image/png',sizeBytes:png.length,sha256:logoHash(png)};});
  beforeEach(async()=>{for(const n of ['logo_uploads','logo_assets','workspaces','memberships'])await db.collection(n).deleteMany({});await db.collection<Row>('workspaces').insertOne(workspaceFixture());await db.collection<Row>('memberships').insertOne(membershipFixture());store=new FakeStore();service=new LogoService(client,name,context,()=>store);});
  after(async()=>{try{if(!/^videocraft_logo_test_[a-f0-9]{32}$/.test(name))throw new Error('Unsafe cleanup');await db.dropDatabase();}finally{await client.close();}});
  test('validated upload atomically creates an available upload-owned asset; replay and scoped preview preserve identity',async()=>{
    const id=randomUUID(),ready=await service.put(id,file,png);assert.equal(ready.state,'ready');assert.ok(ready.assetId);assert.equal(store.calls,1);assert.equal(await db.collection('logo_assets').countDocuments(),1);const member=await db.collection('memberships').findOne({});
    assert.deepEqual(await service.put(id,file,png),ready);assert.equal(store.calls,1);assert.deepEqual(await db.collection('memberships').findOne({}),member);
    const asset=(await db.collection<Row>('logo_assets').findOne({}))!;assert.equal(asset.uploadId,id);assert.equal(asset.refCount,1);assert.equal(asset.referenceRevision.toString(),'1');assert.notEqual(asset.object.sha256,file.sha256);assert.deepEqual(await service.preview(ready.assetId!),store.objects.get(asset.object.key));
    assert.equal(JSON.stringify(ready).includes('bucket'),false);assert.equal(JSON.stringify(ready).includes('configHash'),false);await checkDatabase(db);
  });
  test('mismatched bytes create no receipt; invalid decoded bytes become rejected without any R2 write',async()=>{
    await assert.rejects(service.put(randomUUID(),file,Buffer.from('bad')),/checksum must match/);assert.equal(await db.collection('logo_uploads').countDocuments(),0);
    const bytes=Buffer.from('<svg/>'),bad={...file,sizeBytes:bytes.length,sha256:logoHash(bytes)},id=randomUUID(),view=await service.put(id,bad,bytes);assert.equal(view.state,'rejected');assert.equal((await service.get(id)).assetId,null);assert.equal(store.calls,0);assert.equal(await db.collection('logo_assets').countDocuments(),0);assert.deepEqual(await service.put(id,bad,bytes),view);
  });
  test('same ID cannot change file; disabled or foreign users cannot inspect or replay uploads',async()=>{
    const id=randomUUID(),ready=await service.put(id,file,png);
    await assert.rejects(service.put(id,{...file,filename:'other.png'},png),/different file/);
    const otherUser='abcdef0123456789abcdef01',otherWorkspace=randomUUID();await db.collection<Row>('workspaces').insertOne({...workspaceFixture(),_id:otherWorkspace});await db.collection<Row>('memberships').insertOne({...membershipFixture(),workspaceId:otherWorkspace,userId:otherUser,normalizedEmail:'other@example.com'});
    const foreign=new LogoService(client,name,{...context,workspaceId:otherWorkspace,userId:otherUser},()=>store);await assert.rejects(foreign.get(id),/could not be found/);await assert.rejects(foreign.put(id,file,png),/could not be found/);await assert.rejects(foreign.preview(ready.assetId!),/could not be found/);
    await db.collection('memberships').updateOne({userId:testUserId},{$set:{status:'disabled'}});await assert.rejects(service.get(id),/team access/);await assert.rejects(service.put(id,file,png),/team access/);await assert.rejects(service.preview(ready.assetId!),/team access/);
  });
  test('lost storage acknowledgement is recoverable at the same key without duplicate assets',async()=>{
    const id=randomUUID();store.fail=true;await assert.rejects(service.put(id,file,png),(e:unknown)=>!!e&&typeof e==='object'&&'code'in e&&e.code==='LOGO_STORAGE_UNAVAILABLE');
    assert.equal((await service.get(id)).retryAfterSeconds,0);assert.equal(await db.collection('logo_assets').countDocuments(),0);const object=(await db.collection<Row>('logo_uploads').findOne({_id:id}))!.object;
    store.fail=false;const ready=await service.put(id,file,png);assert.equal(ready.state,'ready');assert.equal(store.objects.size,1);assert.deepEqual((await db.collection<Row>('logo_assets').findOne({}))!.object,object);assert.equal(await db.collection('logo_assets').countDocuments(),1);
  });
  test('concurrent retry refuses an active lease; expired lease takeover fences the late owner',async()=>{
    const id=randomUUID();let entered!:()=>void,release!:()=>void;const started=new Promise<void>(r=>entered=r),gate=new Promise<void>(r=>release=r);store.hook=async()=>{entered();await gate;};
    const first=service.put(id,file,png);await started;
    try{await assert.rejects(service.put(id,file,png),/still being checked/);await db.collection<Row>('logo_uploads').updateOne({_id:id},{$set:{leaseUntil:new Date(0)}});assert.equal((await service.put(id,file,png)).state,'ready');}finally{release();}
    await assert.rejects(first,/still being checked/);assert.equal(await db.collection('logo_assets').countDocuments(),1);assert.equal((await db.collection<Row>('logo_uploads').findOne({_id:id}))!.epoch.toString(),'2');await checkDatabase(db);
  });
  test('membership revocation during R2 write prevents asset finalization',async()=>{
    store.hook=async()=>{await db.collection('memberships').updateOne({userId:testUserId},{$set:{status:'disabled'}});};await assert.rejects(service.put(randomUUID(),file,png),/team access/);assert.equal(store.objects.size,1);assert.equal(await db.collection('logo_assets').countDocuments(),0);
  });
  test('asset validation failure rolls back readiness and can be retried using the verified private object',async()=>{
    const id=randomUUID();await db.command({collMod:'logo_assets',validator:{$jsonSchema:{bsonType:'object',required:['controlled_failure']}}});
    try{await assert.rejects(service.put(id,file,png),/upload is unconfirmed/);}finally{await db.command({collMod:'logo_assets',validator:logoCollections.find(c=>c.name==='logo_assets')!.validator});}
    assert.equal((await service.get(id)).state,'validating');assert.equal(await db.collection('logo_assets').countDocuments(),0);assert.equal((await service.put(id,file,png)).state,'ready');assert.equal(store.objects.size,1);await checkDatabase(db);
  });
  test('changed destination is refused and expired unconfirmed receipts do not become ready',async()=>{
    const id=randomUUID();store.fail=true;await assert.rejects(service.put(id,file,png));store.fail=false;store.configHash='b'.repeat(64);await assert.rejects(service.put(id,file,png),/destination or decoder changed/);assert.equal(await db.collection('logo_assets').countDocuments(),0);
    await db.collection<Row>('logo_uploads').updateOne({_id:id},{$set:{expiresAt:new Date(0)}});assert.equal((await service.get(id)).state,'expired');assert.equal((await service.put(id,file,png)).state,'expired');assert.equal(store.calls,1);
  });
  test('private preview verifies bytes and rechecks access after reading storage',async()=>{
    const ready=await service.put(randomUUID(),file,png),asset=(await db.collection<Row>('logo_assets').findOne({}))!;store.objects.set(asset.object.key,Buffer.alloc(asset.object.size));await assert.rejects(service.preview(ready.assetId!),/logo could not be verified/);
    store.objects.set(asset.object.key,(await canonicalLogo(png,file)).bytes);
    store.readHook=async()=>{await db.collection('memberships').updateOne({userId:testUserId},{$set:{status:'disabled'}});};await assert.rejects(service.preview(ready.assetId!),/team access/);
  });
});
