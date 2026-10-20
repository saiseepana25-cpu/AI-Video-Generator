import type {Metadata} from 'next';
import Link from 'next/link';
import {notFound} from 'next/navigation';
import {Button, PageHeading, Panel} from '@/components/ui';
import {DraftArtwork} from '@/components/project-library';
import {requireWorkspacePage} from '@/server/auth/context';
import {projectServiceForContext} from '@/server/projects/runtime';
import {ProjectError} from '@/server/projects/contracts';

export const metadata: Metadata = {title: 'Project'};
export default async function ProjectPage({params}: {params: Promise<{projectId: string}>}) {
  const {projectId} = await params;
  const context = await requireWorkspacePage(`/projects/${projectId}`);
  const project = await projectServiceForContext(context).get(projectId).catch(error => {
    if (error instanceof ProjectError && (error.status === 404 || error.code === 'INVALID_ID')) notFound();
    throw error;
  });
  return <>
    <Link href="/projects" className="back-link">← All projects</Link>
    <div lang={project.settings.language === 'te' ? 'te' : undefined}><PageHeading eyebrow="YOUR EXPLANATION" title={project.displayTitle} description="A saved idea, ready for its next chapter." action={<span className="draft-badge">Draft · Saved</span>}/></div>
    <ol className="project-stages" aria-label="Project workflow"><li aria-current="step"><span>01</span>Plan</li><li><span>02</span>Generate</li><li><span>03</span>Publish</li></ol>
    <div className="project-detail-grid">
      <Panel className="project-idea" aria-labelledby="saved-idea-heading"><span className="section-index">THE IDEA</span><h2 id="saved-idea-heading">Every explanation starts somewhere.</h2><div className="saved-idea-bubble"><p className="idea-author">{project.createdBy.name} <span>· Saved idea</span></p><p className="saved-idea-text" lang={project.settings.language}>{project.brief.idea}</p></div><dl className="project-facts"><div><dt>Audience</dt><dd>{project.brief.audience}</dd></div><div><dt>Created</dt><dd><time dateTime={project.createdAt}>{new Intl.DateTimeFormat('en-IN', {dateStyle: 'medium', timeZone: 'Asia/Kolkata'}).format(new Date(project.createdAt))}</time></dd></div></dl>
        {!!project.brief.references.length && <div className="project-references"><h3>Supplied references</h3>{project.brief.references.map(ref => <div key={ref.referenceId}><p>{ref.text}</p>{ref.suppliedUrl && <a href={ref.suppliedUrl} target="_blank" rel="noopener noreferrer">View source ↗</a>}</div>)}</div>}
        <div className="project-next-note" id="planning-notice"><strong>Your idea is safely saved.</strong><p>Editing and AI planning will be available in an upcoming update. You can return to this project at any time.</p></div><Button disabled aria-describedby="planning-notice">Prepare my plan</Button>
      </Panel>
      <aside className="project-side"><Panel className="project-visual"><DraftArtwork large/><h3>From idea to understanding.</h3><p>Your visual explanation will take shape here.</p></Panel><Panel className="project-settings"><h2>Video details</h2><dl className="project-facts"><div><dt>Language</dt><dd>{project.settings.language === 'te' ? 'తెలుగు · Telugu' : 'English'}</dd></div><div><dt>Subtitles</dt><dd>{project.settings.language === 'te' ? 'Telugu' : 'English'}</dd></div><div><dt>Target length</dt><dd>{project.settings.targetSeconds} seconds</dd></div><div><dt>Voice</dt><dd>{project.settings.voiceCatalogId ? 'Selection saved' : 'Not selected yet'}</dd></div><div><dt>Accent</dt><dd>{project.settings.accentId ? 'Preference saved' : 'Not selected yet'}</dd></div></dl><p className="muted-copy">No voice is chosen automatically.</p></Panel></aside>
    </div>
  </>;
}
