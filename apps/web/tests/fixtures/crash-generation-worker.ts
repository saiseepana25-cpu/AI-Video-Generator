// Isolated acceptance harness: actual OS/rendering, deterministic sine speech.
// Never loads env files or contacts Gemini/ElevenLabs/R2.
import path from 'node:path';
import fs from 'node:fs/promises';
import {createInterface} from 'node:readline';
import {MongoClient} from 'mongodb';
import {databaseClientOptions} from '../../src/server/db/connection';
import {GenerationWorker} from '../../src/server/generation/worker';
import {DatabaseExecutor} from '../../src/server/generation/executor-service';
import {GenerationFault} from '../../src/server/generation/engine';
import {LiveGenerationEngine} from '../../../../src/pipeline/generation-engine';
import {providerEnv} from './providers';
async function main(){
  const [uri,name,root]=process.argv.slice(2);
  if(!/^mongodb:\/\/(127\.0\.0\.1|localhost):\d+\/(?:\?[^\s]*)?$/.test(uri)||!/^videocraft_executor_crash_[a-f0-9]{32}$/.test(name)||!path.isAbsolute(root))throw new Error();
  const client=new MongoClient(uri,databaseClientOptions);await client.connect();
  const env={...providerEnv,REMOTION_FREE_LICENSE_CONFIRMED:'true'},engine=new LiveGenerationEngine(root,env),worker=new GenerationWorker(client,name,env,engine),executor=new DatabaseExecutor(client,name,root,worker.owner);
  engine.executor=executor;
  engine.observe=async()=>({state:'enabled',reasonCode:null,languages:['en','te'],remaining:10000,periodId:'test-period'});
  engine.speech=async()=>({sampleRate:24000,samples:Float32Array.from({length:192000},(_,i)=>Math.sin(i/10)*.1)});
  engine.render=async(runId,plan,hash,clips,signal)=>{
    await executor.execute(runId,'render',{plan,hash,diagnostic:true,clips:clips.map(c=>({segmentId:c.segmentId,text:c.text,source:{provider:'offline-diagnostic',model:'fixture',voiceId:'sine'},sampleRate:c.audio.sampleRate}))},signal,async folder=>{
      for(const [i,c] of clips.entries())await fs.writeFile(path.join(folder,`clip-${i}.f32`),Buffer.from(c.audio.samples.buffer,c.audio.samples.byteOffset,c.audio.samples.byteLength),{flag:'wx'});
    });
    // Even an unexpectedly fast diagnostic completion cannot become Ready.
    throw new GenerationFault('FIXTURE_NOT_DELIVERABLE');
  };
  try{
    if(!await worker.heartbeat())throw new Error();process.stdout.write('worker_ready\n');
    const input=createInterface({input:process.stdin});await new Promise<void>((resolve,reject)=>{input.once('line',line=>line==='go'?resolve():reject(new Error()));});input.close();
    await worker.tick();
  }finally{await client.close();}
}
main().catch(()=>{process.stderr.write('CONTROLLED_EXECUTOR_FIXTURE_FAILED\n');process.exitCode=1;});
