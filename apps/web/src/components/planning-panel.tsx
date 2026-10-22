'use client';

import {useCallback, useEffect, useRef, useState} from 'react';
import type {Angle, JobView, Plan} from '@/server/planning/contracts';
import {Button} from './ui';
import {PlanTextEditor, type PlanPreview} from './plan-text-editor';
import {RevisionReview} from './revision-review';
import {PlanHistory} from './plan-history';
import {PlanReadiness} from './plan-readiness';
import {GenerationPanel} from './generation-panel';
import type {RenderCheck} from '@/server/rendering/service';

type Preview = PlanPreview;
type Command = {key: string; url: string; body: {expectedProjectRevision?: number; expectedRevision?: number}};
export function PlanningPanel({projectId, revision, briefRevision, ready, scope, onPending, onIdea, onProjectSaved}: {
  projectId: string; revision: number; briefRevision: number; ready: boolean; scope: string;
  onPending: (value: boolean) => void; onIdea: (angle: Angle, jobId: string) => void; onProjectSaved: () => Promise<void>;
}) {
  const [job, setJob] = useState<JobView | null>(null), [plan, setPlan] = useState<Preview | null>(null), [message, setMessage] = useState('');
  const [command, setCommand] = useState<Command | null>(null), [sending, setSending] = useState(false), [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [historyPending, setHistoryPending] = useState(true);
  const [checking, setChecking] = useState(false);
  const [generationPending, setGenerationPending] = useState(true), [checked, setChecked] = useState<RenderCheck | null>(null);
  const busy = useRef(false), storageKey = `${scope}:planning-command:v1`;
  const load = useCallback(async () => {
    try {const r = await fetch(`/api/v1/projects/${projectId}/planning`, {cache: 'no-store', signal: AbortSignal.timeout(10000)});
      if (!r.ok) throw new Error(); const v = await r.json(); setJob(v.data.job); setPlan(v.data.plan);
      setMessage(m => m === 'Could not refresh planning status. Your saved work is retained.' ? '' : m);
    } catch {setMessage('Could not refresh planning status. Your saved work is retained.');}
  }, [projectId]);
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(storageKey);
      if (raw && raw.length < 4000) {
        const c = JSON.parse(raw) as Command;
        const allowed = new RegExp(`^/api/v1/(projects/${projectId}/(plans|brainstorm)|jobs/[0-9a-f-]{36}/(cancel|retry))$`);
        if (/^[0-9a-f-]{36}$/.test(c.key) && allowed.test(c.url) && c.body && Object.keys(c.body).length === 1 && Number.isSafeInteger(c.body.expectedRevision ?? c.body.expectedProjectRevision)) {
          setCommand(c); setMessage('An earlier request was not confirmed. Check that same request before starting another.');
        }
      }
    } catch {setMessage('Planning request recovery is unavailable. Keep this tab open.');}
    setLoaded(true); void load();
  }, [storageKey, projectId, load]);
  useEffect(() => {onPending(!!command || sending || editing || historyPending || checking || generationPending);}, [command, sending, editing, historyPending, checking, generationPending, onPending]);
  useEffect(() => {const timer = setInterval(() => {void load();}, 3000); return () => clearInterval(timer);}, [load]);
  async function submit(next: Command) {
    if (busy.current) return; busy.current = true; setSending(true);
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(next)); setCommand(next); setMessage('');
      const r = await fetch(next.url, {method: 'POST', headers: {'Content-Type': 'application/json', 'Idempotency-Key': next.key}, body: JSON.stringify(next.body), signal: AbortSignal.timeout(20000)});
      const v = await r.json();
      if (r.status >= 500 || r.status === 401) {setMessage(v.error?.message ?? 'Request outcome unconfirmed. Check the same request.'); return;}
      sessionStorage.removeItem(storageKey); setCommand(null);
      if (!r.ok) {setMessage(v.error?.message ?? 'Could not start planning.'); return;}
      await load();
    } catch {setMessage('Request outcome unconfirmed. Reconnect and check the same request.');}
    finally {busy.current = false; setSending(false);}
  }
  const active = generationPending || !!job && ['queued', 'running', 'cancellation_requested'].includes(job.state);
  const outdated = !!plan && (!plan.isCurrent || plan.sourceBriefRevision !== briefRevision);
  return <section className="planning-panel" aria-labelledby="planning-heading">
    <span className="section-index">THE PLAN</span><h2 id="planning-heading">Turn your idea into an explanation.</h2>
    <p className="muted-copy">AI prepares narration, matching subtitles and diagram proposals. Review the facts before generating a video.</p>
    {!ready && <p className="muted-copy">Save or resolve your brief changes before starting a new request.</p>}
    <div className="editor-actions"><Button variant="secondary" disabled={!loaded || !ready || active || !!command || sending || editing || historyPending || checking} onClick={() => void submit({key: crypto.randomUUID(), url: `/api/v1/projects/${projectId}/brainstorm`, body: {expectedProjectRevision: revision}})}>Suggest three ideas</Button><Button disabled={!loaded || !ready || active || !!command || sending || editing || historyPending || checking} onClick={() => void submit({key: crypto.randomUUID(), url: `/api/v1/projects/${projectId}/plans`, body: {expectedProjectRevision: revision}})}>Prepare my plan</Button></div>
    {message && <p className="form-error" role="alert">{message}</p>}
    {command && <Button variant="secondary" disabled={sending} onClick={() => void submit(command)}>{sending ? 'Checking request…' : 'Check same request'}</Button>}
    {job && <div className="planning-status" aria-live="polite"><p><strong>{job.kind === 'plan' ? 'Video plan' : 'Idea suggestions'} · {job.state.replaceAll('_', ' ')}</strong></p><p className="muted-copy">Saved brief revision {job.sourceBriefRevision}{job.sourceBriefRevision !== briefRevision ? ' · Brief has since changed' : ''}</p>{active && <p className="muted-copy">{job.state === 'queued' ? 'Waiting for the local worker and free request window.' : job.state === 'cancellation_requested' ? 'Stopping. A submitted request may still consume free allowance.' : 'Preparing your explanation…'}</p>}{job.error && <p role="alert">{job.error.message}</p>}
      <div className="editor-actions">{job.allowedActions.map(action => <Button variant="secondary" key={action} disabled={!!command || sending || editing || historyPending || checking || action === 'retry' && !ready} onClick={() => void submit({key: crypto.randomUUID(), url: `/api/v1/jobs/${job.id}/${action}`, body: {expectedRevision: job.statusRevision}})}>{action === 'cancel' ? 'Cancel request' : 'Retry planning'}</Button>)}<Button variant="secondary" onClick={() => void load()}>Refresh status</Button></div>
      {job.state === 'ready' && job.result && 'angles' in job.result && <div className="planning-angles">{job.result.angles.map(angle => <article key={angle.id}><h3>{angle.title}</h3><p>{angle.hook}</p><p className="muted-copy">{angle.learningObjective}</p><Button variant="secondary" disabled={!ready || !!command || editing || historyPending || checking || briefRevision !== job.sourceBriefRevision} onClick={() => onIdea(angle, job.id)}>Use this idea</Button></article>)}</div>}
    </div>}
    {plan && <div className="plan-preview" lang={plan.plan.language}><div className="editor-heading"><h3>{plan.plan.title}</h3><span className="neutral-badge">{outdated ? 'Outdated proposal' : `Plan version ${plan.versionNumber}`}</span></div><p>{plan.plan.learningObjective}</p>{outdated && <p className="form-error">This plan uses an earlier brief. Prepare a new plan to include your changes.</p>}
      <PlanTextEditor plan={plan} enabled={ready && !outdated && !active && !command && !sending && !historyPending && !checking} scope={scope} onEditing={setEditing} onSaved={async () => {await onProjectSaved(); await load();}}/>
      {!editing && plan.plan.scenes.map((scene, i) => <article className="plan-scene" key={scene.sceneId}><span className="section-index">SCENE {i + 1} · {scene.layout}</span><h4>{scene.heading}</h4><div className={`diagram-proposal diagram-${scene.layout}`} aria-label={`${scene.layout} diagram proposal`}>{scene.labels.map((label, n) => <span key={n}>{label}</span>)}</div><p>{scene.narration}</p><details><summary>Matching subtitles</summary><p>{plan.plan.captions.find(c => c.sourceSegmentId === scene.sceneId)?.text}</p></details></article>)}
      <div className="recovery-panel">{plan.plan.reviewNotes.map(note => <p key={note}>{note}</p>)}</div>
      <RevisionReview plan={plan} enabled={ready && !outdated && !active && !command && !sending && !editing && !historyPending && !checking}/>
      <PlanReadiness plan={plan} enabled={ready && !outdated && !active && !command && !sending && !editing && !historyPending} onPending={setChecking} onChecked={setChecked}/>
    </div>}
    <PlanHistory projectId={projectId} current={plan} scope={scope} enabled={ready && !active && !command && !sending && !editing && !checking} onPending={setHistoryPending} onSaved={async () => {await onProjectSaved(); await load();}}/>
    <GenerationPanel projectId={projectId} revision={revision} scope={scope} checked={checked} enabled={ready && !command && !sending && !editing && !historyPending && !checking} onPending={setGenerationPending} onSaved={async () => {await onProjectSaved(); await load();}}/>
  </section>;
}
