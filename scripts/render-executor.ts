// Private local subprocess. No dotenv, provider, database, network API or secrets.
import fs from 'node:fs/promises';
import path from 'node:path';
import {validateRenderPlan,generationHash} from '../src/pipeline/render-contract';
import {renderSelectedVideo} from '../src/pipeline/selected-renderer';
import {preflightSelectedLayout} from '../src/pipeline/layout-preflight';
import {MeasuredDurationError,MeasuredPacingError} from '../src/pipeline/selected-timing';
import {TextLayoutError} from '../src/video/selected-layout';
async function main(){
  const root=process.cwd(),file=path.resolve(process.argv[2]??''),folder=path.dirname(file);
  if(!/^[a-f0-9]{32}$/.test(path.basename(folder))||path.dirname(folder)!==path.join(root,'.cache','executors')||path.basename(file)!=='input.json')throw new Error('Invalid executor input');
  const raw=JSON.parse(await fs.readFile(file,'utf8'));
  if(raw.protocol!=='windows-job-v1')throw new Error('Invalid executor protocol');
  // Isolated fixture mode exercises the real OS boundary with no renderer/API.
  if(raw.kind==='fixture'){
    if(raw.fixture==='hang')await new Promise(()=>{setInterval(()=>{},1000);});
    if(raw.fixture==='child'){
      const {spawn}=await import('node:child_process');const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{windowsHide:true,stdio:'ignore'});
      await fs.writeFile(path.join(folder,'fixture-child.json'),JSON.stringify({pid:child.pid}));await new Promise(resolve=>setTimeout(resolve,10000));
    }
    await fs.writeFile(path.join(folder,'result.json'),JSON.stringify({ok:true,result:{fixture:true}}),{flag:'wx'});return;
  }
  const plan=validateRenderPlan(raw.plan);if(generationHash(plan)!==raw.hash)throw new Error('Invalid approved input');
  try{
    const signal=new AbortController().signal;
    if(raw.kind==='preflight'){
      const result=await preflightSelectedLayout({root,plan,expectedHash:raw.hash,signal,scratchRoot:path.join(folder,'scratch')});
      await fs.writeFile(path.join(folder,'result.json'),JSON.stringify({ok:true,result}),{flag:'wx'});return;
    }
    if(raw.kind!=='render'||!Array.isArray(raw.clips)||raw.clips.length!==plan.narration.length)throw new Error('Invalid render input');
    const clips=await Promise.all(raw.clips.map(async(c:any,i:number)=>{
      if(c.segmentId!==plan.narration[i].segmentId||c.text!==plan.narration[i].text)throw new Error('Invalid clip');
      const bytes=await fs.readFile(path.join(folder,`clip-${i}.f32`));
      if(bytes.length<4||bytes.length>34560000||bytes.length%4||c.sampleRate!==24000)throw new Error('Invalid clip bytes');
      const samples=new Float32Array(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
      if(!samples.every(value=>Number.isFinite(value)&&Math.abs(value)<=1))throw new Error('Invalid samples');
      return {segmentId:c.segmentId,text:c.text,source:c.source,audio:{samples,sampleRate:c.sampleRate}};
    }));
    const result=await renderSelectedVideo({root,outputRoot:path.join(root,'output','dashboard-renders',raw.runId),artifactId:raw.artifactId,scratchRoot:path.join(folder,'scratch'),plan,expectedHash:raw.hash,clips,
      mode:raw.diagnostic===true?'offline-diagnostic':'elevenlabs-evaluation',licenseConfirmed:true,signal,logoBytes:raw.logo?await fs.readFile(path.join(folder,'logo.png')):undefined,
      onProgress:progress=>{if(raw.diagnostic===true&&progress>.05)void fs.writeFile(path.join(folder,'progress.json'),'{}',{flag:'wx'}).catch(()=>{});}});
    await fs.writeFile(path.join(folder,'result.json'),JSON.stringify({ok:true,result}),{flag:'wx'});
  }catch(error){
    const code=error instanceof MeasuredDurationError?'NARRATION_DURATION_EXCEEDED':error instanceof MeasuredPacingError?'NARRATION_TOO_SHORT':error instanceof TextLayoutError?'TEXT_LAYOUT_EXCEEDED':'LOCAL_EXECUTOR_FAILED';
    await fs.writeFile(path.join(folder,'result.json'),JSON.stringify({ok:false,code}),{flag:'wx'});process.exitCode=1;
  }
}
main().catch(()=>{process.exitCode=1;});
