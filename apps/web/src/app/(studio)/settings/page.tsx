import type {Metadata} from 'next';
import {FeaturePlaceholder} from '@/components/feature-placeholder';
import {requireWorkspacePage} from '@/server/auth/context';

export const metadata: Metadata = {title: 'Settings'};

export default async function SettingsPage() {
  await requireWorkspacePage('/settings');
  return <FeaturePlaceholder title="Make the studio yours." description="One shared workspace. A consistent voice and visual identity." icon="settings" heading="The details that make it feel like you.">Brand kit, video defaults, personal preferences and Instagram connection will arrive as separate features. No settings or API credentials can be changed in this scaffold.</FeaturePlaceholder>;
}
