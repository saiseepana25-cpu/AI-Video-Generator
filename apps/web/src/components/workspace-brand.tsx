'use client';
import {useEffect,useRef,useState,type FormEvent} from 'react';
import type {BrandView} from '@/server/brand/service';
import {initialBrand,parseBrandPut,isColor,brandTextColor,type BrandKit} from '@/server/brand/validation';
import {editableBrandPalette,recoverBrandCommand,type BrandCommand} from '@/lib/brand-command';
import {canCorrectSaveFailure} from '@/lib/save-outcome';
import {Button} from './ui';
export function WorkspaceBrand({workspaceId,userId}:{workspaceId:string;userId:string}){
  const scope=`videocraft:${workspaceId}:${userId}:workspace-brand:v1`;
  const [value,setValue]=useState<BrandView|null>(null),[draft,setDraft]=useState<BrandKit>(initialBrand),[command,setCommand]=useState<BrandCommand|null>(null),[checked,setChecked]=useState(false),[sending,setSending]=useState(false),[loading,setLoading]=useState(false),[conflict,setConflict]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
  const busy=useRef(false),epoch=useRef(0);
  async function load(){const request=++epoch.current;setLoading(true);setError('');
    try{const response=await fetch('/api/v1/workspace/brand',{cache:'no-store',signal:AbortSignal.timeout(10000)});if(!response.ok)throw new Error();const next=(await response.json()).data as BrandView;if(request!==epoch.current)return;setValue(next);setDraft(editableBrandPalette(next.brandKit));setConflict(false);}
    catch{if(request===epoch.current)setError('Could not load shared branding. Reconnect or sign in again, then reload.');}
    finally{if(request===epoch.current)setLoading(false);}
  }
  useEffect(()=>{void(async()=>{await load();try{const raw=sessionStorage.getItem(scope);if(raw){const saved=recoverBrandCommand(raw);if(saved){setCommand(saved);setValue({revision:saved.body.expectedRevision,brandKit:null});setDraft(saved.body.brandKit);setMessage('An earlier brand save is unconfirmed. Check the same save before making more changes.');}else{setConflict(true);setError('The saved brand command is unreadable. Reload saved branding before continuing.');}}}catch{setError('Tab recovery is unavailable. Keep this page open while saving.');}setChecked(true);})();return()=>{epoch.current++;};},[scope]);
  async function save(event?:FormEvent){event?.preventDefault();if(busy.current||!value||!checked)return;
    let next=command;
    try{next??={key:crypto.randomUUID(),body:parseBrandPut({expectedRevision:value.revision,brandKit:draft})};}
    catch(cause){setError(cause instanceof Error?cause.message:'Check your palette before saving.');return;}
    try{sessionStorage.setItem(scope,JSON.stringify(next));}catch{setError('Could not preserve this save for recovery. Keep this page open and try again.');return;}
    busy.current=true;setSending(true);setCommand(next);setError('');setMessage('');
    try{const response=await fetch('/api/v1/workspace/brand',{method:'PUT',headers:{'Content-Type':'application/json','Idempotency-Key':next.key},body:JSON.stringify(next.body),signal:AbortSignal.timeout(20000)});const result=await response.json();
      if(!response.ok){if(!canCorrectSaveFailure(response.status,result.error?.code)){setError('Save outcome is unconfirmed. Reconnect or sign in again, then check the same save.');return;}
        sessionStorage.removeItem(scope);setCommand(null);setConflict(response.status===409);setError(result.error?.message??'Check your palette and try again.');return;}
      sessionStorage.removeItem(scope);setCommand(null);setValue(result.data);setDraft(editableBrandPalette(result.data.brandKit));await load();setMessage('Brand save confirmed. New projects can capture this palette. Existing projects and approved videos keep their saved colors.');
    }catch{setError('Save outcome is unconfirmed. Reconnect and check the same save.');}
    finally{busy.current=false;setSending(false);}
  }
  const colorsValid=[draft.primaryColor,draft.secondaryColor,draft.backgroundColor].every(isColor);
  const preview=colorsValid?draft:initialBrand,text=brandTextColor(preview.backgroundColor);
  return <form className="draft-editor workspace-settings workspace-brand" onSubmit={save} aria-label="Shared brand palette" aria-busy={sending||loading}>
    <span className="section-index">YOUR TEAM’S VISUAL SIGNATURE</span><h2>Make the explanation feel like you.</h2>
    <p className="muted-copy">Save a shared palette for new projects. English and Telugu videos use the captured colors; existing projects keep their palette. Logo uploads are coming next.</p>
    {(loading||!checked)&&<p role="status">Loading shared branding…</p>}{error&&<p role="alert" className="form-error">{error}</p>}{message&&<p role="status">{message}</p>}
    {value&&<><fieldset disabled={!checked||sending||loading||!!command}><legend className="sr-only">Brand colors</legend>
      <div className="brand-color-grid">{([['primaryColor','Primary diagram color'],['secondaryColor','Secondary diagram color'],['backgroundColor','Video background']] as const).map(([key,label])=><div className="brand-color-field" key={key}><label htmlFor={`brand-${key}`}>{label}</label><div><input type="color" aria-label={`Pick ${label.toLowerCase()}`} value={isColor(draft[key])?draft[key]:initialBrand[key]} onChange={e=>setDraft({...draft,[key]:e.target.value})}/><input id={`brand-${key}`} value={draft[key]} maxLength={7} spellCheck={false} autoComplete="off" onChange={e=>{setDraft({...draft,[key]:e.target.value});setMessage('');}} aria-describedby="brand-color-help"/></div></div>)}</div>
      <p id="brand-color-help" className="muted-copy">Six-digit hex colors. Both diagram colors need 3:1 contrast against the background. Preview text uses whichever of black or white is more readable; diagram text stays on the background.</p>
      <div className="editor-actions"><Button variant="secondary" onClick={()=>{setDraft(initialBrand);setMessage('Midnight palette selected. Save to create a brand revision.');}}>Use Midnight palette</Button><Button variant="secondary" onClick={()=>{setDraft({...initialBrand,backgroundColor:'#F5F3EB',primaryColor:'#3660D9',secondaryColor:'#173342'});setMessage('Light palette selected. Save to create a brand revision.');}}>Try a light palette</Button></div>
      <p className="muted-copy">English: Inter · Telugu: Noto Sans Telugu · Educational diagram theme · No logo</p>
    </fieldset>
    <div className="brand-preview" style={{backgroundColor:preview.backgroundColor,color:text}} aria-label="Illustrative brand palette preview">
      <span className="brand-preview-kicker">PALETTE PREVIEW · NOT A GENERATED VIDEO</span><h3>A little idea. A clearer picture.</h3><p lang="te" className="telugu-text">ఒక చిన్న ఆలోచన. స్పష్టమైన వివరణ.</p>
      <div className="brand-preview-diagram"><span style={{borderColor:preview.primaryColor}}>Idea<br/><span lang="te" className="telugu-text">ఆలోచన</span></span><span aria-hidden="true" style={{color:preview.primaryColor}}>→</span><span style={{borderColor:preview.secondaryColor}}>Explain<br/><span lang="te" className="telugu-text">వివరణ</span></span><span aria-hidden="true" style={{color:preview.secondaryColor}}>→</span><span style={{borderColor:preview.primaryColor}}>Understand<br/><span lang="te" className="telugu-text">అవగాహన</span></span></div>
      {!colorsValid&&<p>Showing the Midnight sample until all hex colors are complete.</p>}
    </div>
    <p className="muted-copy">{value.revision?`Saved brand revision ${value.revision}`:'No saved brand yet. This is a sample palette.'}</p>
    <div className="editor-actions"><Button type="submit" disabled={!checked||sending||loading||conflict&&!command}>{sending?'Saving…':command?'Check same brand save':'Save shared brand'}</Button><Button variant="secondary" disabled={sending||loading||!!command} onClick={()=>{try{sessionStorage.removeItem(scope);}catch{}setMessage('');void load();}}>Reload saved brand</Button></div><p className="muted-copy">Reload replaces unsaved colors. Unconfirmed saves retain the same command for retry. Shared defaults, existing projects and videos stay as saved.</p></>}
    {!value&&!loading&&<Button variant="secondary" onClick={()=>void load()}>Reload shared branding</Button>}
  </form>;
}
