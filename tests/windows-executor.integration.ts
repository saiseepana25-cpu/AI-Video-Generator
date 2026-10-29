import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {setTimeout as wait} from 'node:timers/promises';
import {WindowsExecutor,inspectWindowsExecutor} from '../src/pipeline/windows-executor';
import {ExecutorStopUnconfirmed} from '../src/pipeline/executor-stop';
import {spawn} from 'node:child_process';
import {selectedFixture} from '../fixtures/selected-diagrams';
import {buildRenderPlan,generationHash} from '../src/pipeline/render-contract';
import {selectedFontAssets,selectedRendererBuildHash} from '../src/pipeline/selected-renderer';
async function fixture(kind='normal'){
  const id=randomUUID().replaceAll('-',''),root=process.cwd(),folder=path.join(root,'.cache','executors',id);
  await fs.mkdir(folder,{recursive:true});await fs.writeFile(path.join(folder,'input.json'),JSON.stringify({protocol:'windows-job-v1',kind:'fixture',fixture:kind}));
  const identity={id,root,jobName:`Local\\VideoCraft_${id}`};return {folder,identity,job:new WindowsExecutor(identity)};
}
async function until(check:()=>Promise<boolean>){for(let n=0;n<100;n++){if(await check())return;await wait(100);}assert.fail('Expected executor fixture state');}
const options={skip:process.platform!=='win32',timeout:60000};
test('OS admission keeps the child suspended until admitted; normal exit drains the Job',options,async()=>{
  const {job,folder,identity}=await fixture();try{
    await job.prepared;assert.equal(await inspectWindowsExecutor(identity),false);
    assert.equal(await fs.access(path.join(folder,'result.json')).then(()=>true,()=>false),false);
    job.admit();assert.equal(await job.stopped,0);assert.equal(await inspectWindowsExecutor(identity),true);
    assert.equal(JSON.parse(await fs.readFile(path.join(folder,'result.json'),'utf8')).ok,true);
  }finally{job.cancel();}
});
test('cancellation kills an owned child subtree and requires ActiveProcesses zero',options,async()=>{
  const {job,folder,identity}=await fixture('child');try{
    await job.prepared;job.admit();await until(()=>fs.access(path.join(folder,'fixture-child.json')).then(()=>true,()=>false));
    const {pid}=JSON.parse(await fs.readFile(path.join(folder,'fixture-child.json'),'utf8'));
    assert.doesNotThrow(()=>process.kill(pid,0));job.cancel();assert.equal(await job.stopped,130);
    assert.equal(await inspectWindowsExecutor(identity),true);assert.throws(()=>process.kill(pid,0));
  }finally{job.cancel();}
});
test('forced supervisor loss cannot manufacture an acknowledgement; OS closes and recovery proves absence',options,async()=>{
  const {job,identity}=await fixture('hang');try{
    await job.prepared;job.admit();assert.equal(await inspectWindowsExecutor(identity),false);
    job.interruptSupervisor();await assert.rejects(job.stopped,ExecutorStopUnconfirmed);
    assert.equal(await inspectWindowsExecutor(identity,true),true);
  }finally{job.cancel();}
});
test('a duplicate named Job refuses startup without terminating the existing executor',options,async()=>{
  const {job,identity}=await fixture('hang');let second:WindowsExecutor|undefined;
  try{await job.prepared;second=new WindowsExecutor(identity);await assert.rejects(second.prepared,ExecutorStopUnconfirmed);
    assert.equal(await inspectWindowsExecutor(identity),false);job.cancel();assert.equal(await job.stopped,130);
  }finally{second?.cancel();job.cancel();}
});
test('forced worker-parent exit closes stdin and drains its Job without a speculative acknowledgement',options,async()=>{
  const id=randomUUID().replaceAll('-',''),root=process.cwd(),folder=path.join(root,'.cache','executors',id);await fs.mkdir(folder,{recursive:true});
  await fs.writeFile(path.join(folder,'input.json'),JSON.stringify({protocol:'windows-job-v1',kind:'fixture',fixture:'hang'}));
  const identity={id,root,jobName:`Local\\VideoCraft_${id}`};
  const parent=spawn(process.execPath,['--import','tsx','tests/fixtures/executor-parent.ts',id],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});
  try{
    await new Promise<void>((resolve,reject)=>{parent.stdout.once('data',()=>resolve());parent.once('error',reject);parent.once('exit',()=>reject(new Error('Fixture exited before admission')));});
    assert.equal(await inspectWindowsExecutor(identity),false);
    const closed=new Promise(resolve=>parent.once('close',resolve));parent.kill();await closed;
    // Read-only inspection; this test does not ask recovery to terminate the Job.
    let stopped=false;for(let n=0;n<8;n++){stopped=await inspectWindowsExecutor(identity);if(stopped)break;await wait(100);}
    assert.equal(stopped,true);assert.equal(await fs.access(path.join(folder,'result.json')).then(()=>true,()=>false),false);
  }finally{parent.kill();await inspectWindowsExecutor(identity,true);}
});
test('real font preflight runs inside the OS Job and drains Chrome before returning', {...options,timeout:120000},async()=>{
  const id=randomUUID().replaceAll('-',''),root=process.cwd(),folder=path.join(root,'.cache','executors',id);await fs.mkdir(folder,{recursive:true});
  const {pins}=await selectedFontAssets(root),fixture=selectedFixture('te'),plan=buildRenderPlan(fixture.proposal,fixture.brief,fixture.settings,pins);
  await fs.writeFile(path.join(folder,'input.json'),JSON.stringify({protocol:'windows-job-v1',kind:'preflight',plan,hash:generationHash(plan)}));
  const identity={id,root,jobName:`Local\\VideoCraft_${id}`},job=new WindowsExecutor(identity);
  try{await job.prepared;job.admit();assert.equal(await job.stopped,0);assert.equal(await inspectWindowsExecutor(identity),true);
    const output=JSON.parse(await fs.readFile(path.join(folder,'result.json'),'utf8'));assert.equal(output.ok,true);assert.equal(output.result.rendererBuildHash,await selectedRendererBuildHash(root,pins));
  }finally{job.cancel();}
});
test('forced cancellation of a real diagnostic render drains the whole Job including Chrome and FFmpeg', {...options,timeout:150000},async()=>{
  const id=randomUUID().replaceAll('-',''),root=process.cwd(),folder=path.join(root,'.cache','executors',id);await fs.mkdir(folder,{recursive:true});
  const {pins}=await selectedFontAssets(root),fixture=selectedFixture('en'),plan=buildRenderPlan(fixture.proposal,fixture.brief,fixture.settings,pins);
  const clips=plan.narration.map((segment,i)=>{const samples=Float32Array.from({length:48000},(_,n)=>Math.sin(n/10)*.1);return {segmentId:segment.segmentId,text:segment.text,sampleRate:24000,source:{provider:'offline-diagnostic',model:'fixture',voiceId:'sine'},bytes:Buffer.from(samples.buffer)};});
  for(const [i,c] of clips.entries())await fs.writeFile(path.join(folder,`clip-${i}.f32`),c.bytes);
  await fs.writeFile(path.join(folder,'input.json'),JSON.stringify({protocol:'windows-job-v1',kind:'render',diagnostic:true,runId:randomUUID(),artifactId:randomUUID(),plan,hash:generationHash(plan),clips:clips.map(({bytes,...c})=>c)}));
  const identity={id,root,jobName:`Local\\VideoCraft_${id}`},job=new WindowsExecutor(identity);
  try{await job.prepared;job.admit();
    // Wait for real frame progress, with a longer bounded render fixture window.
    for(let n=0;n<1000;n++){if(await fs.access(path.join(folder,'progress.json')).then(()=>true,()=>false))break;await wait(100);if(n===999)assert.fail('No diagnostic frame progress');}
    job.cancel();assert.equal(await job.stopped,130);assert.equal(await inspectWindowsExecutor(identity),true);
    assert.equal(await fs.access(path.join(folder,'result.json')).then(()=>true,()=>false),false);
  }finally{job.cancel();}
});
