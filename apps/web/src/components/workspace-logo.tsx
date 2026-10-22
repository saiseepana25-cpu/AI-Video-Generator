'use client';
import {useEffect,useRef,useState} from 'react';
import {MAX_LOGO_BYTES,parseLogoFile,type LogoFile,type LogoView} from '@/server/logos/contracts';
import {recoverLogoCommand,type LogoCommand} from '@/lib/logo-command';
import {Button} from './ui';
export function WorkspaceLogo({workspaceId,userId}:{workspaceId:string;userId:string}){
  const scope=`videocraft:${workspaceId}:${userId}:logo-upload:v1`,input=useRef<HTMLInputElement>(null),busy=useRef(false);
  const [command,setCommand]=useState<LogoCommand|null>(null),[view,setView]=useState<LogoView|null>(null),[file,setFile]=useState<File|null>(null),[metadata,setMetadata]=useState<LogoFile|null>(null),[working,setWorking]=useState(false),[checked,setChecked]=useState(false),[error,setError]=useState(''),[previewRevision,setPreviewRevision]=useState(0);
  const active=!!command&&(!view||view.state==='validating');
  function showResult(next:LogoView){setView(next);if(next.state==='ready')setPreviewRevision(n=>n+1);if(next.state!=='validating'){setFile(null);setMetadata(null);if(input.current)input.current.value='';}}
  async function status(cmd:LogoCommand){
    if(busy.current)return;busy.current=true;setWorking(true);setError('');try{const response=await fetch(`/api/v1/workspace/logo-uploads/${cmd.id}`,{cache:'no-store',signal:AbortSignal.timeout(15000)}),result=await response.json();if(response.status===404){setView(null);setError('No receipt was found. Reselect the original file and retry the same upload.');return;}if(!response.ok)throw new Error();showResult(result.data);}catch{setError('Could not confirm this upload. Reconnect or sign in again, then check its status.');}finally{busy.current=false;setWorking(false);}
  }
  useEffect(()=>{void(async()=>{try{const raw=sessionStorage.getItem(scope);if(raw){const saved=recoverLogoCommand(raw);if(saved){setCommand(saved);await status(saved);}else setError('The saved upload receipt is unreadable. Select a file to begin a new upload.');}}catch{setError('Tab recovery is unavailable. Keep this page open while uploading.');}setChecked(true);})();},[scope]);
  async function select(selected:File|null){
    if(!selected||busy.current)return;busy.current=true;setError('');setFile(null);setMetadata(null);setWorking(true);
    try{if(selected.size<1||selected.size>MAX_LOGO_BYTES)throw new Error('Choose an image up to 5 MB.');const hash=await crypto.subtle.digest('SHA-256',await selected.arrayBuffer()),sha256=Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('');const next=parseLogoFile({filename:selected.name,contentType:selected.type,sizeBytes:selected.size,sha256});if(active&&JSON.stringify(next)!==JSON.stringify(command!.file))throw new Error('Reselect the original file with the same filename, type, size and contents to recover this upload.');setFile(selected);setMetadata(next);}catch(cause){setError(cause instanceof Error?cause.message:'Choose a supported image.');if(input.current)input.current.value='';}finally{busy.current=false;setWorking(false);}
  }
  async function upload(){
    if(busy.current||!file||!metadata)return;const cmd=active?command!:{id:crypto.randomUUID(),file:metadata};
    try{sessionStorage.setItem(scope,JSON.stringify(cmd));}catch{setError('Could not preserve the upload ID. Keep this page open and try again.');return;}
    busy.current=true;setWorking(true);setCommand(cmd);setView(null);setError('');
    try{const response=await fetch(`/api/v1/workspace/logo-uploads/${cmd.id}`,{method:'PUT',headers:{'Content-Type':cmd.file.contentType,'X-Logo-Filename':encodeURIComponent(cmd.file.filename),'X-Logo-Sha256':cmd.file.sha256,'Idempotency-Key':cmd.id},body:file,signal:AbortSignal.timeout(90000)}),result=await response.json();
      if(!response.ok){setError(result.error?.message??'The upload is unconfirmed. Check its status before retrying.');if([400,413,415,422].includes(response.status)){sessionStorage.removeItem(scope);setCommand(null);}return;}showResult(result.data);
    }catch{setError('The upload is unconfirmed. Check its status before retrying the same file.');}finally{busy.current=false;setWorking(false);}
  }
  return <section className="workspace-settings workspace-logo" aria-label="Prepare a logo" aria-busy={working}>
    <span className="section-index">YOUR LOGO</span><h2>A mark of your own.</h2><p className="muted-copy">Prepare a clean, private logo for your team. Attaching it to saved branding and generated videos comes in the next step.</p>
    {!checked&&<p role="status">Checking saved upload…</p>}{error&&<p className="form-error" role="alert">{error}</p>}
    <label className="logo-file-label">{active?'Reselect original image':'Choose a logo'}<input ref={input} type="file" accept="image/png,image/jpeg,image/webp" disabled={!checked||working} onChange={e=>void select(e.target.files?.[0]??null)}/></label>
    <p className="muted-copy">PNG, JPEG or WebP · Up to 5 MB and 4096 × 4096 pixels · Still images only. We strip metadata and prepare a PNG up to 1024 pixels, preserving proportions and transparency.</p>
    <div className="editor-actions"><Button disabled={!checked||working||!file||!!view&&view.state==='validating'&&view.retryAfterSeconds>0} onClick={()=>void upload()}>{working?'Checking image…':active?'Retry same logo upload':'Upload & validate logo'}</Button>{command&&<Button variant="secondary" disabled={working||!!file&&!active} onClick={()=>void status(command)}>Check upload status</Button>}</div>
    {view?.state==='validating'&&<p role="status">This upload is awaiting confirmation. {view.retryAfterSeconds>0?'The earlier request may still be running. Check its status shortly.':'Reselect the original file if needed, then retry the same upload.'}</p>}
    {view?.state==='rejected'&&<p className="form-error" role="alert">Image rejected. {view.error} Choose a different file to start a new upload.</p>}
    {view?.state==='expired'&&<p role="status">This upload expired. Choose the image again to start a new upload.</p>}
    {view?.state==='ready'&&view.previewUrl&&<div className="logo-prepared"><img key={previewRevision} src={view.previewUrl} alt="Prepared logo preview" onError={()=>setError('The prepared logo preview is unavailable. Check upload status or sign in again.')}/><p role="status">Logo prepared and stored privately.</p><p className="muted-copy">{view.filename} · Ready for the next branding step. Existing projects and videos are unchanged.</p></div>}
    <p className="muted-copy">Keep this tab for upload recovery. After a reload, reselect the same file if asked. An unconfirmed upload keeps its original ID.</p>
  </section>;
}
