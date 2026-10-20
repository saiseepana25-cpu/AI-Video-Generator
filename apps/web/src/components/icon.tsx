import type {CSSProperties} from 'react';

type IconName = 'projects' | 'calendar' | 'settings' | 'plus' | 'arrow' | 'play' | 'check';

const paths: Record<IconName, React.ReactNode> = {
  projects: <><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18M8 15h2M14 15h2"/></>,
  settings: <><path d="m9 4 1-2h4l1 2 2 1 2 .2 2 3.6-1 1.8v2.8l1 1.8-2 3.6-2 .2-2 1-1 2h-4l-1-2-2-1-2-.2-2-3.6 1-1.8v-2.8L3 8.8l2-3.6L7 5Z"/><circle cx="12" cy="11.9" r="3"/></>,
  plus: <path d="M12 5v14M5 12h14"/>,
  arrow: <path d="M5 12h14m-6-6 6 6-6 6"/>,
  play: <path d="m9 5 10 7-10 7Z"/>,
  check: <path d="m5 12 4 4L19 6"/>,
};

export function Icon({name, className, style}: {name: IconName; className?: string; style?: CSSProperties}) {
  return <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className} style={style}>{paths[name]}</svg>;
}

export function BrandMark() {
  return <svg width="32" height="32" viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="M11 3H4v8M21 3h7v8M28 21v8h-7M11 29H4v-8" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/><path d="m13 10 10 6-10 6Z" fill="currentColor"/></svg>;
}
