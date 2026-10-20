'use client';

import {useFormStatus} from 'react-dom';

export function GoogleSignInButton({disabled}: {disabled: boolean}) {
  const {pending} = useFormStatus();
  return <button className="button google-sign-in" type="submit" disabled={disabled || pending} aria-describedby={disabled ? 'auth-notice' : undefined}>
    <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24"><path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.4-.18-2.06H12v3.9h5.38a4.6 4.6 0 0 1-2 3.02v2.5h3.23c1.9-1.75 2.99-4.33 2.99-7.36Z"/><path fill="#34A853" d="M12 22c2.7 0 4.96-.9 6.61-2.42l-3.23-2.5c-.9.6-2.04.97-3.38.97-2.6 0-4.8-1.76-5.58-4.12H3.08v2.59A10 10 0 0 0 12 22Z"/><path fill="#FBBC05" d="M6.42 13.93A6 6 0 0 1 6.1 12c0-.67.12-1.32.32-1.93V7.48H3.08A10 10 0 0 0 2 12c0 1.61.39 3.14 1.08 4.52l3.34-2.59Z"/><path fill="#EA4335" d="M12 5.95c1.47 0 2.79.51 3.83 1.51l2.87-2.87A9.6 9.6 0 0 0 12 2a10 10 0 0 0-8.92 5.48l3.34 2.59C7.2 7.71 9.4 5.95 12 5.95Z"/></svg>
    {pending ? 'Opening Google…' : 'Continue with Google'}
  </button>;
}
