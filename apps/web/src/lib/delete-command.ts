import {parseDeleteInput,type DeleteInput} from '../server/projects/deletion';
import {uuidPattern} from '../server/projects/contracts';
export type DeleteCommand={key:string;input:DeleteInput};
export function recoverDeleteCommand(raw:string):DeleteCommand|null{
  try{if(raw.length>500)return null;const v=JSON.parse(raw);if(!v||Array.isArray(v)||Object.keys(v).sort().join(',')!=='input,key'||typeof v.key!=='string'||!uuidPattern.test(v.key)||!v.input||Object.keys(v.input).join(',')!=='expectedProjectRevision'||typeof v.input.expectedProjectRevision!=='number')return null;return {key:v.key,input:parseDeleteInput(new URLSearchParams({expectedProjectRevision:String(v.input.expectedProjectRevision)}))};}catch{return null;}
}
