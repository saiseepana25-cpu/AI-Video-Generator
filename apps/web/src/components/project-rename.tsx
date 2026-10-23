'use client';
import {useEffect,useRef,useState,type FormEvent} from 'react';
import Link from 'next/link';
import {ProjectError,type ProjectDetail} from '@/server/projects/contracts';
import {parseProjectPatch} from '@/server/projects/validation';
import {recoverRenameCommand,type RenameCommand} from '@/lib/rename-command';
import {canCorrectSaveFailure} from '@/lib/save-outcome';
import {Button} from './ui';

export function ProjectRename({project,scope,enabled,onLocked,onSaved}:{project:ProjectDetail;scope:string;enabled:boolean;onLocked:(locked:boolean)=>void;onSaved:(project:ProjectDetail)=>void}){
  const storageKey=`${scope}:rename-command:v1`,busy=useRef(false);
  const [checked,setChecked]=useState(false),[open,setOpen]=useState(false),[title,setTitle]=useState(project.displayTitle);
  const [command,setCommand]=useState<RenameCommand|null>(null),[sending,setSending]=useState(false),[conflict,setConflict]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[sessionEnded,setSessionEnded]=useState(false);
  useEffect(()=>{
    try{const raw=sessionStorage.getItem(storageKey);if(raw){const saved=recoverRenameCommand(raw);setOpen(true);if(saved){setCommand(saved);setTitle(saved.body.patch.displayTitle!);setMessage('An earlier rename is unconfirmed. Check that same rename before editing.');}else{setConflict(true);setError('Rename recovery is unreadable. Reload the saved project before starting a new rename.');}}}
    catch{setError('Tab recovery is unavailable. Keep this page open.');}
    setChecked(true);
  },[storageKey]);
  useEffect(()=>{onLocked(!checked||open);},[checked,open,onLocked]);
  useEffect(()=>{const warn=(event:BeforeUnloadEvent)=>{if(command||open&&title!==project.displayTitle)event.preventDefault();};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[command,open,title,project.displayTitle]);
  async function submit(event:FormEvent){
    event.preventDefault();if(busy.current||!checked||!enabled||conflict)return;
    let next=command;
    try{if(!next)next={key:crypto.randomUUID(),body:parseProjectPatch({expectedProjectRevision:project.revision,patch:{displayTitle:title}})};sessionStorage.setItem(storageKey,JSON.stringify(next));}
    catch(cause){setError(cause instanceof ProjectError?cause.fieldErrors[0]?.message??cause.message:cause instanceof Error?cause.message:'Check the project title.');return;}
    busy.current=true;setSending(true);setCommand(next);setError('');setMessage('');setSessionEnded(false);
    try{
      const response=await fetch(`/api/v1/projects/${project.id}`,{method:'PATCH',headers:{'Content-Type':'application/json','Idempotency-Key':next.key},body:JSON.stringify(next.body),signal:AbortSignal.timeout(20000)}),value=await response.json();
      if(!response.ok){
        if(!canCorrectSaveFailure(response.status,value.error?.code)){setSessionEnded(response.status===401);setError('Rename outcome is unconfirmed. Reconnect or sign in, then check the same rename.');return;}
        sessionStorage.removeItem(storageKey);setCommand(null);setConflict(response.status===409);setError(value.error?.fieldErrors?.[0]?.message??value.error?.message??'Could not rename this project.');return;
      }
      let saved=value.data as ProjectDetail;
      // A replay is the original receipt, potentially older than today's project.
      // Confirm the command first, then show the latest saved state without writing it.
      if(response.headers.get('Idempotency-Replayed')==='true'){
        const latest=await fetch(`/api/v1/projects/${project.id}`,{cache:'no-store',signal:AbortSignal.timeout(15000)});
        if(!latest.ok)throw new Error();saved=(await latest.json()).data;
      }
      sessionStorage.removeItem(storageKey);setCommand(null);onSaved(saved);setTitle(saved.displayTitle);setOpen(false);setMessage('Rename confirmed. The current project title is shown; the video plan and generated content keep their saved titles.');
    }catch{setError('Rename outcome is unconfirmed. Reconnect and check the same rename.');}
    finally{busy.current=false;setSending(false);}
  }
  async function reload(){
    if(busy.current||command||!enabled)return;busy.current=true;setSending(true);
    try{const response=await fetch(`/api/v1/projects/${project.id}`,{cache:'no-store',signal:AbortSignal.timeout(15000)});if(!response.ok)throw new Error();const saved=(await response.json()).data as ProjectDetail;sessionStorage.removeItem(storageKey);onSaved(saved);setConflict(false);setError('');setMessage(`Saved title: ${saved.displayTitle}. Your typed title is retained; review it before saving.`);}
    catch{setError('Could not reload the project. Your typed title is retained.');}finally{busy.current=false;setSending(false);}
  }
  return <div className="project-rename">
    {!open&&<Button variant="secondary" disabled={!checked||!enabled} onClick={()=>{setTitle(project.displayTitle);setOpen(true);setMessage('');setError('');}}>Rename project</Button>}
    {open&&<form className="draft-editor rename-form" aria-label="Rename project" onSubmit={submit} aria-busy={sending}>
      <label htmlFor="project-title">Project title</label><input id="project-title" value={title} disabled={sending||!!command||conflict} onChange={e=>setTitle(e.target.value)} aria-describedby="rename-hint" autoFocus/>
      <p className="muted-copy" id="rename-hint">Up to 120 characters. This changes the library title; narration and on-video titles stay as saved.</p>
      <div className="editor-actions"><Button type="submit" disabled={sending||!enabled||conflict}>{sending?'Checking rename…':command?'Check same rename':'Save title'}</Button>{conflict&&!command&&<Button variant="secondary" disabled={sending||!enabled} onClick={()=>void reload()}>Reload saved project</Button>}{!command&&<Button variant="secondary" disabled={sending} onClick={()=>{setOpen(false);setConflict(false);setError('');setMessage('');}}>Cancel rename</Button>}{sessionEnded&&<Link className="text-button" href="/sign-in" target="_blank" rel="noopener">Sign in in a new tab</Link>}</div>
    </form>}
    {error&&<p className="form-error" role="alert">{error}</p>}{message&&<p className="muted-copy" role="status">{message}</p>}
  </div>;
}
