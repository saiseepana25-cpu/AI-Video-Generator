import type {Metadata} from 'next';
import Link from 'next/link';
import {notFound} from 'next/navigation';
import {PageHeading} from '@/components/ui';
import {ProjectEditor} from '@/components/project-editor';
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
    <div lang={project.settings.language === 'te' ? 'te' : undefined}><PageHeading eyebrow="YOUR EXPLANATION" title={project.displayTitle} description="A saved idea, ready for its next chapter." action={<span className="draft-badge">Draft</span>}/></div>
    <ol className="project-stages" aria-label="Project workflow"><li aria-current="step"><span>01</span>Plan</li><li><span>02</span>Generate</li><li><span>03</span>Publish</li></ol>
    <ProjectEditor project={project} workspaceId={context.workspace._id} userId={context.identity.userId}/>
  </>;
}
