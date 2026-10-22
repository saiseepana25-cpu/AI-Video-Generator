import type {Metadata} from 'next';
import Link from 'next/link';
import {PageHeading, Panel} from '@/components/ui';
import {Icon} from '@/components/icon';
import {ProjectComposer} from '@/components/project-composer';
import {ProjectLibrary} from '@/components/project-library';
import {requireWorkspacePage} from '@/server/auth/context';
import {projectServiceForContext} from '@/server/projects/runtime';
import {parseListOptions} from '@/server/projects/validation';
import {ProjectError, type ProjectPage} from '@/server/projects/contracts';
import {defaultComposerSettings} from '@/lib/composer-settings';

export const metadata: Metadata = {title: 'Projects'};
export default async function ProjectsPage({searchParams}: {searchParams: Promise<Record<string, string | string[] | undefined>>}) {
  const context = await requireWorkspacePage('/projects');
  const query = await searchParams;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) for (const item of Array.isArray(value) ? value : value !== undefined ? [value] : []) params.append(key, item);
  let data: ProjectPage = {items: [], page: {limit: 20, hasMore: false, nextCursor: null}};
  let q = '', error = '';
  try {
    const options = parseListOptions(params);
    q = options.q;
    data = await projectServiceForContext(context).list(options);
  } catch (cause) {if (cause instanceof ProjectError && cause.status === 400) error = cause.message; else throw cause;}
  const defaults = context.workspace.defaults;
  const initialSettings=defaultComposerSettings(defaults,context.member.preferences.language??defaults.language,context.workspace.brandKitRevisionId,context.member.preferences);
  return <>
    <PageHeading eyebrow="YOUR CREATIVE SPACE" title="Make your next idea move." description="Turn a simple concept into an explainer worth watching." action={<a href="#idea" className="button button--primary"><Icon name="plus"/>New project</a>}/>
    <Panel className="idea-panel" aria-labelledby="idea-heading"><div className="idea-intro"><span className="section-index">01 / THE STARTING POINT</span><h2 id="idea-heading">What would you like to explain?</h2><p>A curious question. A useful lesson. An idea that deserves a little clarity.</p></div><ProjectComposer workspaceId={context.workspace._id} userId={context.identity.userId} defaultLanguage={initialSettings.language} defaultSeconds={initialSettings.targetSeconds} defaultVoice={initialSettings.voiceCatalogId} defaultAccent={initialSettings.accentId} defaultBrand={initialSettings.brandKitRevisionId}/></Panel>
    <ol className="workflow" aria-label="Video creation workflow"><li><span className="workflow-number">01</span><div><strong>Plan</strong><p>Shape the idea. Review the story.</p></div></li><li><span className="workflow-number">02</span><div><strong>Generate</strong><p>Bring visuals and voice together.</p></div></li><li><span className="workflow-number">03</span><div><strong>Publish</strong><p>Review, download, then share.</p></div></li></ol>
    <div className="section-heading library-heading"><div><h2>Your projects</h2><p className="muted-copy">A shared space for your team’s explanations.</p></div><form action="/projects" method="get" className="project-search" role="search"><label htmlFor="project-search" className="sr-only">Search project titles</label><input type="search" name="q" id="project-search" defaultValue={q} placeholder="Search projects…"/><button className="button button--secondary" type="submit">Search</button>{q && <Link href="/projects" className="text-button">Clear</Link>}</form></div>
    <ProjectLibrary key={params.toString()} initial={data} query={q} initialError={error}/>
  </>;
}
