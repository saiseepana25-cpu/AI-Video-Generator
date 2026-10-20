'use client';

import Link from 'next/link';
import {usePathname} from 'next/navigation';
import type {ReactNode} from 'react';
import {BrandMark, Icon} from './icon';

const navigation = [
  {href: '/projects', label: 'Projects', icon: 'projects'},
  {href: '/calendar', label: 'Calendar', icon: 'calendar'},
  {href: '/settings', label: 'Settings', icon: 'settings'},
] as const;

export function StudioShell({children}: {children: ReactNode}) {
  const pathname = usePathname();
  const currentPage = navigation.find(item => pathname === item.href || pathname.startsWith(`${item.href}/`));

  return <div className="studio-shell">
    <a className="skip-link" href="#main-content">Skip to content</a>
    <aside className="sidebar" aria-label="Studio sidebar">
      <Link className="wordmark" href="/projects" aria-label="VideoCraft projects"><BrandMark/><span>VideoCraft<span className="wordmark-dot">.</span></span></Link>
      <div className="workspace-label"><span className="workspace-glyph">V</span><div>Team workspace<small>Local preview</small></div></div>
      <nav className="studio-nav" aria-label="Main navigation">{navigation.map(item => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return <Link key={item.href} href={item.href} className={`nav-link${active ? ' is-active' : ''}`} aria-current={active ? 'page' : undefined}><Icon name={item.icon}/><span>{item.label}</span>{active && <span className="nav-indicator"/>}</Link>;
      })}</nav>
      <div className="sidebar-note"><span className="tiny-label">A LITTLE CLARITY GOES A LONG WAY</span><p>One idea.<br/>A new way to explain it.</p><span className="note-rule"/></div>
      <div className="local-identity"><span className="local-dot"/><div>Local development<small>Sign-in not connected</small></div></div>
    </aside>
    <div className="studio-body">
      <header className="topbar"><span className="breadcrumb">Studio <span aria-hidden="true">/</span> <strong>{currentPage?.label ?? 'Workspace'}</strong></span><span className="preview-badge">Scaffold preview</span></header>
      <main id="main-content" tabIndex={-1} className="main-content">{children}</main>
      <footer className="studio-footer"><span>Thoughtful videos start with a clear idea.</span><span>VideoCraft · Internal V1</span></footer>
    </div>
  </div>;
}
