import Link from 'next/link';

export default function NotFound() {
  return <main className="standalone-message"><p className="eyebrow">404 / PAGE NOT FOUND</p><h1>This page isn’t in the studio.</h1><p>The link may be incomplete, or the page may have moved.</p><Link href="/projects" className="button button--primary">Back to projects</Link></main>;
}
