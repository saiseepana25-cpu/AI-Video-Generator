import {createHash} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import type {Long,Db,ClientSession} from 'mongodb';
import type {GenerationRun} from './contracts';
export type Execution={_id:string;workspaceId:string;projectId:string;runId:string;inputHash:string;rendererBuildHash:string;hostHash:string;rootHash:string;
  owner:string;leaseEpoch:Long;stage:'preflight'|'render';artifactId:string|null;jobName:string;protocol:'windows-job-v1';state:'prepared'|'running'|'recovering'|'stopped';
  revision:Long;createdAt:Date;updatedAt:Date;stoppedAt:Date|null;exitCode:number|null;stopReason:'completed'|'cancelled'|'recovered'|null};
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
let hostIdentity:string|undefined;
export function executorLocation(root:string){
  if(!hostIdentity){
    try{
      // Local\ named Jobs are session-scoped. Hostname/path alone could mistake
      // absence in another Windows session or cloned checkout for termination.
      const identity=process.platform==='win32'?execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-WindowStyle','Hidden','-Command',
        '$ErrorActionPreference="Stop"; [string](Get-ItemPropertyValue -LiteralPath "HKLM:\\SOFTWARE\\Microsoft\\Cryptography" -Name MachineGuid); [string][System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value; [string][System.Diagnostics.Process]::GetCurrentProcess().SessionId'],{windowsHide:true,timeout:10000,encoding:'utf8',stdio:['ignore','pipe','ignore']}):'unsupported';
      if(!identity.trim())throw new Error();hostIdentity=hash(`${os.hostname()}\n${identity.trim()}`);
    }catch{throw new Error('EXECUTOR_HOST_UNAVAILABLE');}
  }
  const canonical=path.resolve(root);return {rootHash:hash(canonical),hostHash:hash(`${hostIdentity}\n${canonical}`)};
}
export async function executorStopEvidence(db:Db,session:ClientSession,run:GenerationRun){
  const rows=await db.collection<Execution>('generation_executors').find({runId:run._id},{session}).limit(3).toArray();
  const stage=run.stage==='validating'?'preflight':'render';
  // Under this persisted protocol every launch must first insert a receipt and
  // contend on the run. A finalizing transaction fences any not-yet-admitted
  // launch. This exception never applies to legacy/unregistered executors.
  return rows.length<=2&&(run.executorProtocol==='windows-job-v1'||rows.some(e=>e.stage===stage))&&rows.every(e=>e.state==='stopped'&&e.stoppedAt instanceof Date&&e.exitCode!==null&&e.protocol==='windows-job-v1'
    &&e.workspaceId===run.workspaceId&&e.projectId===run.projectId&&e.inputHash===run.inputHash&&e.rendererBuildHash===run.rendererBuildHash&&e.owner===run.owner&&e.leaseEpoch.equals(run.leaseEpoch!));
}
