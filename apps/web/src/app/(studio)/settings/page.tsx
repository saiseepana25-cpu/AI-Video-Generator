import type {Metadata} from 'next';
import {PageHeading,Panel} from '@/components/ui';
import {WorkspaceSettings} from '@/components/workspace-settings';
import {WorkspaceBrand} from '@/components/workspace-brand';
import {WorkspaceLogo} from '@/components/workspace-logo';
import {requireWorkspacePage} from '@/server/auth/context';

export const metadata: Metadata = {title: 'Settings'};

export default async function SettingsPage() {
  const context=await requireWorkspacePage('/settings');
  return <><PageHeading eyebrow="YOUR STUDIO" title="A thoughtful starting point." description="Shared preferences for your team’s next explanation."/><Panel className="workspace-settings-panel"><WorkspaceSettings key={`${context.workspace._id}:${context.identity.userId}`} workspaceId={context.workspace._id} userId={context.identity.userId}/></Panel><Panel className="workspace-settings-panel brand-panel"><WorkspaceBrand key={`${context.workspace._id}:${context.identity.userId}`} workspaceId={context.workspace._id} userId={context.identity.userId}/></Panel><Panel className="workspace-settings-panel brand-panel"><WorkspaceLogo key={`${context.workspace._id}:${context.identity.userId}`} workspaceId={context.workspace._id} userId={context.identity.userId}/></Panel></>;
}
