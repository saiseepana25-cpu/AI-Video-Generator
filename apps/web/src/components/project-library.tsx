'use client';

import {useRef, useState} from 'react';
import Link from 'next/link';
import type {ProjectPage} from '@/server/projects/contracts';
import {Button, Panel} from './ui';
import {Icon} from './icon';

export function DraftArtwork({language, large = false}: {language?: 'en' | 'te'; large?: boolean}) {
  return <div className={`draft-artwork${large ? ' draft-artwork--large' : ''}`} aria-hidden="true">
    <svg viewBox="0 0 260 150" fill="none"><path d="M32 75h196" stroke="var(--border)" strokeDasharray="4 7"/><rect x="20" y="48" width="60" height="54" rx="10" fill="var(--surface)" stroke="var(--primary)"/><circle cx="130" cy="75" r="27" fill="var(--surface)" stroke="var(--accent)"/><rect x="180" y="48" width="60" height="54" rx="10" fill="var(--surface)" stroke="var(--primary)"/><path d="M37 68h26M37 80h18M119 75l8 8 15-16M197 68h26M197 80h18" stroke="var(--muted)" strokeWidth="2" strokeLinecap="round"/><circle cx="211" cy="21" r="3" fill="var(--accent)"/><circle cx="44" cy="126" r="2" fill="var(--primary)"/></svg>
    <span>{large ? 'A clear idea. A story taking shape.' : language === 'te' ? 'తెలుగు' : 'ENGLISH'}</span>
  </div>;
}

export function ProjectLibrary({initial, query, initialError}: {initial: ProjectPage; query: string; initialError?: string}) {
  const [data, setData] = useState(initial);
  const [error, setError] = useState(initialError ?? '');
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  async function more() {
    if (busy.current || !data.page.nextCursor) return;
    busy.current = true; setPending(true); setError('');
    try {
      const params = new URLSearchParams({q: query, limit: String(data.page.limit), cursor: data.page.nextCursor});
      const response = await fetch(`/api/v1/projects?${params}`, {cache: 'no-store', signal: AbortSignal.timeout(20000)});
      const value = await response.json();
      if (!response.ok) {setError(response.status === 401 ? 'Your session ended. Sign in again to open the library.' : 'We couldn’t load more projects. Retry, or refresh the library if the page link expired.'); return;}
      const next: ProjectPage = value.data;
      setData(current => ({items: [...current.items, ...next.items.filter(item => !current.items.some(existing => existing.id === item.id))], page: next.page}));
    } catch {setError('We couldn’t load more projects. Check your connection and retry.');}
    finally {busy.current = false; setPending(false);}
  }
  const reset = `/projects${query ? `?q=${encodeURIComponent(query)}` : ''}`;
  return <div className="project-library" aria-busy={pending}>
    {error && <div className="library-notice" role="alert"><p>{error}</p><Link className="text-button" href={reset}>Refresh library</Link></div>}
    {!data.items.length && !error && <Panel className="empty-library"><DraftArtwork large/><h3>{query ? 'No projects match your search.' : 'Your next explanation starts here.'}</h3><p>{query ? 'Try a different title or clear your search to see the shared library.' : 'Add an idea above to create your first project. Your team can pick up the same saved work.'}</p>{query && <Link className="text-button" href="/projects">Clear search</Link>}</Panel>}
    {!!data.items.length && <ul className="project-grid" aria-label="Saved projects">{data.items.map(project => <li key={project.id}><Link href={`/projects/${project.id}`} className="project-card">
      <DraftArtwork language={project.language}/>
      <div className="project-card-body"><span className="draft-badge"><span className="notice-dot"/>Draft · Idea saved</span><h3 lang={project.language === 'te' ? 'te' : undefined}>{project.displayTitle}</h3><p>{project.language === 'te' ? 'Telugu' : 'English'} <span aria-hidden="true">·</span> {project.targetSeconds}s target</p><div className="project-card-footer"><span>{project.updatedBy.name}</span><time dateTime={project.updatedAt}>{new Intl.DateTimeFormat('en-IN', {day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata'}).format(new Date(project.updatedAt))}</time><Icon name="arrow"/></div></div>
    </Link></li>)}</ul>}
    {data.page.hasMore && <div className="load-more"><Button variant="secondary" onClick={more} disabled={pending}>{pending ? 'Loading projects…' : error ? 'Retry loading more' : 'Load more projects'}</Button></div>}
    <span className="sr-only" role="status">{pending ? 'Loading more projects.' : `${data.items.length} projects displayed.`}</span>
  </div>;
}
