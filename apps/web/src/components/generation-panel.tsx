'use client';
import {useCallback, useEffect, useRef, useState} from 'react';
import {recoverGenerationCommand, type GenerationCommand} from '@/lib/generation-command';
import type {RenderCheck} from '@/server/rendering/service';
import type {GenerationView} from '@/server/generation/contracts';
import {Button} from './ui';

export function GenerationPanel({projectId, revision, scope, checked, enabled, onPending, onSaved}: {
  projectId: string; revision: number; scope: string; checked: RenderCheck | null; enabled: boolean;
  onPending: (value: boolean) => void; onSaved: () => Promise<void>;
}) {
  const [job, setJob] = useState<GenerationView | null>(null), [command, setCommand] = useState<GenerationCommand | null>(null);
  const [loaded, setLoaded] = useState(false), [sending, setSending] = useState(false), [message, setMessage] = useState('');
  const busy = useRef(false), storageKey = `${scope}:generation-command:v1`;
  const latest = useRef({revision, enabled, onSaved}); latest.current = {revision, enabled, onSaved};
  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/v1/projects/${projectId}/generations`, {cache: 'no-store', signal: AbortSignal.timeout(10000)});
      if (!response.ok) throw new Error(); const result = await response.json(); setJob(result.data.job); setLoaded(true);
      setMessage(previous => previous.startsWith('Could not confirm generation status.') ? '' : previous);
      if (result.data.job && !['queued', 'running', 'cancellation_requested'].includes(result.data.job.state) && result.data.job.projectRevision > latest.current.revision && latest.current.enabled) await latest.current.onSaved();
    } catch {setLoaded(false); setMessage('Could not confirm generation status. Reconnect and refresh before starting another request.');}
  }, [projectId]);
  useEffect(() => {
    try {const raw = sessionStorage.getItem(storageKey); if (raw) {const saved = recoverGenerationCommand(raw, projectId); if (saved) setCommand(saved); else {setMessage('Generation recovery needs attention. Keep this tab open and check status before starting another request.'); return;}}}
    catch {setMessage('Tab recovery is unavailable. Keep this tab open.'); return;}
    void load(); const timer = setInterval(() => void load(), 3000); return () => clearInterval(timer);
  }, [storageKey, projectId, load]);
  const active = !!job && ['queued', 'running', 'cancellation_requested'].includes(job.state);
  useEffect(() => {onPending(!loaded || !!command || sending || active); return () => onPending(false);}, [loaded, command, sending, active, onPending]);
  async function submit(next: GenerationCommand) {
    if (busy.current) return; busy.current = true; setSending(true);
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(next)); setCommand(next); setMessage('');
      const url = next.action === 'approve' ? `/api/v1/projects/${projectId}/generations` : `/api/v1/jobs/${next.targetId}/cancel`;
      const response = await fetch(url, {method: 'POST', headers: {'Content-Type': 'application/json', 'Idempotency-Key': next.key}, body: JSON.stringify(next.body), signal: AbortSignal.timeout(20000)});
      const result = await response.json();
      // An explicit admission refusal is definite; transport/server failures may hide a committed receipt.
      const definiteRefusal = ['GENERATION_WORKER_UNAVAILABLE', 'SPEECH_RESERVATION_UNAVAILABLE', 'RENDER_ASSETS_UNAVAILABLE'].includes(result.error?.code);
      if ((response.status >= 500 && !definiteRefusal) || response.status === 401) {setMessage('The request outcome is unconfirmed. Check the same request before continuing.'); return;}
      sessionStorage.removeItem(storageKey); setCommand(null);
      if (!response.ok) {setMessage(result.error?.message ?? 'The request was refused. Review the current plan and status.'); await load(); return;}
      await load(); await onSaved();
    } catch {setMessage('The request outcome is unconfirmed. Reconnect and check the same request.');}
    finally {busy.current = false; setSending(false);}
  }
  const canApprove = enabled && loaded && !active && !command && !sending && checked?.canGenerate && checked.generationInputHash && checked.projectId === projectId && checked.projectRevision === revision;
  return <section className="recovery-panel" aria-label="Video generation">
    <div className="editor-heading"><div><span className="section-index">YOUR VIDEO</span><h3>Approve and generate</h3></div><Button disabled={!canApprove} onClick={() => {
      if (canApprove && checked?.generationInputHash) void submit({projectId, key: crypto.randomUUID(), action: 'approve', targetId: projectId, body: {expectedProjectRevision: checked.projectRevision, planVersionId: checked.planVersionId, generationInputHash: checked.generationInputHash}});
    }}>Approve & generate video</Button></div>
    <p className="muted-copy">Approve the saved narration, matching subtitles and diagrams together. Generation uses the reviewed voice and settings, with free evaluation allowance only.</p>
    {!checked && !active && <p className="muted-copy">Check your video plan first. A compatible local generation worker must be running before approval is available.</p>}
    {job && <div aria-live="polite"><p><strong>Video · {job.state.replaceAll('_', ' ')}</strong></p><p className="muted-copy">{job.state === 'queued' ? 'Waiting for the local generation worker.' : job.state === 'running' ? `Working on ${job.stage.replaceAll('_', ' ')}. You can leave this page and return.` : job.state === 'cancellation_requested' ? 'Stopping generation. Submitted speech may still consume free allowance.' : job.state === 'rendered_local' ? 'Rendering finished. Private storage and playback availability are shown in the finished-video panel.' : job.state === 'cancelled' ? 'Generation stopped. Review a new plan version to request another take.' : 'Generation did not finish. Your reviewed plan is retained.'}</p>
      {job.error && <p role="alert">{job.error.message}</p>}
      {job.allowedActions.includes('cancel') && <Button variant="secondary" disabled={!!command || sending} onClick={() => void submit({projectId, key: crypto.randomUUID(), action: 'cancel', targetId: job.jobId, body: {expectedRevision: job.statusRevision}})}>{job.state === 'queued' ? 'Cancel queued video' : 'Request cancellation'}</Button>}</div>}
    {message && <p role="alert">{message}</p>}
    {command && <Button variant="secondary" disabled={sending} onClick={() => void submit(command)}>{sending ? 'Checking…' : 'Check same generation request'}</Button>}
    <Button variant="secondary" disabled={sending} onClick={() => void load()}>Refresh video status</Button>
  </section>;
}
