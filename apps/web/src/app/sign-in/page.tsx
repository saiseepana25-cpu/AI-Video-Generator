import type {Metadata} from 'next';
import Link from 'next/link';
import {redirect} from 'next/navigation';
import {BrandMark,Icon} from '@/components/icon';
import {GoogleSignInButton} from '@/components/google-sign-in-button';
import {inspectAuthSettings} from '@/server/configuration/auth';
import {AccessError,safeReturnPath} from '@/server/auth/access-policy';
import {workspaceContext} from '@/server/auth/context';
import {startGoogleSignIn,endSession} from './actions';

export const metadata: Metadata = {title:'Team sign-in'};
export const dynamic = 'force-dynamic';

const messages: Record<string,{title:string;body:string}> = {
  AccessDenied:{title:'This account doesn’t have team access.',body:'Try another Google account, or ask the workspace operator to check your access.'},
  OAuthAccountNotLinked:{title:'Use your original Google account.',body:'This email is already linked to another identity. Ask the workspace operator for help.'},
  Unavailable:{title:'We couldn’t complete sign-in.',body:'Try again in a moment. Your team’s existing work is unchanged.'},
};

export default async function SignInPage({searchParams}: {searchParams:Promise<Record<string,string|string[]|undefined>>}) {
  const query = await searchParams;
  const returnTo = safeReturnPath(query.returnTo);
  const {ready} = inspectAuthSettings(process.env);
  let errorCode = typeof query.error === 'string' ? query.error : '';
  if (ready) {
    let signedIn = false;
    try { await workspaceContext(); signedIn = true; }
    catch (error) {
      if (error instanceof AccessError && error.code === 'TEAM_ACCESS_DENIED') errorCode = 'AccessDenied';
      else if (error instanceof AccessError && error.code === 'CONNECTION_UNAVAILABLE') errorCode = 'Unavailable';
    }
    if (signedIn) redirect(returnTo);
  }
  const notice = !ready ? {title:'The studio is being connected.',body:'Team sign-in is not available yet. The workspace operator needs to finish the local setup.'} : errorCode ? (messages[errorCode] ?? messages.Unavailable) : null;
  return <main className="auth-page">
    <a className="skip-link" href="#sign-in-content">Skip to sign-in</a>
    <header className="auth-header"><Link href="/" className="wordmark" aria-label="VideoCraft"><BrandMark/><span>VideoCraft<span className="wordmark-dot">.</span></span></Link><span className="neutral-badge">Private team workspace</span></header>
    <div className="auth-grid">
      <section className="auth-story" aria-labelledby="story-title"><p className="eyebrow">CLEAR IDEAS. THOUGHTFUL MOTION.</p><h2 id="story-title">A little curiosity.{' '}<br/>A whole new way{' '}<br/>to explain.</h2><p>Turn the things you know into videos that make sense. Plan, generate and share—with your team, in one studio.</p>
        <div className="auth-diagram" aria-label="Illustration of an idea becoming a narrated explainer"><span className="diagram-label">FROM A QUESTION TO UNDERSTANDING</span><div className="diagram-path"><span className="diagram-sun"/><span className="diagram-line"/><span className="diagram-panel"><span/><span/><span/><span/></span><Icon name="arrow"/><span className="diagram-bulb"/></div><div className="diagram-caption"><span className="diagram-wave">▂ ▅ ▃ ▆ ▂ ▅ ▃ ▂</span><span>How does sunlight become electricity?</span></div><p className="diagram-footnote">An idea, made visual.</p></div>
      </section>
      <section id="sign-in-content" tabIndex={-1} className="auth-card" aria-labelledby="signin-title"><span className="auth-card-mark"><BrandMark/></span><p className="eyebrow">WELCOME TO THE STUDIO</p><h1 id="signin-title">Make room for<br/>your next idea.</h1><p className="auth-description">Sign in with your approved Google account to join your team’s shared workspace.</p>
        {notice && <div className="auth-notice" id="auth-notice" role="status"><strong>{notice.title}</strong><p>{notice.body}</p></div>}
        <form action={startGoogleSignIn}><input type="hidden" name="returnTo" value={returnTo}/><GoogleSignInButton disabled={!ready}/></form>
        <div className="auth-access-note"><Icon name="check"/><p>Individual sign-in. One shared workspace.<br/>Access is limited to approved teammates.</p></div>
        {ready && errorCode === 'AccessDenied' && <form action={endSession}><button className="text-button" type="submit">Clear this session</button></form>}
        <p className="auth-help">Need access? Contact your workspace operator.</p>
      </section>
    </div>
    <footer className="auth-footer"><span>VideoCraft · Internal V1</span><span>Made for explanations in English and <span lang="te">తెలుగు</span>.</span></footer>
  </main>;
}
