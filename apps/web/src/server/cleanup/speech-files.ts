import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {requireProjectId} from '../projects/contracts';
import {CleanupFault} from './contracts';
import type {SpeechSource,SpeechFileCleaner} from './speech-contracts';
const sha=(v:Buffer|string)=>createHash('sha256').update(v).digest('hex');
const fail=()=>new CleanupFault('SPEECH_FILE_UNAVAILABLE');
const absent=(e:unknown)=>!!e&&typeof e==='object'&&'code'in e&&e.code==='ENOENT';
/** Only the immutable WAV belonging to a settled attempt. No recursive deletion. */
export class SpeechFiles implements SpeechFileCleaner{
  readonly rootHash:string;
  private constructor(private root:string){this.rootHash=sha(root);}
  static async create(root:string){const resolved=path.resolve(root),real=await fs.realpath(resolved);if(real!==resolved)throw fail();return new SpeechFiles(real);}
  private async location(source:SpeechSource){
    requireProjectId(source.runId);requireProjectId(source.attemptId);
    if(source.sampleRate!==24000||!Number.isSafeInteger(source.byteLength)||source.byteLength<4844||source.byteLength>4320044||!/^[a-f0-9]{64}$/.test(source.audioHash))throw fail();
    let folder=this.root;for(const part of ['', 'output','dashboard-speech',source.runId]){folder=part?path.join(folder,part):folder;try{const s=await fs.lstat(folder);if(!s.isDirectory()||s.isSymbolicLink()||await fs.realpath(folder)!==folder)throw fail();}catch(e){if(absent(e))return null;throw e;}}
    const file=path.join(folder,`${source.attemptId}.wav`);if(path.relative(this.root,file).startsWith('..')||path.isAbsolute(path.relative(this.root,file)))throw fail();return file;
  }
  private async verify(source:SpeechSource,allowAbsent:boolean){
    const file=await this.location(source);if(!file){if(allowAbsent)return null;throw fail();}
    let stat;try{stat=await fs.lstat(file,{bigint:true});}catch(e){if(allowAbsent&&absent(e))return null;throw fail();}
    if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1n||stat.size!==BigInt(source.byteLength)||await fs.realpath(file)!==file)throw fail();
    const handle=await fs.open(file,'r');try{const current=await handle.stat({bigint:true});if(!current.isFile()||current.nlink!==1n||current.ino!==stat.ino||current.size!==stat.size||stat.dev!==0n&&current.dev!==stat.dev)throw fail();const bytes=await handle.readFile();if(bytes.length!==source.byteLength||sha(bytes)!==source.audioHash)throw fail();}finally{await handle.close();}return {file,stat};
  }
  async inspect(source:SpeechSource){await this.verify(source,false);}
  async remove(source:SpeechSource){const verified=await this.verify(source,true);if(!verified)return;const file=await this.location(source);if(!file)return;try{const current=await fs.lstat(file,{bigint:true});if(!current.isFile()||current.isSymbolicLink()||current.nlink!==1n||current.ino!==verified.stat.ino||current.size!==verified.stat.size||await fs.realpath(file)!==file)throw fail();await fs.unlink(file);}catch(e){if(!absent(e))throw e;}try{await fs.lstat(file);throw fail();}catch(e){if(!absent(e))throw e;}}
}
