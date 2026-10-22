import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {readVerifiedSpeech,type SpeechFile} from '../src/pipeline/speech-reader.js';
import {encodeWav} from '../src/pipeline/wav.js';
const hash=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
async function fixture(work:(root:string,file:string,source:SpeechFile)=>Promise<void>){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'videocraft-speech-reader-')),runId=randomUUID(),attemptId=randomUUID(),folder=path.join(root,'output','dashboard-speech',runId);
  await fs.mkdir(folder,{recursive:true});const file=path.join(folder,`${attemptId}.wav`),bytes=encodeWav({sampleRate:24000,samples:Float32Array.from({length:24000},(_,i)=>Math.sin(i/10)*.2)});await fs.writeFile(file,bytes);
  try{await work(root,file,{runId,attemptId,audioHash:hash(bytes),byteLength:bytes.length,sampleRate:24000});}
  finally{if(path.dirname(path.resolve(root))!==path.resolve(os.tmpdir())||!path.basename(root).startsWith('videocraft-speech-reader-'))throw new Error('Unsafe cleanup');await fs.rm(root,{recursive:true,force:true});}
}
test('speech reader verifies actual bounded WAV bytes and returns measured mono samples',async()=>{
  await fixture(async(root,_file,source)=>{const audio=await readVerifiedSpeech(root,source,new AbortController().signal);assert.equal(audio.sampleRate,24000);assert.equal(audio.samples.length,24000);assert.ok(Math.abs(audio.samples[50])<.21);});
});
test('speech reader refuses missing, replaced, truncated, malformed and silent source audio',async()=>{
  await fixture(async(root,file,source)=>{
    const original=await fs.readFile(file);const replaced=Buffer.from(original);replaced[100]^=1;await fs.writeFile(file,replaced);await assert.rejects(readVerifiedSpeech(root,source,new AbortController().signal),/REUSABLE_SPEECH_UNAVAILABLE/);
    for(const changed of [original.subarray(0,100),Buffer.alloc(original.length),(()=>{const b=Buffer.from(original);b.writeUInt16LE(2,22);return b;})(),encodeWav({sampleRate:24000,samples:new Float32Array(24000)})]){
      await fs.writeFile(file,changed);await assert.rejects(readVerifiedSpeech(root,{...source,audioHash:hash(changed),byteLength:changed.length},new AbortController().signal),/REUSABLE_SPEECH_UNAVAILABLE/);
    }
    await fs.unlink(file);await assert.rejects(readVerifiedSpeech(root,source,new AbortController().signal));
  });
});
test('speech reader rejects traversal, oversized metadata, wrong rate and cancellation',async()=>{
  await fixture(async(root,_file,source)=>{
    for(const invalid of [{...source,runId:'../escape'},{...source,attemptId:'../escape'},{...source,byteLength:4320045},{...source,sampleRate:48000}])await assert.rejects(readVerifiedSpeech(root,invalid,new AbortController().signal));
    const controller=new AbortController();controller.abort();await assert.rejects(readVerifiedSpeech(root,source,controller.signal));
  });
});
