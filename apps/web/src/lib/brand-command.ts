import {parseBrandPut,type BrandPut} from '../server/brand/validation';
import {uuidPattern} from '../server/projects/contracts';
export type BrandCommand={key:string;body:BrandPut};
export function recoverBrandCommand(raw:string):BrandCommand|null{
  try{if(raw.length>16000)return null;const value=JSON.parse(raw);if(!value||Array.isArray(value)||Object.keys(value).some(k=>!['key','body'].includes(k))||typeof value.key!=='string'||!uuidPattern.test(value.key))return null;
    const body=parseBrandPut(value.body);return {key:value.key,body};
  }catch{return null;}
}
