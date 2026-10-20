import {StudioShell} from '@/components/studio-shell';
import {requireWorkspacePage} from '@/server/auth/context';
import {endSession} from '@/app/sign-in/actions';

export const dynamic = 'force-dynamic';

export default async function StudioLayout({children}: {children: React.ReactNode}) {
  const {identity,workspace} = await requireWorkspacePage();
  return <StudioShell userName={identity.name} workspaceName={workspace.name} accountControl={<form action={endSession}><button className="button button--secondary" type="submit">Sign out</button></form>}>{children}</StudioShell>;
}
