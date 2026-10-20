'use client';

import {Button, Panel} from '@/components/ui';

export default function StudioError({reset}: {error: Error & {digest?: string}; reset: () => void}) {
  return <Panel className="feature-placeholder"><h1>We couldn’t open this page.</h1><p>Try loading it again. If this continues, restart the local application.</p><Button onClick={reset}>Try again</Button></Panel>;
}
