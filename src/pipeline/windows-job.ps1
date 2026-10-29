param([Parameter(Mandatory=$true)][ValidateSet('run','inspect','terminate')][string]$Mode,
  [Parameter(Mandatory=$true)][string]$JobName,[string]$NodeExe,[string]$Root,[string]$Payload)
$ErrorActionPreference='Stop'
if ($JobName -notmatch '^Local\\VideoCraft_[a-f0-9]{32}$') { exit 2 }
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;
public static class VideoCraftJob {
  [StructLayout(LayoutKind.Sequential)] struct IO { public UInt64 a,b,c,d,e,f; }
  [StructLayout(LayoutKind.Sequential)] struct BasicLimit { public Int64 a,b; public UInt32 flags; public UIntPtr min,max; public UInt32 count; public UIntPtr affinity; public UInt32 priority,schedule; }
  [StructLayout(LayoutKind.Sequential)] struct Limits { public BasicLimit basic; public IO io; public UIntPtr process,job,peakProcess,peakJob; }
  [StructLayout(LayoutKind.Sequential)] struct Accounting { public Int64 a,b,c,d; public UInt32 faults,total,active,terminated; }
  [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] struct Startup { public UInt32 cb; public string reserved,desktop,title; public UInt32 x,y,w,h,charsX,charsY,fill,flags; public UInt16 show,reserved2; public IntPtr data,input,output,error; }
  [StructLayout(LayoutKind.Sequential)] struct ProcessInfo { public IntPtr process,thread; public UInt32 pid,tid; }
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr CreateJobObjectW(IntPtr attrs,string name);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr OpenJobObjectW(UInt32 access,bool inherit,string name);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job,int kind,ref Limits info,int size);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool QueryInformationJobObject(IntPtr job,int kind,ref Accounting info,int size,IntPtr length);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool QueryInformationJobObject(IntPtr job,int kind,ref Limits info,int size,IntPtr length);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool TerminateJobObject(IntPtr job,UInt32 code);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool TerminateProcess(IntPtr process,UInt32 code);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool CreateProcessW(string app,StringBuilder cmd,IntPtr pa,IntPtr ta,bool inherit,UInt32 flags,IntPtr env,string cwd,ref Startup start,out ProcessInfo info);
  [DllImport("kernel32.dll",SetLastError=true)] static extern UInt32 ResumeThread(IntPtr thread);
  [DllImport("kernel32.dll",SetLastError=true)] static extern UInt32 WaitForSingleObject(IntPtr handle,UInt32 ms);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetExitCodeProcess(IntPtr process,out UInt32 code);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  static void Need(bool value) { if(!value) throw new Exception("EXECUTOR_OS_UNAVAILABLE"); }
  static UInt32 Active(IntPtr job) { var a=new Accounting(); Need(QueryInformationJobObject(job,1,ref a,Marshal.SizeOf(typeof(Accounting)),IntPtr.Zero));return a.active; }
  static void Drain(IntPtr job) { for(int n=0;n<300;n++){if(Active(job)==0)return;Thread.Sleep(100);} throw new Exception("EXECUTOR_STOP_UNCONFIRMED"); }
  static string Quote(string value) { if(String.IsNullOrEmpty(value)||value.IndexOf('"')>=0||value.EndsWith("\\"))throw new Exception("INVALID_EXECUTOR_PATH"); return "\""+value+"\""; }
  public static bool Inspect(string name,bool terminate) {
    IntPtr job=OpenJobObjectW(terminate?12u:4u,false,name);
    if(job==IntPtr.Zero){if(Marshal.GetLastWin32Error()==2)return true;throw new Exception("EXECUTOR_STOP_UNCONFIRMED");}
    try {var limits=new Limits();Need(QueryInformationJobObject(job,9,ref limits,Marshal.SizeOf(typeof(Limits)),IntPtr.Zero));
      Need((limits.basic.flags&0x2000)!=0&&(limits.basic.flags&0x1800)==0);
      if(terminate){Need(TerminateJobObject(job,130));Drain(job);} return Active(job)==0;
    } finally {CloseHandle(job);}
  }
  public static void Run(string name,string node,string root,string payload) {
    IntPtr job=IntPtr.Zero;var pi=new ProcessInfo();bool assigned=false;
    try {
      job=CreateJobObjectW(IntPtr.Zero,name);int error=Marshal.GetLastWin32Error();
      if(job!=IntPtr.Zero&&error==183){CloseHandle(job);job=IntPtr.Zero;throw new Exception("EXECUTOR_NAME_COLLISION");}Need(job!=IntPtr.Zero);
      var limits=new Limits();limits.basic.flags=0x2000;Need(SetInformationJobObject(job,9,ref limits,Marshal.SizeOf(typeof(Limits))));
      var si=new Startup();si.cb=(UInt32)Marshal.SizeOf(typeof(Startup));
      var command=new StringBuilder(Quote(node)+" --import tsx "+Quote(System.IO.Path.Combine(root,"scripts","render-executor.ts"))+" "+Quote(payload));
      Need(CreateProcessW(node,command,IntPtr.Zero,IntPtr.Zero,false,0x08000004,IntPtr.Zero,root,ref si,out pi));
      Need(AssignProcessToJobObject(job,pi.process));assigned=true;
      Console.WriteLine("{\"event\":\"prepared\"}");Console.Out.Flush();
      // No child instruction runs before durable parent admission. EOF is stop.
      if(Console.ReadLine()!="go"){Need(TerminateJobObject(job,130));Drain(job);Console.WriteLine("{\"event\":\"stopped\",\"exitCode\":130}");return;}
      Need(ResumeThread(pi.thread)!=UInt32.MaxValue);Task<string> input=Task.Run(()=>Console.ReadLine());bool cancelled=false;
      while(WaitForSingleObject(pi.process,100)==258){if(input.IsCompleted){Need(TerminateJobObject(job,130));cancelled=true;break;}}
      if(!cancelled)Need(WaitForSingleObject(pi.process,0)==0);
      UInt32 code=130;if(!cancelled)Need(GetExitCodeProcess(pi.process,out code));
      // Root exit alone is insufficient. Terminate leftovers and await active=0.
      Need(TerminateJobObject(job,code));Drain(job);
      Console.WriteLine("{\"event\":\"stopped\",\"exitCode\":"+code+"}");Console.Out.Flush();
    } finally {
      if(job!=IntPtr.Zero){TerminateJobObject(job,130);CloseHandle(job);}
      if(pi.process!=IntPtr.Zero){if(!assigned)TerminateProcess(pi.process,130);CloseHandle(pi.process);}
      if(pi.thread!=IntPtr.Zero)CloseHandle(pi.thread);
    }
  }
}
'@
try {
  if($Mode -eq 'run'){[VideoCraftJob]::Run($JobName,$NodeExe,$Root,$Payload)}
  else {$stopped=[VideoCraftJob]::Inspect($JobName,($Mode -eq 'terminate')); @{stopped=$stopped}|ConvertTo-Json -Compress}
} catch { [Console]::Error.WriteLine('EXECUTOR_OS_UNAVAILABLE');exit 1 }
