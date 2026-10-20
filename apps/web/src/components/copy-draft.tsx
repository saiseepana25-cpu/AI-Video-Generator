'use client';
import {useState} from 'react';
import {Button} from './ui';

export function CopyDraft({text}: {text: string}) {
  const [fallback, setFallback] = useState(false), [copied, setCopied] = useState(false);
  return <div className="copy-draft"><Button variant="secondary" onClick={async () => {
    try {await navigator.clipboard.writeText(text); setCopied(true);} catch {setFallback(true);}
  }}>{copied ? 'Copied' : 'Copy my draft'}</Button>{fallback && <label>Copy this text manually<textarea readOnly value={text} onFocus={e => e.target.select()} rows={5}/></label>}</div>;
}
