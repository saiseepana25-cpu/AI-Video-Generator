'use client';
import {useEffect, useRef, useState} from 'react';
import Link from 'next/link';
import type {ProjectSettings} from '@/server/projects/contracts';
import type {VoiceCatalog} from '@/server/providers/contracts';
import {Button} from './ui';
export const voiceReason = (code: string | null) => ({
  INTEGRATION_NOT_CONFIGURED: 'Connection not configured', FREE_TIER_UNCONFIRMED: 'Free access needs confirmation', MODEL_UNREVIEWED: 'Model needs review',
  CAPABILITY_UNVERIFIED: 'Availability needs checking', CAPABILITY_STALE: 'Availability needs refreshing', FREE_ALLOWANCE_EXHAUSTED: 'Free allowance exhausted', FREE_ALLOWANCE_UNVERIFIED: 'Free allowance could not be verified',
  PROVIDER_AUTH_INVALID: 'Connection needs attention', PROVIDER_ACCESS_DENIED: 'Access denied', PAID_ACCOUNT_BLOCKED: 'Account does not match free testing policy', PAID_ACCESS_BLOCKED: 'Paid access is blocked',
  PROVIDER_UNREACHABLE: 'Connection unavailable', PROVIDER_UNAVAILABLE: 'Temporarily unavailable', PROVIDER_INVALID_RESPONSE: 'Availability could not be verified', MODEL_UNAVAILABLE: 'Model unavailable', MODEL_RATE_UNVERIFIED: 'Free usage could not be verified',
  VOICE_UNVERIFIED: 'Voice access needs review', LANGUAGE_UNSUPPORTED: 'Language unavailable', VOICE_UNTESTED: 'Speech test needed for this language', ACCENT_UNVERIFIED: 'Accent not verified', PAID_VOICE_UNAVAILABLE: 'Unavailable for free API testing', MEDIA_USAGE_RESTRICTED: 'Evaluation only — publication unavailable',
}[code ?? ''] ?? (code ? 'Unavailable — verification needed' : 'Available for free evaluation'));

export function VoiceControls({settings, onChange}: {settings: ProjectSettings; onChange: (settings: ProjectSettings) => void}) {
  const [catalog, setCatalog] = useState<VoiceCatalog | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState(''), [signedOut, setSignedOut] = useState(false), [refresh, setRefresh] = useState(0);
  const sequence = useRef(0);
  useEffect(() => {
    const controller = new AbortController(), request = ++sequence.current;
    setLoading(true); setError(''); setSignedOut(false); setCatalog(null);
    void (async () => {
      try {
        const response = await fetch(`/api/v1/voices?language=${settings.language}&includeUnavailable=true`, {cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(25000)])});
        if (!response.ok) {if (response.status === 401) setSignedOut(true); throw new Error();}
        const value = await response.json(); if (request === sequence.current) setCatalog(value.data);
      } catch {if (!controller.signal.aborted && request === sequence.current) setError('Could not check voice availability. Your draft is retained.');}
      finally {if (request === sequence.current) setLoading(false);}
    })();
    return () => {controller.abort(); sequence.current++;};
  }, [settings.language, refresh]);
  const selected = catalog?.items.find(v => v.id === settings.voiceCatalogId);
  return <div className="voice-controls">
    <div className="editor-options"><label htmlFor="edit-voice">Voice<select id="edit-voice" disabled={loading || !catalog} value={settings.voiceCatalogId ?? ''} onChange={e => onChange({...settings, voiceCatalogId: e.target.value || null, accentId: null})} aria-describedby="voice-catalog-note"><option value="">Not selected</option>{!catalog && settings.voiceCatalogId && <option value={settings.voiceCatalogId}>Saved selection · checking availability</option>}{catalog?.items.map(v => <option key={v.id} value={v.id} disabled={!v.available}>{v.name}{v.available ? '' : ` · ${voiceReason(v.reasonCode)}`}</option>)}</select></label>
      <label htmlFor="edit-accent">Accent<select id="edit-accent" disabled={loading || !selected?.available} value={settings.accentId ?? ''} onChange={e => onChange({...settings, accentId: e.target.value || null})} aria-describedby="voice-catalog-note"><option value="">Not selected</option><option value="source-voice" disabled={!selected?.supportedAccentIds.includes('source-voice')}>Evaluation delivery · original voice</option><option value="en-IN" disabled>Indian English · not verified</option><option value="te-IN" disabled>Native Telugu · not verified</option></select></label></div>
    <p className="muted-copy" id="voice-catalog-note">Voice and accent are separate choices. Evaluation delivery does not claim a native Indian accent. Free test audio is for internal evaluation; publication is unavailable.</p>
    <div className="catalog-status" role="status" aria-live="polite">{loading ? <p>Checking voice availability…</p> : error ? <p className="form-error">{error}</p> : <><p>{selected ? `${selected.name}: ${voiceReason(selected.reasonCode)}` : catalog?.items.some(v => v.available) ? 'Choose an available evaluation voice. No voice is selected automatically.' : 'No verified free voice is currently available for this language.'}</p>{catalog?.providers.map(p => <p key={p.provider}>{p.provider === 'elevenlabs' ? 'Speech' : 'AI planning'}: {voiceReason(p.reasonCode)}</p>)}</>}
      <Button variant="secondary" disabled={loading} onClick={() => setRefresh(n => n + 1)}>Refresh availability</Button>{signedOut && <Link href="/sign-in" target="_blank" rel="noopener" className="text-button">Sign in in a new tab</Link>}
    </div>
  </div>;
}
