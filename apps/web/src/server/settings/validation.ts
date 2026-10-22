import {ProjectError} from '../projects/contracts';
export type WorkspaceDefaults={language:'en'|'te';targetSeconds:30|60|90;preferredVoiceCatalogId:string|null;preferredAccentId:string|null;themeId:string;captionStyleId:string};
export type SettingsPatch={expectedRevision:number;patch:{timezone?:string;defaults?:WorkspaceDefaults}};
const invalid=(message:string):never=>{throw new ProjectError('VALIDATION_FAILED',422,message);};
function object(value:unknown,allowed:string[]):Record<string,unknown>{
  if(!value||typeof value!=='object'||Array.isArray(value))return invalid('Use the documented settings object.');
  if(Object.keys(value).some(k=>!allowed.includes(k)))throw new ProjectError('UNKNOWN_FIELD',400,'Remove unsupported settings fields.');
  return value as Record<string,unknown>;
}
export function parseWorkspaceDefaults(value:unknown):WorkspaceDefaults{
  const d=object(value,['language','targetSeconds','preferredVoiceCatalogId','preferredAccentId','themeId','captionStyleId']);
  if(Object.keys(d).length!==6||!['en','te'].includes(d.language as string)||![30,60,90].includes(d.targetSeconds as number))return invalid('Include all defaults and choose a supported language and length.');
  if(d.themeId!=='clean-educational-v1'||d.captionStyleId!=='readable-default-v1')return invalid('Use the supported educational theme and readable captions.');
  if(d.preferredVoiceCatalogId!==null&&!['alice-evaluation','madhavi','bharadwaj'].includes(d.preferredVoiceCatalogId as string)
    ||d.preferredAccentId!==null&&!['source-voice','en-IN','te-IN'].includes(d.preferredAccentId as string))return invalid('Choose a supported catalog voice/accent or leave both unselected.');
  if((d.preferredVoiceCatalogId===null)!==(d.preferredAccentId===null))return invalid('Choose both a voice and its accent, or leave both unselected.');
  return {language:d.language as 'en'|'te',targetSeconds:d.targetSeconds as 30|60|90,preferredVoiceCatalogId:d.preferredVoiceCatalogId as string|null,preferredAccentId:d.preferredAccentId as string|null,themeId:d.themeId,captionStyleId:d.captionStyleId};
}
export function parseSettingsPatch(raw:unknown):SettingsPatch{
  const body=object(raw,['expectedRevision','patch']);
  if(body.expectedRevision===undefined)throw new ProjectError('PRECONDITION_REQUIRED',428,'Include the saved settings revision.');
  if(!Number.isSafeInteger(body.expectedRevision)||(body.expectedRevision as number)<1)return invalid('Use a positive safe settings revision.');
  const source=object(body.patch,['timezone','defaults']);if(!Object.keys(source).length)return invalid('Include timezone or a complete defaults replacement.');
  const patch:SettingsPatch['patch']={};
  if('timezone'in source){
    if(typeof source.timezone!=='string'||source.timezone.length>100||!source.timezone||source.timezone.trim()!==source.timezone||!/^[-A-Za-z0-9_+/]+$/.test(source.timezone))return invalid('Enter a valid IANA timezone, such as Asia/Kolkata.');
    try{new Intl.DateTimeFormat('en',{timeZone:source.timezone});}catch{return invalid('Enter a valid IANA timezone, such as Asia/Kolkata.');}
    patch.timezone=source.timezone;
  }
  if('defaults'in source)patch.defaults=parseWorkspaceDefaults(source.defaults);
  return {expectedRevision:body.expectedRevision as number,patch};
}
/** Legacy bootstrap's unresolved "indian" accent is not a selected catalog
 * accent. Read it as unselected without rewriting the stored workspace. */
export function effectiveDefaults(stored:WorkspaceDefaults):WorkspaceDefaults{
  return {...stored,preferredAccentId:stored.preferredVoiceCatalogId?stored.preferredAccentId:null};
}
