import {parseLogoFile,type LogoFile} from '../server/logos/contracts';
import {uuidPattern} from '../server/projects/contracts';
export type LogoCommand={id:string;file:LogoFile};
export function recoverLogoCommand(raw:string):LogoCommand|null{
  try{if(raw.length>4000)return null;const value=JSON.parse(raw);if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!=='file,id'||typeof value.id!=='string'||!uuidPattern.test(value.id))return null;return {id:value.id,file:parseLogoFile(value.file)};}catch{return null;}
}
