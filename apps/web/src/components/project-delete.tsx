'use client';
import {useEffect,useRef,useState,type FormEvent} from 'react';
import Link from 'next/link';
import {useRouter} from 'next/navigation';
import type {ProjectDetail} from '@/server/projects/contracts';
import {recoverDeleteCommand,type DeleteCommand} from '@/lib/delete-command';
import {canCorrectSaveFailure} from '@/lib/save-outcome';
import {deleteQuery,type DeletionImpact} from '@/server/projects/deletion';
import {Button} from './ui';
export function ProjectDelete({project,scope,enabled,onLocked,onSaved}:{project:ProjectDetail;scope:string;enabled:boolean;onLocked:(locked:boolean)=>void;onSaved:(project:ProjectDetail)=>void}){
  const storageKey=`${scope}:delete-command:v1`,busy=useRef(false),router=useRouter();
  const [checked,setChecked]=useState(false),[open,setOpen]=useState(false),[confirmed,setConfirmed]=useState(false),[command,setCommand]=useState<DeleteCommand|null>(null);
  const [sending,setSending]=useState(false),[conflict,setConflict]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[sessionEnded,setSessionEnded]=useState(false),[done,setDone]=useState(false);
  const [impact,setImpact]=useState<DeletionImpact|null>(null),[impactLoading,setImpactLoading]=useState(false),[cancelQueued,setCancelQueued]=useState(false);
  const queued=!!impact&&(impact.queuedPlanning>0||impact.queuedGenerations>0);
  async function loadImpact(revision=project.revision){
    setImpactLoading(true);setImpact(null);setConfirmed(false);setCancelQueued(false);
    try{const response=await fetch(`/api/v1/projects/${project.id}/deletion-impact`,{cache:'no-store',signal:AbortSignal.timeout(15000)});if(!response.ok)throw new Error();const next=(await response.json()).data as DeletionImpact;setImpact(next);if(next.projectRevision!==revision){setConflict(true);setError('The project changed. Reload and review before deleting.');}else setError('');}
    catch{setError('Could not check current work. Refresh work impact before deleting.');}finally{setImpactLoading(false);}
  }
  useEffect(()=>{try{const raw=sessionStorage.getItem(storageKey);if(raw){const recovered=recoverDeleteCommand(raw);setOpen(true);if(recovered){setCommand(recovered);setMessage('A deletion request is unconfirmed. Check the same request before continuing.');}else{setConflict(true);setError('Deletion recovery is unreadable. Reload and review the saved project before continuing.');}}}catch{setError('Tab recovery is unavailable. Deletion needs local command recovery.');}setChecked(true);},[storageKey]);
  useEffect(()=>{onLocked(!checked||open||done);},[checked,open,done,onLocked]);
  useEffect(()=>{const warn=(e:BeforeUnloadEvent)=>{if(command)e.preventDefault();};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[command]);
  async function submit(event:FormEvent){
    event.preventDefault();if(busy.current||!checked||!enabled||conflict||!command&&(!confirmed||impactLoading||!impact?.canDelete||queued&&!cancelQueued))return;
    const next=command??{key:crypto.randomUUID(),input:{expectedProjectRevision:project.revision,...(queued?{acknowledgeActiveWork:true as const,expectedWorkRevision:impact!.workRevision}:{})}};
    try{sessionStorage.setItem(storageKey,JSON.stringify(next));}catch{setError('Cannot save deletion recovery. Keep this tab open and enable tab storage before deleting.');return;}
    busy.current=true;setSending(true);setCommand(next);setError('');setMessage('');setSessionEnded(false);
    try{
      const response=await fetch(`/api/v1/projects/${project.id}?${deleteQuery(next.input)}`,{method:'DELETE',headers:{'Idempotency-Key':next.key},signal:AbortSignal.timeout(20000)}),value=await response.json();
      if(!response.ok){if(!canCorrectSaveFailure(response.status,value.error?.code)){setSessionEnded(response.status===401);setError('Deletion outcome is unconfirmed. Reconnect or sign in, then check the same request.');return;}sessionStorage.removeItem(storageKey);setCommand(null);setConfirmed(false);setConflict(response.status===409);setError(value.error?.message??'Could not delete this project.');return;}
      sessionStorage.removeItem(storageKey);setCommand(null);setDone(true);setMessage(value.data.message);router.refresh();
    }catch{setError('Deletion outcome is unconfirmed. Reconnect and check the same request.');}finally{busy.current=false;setSending(false);}
  }
  async function reload(){if(busy.current||command||!enabled||impactLoading)return;busy.current=true;setSending(true);try{const response=await fetch(`/api/v1/projects/${project.id}`,{cache:'no-store',signal:AbortSignal.timeout(15000)});if(response.status===404){router.refresh();return;}if(!response.ok)throw new Error();const saved=(await response.json()).data;sessionStorage.removeItem(storageKey);onSaved(saved);setConflict(false);setConfirmed(false);setError('');await loadImpact(saved.revision);setMessage(`Saved project: ${saved.displayTitle}. Review it and confirm again before deleting.`);}catch{setError('Could not reload the saved project. Deletion remains paused.');}finally{busy.current=false;setSending(false);}}
  return <div className="project-delete">
    {!open&&!done&&<Button variant="secondary" disabled={!checked||!enabled} onClick={()=>{setOpen(true);setConfirmed(false);setError('');setMessage('');void loadImpact();}}>Delete project</Button>}
    {open&&!done&&<form className="draft-editor rename-form delete-form" aria-label="Delete project" onSubmit={submit} aria-busy={sending||impactLoading}><h2>Remove this project from the team?</h2><p><strong>{project.displayTitle}</strong> · saved revision {project.revision}</p><p className="muted-copy">Everyone in the workspace will lose access to its brief, plans and videos. There is no restore action in this version.</p><p className="muted-copy">Files and records will be retained until physical cleanup is implemented. Shared branding and other projects stay available. This does not remove any Instagram post.</p><p className="muted-copy">Only work that has never started can be cancelled here. Running, uncertain, previously started or unstored work must be resolved first.</p>
    {!command&&<div aria-live="polite">{impactLoading?<p className="muted-copy">Checking current work…</p>:impact?<><p className="muted-copy">Queued planning: {impact.queuedPlanning} · Queued videos: {impact.queuedGenerations}</p>{!impact.canDelete&&<p className="form-error">{impact.blockReason}</p>}{queued&&impact.canDelete&&<label className="delete-confirm"><input type="checkbox" checked={cancelQueued} disabled={sending||conflict} onChange={e=>setCancelQueued(e.target.checked)}/>Cancel this reviewed queued work before removing team access.</label>}</>:null}<Button variant="secondary" disabled={sending||impactLoading||conflict} onClick={()=>void loadImpact()}>Refresh work impact</Button></div>}
    {!command&&<label className="delete-confirm"><input type="checkbox" checked={confirmed} disabled={sending||conflict} onChange={e=>setConfirmed(e.target.checked)}/>I understand this removes team access and cannot be restored in the app.</label>}
    <div className="editor-actions"><Button type="submit" disabled={sending||!enabled||conflict||!command&&(!confirmed||impactLoading||!impact?.canDelete||queued&&!cancelQueued)}>{sending?'Checking deletion…':command?'Check same deletion request':'Delete for everyone'}</Button>{conflict&&!command&&<Button variant="secondary" disabled={sending||!enabled||impactLoading} onClick={()=>void reload()}>Reload before deleting</Button>}{!command&&<Button variant="secondary" disabled={sending||impactLoading} onClick={()=>{setOpen(false);setConflict(false);setConfirmed(false);setError('');setMessage('');}}>Keep project</Button>}{sessionEnded&&<Link className="text-button" href="/sign-in" target="_blank" rel="noopener">Sign in in a new tab</Link>}</div></form>}
    {error&&<p className="form-error" role="alert">{error}</p>}{message&&<p className="muted-copy" role="status">{message}</p>}{done&&<Link className="text-button" href="/projects">Return to projects</Link>}
  </div>;
}
