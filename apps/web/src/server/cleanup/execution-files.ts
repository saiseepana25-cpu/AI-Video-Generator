import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {CleanupFault} from './contracts';
export type ExecutionSource={executionId:string;runId:string;artifactId:string|null;includeArtifact:boolean;stoppedAt:Date;artifactOwnerHash:string|null;workOwnerHash:string};
export type ExecutionFile={area:'work'|'artifact';name:string;size:number;sha256:string};
export type ExecutionDirectory={area:'work'|'artifact';name:string};
export type ExecutionInventory={files:ExecutionFile[];directories:ExecutionDirectory[]};
export interface ExecutionCleaner{rootHash:string;inspect(source:ExecutionSource):Promise<ExecutionInventory>;remove(source:ExecutionSource,inventory:ExecutionInventory):Promise<void>;}
const hash=(v:Buffer|string)=>createHash('sha256').update(v).digest('hex');
const absent=(e:unknown)=>!!e&&typeof e==='object'&&'code'in e&&e.code==='ENOENT';
const fail=()=>new CleanupFault('EXECUTION_FILES_UNAVAILABLE');
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
/** Bounded enumeration, followed by exact checkpointed unlinks/rmdir. Never
 * follows links, deletes by prefix, or calls recursive rm. Trusted local root. */
