'use client';

import Link from 'next/link';
import {usePathname} from 'next/navigation';
import {useEffect,useRef,useState} from 'react';
import type {ActivityPage,Operations} from '@/server/activity/contracts';
import {Icon} from './icon';

class PanelFailure extends Error{constructor(public status:number){super('Activity request failed');}}
async function read<T>(url:string,signal?:AbortSignal,body?:unknown):Promise<T>{
  const response=await fetch(url,{method:body===undefined?'GET':'POST',credentials:'same-origin',cache:'no-store',signal:AbortSignal.any([...(signal?[signal]:[]),AbortSignal.timeout(20000)]),headers:body===undefined?undefined:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  if(!response.ok)throw new PanelFailure(response.status);
  return (await response.json()).data as T;
}
const filters=[['','All events'],['project_created,project_updated,project_deleted','Projects'],['planning_changed','Planning'],['generation_changed','Video generation'],['workspace_settings_changed,workspace_brand_changed','Team settings']] as const;
const labels:Record<string,string>={healthy:'Heartbeat connected',stale:'Heartbeat expired',not_started:'Not started',disabled:'Disabled by operator',draining:'Not accepting new work',observed:'Free evaluation observed',paused:'Paused',unverified:'Check required',exhausted:'No free allowance'};
function stamp(value:string,timezone:string){try{return new Intl.DateTimeFormat('en-IN',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',timeZone:timezone}).format(new Date(value));}catch{return new Date(value).toISOString();}}
export function ActivityPanel(){
  const pathname=usePathname(),dialog=useRef<HTMLDialogElement>(null),trigger=useRef<HTMLButtonElement>(null),request=useRef<AbortController|null>(null),epoch=useRef(0);
  const [open,setOpen]=useState(false),[unread,setUnread]=useState(false),[online,setOnline]=useState(true),[projectId,setProjectId]=useState(''),[types,setTypes]=useState('');
  const [view,setView]=useState<'activity'|'recovery'|'status'>('activity'),body=useRef<HTMLDivElement>(null);
  const [feed,setFeed]=useState<ActivityPage|null>(null),[operations,setOperations]=useState<Operations|null>(null),[projects,setProjects]=useState<{id:string;displayTitle:string}[]>([]);
  const [loading,setLoading]=useState(false),[marking,setMarking]=useState(false),[error,setError]=useState(''),[opsError,setOpsError]=useState(''),[readMessage,setReadMessage]=useState(''),[blocked,setBlocked]=useState(false);
  const [refresh,setRefresh]=useState(0);
  const currentProject=/^\/projects\/([0-9a-f-]{36})$/.exec(pathname)?.[1];
  useEffect(()=>{const update=()=>setOnline(navigator.onLine);update();window.addEventListener('online',update);window.addEventListener('offline',update);return()=>{window.removeEventListener('online',update);window.removeEventListener('offline',update);};},[]);
  useEffect(()=>{const controller=new AbortController(),version=epoch.current;void read<ActivityPage>('/api/v1/activity?limit=1',controller.signal).then(page=>{if(epoch.current===version)setUnread(page.latestSequence>page.readThroughSequence);}).catch(()=>{});return()=>controller.abort();},[pathname]);
  useEffect(()=>{
    if(open){dialog.current?.showModal();}else if(dialog.current?.open){request.current?.abort();dialog.current.close();trigger.current?.focus();}
  },[open]);
  useEffect(()=>{
    if(!open)return;const controller=new AbortController(),version=++epoch.current;request.current?.abort();request.current=controller;
    setFeed(null);setOperations(null);setError('');setOpsError('');setReadMessage('');setBlocked(false);setLoading(true);
    const timer=setTimeout(()=>controller.abort(),20000);
    const query=new URLSearchParams({limit:'20',...(projectId?{projectId}:{}),...(types?{types}:{})});
    void (async()=>{
      try{
        const results=await Promise.allSettled([read<ActivityPage>(`/api/v1/activity?${query}`,controller.signal),read<Operations>('/api/v1/operations',controller.signal),read<{items:{id:string;displayTitle:string}[]}>('/api/v1/projects?limit=50',controller.signal)]);
        if(controller.signal.aborted||epoch.current!==version)return;
        const denied=results.some(r=>r.status==='rejected'&&r.reason instanceof PanelFailure&&[401,403].includes(r.reason.status));
        if(denied){setBlocked(true);setFeed(null);setOperations(null);setProjects([]);setUnread(false);setError('Your session or team access needs attention. Sign in again to continue.');return;}
        if(results[0].status==='fulfilled'){setFeed(results[0].value);setUnread(results[0].value.latestSequence>results[0].value.readThroughSequence);}else setError(results[0].reason instanceof PanelFailure&&results[0].reason.status===404?'This project is no longer available. Choose All projects.':'Activity could not be refreshed. Try again; your saved work is unchanged.');
        if(results[1].status==='fulfilled')setOperations(results[1].value);else setOpsError('System status could not be checked. Refresh to try again.');
        if(results[2].status==='fulfilled')setProjects(results[2].value.items);
      }catch{if(epoch.current===version&&!controller.signal.aborted)setError('Activity could not be refreshed. Try again.');}
      finally{clearTimeout(timer);if(epoch.current===version){setLoading(false);if(controller.signal.aborted&&open)setError('The status check stopped or timed out. Refresh to try again.');}}
    })();
    return()=>{clearTimeout(timer);epoch.current++;controller.abort();};
  },[open,projectId,types,refresh]);
  async function more(){
    if(!feed?.page.nextCursor||loading||marking||!online)return;const version=epoch.current,controller=new AbortController();request.current=controller;setLoading(true);setError('');
    try{const query=new URLSearchParams({limit:'20',cursor:feed.page.nextCursor,...(projectId?{projectId}:{}),...(types?{types}:{})}),next=await read<ActivityPage>(`/api/v1/activity?${query}`,controller.signal);
      if(epoch.current!==version)return;setFeed(previous=>previous?{...next,items:[...previous.items,...next.items.filter(item=>!previous.items.some(old=>old.id===item.id))]}:next);
    }catch(failure){if(epoch.current!==version)return;if(failure instanceof PanelFailure&&[401,403].includes(failure.status)){setBlocked(true);setFeed(null);setOperations(null);setProjects([]);setUnread(false);}setError('Older activity could not be loaded. Refresh activity or sign in again if your session expired.');}
    finally{if(epoch.current===version)setLoading(false);}
  }
  async function markRead(){
    if(!feed||loading||marking||!online)return;const through=feed.latestSequence;setMarking(true);setReadMessage('');
    try{const result=await read<{readThroughSequence:number}>('/api/v1/activity/read',undefined,{throughSequence:through});setFeed(previous=>previous?{...previous,readThroughSequence:Math.max(previous.readThroughSequence,result.readThroughSequence)}:previous);setReadMessage('Read position saved. Newer updates will stay unread.');
      // A fresh high water keeps updates created during acknowledgement unread.
      try{const current=await read<ActivityPage>('/api/v1/activity?limit=1');setUnread(current.latestSequence>current.readThroughSequence);}
      catch(failure){if(failure instanceof PanelFailure&&[401,403].includes(failure.status))throw failure;setReadMessage('Read position saved. Refresh to check for newer updates.');}
    }catch(failure){if(failure instanceof PanelFailure&&[401,403].includes(failure.status)){setBlocked(true);setFeed(null);setOperations(null);setProjects([]);setUnread(false);setError('Your session or team access needs attention. Sign in again to continue.');}setReadMessage('Read position could not be confirmed. It is safe to mark read again after reconnecting.');}
    finally{setMarking(false);}
  }
  const close=()=>setOpen(false);
  return <><button ref={trigger} className="button button--secondary activity-trigger" onClick={()=>setOpen(true)} aria-haspopup="dialog" aria-expanded={open}><Icon name="activity"/><span>Activity</span>{unread&&<span className="activity-dot" aria-label="New activity"/>}</button>
    <dialog ref={dialog} className="activity-drawer" aria-labelledby="activity-title" onCancel={close} onClose={close} onKeyDown={event=>{
      if(event.key!=='Tab')return;
      const focusable=[...event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],select:not([disabled]),[tabindex="0"]')].filter(element=>element.getClientRects().length>0&&!element.closest('[hidden]'));
      const first=focusable[0],last=focusable.at(-1),active=document.activeElement;
      if(!first||!last)return;
      if(event.shiftKey&&(active===first||!event.currentTarget.contains(active))){event.preventDefault();last.focus();}
      else if(!event.shiftKey&&(active===last||!event.currentTarget.contains(active))){event.preventDefault();first.focus();}
    }}>
      <div className="activity-drawer-header"><div><span className="tiny-label">YOUR TEAM, IN MOTION</span><h2 id="activity-title">Activity & recovery</h2><p>Shared updates. A clear next step.</p></div><button type="button" className="button button--secondary" onClick={close} aria-label="Close activity">Close</button></div>
      <nav className="activity-sections" aria-label="Activity sections">{([['activity','Updates'],['recovery','Needs review'],['status','System status']] as const).map(([value,label])=><button key={value} type="button" aria-pressed={view===value} onClick={()=>{setView(value);body.current?.scrollTo(0,0);}}>{label}{value==='recovery'&&operations&&operations.recovery.items.length>0?` (${operations.recovery.items.length})`:''}</button>)}</nav>
      <div ref={body} className="activity-drawer-body">
        {!online&&<p role="status" className="activity-notice">You’re offline. Saved updates may be out of date. Reconnect, then refresh.</p>}
        <div hidden={view!=='activity'}>
        <div className="activity-actions"><button className="button button--secondary" disabled={loading||marking||!online} onClick={()=>setRefresh(n=>n+1)}>Refresh activity</button><button className="button button--secondary" disabled={!feed||loading||marking||blocked||!online||!!error||feed.readThroughSequence>=feed.latestSequence} onClick={markRead}>{marking?'Saving read position…':'Mark all read'}</button></div>
        <p className="activity-caption">Read status is personal. Mark all read includes all team updates through this snapshot, even when filtered.</p>
        {readMessage&&<p role="status" className="activity-notice">{readMessage}</p>}
        <div className="activity-filters"><label>Project<select value={projectId} disabled={loading||marking||blocked} onChange={event=>setProjectId(event.target.value)}><option value="">All projects</option>{projectId&&projectId!==currentProject&&!projects.some(p=>p.id===projectId)&&<option value={projectId}>Selected project · unavailable</option>}{currentProject&&!projects.some(p=>p.id===currentProject)&&<option value={currentProject}>This project</option>}{projects.map(project=><option key={project.id} value={project.id}>{project.displayTitle}</option>)}</select></label><label>Event<select value={types} disabled={loading||marking||blocked} onChange={event=>setTypes(event.target.value)}>{filters.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label></div>
        </div>
        {view!=='activity'&&<button className="button button--secondary" disabled={loading||marking||!online} onClick={()=>setRefresh(n=>n+1)}>Refresh status</button>}
        {error&&<div role="alert" className="activity-notice">{error}{blocked&&<p><Link href="/sign-in" onClick={close}>Return to sign-in</Link></p>}</div>}
        {opsError&&view!=='activity'&&<p role="alert" className="activity-notice">{opsError}</p>}
        {loading&&<p role="status">Checking team updates…</p>}
        {feed&&<section hidden={view!=='activity'} aria-label="Team activity"><p className="tiny-label">TEAM TIMELINE · {feed.timezone}</p>{feed.items.length===0?<div className="activity-empty"><h3>No updates here yet.</h3><p>{projectId||types?'Try All projects and All events.':'Saved project and video updates will appear here.'}</p></div>:<ol className="activity-timeline">{feed.items.map(item=><li key={item.id} className={`activity-event${item.sequence>feed.readThroughSequence?' is-unread':''}`}><div className="activity-event-top"><span>{item.sequence>feed.readThroughSequence?'New · ':''}{item.actor}</span><time dateTime={item.createdAt}>{stamp(item.createdAt,feed.timezone)}</time></div><h3>{item.projectTitle??(item.projectId===null&&item.type.startsWith('workspace_')?'Team settings':'Studio update')}</h3><p>{item.message}</p><Link href={item.safeActionRoute} onClick={close}>{item.projectId?'Open project':item.safeActionRoute==='/settings'?'Open settings':'View projects'} <span aria-hidden="true">↗</span></Link></li>)}</ol>}{feed.page.hasMore&&<button className="button button--secondary" disabled={loading||marking||!online||blocked} onClick={more}>Load older activity</button>}</section>}
        <section hidden={view!=='recovery'} className="activity-recovery" aria-labelledby="recovery-title"><span className="tiny-label">A WAY FORWARD</span><h3 id="recovery-title">Needs review</h3><p className="activity-caption">Current issues from recent projects. Opening a card does not retry work or use AI allowance.</p>{operations&&(operations.recovery.items.length?<ul className="activity-recovery-list">{operations.recovery.items.map(item=><li key={item.id}><span className="tiny-label">{item.kind}</span><h4>{item.projectTitle}</h4><p>{item.message}</p><Link href={item.safeActionRoute} onClick={close}>{item.actionLabel} ↗</Link></li>)}</ul>:<p>No current recovery issues were found in the recent projects checked.</p>)}</section>
        <section hidden={view!=='status'} className="activity-health" aria-labelledby="health-title"><span className="tiny-label">SYSTEM STATUS</span><h3 id="health-title">Behind the scenes</h3>{operations?<><div className="activity-health-grid"><div><h4>Video worker</h4><strong>{labels[operations.worker.state]}</strong><p>{operations.worker.activeRenders} active render reservations · {operations.queues.generationWaiting} waiting</p></div><div><h4>Planning worker</h4><strong>{labels[operations.planningWorker.state]}</strong><p>{operations.queues.planningWaiting} waiting</p></div>{operations.providers.map(provider=><div key={provider.id}><h4>{provider.id==='gemini'?'AI planning':'Voice generation'}</h4><strong>{labels[provider.state]}</strong><p>{provider.message}</p></div>)}</div><p className="activity-caption">Checked {stamp(operations.checkedAt,feed?.timezone??'Asia/Kolkata')}. Heartbeats and cached availability do not guarantee a new request can run. Project checks remain authoritative.</p><p className="activity-notice">Instagram publishing and scheduling are not connected yet.</p></>:!opsError&&<p>System status will appear after the check finishes.</p>}</section>
      </div>
    </dialog>
  </>;
}
