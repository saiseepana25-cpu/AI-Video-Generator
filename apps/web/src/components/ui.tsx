import type {ComponentProps, ReactNode} from 'react';

export function Button({variant = 'primary', className = '', ...props}: ComponentProps<'button'> & {variant?: 'primary' | 'secondary'}) {
  return <button type="button" className={`button button--${variant} ${className}`} {...props}/>;
}

export function PageHeading({eyebrow, title, description, action}: {eyebrow: string; title: string; description: string; action?: ReactNode}) {
  return <div className="page-heading"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p className="page-description">{description}</p></div>{action}</div>;
}

export function Panel({children, className = '', ...props}: ComponentProps<'section'>) {
  return <section className={`panel ${className}`} {...props}>{children}</section>;
}
