import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {requireProjectId} from '../projects/contracts';
import {storageFiles} from '../storage/contracts';
import {CleanupFault} from './contracts';
import type {LocalFileCleaner,LocalFile,LocalSource} from './local-contracts';
const sha=(bytes:Buffer|string)=>createHash('sha256').update(bytes).digest('hex');
const absent=(error:unknown)=>!!error&&typeof error==='object'&&'code'in error&&error.code==='ENOENT';
const max=(name:string)=>name==='video.mp4'?128*1024*1024:name==='manifest.json'?256*1024:name==='input.json'?512*1024:name==='timing.json'?2*1024*1024:name==='captions.srt'?256*1024:16*1024*1024;
export const localNames=['video.mp4','captions.srt','input.json','timing.json','manifest.json','narration.wav',...Array.from({length:8},(_,i)=>`scene-${i+1}.png`)];
const fail=()=>new CleanupFault('LOCAL_FILES_UNAVAILABLE');
/** Exact regular files only. No recursive deletion, directory removal or DB-supplied path. */
export class LocalRenderFiles implements LocalFileCleaner{
  readonly rootHash:string;
  private constructor(private root:string){this.rootHash=sha(root);}
  static async create(root:string){const resolved=path.resolve(root),real=await fs.realpath(resolved);if(real!==resolved)throw fail();return new LocalRenderFiles(real);}
  private async location(source:LocalSource,name:string){
    requireProjectId(source.runId);requireProjectId(source.artifactId);if(!localNames.includes(name))throw fail();
    const segments=['output','dashboard-renders',source.runId,source.artifactId],folder=path.join(this.root,...segments),file=path.join(folder,name);
    if(path.relative(this.root,file).startsWith('..')||path.isAbsolute(path.relative(this.root,file)))throw fail();
    let current=this.root;
    // Revalidate every existing ancestor, including output/run folders. Refuse
    // symlinks/junctions instead of resolving through them into another tree.
    for(const part of ['',...segments]){current=part?path.join(current,part):current;try{const info=await fs.lstat(current);if(!info.isDirectory()||info.isSymbolicLink()||await fs.realpath(current)!==current)throw fail();}catch(error){if(absent(error))return null;throw error;}}
    return file;
  }
  private async read(source:LocalSource,name:string,optional=false):Promise<Buffer|null>{
    const file=await this.location(source,name);if(!file){if(optional)return null;throw fail();}
    let stat;try{stat=await fs.lstat(file,{bigint:true});}catch(error){if(optional&&absent(error))return null;throw fail();}
    if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1n||stat.size<1n||stat.size>BigInt(max(name))||await fs.realpath(file)!==file)throw fail();
    // Windows lstat reports dev=0 while fstat reports the volume ID. Compare
    // nonzero device IDs and exact bigint inode/size without lossy conversion.
    const handle=await fs.open(file,'r');try{const opened=await handle.stat({bigint:true});if(!opened.isFile()||opened.nlink!==1n||opened.ino!==stat.ino||stat.dev!==0n&&opened.dev!==stat.dev||opened.size!==stat.size)throw fail();const bytes=await handle.readFile();if(BigInt(bytes.length)!==stat.size)throw fail();return bytes;}finally{await handle.close();}
  }
  async inspect(source:LocalSource){
    const manifestBytes=await this.read(source,'manifest.json');if(sha(manifestBytes!)!==source.manifestHash)throw fail();
    let manifest;try{manifest=JSON.parse(manifestBytes!.toString('utf8'));}catch{throw fail();}
    if(manifest.state!=='validated_local'||manifest.mode!=='elevenlabs-evaluation'||manifest.diagnostic!==false||manifest.inputHash!==source.inputHash||manifest.rendererBuildHash!==source.rendererBuildHash||!/^[a-f0-9]{64}$/.test(manifest.audioHash??''))throw fail();
    const files:LocalFile[]=[];
    for(const name of localNames){const bytes=await this.read(source,name,!source.objects.some(o=>storageFiles[o.kind].name===name));if(!bytes)continue;const hash=sha(bytes),expected=source.objects.find(o=>storageFiles[o.kind].name===name);
      if(expected&&(expected.sha256!==hash||expected.size!==bytes.length)||name==='narration.wav'&&hash!==manifest.audioHash)throw fail();files.push({name,sha256:hash,size:bytes.length});}
    return files;
  }
  async remove(source:LocalSource,files:LocalFile[]){
    if(files.length<5||files.length>14||new Set(files.map(f=>f.name)).size!==files.length)throw fail();
    // Validate the entire checkpoint before the first unlink. Core file hashes
    // must still be anchored in the completed bundle, even on a partial retry.
    for(const entry of files)if(!localNames.includes(entry.name)||!Number.isSafeInteger(entry.size)||entry.size<1||entry.size>max(entry.name)||!/^[a-f0-9]{64}$/.test(entry.sha256))throw fail();
    for(const object of source.objects){const entry=files.find(f=>f.name===storageFiles[object.kind].name);if(!entry||entry.sha256!==object.sha256||entry.size!==object.size)throw fail();}
    if(source.objects.length!==5||new Set(source.objects.map(o=>o.kind)).size!==5||files.find(f=>f.name==='manifest.json')?.sha256!==source.manifestHash)throw fail();
    // Manifest last aids manual diagnosis; the durable DB snapshot is the
    // authority after any interrupted subset of unlinks.
    for(const entry of [...files].sort((a,b)=>Number(a.name==='manifest.json')-Number(b.name==='manifest.json'))){
      if(!localNames.includes(entry.name)||!Number.isSafeInteger(entry.size)||entry.size<1||entry.size>max(entry.name)||!/^[a-f0-9]{64}$/.test(entry.sha256))throw fail();
      const bytes=await this.read(source,entry.name,true);if(!bytes)continue;if(bytes.length!==entry.size||sha(bytes)!==entry.sha256)throw fail();
      const file=await this.location(source,entry.name);if(!file)continue;
      try{const current=await fs.lstat(file);if(!current.isFile()||current.isSymbolicLink()||current.nlink!==1||current.size!==entry.size||await fs.realpath(file)!==file)throw fail();await fs.unlink(file);}catch(error){if(!absent(error))throw error;}
      try{await fs.lstat(file);throw fail();}catch(error){if(!absent(error))throw error;}
    }
  }
}
