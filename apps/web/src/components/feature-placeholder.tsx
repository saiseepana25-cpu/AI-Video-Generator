import Link from 'next/link';
import {Icon} from './icon';
import {PageHeading, Panel} from './ui';

export function FeaturePlaceholder({title, description, icon, heading, children}: {title: string; description: string; icon: 'calendar' | 'settings'; heading: string; children: React.ReactNode}) {
  return <><PageHeading eyebrow="TEAM WORKSPACE" title={title} description={description}/><Panel className="feature-placeholder" aria-labelledby="feature-heading"><span className="placeholder-icon"><Icon name={icon}/></span><span className="neutral-badge">Not connected yet</span><h2 id="feature-heading">{heading}</h2><p>{children}</p><Link href="/projects" className="button button--secondary">Back to projects<Icon name="arrow"/></Link></Panel></>;
}
