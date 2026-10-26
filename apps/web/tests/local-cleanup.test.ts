import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {LocalRenderFiles} from '../src/server/cleanup/local-files';
import {storageKinds,storageFiles,type StorageObject} from '../src/server/storage/contracts';
import type {LocalSource} from '../src/server/cleanup/local-contracts';
const sha=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
async function fixture(){
  const base=await fs.realpath(path.resolve('../..')),root=path.join(base,'.cache',`local-cleanup-test_${randomUUID()}`),runId=randomUUID(),artifactId=randomUUID(),folder=path.join(root,'output','dashboard-renders',runId,artifactId);
  await fs.mkdir(folder,{recursive:true});
  const narration=Buffer.from('verified narration'),manifest=Buffer.from(JSON.stringify({state:'validated_local',mode:'elevenlabs-evaluation',diagnostic:false,inputHash:'a'.repeat(64),rendererBuildHash:'b'.repeat(64),audioHash:sha(narration)}));
  const objects:StorageObject[]=[];for(const kind of storageKinds){const data=kind==='manifest'?manifest:Buffer.from(kind);await fs.writeFile(path.join(folder,storageFiles[kind].name),data);objects.push({kind,key:kind,mime:storageFiles[kind].mime,sha256:sha(data),size:data.length});}
  await fs.writeFile(path.join(folder,'narration.wav'),narration);await fs.writeFile(path.join(folder,'scene-1.png'),'preview');await fs.writeFile(path.join(folder,'keep.txt'),'unowned');
  const speech=path.join(root,'output','dashboard-speech',runId);await fs.mkdir(speech,{recursive:true});await fs.writeFile(path.join(speech,'retained.wav'),'reuse');
  const source:LocalSource={runId,artifactId,manifestHash:sha(manifest),inputHash:'a'.repeat(64),rendererBuildHash:'b'.repeat(64),objects},cleaner=await LocalRenderFiles.create(root);
  return {root,folder,source,cleaner,speech,async close(){const target=path.resolve(root);assert.equal(path.dirname(target),path.join(base,'.cache'));assert.match(path.basename(target),/^local-cleanup-test_[a-f0-9-]{36}$/);await fs.rm(target,{recursive:true,force:true});}};
}
test('local cleanup verifies seven files, removes exact files idempotently and retains speech/unknown files',async()=>{const f=await fixture();try{const files=await f.cleaner.inspect(f.source);assert.equal(files.length,7);await f.cleaner.remove(f.source,files);await f.cleaner.remove(f.source,files);assert.deepEqual(await fs.readdir(f.folder),['keep.txt']);assert.equal(await fs.readFile(path.join(f.speech,'retained.wav'),'utf8'),'reuse');await assert.rejects(f.cleaner.inspect(f.source));}finally{await f.close();}});
test('local cleanup rejects changed bytes and missing initial manifests',async()=>{const f=await fixture();try{const files=await f.cleaner.inspect(f.source);await fs.writeFile(path.join(f.folder,'video.mp4'),'changed');await assert.rejects(f.cleaner.remove(f.source,files));assert.equal(await fs.readFile(path.join(f.folder,'video.mp4'),'utf8'),'changed');await fs.unlink(path.join(f.folder,'manifest.json'));await assert.rejects(f.cleaner.inspect(f.source));}finally{await f.close();}});
test('local cleanup refuses hard links, invalid paths and junction ancestors',async()=>{const f=await fixture();try{await fs.link(path.join(f.folder,'video.mp4'),path.join(f.root,'hardlink'));await assert.rejects(f.cleaner.inspect(f.source));await fs.unlink(path.join(f.root,'hardlink'));await assert.rejects(f.cleaner.inspect({...f.source,runId:'../elsewhere'}));const runFolder=path.dirname(f.folder),moved=path.join(f.root,'moved');await fs.rename(runFolder,moved);await fs.symlink(moved,runFolder,'junction');await assert.rejects(f.cleaner.inspect(f.source));await fs.unlink(runFolder);}finally{await f.close();}});
test('checkpoint rejects unknown file descriptors and changed manifest identity',async()=>{const f=await fixture();try{const files=await f.cleaner.inspect(f.source);await assert.rejects(f.cleaner.remove(f.source,[...files,{name:'../keep.txt',sha256:'a'.repeat(64),size:1}]));await assert.rejects(f.cleaner.inspect({...f.source,manifestHash:'f'.repeat(64)}));}finally{await f.close();}});
