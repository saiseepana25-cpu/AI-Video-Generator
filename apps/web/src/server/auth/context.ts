import 'server-only';
import {cache} from 'react';
import {redirect} from 'next/navigation';
import {auth} from '@/auth';
import {inspectAuthSettings} from '../configuration/auth';
import {AccessError,authorizeIdentity,authorizeMembership} from './access-policy';
import {authDatabase,revokeUserSessions,type Membership,type Workspace} from '../db/auth-store';

export const workspaceContext = cache(async () => {
  const {settings} = inspectAuthSettings(process.env);
  if (!settings) throw new AccessError('AUTHENTICATION_REQUIRED');
  try {
    const session = await auth();
    let identity;
    try { identity = authorizeIdentity(session,settings.allowedEmails); }
    catch (error) {
      if (error instanceof AccessError && error.code === 'TEAM_ACCESS_DENIED' && session?.user?.id) await revokeUserSessions(settings,session.user.id);
      throw error;
    }
    const db = await authDatabase(settings);
    const member = await db.collection<Membership>('memberships').findOne({workspaceId:settings.workspaceId,userId:identity.userId});
    try { authorizeMembership(member,identity.userId,identity.email,settings.workspaceId); }
    catch (error) { await revokeUserSessions(settings,identity.userId); throw error; }
    const workspace = await db.collection<Workspace>('workspaces').findOne({_id:settings.workspaceId});
    if (!workspace) throw new AccessError('CONNECTION_UNAVAILABLE');
    return {identity,member:member!,workspace};
  } catch (error) {
    if (error instanceof AccessError) throw error;
    throw new AccessError('CONNECTION_UNAVAILABLE');
  }
});

export async function requireWorkspacePage(returnTo = '/projects') {
  try { return await workspaceContext(); }
  catch (error) {
    const code = error instanceof AccessError ? error.code : 'CONNECTION_UNAVAILABLE';
    if (code === 'TEAM_ACCESS_DENIED') redirect('/sign-in?error=AccessDenied');
    if (code === 'CONNECTION_UNAVAILABLE') redirect('/sign-in?error=Unavailable');
    redirect(`/sign-in?returnTo=${encodeURIComponent(returnTo)}`);
  }
}
