'use client';
import {VideoPlayer} from './video-player';

import {useEffect, useRef, useState} from 'react';
import Link from 'next/link';
import type {ProjectDetail} from '@/server/projects/contracts';
import {acknowledge, changes, editable, readRecovery, recoveryKey, sameDraft, type Draft, type PendingEdit, type Recovery} from '@/lib/project-draft';
import {Button, Panel, PageHeading} from './ui';
import {CopyDraft} from './copy-draft';
import {VoiceControls} from './voice-controls';
import {PlanningPanel} from './planning-panel';
import {ProjectRename} from './project-rename';

type Mode = 'ready' | 'saving' | 'error' | 'session' | 'conflict' | 'review';
type State = {base: ProjectDetail; draft: Draft; pending: PendingEdit | null; mode: Mode; message: string; latest: ProjectDetail | null};
export function ProjectEditor({project, workspaceId, userId}: {project: ProjectDetail; workspaceId: string; userId: string}) {
  const scope = recoveryKey(workspaceId, userId, project.id);
  const initial: State = {base: project, draft: editable(project), pending: null, mode: 'ready', message: '', latest: null};
  const [state, setState] = useState(initial), current = useRef(initial), busy = useRef(false);
  const [loaded, setLoaded] = useState(false), [recovery, setRecovery] = useState<Recovery | null>(null), [storageWarning, setStorageWarning] = useState('');
  const [planningPending, setPlanningPending] = useState(false);
  const [renamePending, setRenamePending] = useState(true);
  const recoveryPending = useRef(false);
  const dirty = !sameDraft(state.base, state.draft);
  function update(next: State) {
    current.current = next; setState(next);
    try {
      if (sameDraft(next.base, next.draft) && !next.pending && next.mode !== 'review') sessionStorage.removeItem(scope);
      else sessionStorage.setItem(scope, JSON.stringify({version: 1, scope, base: next.base, draft: next.draft, pending: next.pending, review: next.mode === 'review' || next.mode === 'conflict'} satisfies Recovery));
    } catch {setStorageWarning('Tab recovery is unavailable. Keep this page open or copy your draft before leaving.');}
  }
  useEffect(() => {
    try {const saved = readRecovery(sessionStorage.getItem(scope), scope, project.id); setRecovery(saved); recoveryPending.current = !!saved;}
    catch {setStorageWarning('Tab recovery is unavailable. Copy your draft before leaving.');}
    setLoaded(true);
  }, [scope, project.id]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {const s = current.current; if (recoveryPending.current || s.pending || !sameDraft(s.base, s.draft)) event.preventDefault();};
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, []);
  async function loadLatest() {
    try {
      const response = await fetch(`/api/v1/projects/${project.id}`, {cache: 'no-store', signal: AbortSignal.timeout(20000)});
      if (!response.ok) throw new Error();
      const value = await response.json(); update({...current.current, latest: value.data});
    } catch {update({...current.current, message: 'Your edits are retained. Could not load the saved version; retry the comparison.'});}
  }
  async function save() {
    if (busy.current || recoveryPending.current || !loaded) return;
    const s = current.current;
    if (s.mode === 'conflict') return;
    if (!s.pending && sameDraft(s.base, s.draft)) {update({...s, mode: 'ready', message: ''}); return;}
    const command: PendingEdit = s.pending ?? {key: crypto.randomUUID(), body: {expectedProjectRevision: s.base.revision, patch: changes(s.base, s.draft)}, submitted: editable(s.draft)};
    busy.current = true;
    update({...s, pending: command, mode: 'saving', message: ''});
    try {
      if (!navigator.onLine) throw new Error('offline');
      const response = await fetch(`/api/v1/projects/${project.id}`, {method: 'PATCH', headers: {'Content-Type': 'application/json', 'Idempotency-Key': command.key}, body: JSON.stringify(command.body), signal: AbortSignal.timeout(20000)});
      const value = await response.json();
      const latest = current.current;
      if (response.ok) {
        update({...latest, base: value.data, draft: acknowledge(latest.draft, command.submitted, value.data), pending: null, mode: 'ready', message: ''});
      } else if (value.error?.code === 'STALE_REVISION') {
        update({...latest, pending: null, mode: 'conflict', latest: null, message: 'A newer version is saved. Compare it with your edits before continuing.'});
        await loadLatest();
      } else if (response.status === 401) {
        update({...latest, mode: 'session', message: 'Your session ended. Sign in in a new tab, then retry the same save.'});
      } else if (response.status >= 500) {
        update({...latest, mode: 'error', message: 'The save could not be confirmed. Retry will check the same request before saving later edits.'});
      } else {
        update({...latest, pending: null, mode: 'error', message: value.error?.fieldErrors?.[0]?.message ?? value.error?.message ?? 'Your changes could not be saved.'});
      }
    } catch {
      update({...current.current, mode: 'error', message: navigator.onLine ? 'Connection interrupted. Your edits are retained. Retry the same save.' : 'You are offline. Your edits are retained in this tab. Reconnect and retry.'});
    } finally {busy.current = false;}
  }
  useEffect(() => {
    if (!loaded || recovery || renamePending || state.mode !== 'ready' || !dirty) return;
    const timer = setTimeout(() => {void save();}, 2000);
    return () => clearTimeout(timer);
    // save reads the latest ref; this timer restarts only when editable state changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, recovery, renamePending, state.draft, state.mode, dirty]);
  function edit(draft: Draft) {
    const s = current.current;
    update({...s, draft, mode: s.mode === 'error' && !s.pending ? 'ready' : s.mode, message: s.mode === 'error' && !s.pending ? '' : s.message});
  }
  const brief = state.draft.brief, settings = state.draft.settings;
  const locked = !loaded || !!recovery || state.mode === 'conflict' || planningPending || renamePending;
  const status = recovery ? 'Local draft available' : state.mode === 'saving' ? 'Saving…' : state.mode === 'review' ? 'Review your edits · autosave paused' : state.mode === 'conflict' ? 'Newer saved version · resolve changes' : state.mode === 'error' || state.mode === 'session' ? 'Changes not confirmed' : dirty ? 'Unsaved changes' : 'All changes saved';
  return <>
    <div lang={settings.language === 'te' ? 'te' : undefined}><PageHeading eyebrow="YOUR EXPLANATION" title={state.base.displayTitle} description="A saved idea, ready for its next chapter." action={<span className="draft-badge">Draft</span>}/></div>
    <ProjectRename project={state.base} scope={scope} enabled={loaded&&!recovery&&!dirty&&!state.pending&&state.mode==='ready'&&!planningPending} onLocked={setRenamePending} onSaved={saved=>{const s=current.current;update({...s,base:saved,draft:editable(saved)});}}/>
    <ol className="project-stages" aria-label="Project workflow"><li aria-current="step"><span>01</span>Plan</li><li><span>02</span>Generate</li><li><span>03</span>Publish</li></ol>
    <div className="project-detail-grid">
    <Panel className="project-idea draft-editor" aria-labelledby="edit-idea-heading">
      <div className="editor-heading"><div><span className="section-index">THE IDEA</span><h2 id="edit-idea-heading">Shape your explanation.</h2></div><span className="save-status" role="status" aria-live="polite">{status}</span></div>
      {storageWarning && <p className="form-error" role="alert">{storageWarning}</p>}
      {recovery && <div className="recovery-panel"><h3>Unsaved work found in this tab</h3><p>Restore it to continue. A pending save will be checked using its original request.</p><div className="editor-actions"><Button onClick={() => {
        const found = recovery; recoveryPending.current = false; setRecovery(null);
        update({...initial, base: found.base, draft: found.draft, pending: found.pending, mode: found.pending ? 'error' : found.review ? 'review' : 'ready', message: found.pending ? 'Recovered a pending save. Retry to check its outcome.' : ''});
      }}>Restore my draft</Button>{!recovery.pending && <Button variant="secondary" onClick={() => {recoveryPending.current = false; setRecovery(null); update(initial);}}>Discard local draft</Button>}<CopyDraft text={JSON.stringify(recovery.draft, null, 2)}/></div></div>}
      {state.message && <div className="recovery-panel" role="alert"><p>{state.message}</p><div className="editor-actions">{state.mode !== 'conflict' && <Button variant="secondary" disabled={state.mode === 'saving'} onClick={() => void save()}>Retry save</Button>}{state.mode === 'session' && <Link className="text-button" href="/sign-in" target="_blank" rel="noopener">Sign in in a new tab</Link>}{state.mode === 'conflict' && !state.latest && <Button variant="secondary" onClick={() => void loadLatest()}>Load saved version</Button>}<CopyDraft text={JSON.stringify(state.draft, null, 2)}/></div></div>}
      {state.mode === 'conflict' && state.latest && <div className="recovery-panel"><h3>Compare changes</h3><p>Saved revision {state.latest.revision} · {state.latest.updatedBy.name}</p><div className="conflict-columns">{[{title: 'Saved version', value: state.latest}, {title: 'Your unsaved edits', value: state.draft}].map(item => <div key={item.title}><h4>{item.title}</h4><p className="conflict-text">{item.value.brief.idea}</p><p>Audience: {item.value.brief.audience}</p><p>{item.value.settings.language === 'te' ? 'Telugu' : 'English'} · {item.value.settings.targetSeconds}s</p>{item.value.brief.references.map(ref => <p className="conflict-text" key={ref.referenceId}>{ref.text}{ref.suppliedUrl && <> · {ref.suppliedUrl}</>}</p>)}</div>)}</div><div className="editor-actions"><Button variant="secondary" onClick={() => {const latest = current.current.latest!; update({...initial, base: latest, draft: editable(latest)});}}>Use saved version</Button><Button onClick={() => {const s = current.current; update({...s, base: s.latest!, mode: 'review', latest: null, message: ''});}}>Keep my edits for review</Button></div></div>}
      <fieldset disabled={locked}>
        <label htmlFor="edit-idea">Your video idea</label><textarea id="edit-idea" rows={6} lang={settings.language} value={brief.idea} onChange={e => edit({...state.draft, brief: {...brief, idea: e.target.value}})} aria-describedby="edit-hint"/>
        <p id="edit-hint" className="muted-copy">One clear concept. Up to 2,000 characters. Changes save after you pause typing.</p>
        <label htmlFor="edit-audience">Who is this for?</label><input id="edit-audience" value={brief.audience} onChange={e => edit({...state.draft, brief: {...brief, audience: e.target.value}})}/>
        <div className="editor-options"><label htmlFor="edit-language">Video language<select id="edit-language" value={settings.language} onChange={e => edit({...state.draft, settings: {...settings, language: e.target.value as 'en' | 'te', voiceCatalogId: null, accentId: null}})}><option value="en">English</option><option value="te">తెలుగు · Telugu</option></select></label><label htmlFor="edit-duration">Target length<select id="edit-duration" value={settings.targetSeconds} onChange={e => edit({...state.draft, settings: {...settings, targetSeconds: Number(e.target.value) as 30 | 60 | 90}})}>{[30, 60, 90].map(n => <option key={n} value={n}>{n} seconds</option>)}</select></label></div>
        <p className="muted-copy">{settings.language === 'te' ? 'Telugu narration with Telugu subtitles.' : 'English narration with English subtitles.'}</p>
        <VoiceControls settings={settings} onChange={next => edit({...state.draft, settings: next})}/>
        <details className="editor-references"><summary>References · {brief.references.length} / 10</summary><p className="muted-copy">Paste source text. Optional URLs record provenance; pages are not fetched.</p>{brief.references.map((ref, i) => <div className="reference-edit" key={ref.referenceId}><label htmlFor={`ref-${ref.referenceId}`}>Reference {i + 1}<textarea id={`ref-${ref.referenceId}`} rows={3} value={ref.text} onChange={e => edit({...state.draft, brief: {...brief, references: brief.references.map(r => r.referenceId === ref.referenceId ? {...r, text: e.target.value} : r)}})}/></label><label>Source URL (optional)<input value={ref.suppliedUrl ?? ''} onChange={e => edit({...state.draft, brief: {...brief, references: brief.references.map(r => r.referenceId === ref.referenceId ? {...r, suppliedUrl: e.target.value || null} : r)}})}/></label><Button variant="secondary" onClick={() => edit({...state.draft, brief: {...brief, references: brief.references.filter(r => r.referenceId !== ref.referenceId)}})}>Remove reference {i + 1}</Button></div>)}<Button variant="secondary" disabled={brief.references.length >= 10} onClick={() => edit({...state.draft, brief: {...brief, references: [...brief.references, {referenceId: `ref_${crypto.randomUUID()}`, text: '', suppliedUrl: null}]}})}>Add reference</Button></details>
      </fieldset>
      {state.mode === 'review' && <div className="recovery-panel"><p>Review is paused. Saving will replace the saved brief/options with the edits shown above.</p><Button onClick={() => void save()}>Save my edits</Button></div>}
      <PlanningPanel projectId={project.id} revision={state.base.revision} briefRevision={state.base.briefRevision} scope={scope}
        ready={loaded && !recovery && !renamePending && !dirty && !state.pending && state.mode === 'ready'} onPending={setPlanningPending}
        onProjectSaved={async () => {
          const response = await fetch(`/api/v1/projects/${project.id}`, {cache: 'no-store', signal: AbortSignal.timeout(15000)});
          if (!response.ok) throw new Error('Could not refresh the project revision.');
          const value = await response.json(), s = current.current;
          if (s.pending || !sameDraft(s.base, s.draft)) throw new Error('Brief edits are pending.');
          update({...s, base: value.data, draft: editable(value.data)});
        }}
        onIdea={(angle, jobId) => {
          if (busy.current || dirty || state.pending || planningPending) return;
          const draft = {...editable(state.base), brief: {...state.base.brief, idea: `${angle.title}\n${angle.hook}\n${angle.learningObjective}`}};
          const command: PendingEdit = {key: crypto.randomUUID(), body: {expectedProjectRevision: state.base.revision, patch: {brief: draft.brief, brainstormSelection: {jobId, angleId: angle.id}}}, submitted: editable(draft)};
          update({...current.current, draft, pending: command, mode: 'ready', message: ''});
        }}/>
    </Panel>
    <aside className="project-side"><VideoPlayer key={project.id} projectId={project.id}/><Panel className="project-settings"><h2>Video details</h2><dl className="project-facts"><div><dt>Language & subtitles</dt><dd>{settings.language === 'te' ? 'తెలుగు · Telugu' : 'English'}</dd></div><div><dt>Target length</dt><dd>{settings.targetSeconds} seconds</dd></div><div><dt>Brand palette</dt><dd>{settings.brandKitRevisionId ? 'Shared palette captured' : 'Default educational palette'}</dd></div><div><dt>Saved revision</dt><dd>{state.base.revision}</dd></div></dl><p className="muted-copy">Clean educational visuals · Readable captions</p>{(dirty || state.pending || storageWarning) && <CopyDraft text={JSON.stringify(state.draft, null, 2)}/>}</Panel></aside>
  </div></>;
}
