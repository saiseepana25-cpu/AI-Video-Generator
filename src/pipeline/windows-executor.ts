import {spawn,execFile,type ChildProcessWithoutNullStreams} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';
import {ExecutorStopUnconfirmed} from './executor-stop';
const execute=promisify(execFile);
export type ExecutorIdentity={id:string;jobName:string;root:string};
const validate=(id:ExecutorIdentity)=>{
  if(process.platform!=='win32'||!/^[a-f0-9]{32}$/.test(id.id)||id.jobName!==`Local\\VideoCraft_${id.id}`||!path.isAbsolute(id.root))throw new ExecutorStopUnconfirmed();
};
function env(){return Object.fromEntries(Object.entries(process.env).filter(([key,value])=>value!==undefined&&['PATH','SYSTEMROOT','WINDIR','TEMP','TMP','PATHEXT','USERPROFILE','APPDATA','LOCALAPPDATA','PROGRAMFILES','PROGRAMFILES(X86)'].includes(key.toUpperCase()))) as NodeJS.ProcessEnv;}
export async function inspectWindowsExecutor(identity:ExecutorIdentity,terminate=false){
  validate(identity);
  try{
    const {stdout}=await execute('powershell.exe',['-NoProfile','-NonInteractive','-WindowStyle','Hidden','-File',path.join(identity.root,'src/pipeline/windows-job.ps1'),'-Mode',terminate?'terminate':'inspect','-JobName',identity.jobName],{windowsHide:true,env:env(),timeout:45000,maxBuffer:16384});
    const value=JSON.parse(stdout);if(typeof value.stopped!=='boolean')throw new Error();return value.stopped as boolean;
  }catch{throw new ExecutorStopUnconfirmed();}
}
/** The OS child is suspended inside its non-breakaway, kill-on-close Job until
 * the caller durably admits it. A returned stop requires ActiveProcesses==0. */
export class WindowsExecutor {
  private child:ChildProcessWithoutNullStreams;
  private preparedResolve!:()=>void;private preparedReject!:(error:unknown)=>void;
  private stoppedResolve!:(code:number)=>void;private stoppedReject!:(error:unknown)=>void;
  readonly prepared:Promise<void>;readonly stopped:Promise<number>;
  private admitted=false;private stopping=false;
  constructor(readonly identity:ExecutorIdentity){
    validate(identity);
    this.prepared=new Promise((resolve,reject)=>{this.preparedResolve=resolve;this.preparedReject=reject;});
    this.stopped=new Promise((resolve,reject)=>{this.stoppedResolve=resolve;this.stoppedReject=reject;});
    // Consumers attach after durable setup; never leak an unhandled rejection.
    void this.prepared.catch(()=>{});void this.stopped.catch(()=>{});
    this.child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-WindowStyle','Hidden','-File',path.join(identity.root,'src/pipeline/windows-job.ps1'),'-Mode','run','-JobName',identity.jobName,'-NodeExe',process.execPath,'-Root',identity.root,'-Payload',path.join(identity.root,'.cache','executors',identity.id,'input.json')],{windowsHide:true,env:env(),stdio:['pipe','pipe','pipe']});
    let buffer='',seenPrepared=false,seenStopped=false,reportedCode:number|undefined,total=0;
    const fail=()=>{this.cancel();this.preparedReject(new ExecutorStopUnconfirmed());this.stoppedReject(new ExecutorStopUnconfirmed());};
    const startup=setTimeout(fail,30000),deadline=setTimeout(fail,15*60000);
    this.child.stdin.on('error',()=>{});this.child.stderr.on('data',()=>{});
    this.child.stdout.on('data',(chunk:Buffer)=>{
      total+=chunk.length;if(total>16384){fail();return;}buffer+=chunk.toString();
      while(buffer.includes('\n')){
        const index=buffer.indexOf('\n'),line=buffer.slice(0,index).trim();buffer=buffer.slice(index+1);if(!line)continue;
        try{const message=JSON.parse(line);
          if(message.event==='prepared'&&!seenPrepared&&!seenStopped){seenPrepared=true;clearTimeout(startup);this.preparedResolve();}
          else if(message.event==='stopped'&&seenPrepared&&!seenStopped&&Number.isInteger(message.exitCode)&&message.exitCode>=0&&message.exitCode<=4294967295){seenStopped=true;reportedCode=message.exitCode;}
          else fail();
        }catch{fail();}
      }
    });
    this.child.once('error',fail);
    this.child.once('close',code=>{clearTimeout(startup);clearTimeout(deadline);if(code===0&&seenStopped&&reportedCode!==undefined){this.stoppedResolve(reportedCode);}else fail();});
  }
  admit(){if(this.admitted||this.stopping)throw new ExecutorStopUnconfirmed();this.admitted=true;this.child.stdin.write('go\n');}
  cancel(){if(this.stopping)return;this.stopping=true;this.child.stdin.end('stop\n');}
  /** Test/diagnostic hook kills only this supervisor; OS kill-on-close owns its
   * child tree. Recovery still must inspect the named Job before releasing DB. */
  interruptSupervisor(){this.child.kill();}
}
