'use client';
import {useCallback, useEffect, useRef, useState} from 'react';
import type {VideoView} from '@/server/videos/contracts';
import {Button} from './ui';
export function VideoPlayer({projectId}: {projectId: string}) {
  const [video, setVideo] = useState<VideoView | null>(null), [loaded, setLoaded] = useState(false), [error, setError] = useState(''), [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0); const element = useRef<HTMLVideoElement>(null), position = useRef(0), currentId = useRef<string | null>(null);
  const requestSequence = useRef(0);
  const refresh = useCallback(async () => {
    const sequence = ++requestSequence.current;
    try {const response = await fetch(`/api/v1/projects/${projectId}/videos/latest`, {cache: 'no-store', signal: AbortSignal.timeout(10000)});
      if (!response.ok) throw new Error(); const next = (await response.json()).data.video as VideoView | null;
      if (sequence !== requestSequence.current) return;
      if (next?.id !== currentId.current) {currentId.current = next?.id ?? null; position.current = 0; setFailed(false);}
      setVideo(next); setLoaded(true); setError('');
    } catch {if (sequence === requestSequence.current) setError('Could not confirm video availability. Reconnect or sign in again, then refresh.');}
  }, [projectId]);
  useEffect(() => {void refresh(); const timer = setInterval(() => void refresh(), 10000); return () => clearInterval(timer);}, [refresh]);
  return <section className="recovery-panel video-preview" aria-label="Finished video">
    <div className="editor-heading"><div><span className="section-index">YOUR FINISHED VIDEO</span><h3>{video ? `Ready · Version ${video.versionNumber}` : 'Your explanation, in motion.'}</h3></div></div>
    {!video && <p className="muted-copy">{loaded ? 'Your video will appear here after generation and private storage checks finish.' : 'Checking for a finished video…'}</p>}
    {video && <><p className="muted-copy">{video.language === 'te' ? 'Telugu narration · Telugu subtitles' : 'English narration · English subtitles'} · {Math.round(video.media.durationSeconds)} seconds</p>
      <video key={`${video.id}:${retry}`} ref={element} className="finished-video" controls playsInline preload="none" controlsList="nodownload" aria-label="Finished educational video"
        src={video.playbackUrl} onTimeUpdate={() => {position.current = element.current?.currentTime ?? 0;}}
        onLoadedMetadata={() => {if (element.current && position.current > 0) element.current.currentTime = Math.min(position.current, element.current.duration);}}
        onError={() => setFailed(true)}/>
      <p className="muted-copy">Internal evaluation only · Review facts and pronunciation before use.</p>
      {failed && <div role="alert"><p>Playback could not load. Refresh access and try again; your video is retained.</p><Button variant="secondary" onClick={async () => {await refresh(); setFailed(false); setRetry(v => v + 1);}}>Retry playback</Button></div>}
      <details><summary>Matching transcript</summary>{video.transcript.map(segment => <p key={segment.segmentId}>{segment.text}</p>)}</details>
    </>}
    {error && <p role="alert">{error}</p>}
    <Button variant="secondary" onClick={() => void refresh()}>Refresh video availability</Button>
  </section>;
}
