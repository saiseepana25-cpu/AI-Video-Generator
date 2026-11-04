import fs from 'node:fs/promises';
import path from 'node:path';
import type {Db} from 'mongodb';
import type {Execution} from '../generation/executor-contracts';
import {executorLocation} from '../generation/executor-contracts';
import {CleanupFault} from './contracts';
/** Bounded, read-only quarantine inventory. Unknown ownership is retained, not
 * guessed from filenames, age or a missing DB row. No path/content is returned. */
export async function orphanAudit(db:Db,root:string){
  root=path.resolve(root);const location=executorLocation(root),folder=path.join(root,'.cache','executors');
  const summary={observedFolders:0,knownStoppedPastGrace:0,knownRetained:0,unknownFoldersRetained:0,truncated:false,perInventoryLimit:200,deleted:0,eligibilityProved:false};
  try{
    for(const dir of [root,path.join(root,'.cache'),folder]){const stat=await fs.lstat(dir);if(!stat.isDirectory()||stat.isSymbolicLink()||await fs.realpath(dir)!==dir)throw new CleanupFault('ORPHAN_AUDIT_UNAVAILABLE');}
  }catch(error){if(error&&typeof error==='object'&&'code'in error&&error.code==='ENOENT')return summary;throw error;}
  const entries:{id:string|null}[]=[],directory=await fs.opendir(folder);
  for await(const entry of directory){if(entries.length===200){summary.truncated=true;break;}
    const hex=entry.name,valid=/^[a-f0-9]{32}$/.test(hex)&&entry.isDirectory()&&!entry.isSymbolicLink();
    entries.push({id:valid?`${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`:null});
  }
  const rows=await db.collection<Execution>('generation_executors').find({_id:{$in:entries.flatMap(e=>e.id?[e.id]:[])}}).limit(201).toArray();
  for(const entry of entries){summary.observedFolders++;const row=rows.find(row=>row._id===entry.id);
    if(!row||row.rootHash!==location.rootHash||row.hostHash!==location.hostHash||row.protocol!=='windows-job-v1'){summary.unknownFoldersRetained++;continue;}
    if(row.state==='stopped'&&row.stoppedAt&&row.payloadSealedAt&&Math.max(row.stoppedAt.getTime(),row.payloadSealedAt.getTime())<=Date.now()-24*3600000)summary.knownStoppedPastGrace++;else summary.knownRetained++;
  }return summary;
}
