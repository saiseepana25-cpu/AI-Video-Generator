import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {ExecutionFiles,type ExecutionSource} from '../src/server/cleanup/execution-files';
import {artifactOwner,workspaceOwner} from '../../../src/pipeline/execution-owner';
async function fixture(includeArtifact=false){
  const root=path.resolve(process.cwd(),'../..','.cache','execution-files-tests',randomUUID()),id=randomUUID(),runId=randomUUID(),artifactId=randomUUID();
  const work=path.join(root,'.cache','executors',id.replaceAll('-','')),artifact=path.join(root,'output','dashboard-renders',runId,artifactId);
  await fs.mkdir(path.join(work,'scratch','bundle'),{recursive:true});await fs.mkdir(artifact,{recursive:true});
  await fs.writeFile(path.join(work,'input.json'),'source');await fs.writeFile(path.join(work,'scratch','bundle','entry.js'),'generated');await fs.writeFile(path.join(artifact,'video.mp4'),'partial media');
  await fs.writeFile(path.join(work,'.workspace-owner.json'),workspaceOwner(id,runId,'a'.repeat(64),'b'.repeat(64)).bytes,{flag:'wx'});
  const owner=artifactOwner(id,runId,artifactId,'a'.repeat(64),'b'.repeat(64));
  if(includeArtifact)await fs.writeFile(path.join(artifact,'.execution-owner.json'),owner.bytes,{flag:'wx'});
  const source:ExecutionSource={executionId:id,runId,artifactId,includeArtifact,stoppedAt:new Date(Date.now()+10000),artifactOwnerHash:includeArtifact?owner.sha256:null,workOwnerHash:workspaceOwner(id,runId,'a'.repeat(64),'b'.repeat(64)).sha256};
  return {root,work,artifact,source,files:await ExecutionFiles.create(root)};
}
test('execution cleanup removes only captured owned files and empty directories, preserving retained output',async()=>{
  const f=await fixture();const inventory=await f.files.inspect(f.source);assert.equal(inventory.files.length,3);
  await f.files.remove(f.source,inventory);assert.equal(await fs.access(f.work).then(()=>true,()=>false),false);assert.equal(await fs.readFile(path.join(f.artifact,'video.mp4'),'utf8'),'partial media');
  await f.files.remove(f.source,inventory);
});
test('failed unpromoted output and workspace share a bounded retryable exact inventory',async()=>{
  const f=await fixture(true),inventory=await f.files.inspect(f.source);assert.equal(inventory.files.length,5);
  await fs.unlink(path.join(f.work,'input.json'));await f.files.remove(f.source,inventory);
  assert.equal((await f.files.inspect(f.source)).files.length,0);assert.equal(await fs.access(f.artifact).then(()=>true,()=>false),false);
});
test('unregistered or foreign partial output is quarantined without claiming an existing directory',async()=>{
  const f=await fixture(true);await fs.unlink(path.join(f.artifact,'.execution-owner.json'));
  await assert.rejects(f.files.inspect(f.source));assert.equal(await fs.readFile(path.join(f.artifact,'video.mp4'),'utf8'),'partial media');
  await fs.writeFile(path.join(f.artifact,'.execution-owner.json'),'foreign');await assert.rejects(f.files.inspect(f.source));
  assert.equal(await fs.readFile(path.join(f.work,'input.json'),'utf8'),'source');
  const g=await fixture();await fs.unlink(path.join(g.work,'.workspace-owner.json'));await assert.rejects(g.files.inspect(g.source));
  assert.equal(await fs.readFile(path.join(g.work,'input.json'),'utf8'),'source');
});
test('changed files or extra directories refuse before any captured unlink',async()=>{
  const f=await fixture(),inventory=await f.files.inspect(f.source);await fs.writeFile(path.join(f.work,'scratch','bundle','entry.js'),'changed');
  await assert.rejects(f.files.remove(f.source,inventory));assert.equal(await fs.readFile(path.join(f.work,'input.json'),'utf8'),'source');
  await fs.writeFile(path.join(f.work,'scratch','bundle','entry.js'),'generated');await fs.mkdir(path.join(f.work,'unexpected'));
  await assert.rejects(f.files.remove(f.source,inventory));assert.equal(await fs.readFile(path.join(f.work,'input.json'),'utf8'),'source');
});
test('hard links, junction ancestors and writes after stop refuse without touching outside files',async()=>{
  const f=await fixture(),outside=path.join(f.root,'retained');await fs.mkdir(outside);await fs.writeFile(path.join(outside,'private.json'),'keep');
  await fs.link(path.join(outside,'private.json'),path.join(f.work,'linked.json'));await assert.rejects(f.files.inspect(f.source));await fs.unlink(path.join(f.work,'linked.json'));
  await fs.symlink(outside,path.join(f.work,'junction'),'junction');await assert.rejects(f.files.inspect(f.source));assert.equal(await fs.readFile(path.join(outside,'private.json'),'utf8'),'keep');
  const g=await fixture();g.source.stoppedAt=new Date(Date.now()-60000);await assert.rejects(g.files.inspect(g.source));assert.equal(await fs.readFile(path.join(g.work,'input.json'),'utf8'),'source');
});
test('malformed traversal, over-limit and corrupt checkpoint descriptors refuse before deletion',async()=>{
  const f=await fixture(),inventory=await f.files.inspect(f.source);
  await assert.rejects(f.files.remove(f.source,{...inventory,directories:[...inventory.directories,{area:'work',name:'../escape'}]}));
  await assert.rejects(f.files.remove(f.source,{...inventory,files:[...inventory.files,{area:'work',name:'bad.json',sha256:'bad',size:1}]}));
  await assert.rejects(f.files.remove(f.source,{files:Array.from({length:2049},()=>inventory.files[0]),directories:[]}));
  assert.equal(await fs.readFile(path.join(f.work,'input.json'),'utf8'),'source');
});
