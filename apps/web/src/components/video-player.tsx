'use client';
import {useCallback, useEffect, useRef, useState} from 'react';
import type {VideoView} from '@/server/videos/contracts';
import {Button} from './ui';
import {VideoHistory} from './video-history';
export function VideoPlayer({projectId}: {projectId: string}) {
  const [video, setVideo] = useState<VideoView | null>(null), [loaded, setLoaded] = useState(false), [error, setError] = useState(''), [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0); const element = useRef<HTMLVideoElement>(null), position = useRef(0), currentId = useRef<string | null>(null);
  const requestSequence = useRef(0);
  const [selectedId, setSelectedId] = useState<string|null>(null), selected = useRef<string|null>(null);
  const [downloading, setDownloading] = useState(''), [downloadError, setDownloadError] = useState('');
  const downloadController = useRef<AbortController | null>(null);
  useEffect(() => () => downloadController.current?.abort(), []);
  async function download(kind: 'mp4'|'srt') {
    if (!video || downloadController.current) return;
    const controller = new AbortController(); downloadController.current = controller;
    setDownloading(kind); setDownloadError('');
    try {
      const response = await fetch(video.downloadUrls[kind], {cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(120000)])});
      if (!response.ok) throw new Error();
      const blob = await response.blob(); if (controller.signal.aborted) return;
      const url = URL.createObjectURL(blob), anchor = document.createElement('a');
      anchor.href = url; anchor.download = `videocraft-v${video.versionNumber}-${video.language}.${kind}`;
      document.body.appendChild(anchor); anchor.click(); anchor.remove();
      // Leave time for the browser to start consuming the object URL.
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch {if (!controller.signal.aborted) setDownloadError('Download could not complete. Reconnect or sign in again, then try the download again.');}
    finally {downloadController.current = null; setDownloading('');}
  }
  const refresh = useCallback(async () => {
    const sequence = ++requestSequence.current;
    const id = selected.current;
    try {const response = await fetch(id ? `/api/v1/videos/${id}` : `/api/v1/projects/${projectId}/videos/latest`, {cache: 'no-store', signal: AbortSignal.timeout(10000)});
      if (!response.ok) throw new Error(); const data = (await response.json()).data;
      const next = (id ? data : data.video) as VideoView | null;
      if (next && (next.projectId !== projectId || id && next.id !== id)) throw new Error();
      if (sequence !== requestSequence.current) return;
      if (next?.id !== currentId.current) {currentId.current = next?.id ?? null; position.current = 0; setFailed(false);}
      setVideo(next); setLoaded(true); setError('');
    } catch {if (sequence === requestSequence.current) setError('Could not confirm video availability. Reconnect or sign in again, then refresh.');}
  }, [projectId]);
  function selectVideo(id: string|null) {
    selected.current = id; setSelectedId(id); ++requestSequence.current;
    downloadController.current?.abort(); setDownloadError('');
    currentId.current = null; position.current = 0; setVideo(null); setLoaded(false); setFailed(false); setError(''); void refresh();
  }
  useEffect(() => {void refresh(); const timer = setInterval(() => void refresh(), 10000); return () => clearInterval(timer);}, [refresh]);
  return <section className="recovery-panel video-preview" aria-label="Finished video">
    <div className="editor-heading"><div><span className="section-index">{selectedId ? 'SELECTED VIDEO VERSION' : 'YOUR FINISHED VIDEO'}</span><h3>{video ? `Ready · Version ${video.versionNumber}` : selectedId ? 'Loading selected version' : 'Your explanation, in motion.'}</h3></div></div>
    {selectedId && <Button variant="secondary" onClick={() => selectVideo(null)}>Return to latest video</Button>}
    {!video && <p className="muted-copy">{loaded ? 'Your video will appear here after generation and private storage checks finish.' : error ? 'Video availability could not be confirmed.' : 'Checking for a finished video…'}</p>}
    {video && <><p className="muted-copy">{video.language === 'te' ? 'Telugu narration · Telugu subtitles' : 'English narration · English subtitles'} · {Math.round(video.media.durationSeconds)} seconds</p>
      <video key={`${video.id}:${retry}`} ref={element} className="finished-video" controls playsInline preload="none" controlsList="nodownload" aria-label="Finished educational video"
        src={video.playbackUrl} onTimeUpdate={() => {position.current = element.current?.currentTime ?? 0;}}
        onLoadedMetadata={() => {if (element.current && position.current > 0) element.current.currentTime = Math.min(position.current, element.current.duration);}}
        onError={() => setFailed(true)}/>
      <p className="muted-copy">Internal evaluation only · Review facts and pronunciation before use.</p>
      {video.capabilities.download && <div className="video-downloads" aria-label="Download finished video">
        <Button variant="secondary" disabled={!!downloading} onClick={() => void download('mp4')}>{downloading === 'mp4' ? 'Preparing MP4…' : 'Download MP4'}</Button>
        <Button variant="secondary" disabled={!!downloading} onClick={() => void download('srt')}>{downloading === 'srt' ? 'Preparing subtitles…' : 'Download subtitles (.srt)'}</Button>
      </div>}
      {downloadError && <p role="alert">{downloadError}</p>}
      {failed && <div role="alert"><p>Playback could not load. Refresh access and try again; your video is retained.</p><Button variant="secondary" onClick={async () => {await refresh(); setFailed(false); setRetry(v => v + 1);}}>Retry playback</Button></div>}
      <details><summary>Matching transcript</summary>{video.transcript.map(segment => <p key={segment.segmentId}>{segment.text}</p>)}</details>
    </>}
    {error && <p role="alert">{error}</p>}
    <Button variant="secondary" onClick={() => void refresh()}>Refresh video availability</Button>
    <VideoHistory projectId={projectId} selectedId={selectedId} onSelect={selectVideo}/>
  </section>;
}
