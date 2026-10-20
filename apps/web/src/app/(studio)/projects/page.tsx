import type {Metadata} from 'next';
import {Button, PageHeading, Panel} from '@/components/ui';
import {Icon} from '@/components/icon';
import {requireWorkspacePage} from '@/server/auth/context';

export const metadata: Metadata = {title: 'Projects'};

function EmptyLibraryArtwork() {
  return <svg className="empty-artwork" viewBox="0 0 260 150" fill="none" aria-hidden="true">
    <path d="M25 112h210M50 128h160" stroke="var(--border)" strokeDasharray="3 6"/>
    <rect x="44" y="37" width="58" height="85" rx="8" transform="rotate(-10 44 37)" fill="var(--elevated)" stroke="var(--border)"/>
    <rect x="165" y="28" width="58" height="85" rx="8" transform="rotate(10 165 28)" fill="var(--elevated)" stroke="var(--border)"/>
    <rect x="94" y="14" width="72" height="116" rx="10" fill="var(--canvas)" stroke="var(--primary)" strokeWidth="1.5"/>
    <path d="M109 29h13M109 29v13M151 29h-13M151 29v13M109 113h13M109 113v-13M151 113h-13M151 113v-13" stroke="var(--border)" strokeWidth="1.5"/>
    <circle cx="130" cy="65" r="19" fill="var(--elevated)"/><path d="m126 57 12 8-12 8Z" fill="var(--primary)"/>
    <path d="M118 98h24M123 104h14M62 71l9 9 10-16M183 68h14m-7-7v14" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round"/>
    <circle cx="203" cy="19" r="3" fill="var(--accent)"/><circle cx="58" cy="20" r="2" fill="var(--primary)"/>
  </svg>;
}

export default async function ProjectsPage() {
  await requireWorkspacePage('/projects');
  return <>
    <PageHeading eyebrow="YOUR CREATIVE SPACE" title="Make your next idea move." description="Turn a simple concept into an explainer worth watching." action={<Button disabled aria-describedby="scaffold-notice"><Icon name="plus"/>Create video</Button>}/>
    <p className="development-notice" id="scaffold-notice"><span className="notice-dot"/>Dashboard foundation — project saving and video creation are not connected yet.</p>
    <Panel className="idea-panel" aria-labelledby="idea-heading">
      <div className="idea-intro"><span className="section-index">01 / THE STARTING POINT</span><h2 id="idea-heading">What would you like to explain?</h2><p>A curious question. A useful lesson. An idea that deserves a little clarity.</p></div>
      <label htmlFor="idea" className="sr-only">Your video idea</label>
      <textarea id="idea" disabled rows={3} placeholder="For example, how does sunlight become electricity?" aria-describedby="idea-hint"/>
      <div className="idea-panel-bottom"><p id="idea-hint">One language for narration and subtitles.<span className="language-note">English <span aria-hidden="true">/</span> <span lang="te">తెలుగు</span></span></p><Button disabled aria-describedby="scaffold-notice">Plan my video<Icon name="arrow"/></Button></div>
    </Panel>
    <ol className="workflow" aria-label="Video creation workflow"><li><span className="workflow-number">01</span><div><strong>Plan</strong><p>Shape the idea. Review the story.</p></div></li><li><span className="workflow-number">02</span><div><strong>Generate</strong><p>Bring visuals and voice together.</p></div></li><li><span className="workflow-number">03</span><div><strong>Publish</strong><p>Review, download, then share.</p></div></li></ol>
    <div className="section-heading"><h2>Your projects</h2><span className="neutral-badge">Project library coming next</span></div>
    <Panel className="empty-library" aria-labelledby="library-heading"><EmptyLibraryArtwork/><h3 id="library-heading">A home for your next big explanation.</h3><p>Your team’s saved ideas and finished videos will live here.<br className="desktop-break"/> Project storage will be connected in an upcoming feature.</p><span className="empty-footnote">No sample projects or generated videos are shown.</span></Panel>
  </>;
}
