'use client';
import {useEffect,useRef,useState} from 'react';
import type {RevisionReview as Review} from '@/server/planning/revision-review';
import type {PlanPreview} from './plan-text-editor';
import {Button} from './ui';
export function RevisionReview({plan,enabled}:{plan:PlanPreview;enabled:boolean}) {
  const [result,setResult]=useState<Review|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState(''); const epoch=useRef(0);
  useEffect(()=>{epoch.current++;setResult(null);setError('');setLoading(false);return ()=>{epoch.current++;};},[plan.id,plan.projectRevision,enabled]);
  async function review() {
    const request=++epoch.current;setLoading(true);setError('');setResult(null);
    try {
      const response=await fetch(`/api/v1/plans/${plan.id}/revision-review`,{cache:'no-store',signal:AbortSignal.timeout(10000)});
      if(!response.ok)throw new Error();const next=(await response.json()).data as Review;
      if(request!==epoch.current)return;
      if(next.planVersionId!==plan.id||next.projectRevision!==plan.projectRevision)throw new Error();
      setResult(next);
    }catch{if(request===epoch.current)setError('Could not compare this revision. Refresh the saved plan and try again.');}
    finally{if(request===epoch.current)setLoading(false);}
  }
  return <section className="plan-history" aria-label="Revision change review"><span className="section-index">BEFORE YOUR NEXT VIDEO</span><h3>What changed?</h3>
    <p className="muted-copy">Compare the saved plan with your latest completed video. Your earlier video stays available.</p>
    <Button variant="secondary" disabled={!enabled||loading} onClick={()=>void review()}>{loading?'Comparing revision…':'Review video changes'}</Button>
    {error&&<p role="alert">{error}</p>}
    {enabled&&result&&<div role="status">{!result.baseline?<p>No completed video to compare yet. Review your first plan, then check it before generation.</p>:<>
      <p>Compared with video version {result.baseline.versionNumber}. {result.changes?.hasChanges?'Changes found.':'No content changes found.'}</p>
      {result.changes?.sourceBriefChanged&&<p>The source brief changed.</p>}
      {result.changes?.titleChanged&&<p>The title changed.</p>}{result.changes?.objectiveChanged&&<p>The learning objective changed.</p>}
      {result.changes?.sceneOrderChanged&&<p>The scene sequence changed.</p>}
      {!!result.changes?.settingsChanged.length&&<p>Video settings changed: {result.changes.settingsChanged.map(k=>({language:'language',targetSeconds:'duration',voiceCatalogId:'voice',accentId:'accent',brandKitRevisionId:'branding',themeId:'theme',captionStyleId:'caption style'})[k]).join(', ')}.</p>}
      <ul>{result.changes?.scenes.map(s=><li key={s.sceneId}>{s.sceneId.replace('scene_','Scene ')}: {[s.added&&'added',s.removed&&'removed',s.narrationChanged&&'narration and matching subtitles',s.headingChanged&&'heading',s.diagramChanged&&'diagram'].filter(Boolean).join(', ')}.</li>)}</ul>
    </>}<p className="muted-copy">This comparison uses no AI credits and does not approve a render. New generation currently synthesizes all narration again; audio reuse is not enabled. Check the video plan and explicitly approve it when ready.</p></div>}
  </section>;
}
