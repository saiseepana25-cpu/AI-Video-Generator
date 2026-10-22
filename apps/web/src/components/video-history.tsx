'use client';
import {useEffect, useRef, useState} from 'react';
import type {VideoHistoryPage} from '@/server/videos/history';
import {Button} from './ui';
export function VideoHistory({projectId, selectedId, onSelect}: {projectId:string;selectedId:string|null;onSelect:(id:string|null)=>void}) {
  const [open,setOpen] = useState(false), [page,setPage] = useState<VideoHistoryPage>({items:[],page:{hasMore:false,nextCursor:null}});
  const [loading,setLoading] = useState(false), [error,setError] = useState(''), [loaded,setLoaded] = useState(false);
  const epoch = useRef(0);
  useEffect(() => () => {epoch.current++;}, []);
  async function load(cursor: string|null = null) {
    const request = ++epoch.current; setLoading(true); setError('');
    try {
      const response = await fetch(`/api/v1/projects/${projectId}/versions?kind=video&limit=10${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,{cache:'no-store',signal:AbortSignal.timeout(10000)});
      if (!response.ok) throw new Error(); const next = (await response.json()).data as VideoHistoryPage;
      if (request !== epoch.current) return;
      setPage(previous => ({...next,items:cursor ? [...previous.items,...next.items.filter(item => !previous.items.some(p => p.id===item.id))] : next.items})); setLoaded(true);
    } catch {if (request === epoch.current) setError('Could not load video history. Reconnect or sign in again, then refresh history.');}
    finally {if (request === epoch.current) setLoading(false);}
  }
  return <section className="plan-history" aria-label="Video history">
    <div className="editor-heading"><h3>Video history</h3><Button variant="secondary" onClick={() => {setOpen(!open); if (!open) void load();}}>{open ? 'Hide video history' : 'View video history'}</Button></div>
    {open && <><p className="muted-copy">Choose a completed version to play or download. Your latest video and saved plan stay unchanged.</p>
      <Button variant="secondary" disabled={loading} onClick={() => void load()}>Refresh video history</Button>
      {selectedId && <Button variant="secondary" onClick={() => onSelect(null)}>Show latest video</Button>}
      {error && <p role="alert">{error}</p>}{loading && <p role="status">Loading video history…</p>}
      {loaded && !loading && !page.items.length && <p>No completed video versions yet.</p>}
      <ol className="history-list">{page.items.map(item => <li key={item.id}><div><strong>Version {item.versionNumber}{item.isLatest ? ' · Latest ready' : ''}{item.id===selectedId ? ' · Selected' : ''}</strong>
        <p>{item.language==='te' ? 'Telugu narration & subtitles' : 'English narration & subtitles'} · {Math.round(item.durationSeconds)} seconds</p>
        <small className="muted-copy">{new Date(item.readyAt).toLocaleString()} · Internal evaluation</small></div>
        <Button variant="secondary" disabled={item.id===selectedId} onClick={() => onSelect(item.id)}>View video version {item.versionNumber}</Button></li>)}</ol>
      {page.page.nextCursor && <Button variant="secondary" disabled={loading} onClick={() => void load(page.page.nextCursor)}>Load older videos</Button>}
    </>}
  </section>;
}
