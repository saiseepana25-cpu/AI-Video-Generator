'use server';

import {headers} from 'next/headers';
import {redirect} from 'next/navigation';
import {AuthError} from 'next-auth';
import {signIn,signOut} from '@/auth';
import {inspectAuthSettings} from '@/server/configuration/auth';
import {safeReturnPath} from '@/server/auth/access-policy';

async function requireSameOrigin() {
  const {settings} = inspectAuthSettings(process.env);
  if (!settings) redirect('/sign-in?error=Setup');
  const incoming = await headers();
  if (incoming.get('origin') !== settings.origin || incoming.get('host') !== new URL(settings.origin).host) throw new Error('Request not allowed');
}

export async function startGoogleSignIn(data: FormData) {
  await requireSameOrigin();
  try { await signIn('google',{redirectTo:safeReturnPath(data.get('returnTo'))}); }
  catch (error) {
    if (error instanceof AuthError) redirect(`/sign-in?error=${error.type === 'AccessDenied' ? 'AccessDenied' : 'Unavailable'}`);
    throw error; // Preserve Next.js's own redirect signal.
  }
}

export async function endSession() {
  await requireSameOrigin();
  await signOut({redirectTo:'/sign-in'});
}
