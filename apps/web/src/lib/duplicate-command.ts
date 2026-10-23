import {parseDuplicateInput,type DuplicateInput} from '../server/projects/validation';
import {uuidPattern} from '../server/projects/contracts';
export type DuplicateCommand={key:string;body:DuplicateInput};
export function recoverDuplicateCommand(raw:string):DuplicateCommand|null{
  try{if(raw.length>16000)return null;const v=JSON.parse(raw);if(!v||Array.isArray(v)||Object.keys(v).sort().join(',')!=='body,key'||typeof v.key!=='string'||!uuidPattern.test(v.key))return null;return {key:v.key,body:parseDuplicateInput(v.body)};}catch{return null;}
}
