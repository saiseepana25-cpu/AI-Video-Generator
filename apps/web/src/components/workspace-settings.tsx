'use client';
import {useEffect,useRef,useState,type FormEvent} from 'react';
import type {SettingsView} from '@/server/settings/service';
import {parseSettingsPatch} from '@/server/settings/validation';
import {recoverSettingsCommand,type SettingsCommand} from '@/lib/settings-command';
import {canCorrectSaveFailure} from '@/lib/save-outcome';
import {VoiceControls} from './voice-controls';
import {Button} from './ui';
export function WorkspaceSettings({workspaceId,userId}:{workspaceId:string;userId:string}){
  const scope=`videocraft:${workspaceId}:${userId}:workspace-settings:v1`;
  const [value,setValue]=useState<SettingsView|null>(null),[command,setCommand]=useState<SettingsCommand|null>(null),[checked,setChecked]=useState(false),[sending,setSending]=useState(false),[loading,setLoading]=useState(false),[conflict,setConflict]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
  const busy=useRef(false),epoch=useRef(0);
  async function load(){const request=++epoch.current;setLoading(true);setError('');
    try{const response=await fetch('/api/v1/workspace/settings',{cache:'no-store',signal:AbortSignal.timeout(10000)});if(!response.ok)throw new Error();const next=(await response.json()).data as SettingsView;if(request!==epoch.current)return;setValue(next);setConflict(false);}
    catch{if(request===epoch.current)setError('Could not load workspace settings. Reconnect or sign in again, then reload.');}
    finally{if(request===epoch.current)setLoading(false);}
  }
  useEffect(()=>{void(async()=>{await load();try{const raw=sessionStorage.getItem(scope);if(raw){const saved=recoverSettingsCommand(raw);if(saved){setCommand(saved);setValue({revision:saved.body.expectedRevision,timezone:saved.body.patch.timezone!,defaults:saved.body.patch.defaults!,brandKitRevisionId:null});setMessage('An earlier save is unconfirmed. Check the same save before making more changes.');}else{setConflict(true);setError('The saved command is unreadable. Reload saved settings before continuing.');}}}catch{setError('Tab recovery is unavailable. Keep this page open while saving.');}setChecked(true);})();return()=>{epoch.current++;};},[scope]);
  async function save(event?:FormEvent){event?.preventDefault();if(busy.current||!value||!checked)return;
    let next=command;
    try{next??={key:crypto.randomUUID(),body:parseSettingsPatch({expectedRevision:value.revision,patch:{timezone:value.timezone,defaults:value.defaults}})};}
    catch(cause){setError(cause instanceof Error?cause.message:'Check your settings before saving.');return;}
    try{sessionStorage.setItem(scope,JSON.stringify(next));}catch{setError('Could not preserve this save for recovery. Keep this page open and try again.');return;}
    busy.current=true;setSending(true);setCommand(next);setError('');setMessage('');
    try{const response=await fetch('/api/v1/workspace/settings',{method:'PATCH',headers:{'Content-Type':'application/json','Idempotency-Key':next.key},body:JSON.stringify(next.body),signal:AbortSignal.timeout(20000)});const result=await response.json();
      if(!response.ok){if(!canCorrectSaveFailure(response.status,result.error?.code)){setError('Save outcome is unconfirmed. Reconnect or sign in again, then check the same save.');return;}
        sessionStorage.removeItem(scope);setCommand(null);setConflict(response.status===409);setError(result.error?.message??'Check your settings and try again.');return;}
      sessionStorage.removeItem(scope);setCommand(null);setValue(result.data);await load();setMessage('Save confirmed. Shared defaults apply to new projects; earlier projects retain their settings.');
    }catch{setError('Save outcome is unconfirmed. Reconnect and check the same save.');}
    finally{busy.current=false;setSending(false);}
  }
  return <form className="draft-editor workspace-settings" onSubmit={save} aria-label="Shared workspace defaults" aria-busy={sending||loading}>
    <span className="section-index">SHARED BY YOUR TEAM</span><h2>Start with the right defaults.</h2><p className="muted-copy">Choose the starting point for new projects. Existing plans, videos and scheduled times keep their saved settings.</p>
    {(loading||!checked)&&<p role="status">Loading workspace settings…</p>}{error&&<p role="alert" className="form-error">{error}</p>}{message&&<p role="status">{message}</p>}
    {value&&<><fieldset disabled={!checked||sending||loading||!!command}><legend className="sr-only">Workspace video and timezone defaults</legend>
      <div className="workspace-settings-grid"><label>Default video language<select value={value.defaults.language} onChange={e=>setValue({...value,defaults:{...value.defaults,language:e.target.value as 'en'|'te',preferredVoiceCatalogId:null,preferredAccentId:null}})}><option value="en">English</option><option value="te">తెలుగు · Telugu</option></select></label>
      <label>Default video length<select value={value.defaults.targetSeconds} onChange={e=>setValue({...value,defaults:{...value.defaults,targetSeconds:Number(e.target.value) as 30|60|90}})}>{[30,60,90].map(n=><option key={n} value={n}>{n} seconds</option>)}</select></label></div>
      <p className="muted-copy">English uses English subtitles. Telugu uses Telugu subtitles.</p>
      <VoiceControls settings={{language:value.defaults.language,targetSeconds:value.defaults.targetSeconds,voiceCatalogId:value.defaults.preferredVoiceCatalogId,accentId:value.defaults.preferredAccentId,themeId:value.defaults.themeId,captionStyleId:value.defaults.captionStyleId,brandKitRevisionId:null}}
        onChange={next=>setValue({...value,defaults:{...value.defaults,preferredVoiceCatalogId:next.voiceCatalogId,preferredAccentId:next.accentId}})}/>
      <label>Workspace timezone<input value={value.timezone} onChange={e=>setValue({...value,timezone:e.target.value})} placeholder="Asia/Kolkata" autoComplete="off" aria-describedby="timezone-help"/></label>
      <p className="muted-copy" id="timezone-help">Use an IANA timezone, for example Asia/Kolkata. Changing this default does not move any existing scheduled instant.</p>
      <p className="muted-copy">Educational diagram theme · Readable captions · Workspace revision {value.revision}</p>
    </fieldset>
    <div className="editor-actions"><Button type="submit" disabled={!checked||sending||loading||conflict&&!command}>{sending?'Saving…':command?'Check same settings save':'Save shared defaults'}</Button><Button variant="secondary" disabled={sending||loading||!!command} onClick={()=>{try{sessionStorage.removeItem(scope);}catch{}setMessage('');void load();}}>Reload saved settings</Button></div><p className="muted-copy">Reload replaces unsaved form changes. An unconfirmed save keeps its original request until checked.</p></>}
    {!value&&!loading&&<Button variant="secondary" onClick={()=>void load()}>Reload workspace settings</Button>}
  </form>;
}
