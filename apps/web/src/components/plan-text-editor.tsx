'use client';
import {useEffect, useRef, useState} from 'react';
import type {Plan} from '@/server/planning/contracts';
import {recoverPlanText, textChanges, type TextBase, type TextRecovery} from '@/lib/plan-text-draft';
import {Button} from './ui';
import {CopyDraft} from './copy-draft';

export type PlanPreview = {id: string; projectRevision: number; versionNumber: number; sourceBriefRevision: number; isCurrent: boolean; canEdit: boolean; plan: Plan};
export function PlanTextEditor({plan, enabled, scope, onEditing, onSaved}: {plan: PlanPreview; enabled: boolean; scope: string;
  onEditing: (value: boolean) => void; onSaved: () => Promise<void>}) {
  const storageKey = `${scope}:plan-text:v1`, [work, setWork] = useState<TextRecovery | null>(null), current = useRef<TextRecovery | null>(null);
  const [loaded, setLoaded] = useState(false), [saving, setSaving] = useState(false), [message, setMessage] = useState('');
  const busy = useRef(false);
  function update(value: TextRecovery | null) {
    current.current = value; setWork(value);
    try {if (value) sessionStorage.setItem(storageKey, JSON.stringify(value)); else sessionStorage.removeItem(storageKey);}
    catch {setMessage('Tab recovery is unavailable. Copy your text before leaving.');}
  }
  useEffect(() => {
    try {const saved = recoverPlanText(sessionStorage.getItem(storageKey), storageKey); current.current = saved; setWork(saved);}
    catch {setMessage('Tab recovery is unavailable. Keep this tab open while editing.');}
    setLoaded(true);
  }, [storageKey]);
  useEffect(() => {onEditing(!!work);}, [work, onEditing]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {if (current.current) event.preventDefault();};
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, []);
  function start() {
    const base: TextBase = {id: plan.id, projectRevision: plan.projectRevision, versionNumber: plan.versionNumber, language: plan.plan.language,
      scenes: plan.plan.scenes.map(({sceneId, heading, narration}) => ({sceneId, heading, narration}))};
    setMessage(''); update({version: 1, scope: storageKey, base, scenes: structuredClone(base.scenes), pending: null});
  }
  async function save() {
    const w = current.current; if (!w || busy.current) return;
    const pending = w.pending ?? {key: crypto.randomUUID(), body: textChanges(w.base, w.scenes)};
    busy.current = true; setSaving(true); setMessage('');
    try {
      // Persist the exact command before sending. Never send when recovery storage fails.
      const next = {...w, pending}; sessionStorage.setItem(storageKey, JSON.stringify(next)); current.current = next; setWork(next);
      const response = await fetch(`/api/v1/plans/${w.base.id}/edits`, {method: 'POST', headers: {'Content-Type': 'application/json', 'Idempotency-Key': pending.key}, body: JSON.stringify(pending.body), signal: AbortSignal.timeout(20000)});
      const result = await response.json();
      if (!response.ok) {
        if (response.status < 500 && response.status !== 401) update({...next, pending: null});
        setMessage(result.error?.message ?? 'Save not confirmed. Check the same request before continuing.'); return;
      }
      await onSaved(); update(null); setMessage(`Saved plan version ${result.data.versionNumber}. The previous version is preserved.`);
    } catch {setMessage('Save not confirmed. Your edits are retained. Reconnect and check the same request.');}
    finally {busy.current = false; setSaving(false);}
  }
  const changed = !!work && Object.keys(textChanges(work.base, work.scenes).edits).length > 0;
  return <div className="plan-text-editor">
    {!work && <Button variant="secondary" disabled={!loaded || !enabled || !plan.canEdit} onClick={start}>Edit narration & headings</Button>}
    {message && <p role="status" className="muted-copy">{message}</p>}
    {work && <div className="recovery-panel" lang={work.base.language}><h4>Editing plan version {work.base.versionNumber}</h4><p>Saving creates a new version. Subtitles update to match your narration.</p>
      {(plan.id !== work.base.id || plan.projectRevision !== work.base.projectRevision || !plan.canEdit) && <p className="form-error" role="alert">The saved project or plan has changed. Your text is retained; copy it or discard this draft to review the latest plan.</p>}
      <fieldset disabled={saving || !!work.pending}>{work.scenes.map((scene, i) => <div className="plan-text-fields" key={scene.sceneId}>
        <label htmlFor={`plan-heading-${scene.sceneId}`}>Scene {i + 1} heading<input id={`plan-heading-${scene.sceneId}`} value={scene.heading} onChange={e => update({...work, scenes: work.scenes.map(s => s.sceneId === scene.sceneId ? {...s, heading: e.target.value} : s)})}/></label>
        <label htmlFor={`plan-narration-${scene.sceneId}`}>Scene {i + 1} narration<textarea id={`plan-narration-${scene.sceneId}`} rows={4} value={scene.narration} onChange={e => update({...work, scenes: work.scenes.map(s => s.sceneId === scene.sceneId ? {...s, narration: e.target.value} : s)})}/></label>
        <p className="muted-copy">Heading: up to 140 characters · Narration: up to 1,000 characters</p><details><summary>Matching subtitles</summary><p className="conflict-text">{scene.narration}</p></details>
      </div>)}</fieldset>
      <div className="editor-actions"><Button disabled={saving || !work.pending && !changed} onClick={() => void save()}>{saving ? 'Saving version…' : work.pending ? 'Check same save' : 'Save as new version'}</Button>
        {!work.pending && <Button variant="secondary" disabled={saving} onClick={() => {update(null); setMessage('');}}>Discard text edits</Button>}<CopyDraft text={work.scenes.map(s => `${s.heading}\n${s.narration}`).join('\n\n')}/></div>
    </div>}
  </div>;
}
