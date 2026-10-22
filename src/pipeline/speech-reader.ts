import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {requireProjectId} from '../../apps/web/src/server/projects/contracts';
import {GenerationFault, type MeasuredSpeech} from '../../apps/web/src/server/generation/engine';
import {decodeWav} from './wav.js';
export type SpeechFile = {runId:string;attemptId:string;audioHash:string;byteLength:number;sampleRate:number};
export async function readVerifiedSpeech(root: string, source: SpeechFile, signal: AbortSignal): Promise<MeasuredSpeech> {
  try {
    signal.throwIfAborted();requireProjectId(source.runId);requireProjectId(source.attemptId);
    if(!/^[a-f0-9]{64}$/.test(source.audioHash)||source.sampleRate!==24000||!Number.isSafeInteger(source.byteLength)||source.byteLength<4844||source.byteLength>4320044)throw new Error();
    const base=path.join(await fs.realpath(root),'output','dashboard-speech'),folder=path.join(base,source.runId),file=path.join(folder,`${source.attemptId}.wav`);
    if(await fs.realpath(base)!==base||await fs.realpath(folder)!==folder||await fs.realpath(file)!==file)throw new Error();
    const stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size!==source.byteLength)throw new Error();
    const handle=await fs.open(file,'r');let bytes:Buffer;
    try {const info=await handle.stat();if(!info.isFile()||info.size!==source.byteLength)throw new Error();bytes=Buffer.alloc(source.byteLength);let offset=0;
      while(offset<bytes.length){signal.throwIfAborted();const n=await handle.read(bytes,offset,bytes.length-offset,offset);if(!n.bytesRead)throw new Error();offset+=n.bytesRead;}
    } finally {await handle.close();}
    if(createHash('sha256').update(bytes).digest('hex')!==source.audioHash||bytes.toString('ascii',0,4)!=='RIFF'||bytes.readUInt32LE(4)!==bytes.length-8||bytes.toString('ascii',8,16)!=='WAVEfmt '
      ||bytes.readUInt32LE(16)!==16||bytes.readUInt16LE(20)!==1||bytes.readUInt16LE(22)!==1||bytes.readUInt32LE(24)!==24000||bytes.readUInt32LE(28)!==48000||bytes.readUInt16LE(32)!==2||bytes.readUInt16LE(34)!==16
      ||bytes.toString('ascii',36,40)!=='data'||bytes.readUInt32LE(40)!==bytes.length-44||(bytes.length-44)%2)throw new Error();
    const audio=decodeWav(bytes);let sum=0,clipped=0;for(const sample of audio.samples){sum+=sample*sample;if(Math.abs(sample)>=.999)clipped++;}
    if(audio.sampleRate!==source.sampleRate||10*Math.log10(sum/audio.samples.length)<-55||clipped/audio.samples.length>.01)throw new Error();
    signal.throwIfAborted();return audio;
  } catch {throw new GenerationFault('REUSABLE_SPEECH_UNAVAILABLE');}
}
