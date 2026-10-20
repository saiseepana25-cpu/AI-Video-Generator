import type {Metadata} from 'next';
import {FeaturePlaceholder} from '@/components/feature-placeholder';

export const metadata: Metadata = {title: 'Calendar'};

export default function CalendarPage() {
  return <FeaturePlaceholder title="Your publishing calendar." description="A clear view of what’s ready to go, and when." icon="calendar" heading="Good explanations deserve good timing.">Scheduling will be added after video generation and Instagram connection. This scaffold has no scheduled posts or connected social account.</FeaturePlaceholder>;
}
