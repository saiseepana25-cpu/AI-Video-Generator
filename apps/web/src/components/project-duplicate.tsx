'use client';
import {useEffect,useRef,useState,type FormEvent} from 'react';
import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {ProjectError,type ProjectDetail} from '@/server/projects/contracts';
import {defaultDuplicateTitle,parseDuplicateInput} from '@/server/projects/validation';
import {recoverDuplicateCommand,type DuplicateCommand} from '@/lib/duplicate-command';
import {canCorrectSaveFailure} from '@/lib/save-outcome';
import {Button} from './ui';
export function ProjectDuplicate({project,scope,enabled,onLocked,onSaved}:{project:ProjectDetail;scope:string;enabled:boolean;onLocked:(locked:boolean)=>void;onSaved:(project:ProjectDetail)=>void}){
  const storageKey=`${scope}:duplicate-command:v1`,busy=useRef(false),router=useRouter();
  const [checked,setChecked]=useState(false),[open,setOpen]=useState(false),[title,setTitle]=useState(defaultDuplicateTitle(project.displayTitle)),[command,setCommand]=useState<DuplicateCommand|null>(null);
  const [sending,setSending]=useState(false),[conflict,setConflict]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[created,setCreated]=useState<string|null>(null),[sessionEnded,setSessionEnded]=useState(false);
  useEffect(()=>{try{const raw=sessionStorage.getItem(storageKey);if(raw){const recovered=recoverDuplicateCommand(raw);setOpen(true);if(recovered){setCommand(recovered);setTitle(recovered.body.displayTitle??defaultDuplicateTitle(project.displayTitle));setMessage('A copy request is unconfirmed. Check the same request before creating another copy.');}else{setConflict(true);setError('Copy recovery is unreadable. Reload the saved source before continuing.');}}}catch{setError('Tab recovery is unavailable. Keep this page open.');}setChecked(true);},[storageKey]);
  useEffect(()=>{onLocked(!checked||open);},[checked,open,onLocked]);
  useEffect(()=>{const warn=(e:BeforeUnloadEvent)=>{if(command)e.preventDefault();};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[command]);
  async function submit(event:FormEvent){
    event.preventDefault();if(busy.current||!checked||!enabled||conflict)return;let next=command;
    try{next??={key:crypto.randomUUID(),body:parseDuplicateInput({expectedProjectRevision:project.revision,displayTitle:title})};sessionStorage.setItem(storageKey,JSON.stringify(next));}
    catch(cause){setError(cause instanceof ProjectError?cause.fieldErrors[0]?.message??cause.message:'Copy recovery is unavailable. Check the title and keep this tab open.');return;}
    busy.current=true;setSending(true);setCommand(next);setError('');setMessage('');setSessionEnded(false);
    try{
      const response=await fetch(`/api/v1/projects/${project.id}/duplicate`,{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':next.key},body:JSON.stringify(next.body),signal:AbortSignal.timeout(20000)}),value=await response.json();
      if(!response.ok){if(!canCorrectSaveFailure(response.status,value.error?.code)){setSessionEnded(response.status===401);setError('Copy outcome is unconfirmed. Reconnect or sign in, then check the same request.');return;}sessionStorage.removeItem(storageKey);setCommand(null);setConflict(response.status===409);setError(value.error?.fieldErrors?.[0]?.message??value.error?.message??'Could not duplicate this project.');return;}
      sessionStorage.removeItem(storageKey);setCommand(null);setCreated(value.data.id);setOpen(false);setMessage('A separate draft is ready. It needs its own review and approval.');router.push(`/projects/${value.data.id}`);router.refresh();
    }catch{setError('Copy outcome is unconfirmed. Reconnect and check the same request.');}finally{busy.current=false;setSending(false);}
  }
  async function reload(){if(busy.current||command||!enabled)return;busy.current=true;setSending(true);try{const response=await fetch(`/api/v1/projects/${project.id}`,{cache:'no-store',signal:AbortSignal.timeout(15000)});if(!response.ok)throw new Error();const saved=(await response.json()).data;sessionStorage.removeItem(storageKey);onSaved(saved);setConflict(false);setError('');setMessage(`Saved source: ${saved.displayTitle}. Review its changes before creating a copy.`);}catch{setError('Could not reload the source. Your copy title is retained.');}finally{busy.current=false;setSending(false);}}
  return <div className="project-duplicate">
    {!open&&<Button variant="secondary" disabled={!checked||!enabled} onClick={()=>{setTitle(defaultDuplicateTitle(project.displayTitle));setOpen(true);setError('');setMessage('');setCreated(null);}}>Duplicate project</Button>}
    {open&&<form className="draft-editor rename-form" aria-label="Duplicate project" onSubmit={submit} aria-busy={sending}><h2>Start a separate copy.</h2><label htmlFor="duplicate-title">Copy title</label><input id="duplicate-title" value={title} disabled={sending||!!command||conflict} onChange={e=>setTitle(e.target.value)} autoFocus aria-describedby="duplicate-hint"/>
      <p className="muted-copy" id="duplicate-hint">Copies the saved brief, voice/settings and captured brand. A plan is copied only when it matches the saved brief and settings. Unsaved edits and outdated proposals stay in the original.</p><p className="muted-copy">Approvals, audio, videos, history and publishing work stay in the original. Creating this draft uses no AI credits.</p>
      <div className="editor-actions"><Button type="submit" disabled={sending||!enabled||conflict}>{sending?'Checking copy…':command?'Check same copy request':'Create copy'}</Button>{conflict&&!command&&<Button variant="secondary" disabled={sending||!enabled} onClick={()=>void reload()}>Reload saved source</Button>}{!command&&<Button variant="secondary" disabled={sending} onClick={()=>{setOpen(false);setConflict(false);setError('');setMessage('');}}>Cancel copy</Button>}{sessionEnded&&<Link className="text-button" href="/sign-in" target="_blank" rel="noopener">Sign in in a new tab</Link>}</div></form>}
    {error&&<p className="form-error" role="alert">{error}</p>}{message&&<p role="status" className="muted-copy">{message}</p>}{created&&<Link className="text-button" href={`/projects/${created}`}>Open duplicated project</Link>}
  </div>;
}
