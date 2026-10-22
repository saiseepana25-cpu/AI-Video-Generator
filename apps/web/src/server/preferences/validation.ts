import {ProjectError} from '../projects/contracts';
import {parseSettingsPatch} from '../settings/validation';
export type Preferences={language:'en'|'te'|null;voiceCatalogId:string|null;accentId:string|null;timezone:string|null};
export const emptyPreferences:Preferences={language:null,voiceCatalogId:null,accentId:null,timezone:null};
export type PreferencesPatch={expectedRevision:number;patch:Partial<Preferences>};
const invalid=(message:string):never=>{throw new ProjectError('VALIDATION_FAILED',422,message);};
function object(raw:unknown,keys:string[]):Record<string,unknown>{
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return invalid('Use the documented personal preferences object.');
  if(Object.keys(raw).some(k=>!keys.includes(k)))throw new ProjectError('UNKNOWN_FIELD',400,'Remove unsupported preference fields.');
  return raw as Record<string,unknown>;
}
export function parsePreferencesPatch(raw:unknown):PreferencesPatch{
  const value=object(raw,['expectedRevision','patch']);
  if(value.expectedRevision===undefined)throw new ProjectError('PRECONDITION_REQUIRED',428,'Include your saved preferences revision.');
  if(!Number.isSafeInteger(value.expectedRevision)||(value.expectedRevision as number)<1)return invalid('Use a positive safe preferences revision.');
  const source=object(value.patch,Object.keys(emptyPreferences));if(!Object.keys(source).length)return invalid('Include at least one preference.');
  const patch:Partial<Preferences>={};
  if('language'in source){if(source.language!==null&&!['en','te'].includes(source.language as string))return invalid('Choose English, Telugu or the team language.');patch.language=source.language as Preferences['language'];}
  if('voiceCatalogId'in source){if(source.voiceCatalogId!==null&&!['alice-evaluation','madhavi','bharadwaj'].includes(source.voiceCatalogId as string))return invalid('Choose a supported voice or the team default.');patch.voiceCatalogId=source.voiceCatalogId as string|null;}
  if('accentId'in source){if(source.accentId!==null&&!['source-voice','en-IN','te-IN'].includes(source.accentId as string))return invalid('Choose a supported accent or the team default.');patch.accentId=source.accentId as string|null;}
  if('timezone'in source)patch.timezone=source.timezone===null?null:parseSettingsPatch({expectedRevision:1,patch:{timezone:source.timezone}}).patch.timezone!;
  return {expectedRevision:value.expectedRevision as number,patch};
}
export function validatePreferencePair(p:Preferences){
  if((p.voiceCatalogId===null)!==(p.accentId===null))return invalid('Choose voice and accent separately, or clear both to use team defaults.');
  if(p.voiceCatalogId&&p.language===null)return invalid('Choose a personal video language before saving a personal voice.');
  return p;
}
