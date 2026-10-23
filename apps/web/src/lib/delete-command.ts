import {parseDeleteInput,deleteQuery,type DeleteInput} from '../server/projects/deletion';
import {uuidPattern} from '../server/projects/contracts';
export type DeleteCommand={key:string;input:DeleteInput};
export function recoverDeleteCommand(raw:string):DeleteCommand|null{
  try{if(raw.length>500)return null;const v=JSON.parse(raw);if(!v||Array.isArray(v)||Object.keys(v).sort().join(',')!=='input,key'||typeof v.key!=='string'||!uuidPattern.test(v.key)||!v.input||Object.keys(v.input).some(k=>!['expectedProjectRevision','expectedWorkRevision','acknowledgeActiveWork'].includes(k))||typeof v.input.expectedProjectRevision!=='number'||(v.input.expectedWorkRevision!==undefined)!==(v.input.acknowledgeActiveWork===true)||v.input.expectedWorkRevision!==undefined&&typeof v.input.expectedWorkRevision!=='number'||v.input.acknowledgeActiveWork!==undefined&&v.input.acknowledgeActiveWork!==true)return null;return {key:v.key,input:parseDeleteInput(deleteQuery(v.input))};}catch{return null;}
}
