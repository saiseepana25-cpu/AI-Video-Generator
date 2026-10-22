'use client';
import {useEffect, useRef, useState} from 'react';
import type {RenderCheck} from '@/server/rendering/service';
import type {PlanPreview} from './plan-text-editor';
import {Button} from './ui';

export function PlanReadiness({plan, enabled, onPending, onChecked}: {plan: PlanPreview; enabled: boolean; onPending: (value: boolean) => void; onChecked: (value: RenderCheck | null) => void}) {
  const [result, setResult] = useState<RenderCheck | null>(null), [message, setMessage] = useState(''), [checking, setChecking] = useState(false);
  const epoch = useRef(0), busy = useRef(false);
  useEffect(() => {epoch.current++; setResult(null); setMessage(''); onChecked(null);}, [plan.id, plan.projectRevision, onChecked]);
  useEffect(() => {onPending(checking); return () => onPending(false);}, [checking, onPending]);
  async function check() {
    if (busy.current) return; busy.current = true; const request = ++epoch.current; setChecking(true); setResult(null); onChecked(null); setMessage('');
    try {
      const r = await fetch(`/api/v1/plans/${plan.id}/render-input`, {cache: 'no-store', signal: AbortSignal.timeout(15000)}), v = await r.json();
      if (request !== epoch.current) return;
      if (!r.ok) {setMessage(v.error?.message ?? 'Could not check this plan. Your saved work is unchanged.'); return;}
      if (v.data.planVersionId !== plan.id || v.data.projectRevision !== plan.projectRevision) {setMessage('The project changed. Review the latest saved plan and check again.'); return;}
      setResult(v.data); onChecked(v.data);
    } catch {if (request === epoch.current) setMessage('The check could not finish. Reconnect and try again; no video request was started.');}
    finally {busy.current = false; setChecking(false);}
  }
  const current = enabled && plan.isCurrent;
  return <section className="recovery-panel" aria-label="Video plan check">
    <div className="editor-heading"><div><span className="section-index">BEFORE GENERATION</span><h3>Check your video plan</h3></div><Button variant="secondary" disabled={!current || checking} onClick={() => void check()}>{checking ? 'Checking plan…' : 'Check video plan'}</Button></div>
    <p className="muted-copy">Check narration, matching subtitles, diagram support and video settings. This does not generate audio or use AI credits.</p>
    {message && <p role="alert">{message}</p>}
    {result && current && <div aria-live="polite"><p><strong>{result.status === 'compiled' ? 'Video input prepared' : 'A few changes are needed'}</strong></p>
      {result.summary && <><p>{result.summary.sceneCount} scenes · {result.summary.language === 'te' ? 'Telugu narration and Telugu subtitles' : 'English narration and English subtitles'} · {result.summary.output.width} × {result.summary.output.height} · {result.summary.output.fps} fps</p><p>{result.summary.brand.revisionId?'Saved shared palette · pinned to this approval':'Default educational palette'}</p><div className="brand-check-swatches" aria-label="Approved palette colors">{(['canvas','accent','secondary'] as const).map(role=><span key={role}><i style={{backgroundColor:result.summary!.brand.colors[role]}} aria-hidden="true"/>{role==='canvas'?'Background':role==='accent'?'Primary':'Secondary'} {result.summary!.brand.colors[role]}</span>)}</div></>}
      {result.issues.map(issue => <p key={issue.code} className="form-error">{issue.message}</p>)}
      {result.summary && <><p className="muted-copy">Free evaluation voice · internal testing only. Review the facts and diagram relationships. Final duration, subtitle readability and animation timing will be checked against the generated audio.</p>{result.executionBlocks.map(block => <p key={block.code} className="muted-copy">{block.message}</p>)}</>}
    </div>}
  </section>;
}
