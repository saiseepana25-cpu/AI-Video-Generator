'use client';
import {useEffect, useRef, useState, type FormEvent} from 'react';
import {useRouter} from 'next/navigation';
import Link from 'next/link';
import {Button} from './ui';
import {Icon} from './icon';
import {CopyDraft} from './copy-draft';
import {recoveryKey} from '@/lib/project-draft';
import {composerBody,composerVoiceValid,type ComposerDraft} from '@/lib/composer-settings';
import {canCorrectSaveFailure} from '@/lib/save-outcome';

type Attempt = {body: string; key: string};
type LocalDraft = {scope: string; draft: ComposerDraft; attempt: Attempt | null};
export function ProjectComposer({workspaceId, userId, defaultLanguage = 'en', defaultSeconds = 60,defaultVoice=null,defaultAccent=null}: {workspaceId: string; userId: string; defaultLanguage?: 'en' | 'te'; defaultSeconds?: 30 | 60 | 90;defaultVoice?:string|null;defaultAccent?:string|null}) {
  const router = useRouter(), scope = recoveryKey(workspaceId, userId, 'new');
  const initial: ComposerDraft = {idea: '', language: defaultLanguage, seconds: defaultSeconds,voiceCatalogId:defaultVoice,accentId:defaultAccent};
  const [draft, setDraft] = useState(initial), [recovery, setRecovery] = useState<LocalDraft | null>(null), [loaded, setLoaded] = useState(false);
  const [pending, setPending] = useState(false), [error, setError] = useState(''), [storageWarning, setStorageWarning] = useState('');
  const [signedOut, setSignedOut] = useState(false), [locked, setLocked] = useState(false);
  const request = useRef<Attempt | null>(null), submitting = useRef(false);
  const bodyFor=composerBody;
  function persist(value: ComposerDraft, attempt = request.current) {
    try {
      if (!value.idea && !attempt) sessionStorage.removeItem(scope);
      else sessionStorage.setItem(scope, JSON.stringify({scope, draft: value, attempt} satisfies LocalDraft));
    } catch {setStorageWarning('Tab recovery is unavailable. Copy your idea before leaving.');}
  }
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(scope);
      if (raw && raw.length < 1000000) {
        const saved = JSON.parse(raw) as LocalDraft, d = saved.draft;
        if (saved.scope === scope && typeof d?.idea === 'string' && d.idea.length <= 80000 && ['en', 'te'].includes(d.language) && [30, 60, 90].includes(d.seconds) && composerVoiceValid(d) && (!saved.attempt || (/^[0-9a-f-]{36}$/.test(saved.attempt.key) && saved.attempt.body === bodyFor(d)))) setRecovery(saved);
      }
    } catch {setStorageWarning('Tab recovery is unavailable. Copy your idea before leaving.');}
    setLoaded(true);
  }, [scope]);
  function edit(value: ComposerDraft) {setDraft(value); setError(''); persist(value);}
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (submitting.current || recovery) return;
    request.current ??= {body: bodyFor(draft), key: crypto.randomUUID()};
    const attempt = request.current;
    persist(draft, attempt); submitting.current = true; setPending(true); setLocked(true); setError(''); setSignedOut(false);
    try {
      const response = await fetch('/api/v1/projects', {method: 'POST', headers: {'Content-Type': 'application/json', 'Idempotency-Key': attempt.key}, body: attempt.body, signal: AbortSignal.timeout(20000)});
      const value = await response.json();
      if (!response.ok) {
        if (response.status === 401) {setSignedOut(true); setError('Your session ended. Sign in again, then retry this save.');}
        else if (canCorrectSaveFailure(response.status,value.error?.code)) {request.current = null; setLocked(false); persist(draft, null); setError(value.error?.fieldErrors?.[0]?.message ?? value.error?.message ?? 'Check your idea and video options.');}
        else setError('We couldn’t confirm the save. Retry checks the same request.');
        return;
      }
      try {sessionStorage.removeItem(scope);} catch { /* A restored retry remains protected by the receipt. */ }
      request.current = null; router.push(`/projects/${value.data.id}`); router.refresh();
    } catch {setError('We couldn’t confirm the save. Check your connection and retry the same request.');}
    finally {submitting.current = false; setPending(false);}
  }
  return <form onSubmit={submit} className="project-composer" aria-busy={pending}>
    {storageWarning && <p className="form-error">{storageWarning}</p>}
    {recovery && <div className="recovery-panel"><h3>Continue your unsaved idea?</h3><p>Your draft is available in this tab.</p><div className="editor-actions"><Button onClick={() => {setDraft(recovery.draft); request.current = recovery.attempt; setLocked(!!recovery.attempt); setRecovery(null); if (recovery.attempt) setError('A pending save was recovered. Retry to check its outcome.');}}>Restore idea</Button>{!recovery.attempt && <Button variant="secondary" onClick={() => {setRecovery(null); persist(initial, null);}}>Discard local idea</Button>}<CopyDraft text={recovery.draft.idea}/></div></div>}
    <fieldset disabled={!loaded || pending || locked || !!recovery}>
      <label htmlFor="idea" className="sr-only">Your video idea</label>
      <textarea id="idea" name="idea" required rows={3} value={draft.idea} onChange={e => edit({...draft, idea: e.target.value})} placeholder="For example, how does sunlight become electricity?" aria-describedby={error ? 'create-error' : 'idea-hint'}/>
      <div className="composer-options"><label>Video language<select name="language" value={draft.language} onChange={e => edit({...draft, language: e.target.value as 'en' | 'te',voiceCatalogId:null,accentId:null})}><option value="en">English</option><option value="te">తెలుగు · Telugu</option></select></label><label>Target length<select name="targetSeconds" value={draft.seconds} onChange={e => edit({...draft, seconds: Number(e.target.value) as 30 | 60 | 90})}>{[30, 60, 90].map(n => <option key={n} value={n}>{n} seconds</option>)}</select></label><span className="composer-language-hint">Narration and subtitles use the same language.{draft.voiceCatalogId && <> Workspace voice default applied; change it after saving.</>}</span></div>
    </fieldset>
    {error && <p className="form-error" role="alert" id="create-error">{error}{signedOut && <> <Link href="/sign-in" target="_blank" rel="noopener">Sign in in a new tab</Link></>}</p>}
    <div className="idea-panel-bottom"><p id="idea-hint">Start with one clear idea.<span className="language-note">Save it now. Shape the explanation next.</span></p><Button type="submit" disabled={!loaded || pending || !!recovery}>{pending ? 'Saving project…' : locked ? 'Retry project save' : 'Create project'}<Icon name="arrow"/></Button></div>
    {error&&draft.voiceCatalogId&&!locked&&!pending&&<Button variant="secondary" onClick={()=>edit({...draft,voiceCatalogId:null,accentId:null})}>Clear default voice</Button>}
    {(error || storageWarning) && <CopyDraft text={draft.idea}/>}
  </form>;
}
