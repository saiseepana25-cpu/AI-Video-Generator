'use client';

import {useRef, useState, type FormEvent} from 'react';
import {useRouter} from 'next/navigation';
import Link from 'next/link';
import {Button} from './ui';
import {Icon} from './icon';

export function ProjectComposer({defaultLanguage = 'en', defaultSeconds = 60}: {defaultLanguage?: 'en' | 'te'; defaultSeconds?: 30 | 60 | 90}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [signedOut, setSignedOut] = useState(false);
  const [field, setField] = useState<string | null>(null);
  const request = useRef<{body: string; key: string} | null>(null);
  const submitting = useRef(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    const form = new FormData(event.currentTarget);
    const body = JSON.stringify({idea: form.get('idea'), settings: {
      language: form.get('language'), targetSeconds: Number(form.get('targetSeconds')), accentId: null, voiceCatalogId: null,
      brandKitRevisionId: null, themeId: 'clean-educational-v1', captionStyleId: 'readable-default-v1',
    }});
    if (request.current?.body !== body) request.current = {body, key: crypto.randomUUID()};
    submitting.current = true;
    setPending(true); setError(''); setField(null); setSignedOut(false);
    try {
      const response = await fetch('/api/v1/projects', {method: 'POST', headers: {'Content-Type': 'application/json', 'Idempotency-Key': request.current.key}, body, signal: AbortSignal.timeout(20000)});
      const value = await response.json();
      if (!response.ok) {
        if (response.status === 401) {setSignedOut(true); setError('Your session ended. Sign in again, then retry saving this idea.');}
        else if (response.status === 422) {setError(value.error?.fieldErrors?.[0]?.message ?? 'Check your idea and video options.'); setField(value.error?.fieldErrors?.[0]?.path ?? null);}
        else setError('We couldn’t confirm the save. Keep this page open and try again. Retrying the same idea uses the same request.');
        return;
      }
      router.push(`/projects/${value.data.id}`);
      router.refresh();
    } catch {setError('We couldn’t confirm the save. Check your connection and try again; the same request will be reused.');}
    finally {submitting.current = false; setPending(false);}
  }
  return <form onSubmit={submit} className="project-composer" aria-busy={pending}>
    <fieldset disabled={pending}>
      <label htmlFor="idea" className="sr-only">Your video idea</label>
      <textarea id="idea" name="idea" required rows={3} placeholder="For example, how does sunlight become electricity?" aria-describedby={error ? 'create-error' : 'idea-hint'} aria-invalid={field === '/idea' || undefined}/>
      <div className="composer-options">
        <label>Video language<select name="language" defaultValue={defaultLanguage}><option value="en">English</option><option value="te">తెలుగు · Telugu</option></select></label>
        <label>Target length<select name="targetSeconds" defaultValue={defaultSeconds}><option value="30">30 seconds</option><option value="60">60 seconds</option><option value="90">90 seconds</option></select></label>
        <span className="composer-language-hint">Narration and subtitles use the same language.</span>
      </div>
    </fieldset>
    {error && <p className="form-error" role="alert" id="create-error">{error}{signedOut && <> <Link href="/sign-in" target="_blank" rel="noopener">Sign in in a new tab</Link></>}</p>}
    <div className="idea-panel-bottom"><p id="idea-hint">Start with one clear idea.<span className="language-note">Save it now. Shape the explanation next.</span></p><Button type="submit" disabled={pending}>{pending ? 'Saving project…' : 'Create project'}<Icon name="arrow"/></Button></div>
  </form>;
}