export class ExecutionFiles implements ExecutionCleaner{
  readonly rootHash:string;
  private constructor(private root:string){this.rootHash=hash(root);}
  static async create(root:string){const real=await fs.realpath(path.resolve(root));if(real!==path.resolve(root))throw fail();return new ExecutionFiles(real);}
  private base(source:ExecutionSource,area:ExecutionFile['area']){
    if(area!=='work'&&area!=='artifact')throw fail();
    if(!uuid.test(source.executionId)||!uuid.test(source.runId)||source.artifactId!==null&&!uuid.test(source.artifactId)||typeof source.includeArtifact!=='boolean'||!(source.stoppedAt instanceof Date)||!Number.isFinite(source.stoppedAt.getTime()))throw fail();
    if(area==='artifact'&&(!source.includeArtifact||!source.artifactId))throw fail();
    return area==='work'?path.join(this.root,'.cache','executors',source.executionId.replaceAll('-','')):path.join(this.root,'output','dashboard-renders',source.runId,source.artifactId!);
  }
  private async location(source:ExecutionSource,area:ExecutionFile['area'],name:string){
    if(name&&(!/^[A-Za-z0-9_@. ()+/-]{1,500}$/.test(name)||name.split('/').some(v=>!v||v==='.'||v==='..')||name.split('/').length>14))throw fail();
    const base=this.base(source,area),file=path.join(base,...(name?name.split('/'):[])),relative=path.relative(this.root,file);
    if(relative.startsWith('..')||path.isAbsolute(relative))throw fail();
    let current=this.root;
    for(const segment of ['',...path.relative(this.root,path.dirname(file)).split(path.sep)]){
      current=segment?path.join(current,segment):current;
      try{const s=await fs.lstat(current);if(!s.isDirectory()||s.isSymbolicLink()||await fs.realpath(current)!==current)throw fail();}catch(e){if(absent(e))return null;throw e;}
    }
    return file;
  }
  private async read(source:ExecutionSource,area:ExecutionFile['area'],name:string,allowAbsent=false){
    const file=await this.location(source,area,name);if(!file){if(allowAbsent)return null;throw fail();}
    let stat;try{stat=await fs.lstat(file,{bigint:true});}catch(e){if(allowAbsent&&absent(e))return null;throw fail();}
    if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1n||stat.size>134217728n||stat.mtimeMs>BigInt(source.stoppedAt.getTime())||await fs.realpath(file)!==file)throw fail();
    const handle=await fs.open(file,'r');try{const now=await handle.stat({bigint:true});if(!now.isFile()||now.nlink!==1n||now.ino!==stat.ino||now.size!==stat.size||now.mtimeNs!==stat.mtimeNs||stat.dev!==0n&&now.dev!==stat.dev)throw fail();
      const bytes=await handle.readFile(),after=await handle.stat({bigint:true});if(BigInt(bytes.length)!==stat.size||after.mtimeNs!==now.mtimeNs||after.size!==now.size)throw fail();return {file,stat,sha256:hash(bytes),size:bytes.length};
    }finally{await handle.close();}
  }
  async inspect(source:ExecutionSource){return this.inventory(source,false);}
  private async inventory(source:ExecutionSource,allowMissingOwner:boolean,allowMissingWorkOwner=false){
    const result:ExecutionInventory={files:[],directories:[]};let bytes=0;
    if(!/^[a-f0-9]{64}$/.test(source.workOwnerHash??''))throw fail();
    const work=await this.location(source,'work','');
    if(work&&await fs.access(work).then(()=>true,()=>false)){
      const owner=await this.read(source,'work','.workspace-owner.json',true);
      if(owner?owner.sha256!==source.workOwnerHash:!allowMissingWorkOwner)throw fail();
    }
    if(source.includeArtifact){
      if(!/^[a-f0-9]{64}$/.test(source.artifactOwnerHash??''))throw fail();
      const base=await this.location(source,'artifact','');
      if(base&&await fs.access(base).then(()=>true,()=>false)){
        const owner=await this.read(source,'artifact','.execution-owner.json',true);
        if(owner?owner.sha256!==source.artifactOwnerHash:!allowMissingOwner)throw fail();
      }
    }
    const visit=async(area:ExecutionFile['area'],name:string)=>{
      const file=await this.location(source,area,name);if(!file)return;
      let stat;try{stat=await fs.lstat(file);}catch(e){if(absent(e))return;throw e;}
      if(stat.isSymbolicLink()||await fs.realpath(file)!==file)throw fail();
      if(result.files.length+result.directories.length>=2048)throw fail();
      if(stat.isDirectory()){
        if(name.split('/').length>14)throw fail();result.directories.push({area,name});
        const entries=await fs.readdir(file);if(entries.length>2048)throw fail();
        for(const child of entries.sort())await visit(area,name?`${name}/${child}`:child);
      }else{
        // Only generated media/bundle formats in the execution-owned namespace.
        if(!name.startsWith('temp/')&&!name.startsWith('scratch/')&&!/\.(json|f32|png|ico|wav|mp4|srt|woff2?|ttf|js|map|css|html|svg|wasm)$/i.test(name)&&!/\.LICENSE\.txt$/.test(name))throw fail();
        const value=await this.read(source,area,name);if(!value)throw fail();bytes+=value.size;if(bytes>512*1024*1024)throw fail();result.files.push({area,name,size:value.size,sha256:value.sha256});
      }
    };
    await visit('work','');if(source.includeArtifact)await visit('artifact','');return result;
  }
  async remove(source:ExecutionSource,inventory:ExecutionInventory){
    if(inventory.files.length+inventory.directories.length>2048)throw fail();
    const expected=new Map(inventory.files.map(file=>[`${file.area}:${file.name}`,file]));
    if(expected.size!==inventory.files.length)throw fail();
    for(const entry of inventory.files){if(!Number.isSafeInteger(entry.size)||entry.size<0||entry.size>134217728||!/^[a-f0-9]{64}$/.test(entry.sha256))throw fail();await this.location(source,entry.area,entry.name);}
    for(const entry of inventory.directories)await this.location(source,entry.area,entry.name);
    const marker=inventory.files.find(entry=>entry.area==='artifact'&&entry.name==='.execution-owner.json');
    const workMarker=inventory.files.find(entry=>entry.area==='work'&&entry.name==='.workspace-owner.json');
    const current=await this.inventory(source,!!marker&&marker.sha256===source.artifactOwnerHash,!!workMarker&&workMarker.sha256===source.workOwnerHash);
    const directories=new Set(inventory.directories.map(entry=>`${entry.area}:${entry.name}`));
    if(directories.size!==inventory.directories.length||current.directories.some(entry=>!directories.has(`${entry.area}:${entry.name}`)))throw fail();
    for(const file of current.files){const old=expected.get(`${file.area}:${file.name}`);if(!old||old.size!==file.size||old.sha256!==file.sha256)throw fail();}
    const isMarker=(name:string)=>name==='.execution-owner.json'||name==='.workspace-owner.json';
    for(const entry of [...inventory.files].sort((a,b)=>Number(isMarker(a.name))-Number(isMarker(b.name)))){
      if(!Number.isSafeInteger(entry.size)||entry.size<0||entry.size>134217728||!/^[a-f0-9]{64}$/.test(entry.sha256))throw fail();
      const value=await this.read(source,entry.area,entry.name,true);if(!value)continue;if(value.size!==entry.size||value.sha256!==entry.sha256)throw fail();
      try{const now=await fs.lstat(value.file,{bigint:true});if(!now.isFile()||now.isSymbolicLink()||now.nlink!==1n||now.ino!==value.stat.ino||now.size!==value.stat.size||now.mtimeNs!==value.stat.mtimeNs)throw fail();await fs.unlink(value.file);}catch(e){if(!absent(e))throw e;}
      try{await fs.lstat(value.file);throw fail();}catch(e){if(!absent(e))throw e;}
    }
    for(const entry of [...inventory.directories].sort((a,b)=>b.name.split('/').length-a.name.split('/').length||b.name.length-a.name.length)){
      const file=await this.location(source,entry.area,entry.name);if(!file)continue;
      try{const stat=await fs.lstat(file);if(!stat.isDirectory()||stat.isSymbolicLink()||await fs.realpath(file)!==file)throw fail();await fs.rmdir(file);}catch(e){if(!absent(e))throw e;}
    }
    if((await this.inspect(source)).files.length)throw fail();
  }
}
