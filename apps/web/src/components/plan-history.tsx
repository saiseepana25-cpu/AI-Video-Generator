'use client';
import {useCallback, useEffect, useRef, useState} from 'react';
import {recoverRestore, type RestoreCommand} from '@/lib/plan-restore';
import type {PlanPreview} from './plan-text-editor';
import {Button} from './ui';

type Summary = {id: string; versionNumber: number; title: string; source: string; restoredFromPlanVersionId: string | null; createdAt: string; sourceBriefRevision: number};
type Historical = PlanPreview & {projectId: string; currentPlanVersionId: string | null; canRestore: boolean; createdAt: string};
export function PlanHistory({projectId, current, scope, enabled, onPending, onSaved}: {
  projectId: string; current: PlanPreview | null; scope: string; enabled: boolean; onPending: (pending: boolean) => void; onSaved: () => Promise<void>;
}) {
  const [items, setItems] = useState<Summary[]>([]), [cursor, setCursor] = useState<string | null>(null), [selected, setSelected] = useState<Historical | null>(null);
  const [open, setOpen] = useState(false), [loading, setLoading] = useState(false), [message, setMessage] = useState(''), [command, setCommand] = useState<RestoreCommand | null>(null);
  const [sending, setSending] = useState(false), [recovered, setRecovered] = useState(false);
  const epoch = useRef(0), previewEpoch = useRef(0), busy = useRef(false), key = `${scope}:plan-restore:v1`;
  useEffect(() => {
    try {const raw = sessionStorage.getItem(key); if (raw) {const c = recoverRestore(raw); if (c) {setCommand(c); setOpen(true); setMessage('An earlier restore was not confirmed. Check the same restore request.');} else setMessage('The saved restore command is unreadable. Keep this tab open and refresh history before continuing.');}}
    catch {setMessage('Restore recovery is unavailable. Keep this tab open.');}
    setRecovered(true);
  }, [key]);
  useEffect(() => {onPending(!recovered || !!command || sending);}, [recovered, command, sending, onPending]);
  const load = useCallback(async (after: string | null = null) => {
    const request = ++epoch.current; setLoading(true);
    try {
      const r = await fetch(`/api/v1/projects/${projectId}/versions?kind=plan&limit=10${after ? `&cursor=${encodeURIComponent(after)}` : ''}`, {cache: 'no-store', signal: AbortSignal.timeout(10000)}), v = await r.json();
      if (!r.ok) throw new Error(v.error?.message ?? 'Could not load plan history.');
      if (request !== epoch.current) return;
      setItems(previous => after ? [...previous, ...v.data.items.filter((item: Summary) => !previous.some(p => p.id === item.id))] : v.data.items); setCursor(v.data.page.nextCursor);
    } catch (error) {if (request === epoch.current) setMessage(error instanceof Error ? error.message : 'Could not load history.');}
    finally {if (request === epoch.current) setLoading(false);}
  }, [projectId]);
  useEffect(() => {if (open) void load();}, [open, current?.id, load]);
  async function preview(id: string) {
    const request = ++previewEpoch.current; setSelected(null); setMessage('Loading version…');
    try {
      const r = await fetch(`/api/v1/plans/${id}`, {cache: 'no-store', signal: AbortSignal.timeout(10000)}), v = await r.json();
      if (!r.ok || v.data.projectId !== projectId) throw new Error(v.error?.message ?? 'Could not load this version.');
      if (request !== previewEpoch.current) return;
      setSelected(v.data); setMessage('');
    } catch (error) {if (request === previewEpoch.current) setMessage(error instanceof Error ? error.message : 'Could not load this version.');}
  }
  async function restore(next: RestoreCommand) {
    if (busy.current) return; busy.current = true; setSending(true);
    try {
      // Persist before sending; a lost response must replay this exact command.
      sessionStorage.setItem(key, JSON.stringify(next)); setCommand(next); setMessage('');
      const r = await fetch(`/api/v1/plans/${next.sourceId}/restore`, {method: 'POST', headers: {'Content-Type': 'application/json', 'Idempotency-Key': next.key}, body: JSON.stringify(next.body), signal: AbortSignal.timeout(20000)}), v = await r.json();
      if (r.status >= 500 || r.status === 401) {setMessage(v.error?.message ?? 'Restore outcome unconfirmed. Check the same request.'); return;}
      if (!r.ok) {sessionStorage.removeItem(key); setCommand(null); setMessage(v.error?.message ?? 'Restore refused. Review the latest version.'); return;}
      await onSaved(); await load();
      sessionStorage.removeItem(key); setCommand(null); setSelected(null); setMessage(`Saved as plan version ${v.data.versionNumber}. Earlier versions are preserved.`);
    } catch {setMessage('Restore outcome unconfirmed. Reconnect and check the same request.');}
    finally {busy.current = false; setSending(false);}
  }
  const changed = !!selected && (selected.currentPlanVersionId !== current?.id || selected.projectRevision !== current?.projectRevision);
  return <section className="plan-history" aria-labelledby="history-heading">
    <div className="editor-heading"><div><span className="section-index">YOUR VERSIONS</span><h3 id="history-heading">Plan history</h3></div><Button variant="secondary" onClick={() => setOpen(!open)}>{open ? 'Hide history' : 'View history'}</Button></div>
    {message && <p role="status" className="muted-copy">{message}</p>}
    {command && <Button variant="secondary" disabled={sending} onClick={() => void restore(command)}>{sending ? 'Checking restore…' : 'Check same restore request'}</Button>}
    {open && <><p className="muted-copy">Review an earlier plan. Restoring saves a new version and keeps every original. No AI credits are used.</p>
      <Button variant="secondary" disabled={loading} onClick={() => void load()}>Refresh history</Button>
      {!loading && items.length === 0 && <p>No saved plan versions yet.</p>}
      <ol className="history-list">{items.map(item => <li key={item.id}><div><strong>Version {item.versionNumber}{item.id === current?.id ? ' · Current' : ''}</strong><p>{item.title}</p><small className="muted-copy">{item.restoredFromPlanVersionId ? 'Restored version' : item.source === 'ai' ? 'AI proposal' : 'Direct edit'} · Brief {item.sourceBriefRevision} · {new Date(item.createdAt).toLocaleString()}</small></div><Button variant="secondary" onClick={() => void preview(item.id)}>View version {item.versionNumber}</Button></li>)}</ol>
      {loading && <p role="status">Loading history…</p>}{cursor && <Button variant="secondary" disabled={loading} onClick={() => void load(cursor)}>Load older versions</Button>}
      {selected && <article className="history-preview" lang={selected.plan.language} aria-label={`Read-only version ${selected.versionNumber}`}><span className="section-index">READ-ONLY · VERSION {selected.versionNumber}</span><h3>{selected.plan.title}</h3><p>{selected.plan.learningObjective}</p>
        {selected.plan.scenes.map((scene, i) => <div className="plan-scene" key={scene.sceneId}><span className="section-index">SCENE {i + 1} · {scene.layout}</span><h4>{scene.heading}</h4><div className={`diagram-proposal diagram-${scene.layout}`}>{scene.labels.map((label, n) => <span key={n}>{label}</span>)}</div><p>{scene.narration}</p><details><summary>Matching subtitles</summary><p>{selected.plan.captions.find(c => c.sourceSegmentId === scene.sceneId)?.text}</p></details></div>)}
        {changed && <p className="form-error">The current project changed after this review. View this version again before restoring.</p>}
        {!selected.canRestore && !selected.isCurrent && <p className="muted-copy">Restore is unavailable while work is active, after video generation, or when the saved brief/settings differ.</p>}
        <Button disabled={!enabled || !recovered || !selected.canRestore || changed || !!command || sending || !selected.currentPlanVersionId} onClick={() => void restore({key: crypto.randomUUID(), sourceId: selected.id, body: {expectedProjectRevision: selected.projectRevision, expectedCurrentPlanVersionId: selected.currentPlanVersionId!}})}>Restore as new version</Button>
      </article>}
    </>}
  </section>;
}
