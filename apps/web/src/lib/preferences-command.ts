import {parsePreferencesPatch,validatePreferencePair,type PreferencesPatch} from '../server/preferences/validation';
import {uuidPattern} from '../server/projects/contracts';
export type PreferencesCommand={key:string;body:PreferencesPatch};
export function recoverPreferencesCommand(raw:string):PreferencesCommand|null{
  try{
    if(raw.length>16000)return null;const v=JSON.parse(raw);
    if(!v||Array.isArray(v)||Object.keys(v).length!==2||typeof v.key!=='string'||!uuidPattern.test(v.key))return null;
    const body=parsePreferencesPatch(v.body);
    if(!['language','voiceCatalogId','accentId','timezone'].every(k=>Object.hasOwn(body.patch,k)))return null;
    validatePreferencePair(body.patch as Required<PreferencesPatch['patch']>);
    return {key:v.key,body};
  }catch{return null;}
}
