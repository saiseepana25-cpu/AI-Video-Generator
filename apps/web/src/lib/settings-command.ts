import {parseSettingsPatch,type SettingsPatch} from '../server/settings/validation';
import {uuidPattern} from '../server/projects/contracts';
export type SettingsCommand={key:string;body:SettingsPatch};
export function recoverSettingsCommand(raw:string):SettingsCommand|null{
  try{if(raw.length>16000)return null;const value=JSON.parse(raw);if(!value||Array.isArray(value)||Object.keys(value).some(k=>!['key','body'].includes(k))||typeof value.key!=='string'||!uuidPattern.test(value.key))return null;
    const body=parseSettingsPatch(value.body);if(!body.patch.defaults||!body.patch.timezone)return null;return {key:value.key,body};
  }catch{return null;}
}
