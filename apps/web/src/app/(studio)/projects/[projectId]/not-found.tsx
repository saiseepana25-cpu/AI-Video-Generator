import Link from 'next/link';
import {Panel} from '@/components/ui';
export default function MissingProject() {
  return <Panel className="feature-placeholder"><p className="eyebrow">PROJECT NOT AVAILABLE</p><h1>We couldn’t find that project.</h1><p>It may have been removed or isn’t available in your workspace.</p><Link href="/projects" className="button button--primary">Back to projects</Link></Panel>;
}
