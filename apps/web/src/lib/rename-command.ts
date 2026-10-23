import {parseProjectPatch,type ProjectPatch} from '../server/projects/validation';
import {uuidPattern} from '../server/projects/contracts';
export type RenameCommand={key:string;body:ProjectPatch};
export function recoverRenameCommand(raw:string):RenameCommand|null{
  try{
    if(raw.length>16000)return null;
    const value=JSON.parse(raw);
    if(!value||Array.isArray(value)||Object.keys(value).sort().join(',')!=='body,key'||typeof value.key!=='string'||!uuidPattern.test(value.key))return null;
    const body=parseProjectPatch(value.body);
    if(Object.keys(body.patch).join(',')!=='displayTitle')return null;
    return {key:value.key,body};
  }catch{return null;}
}
