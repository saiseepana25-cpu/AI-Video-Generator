import {createHmac,timingSafeEqual} from 'node:crypto';
import {ProjectError,uuidPattern} from '../projects/contracts';
import {activityTypes,type ActivityType} from './contracts';
const bad=(code='INVALID_QUERY')=>new ProjectError(code,400,code==='INVALID_CURSOR'?'This activity page expired or no longer matches your filters. Refresh activity.':'Use valid activity filters and a page size from 1 to 50.');
export function activityQuery(params:URLSearchParams){
  const keys=['limit','cursor','projectId','types'];
  for(const key of params.keys())if(!keys.includes(key)||params.getAll(key).length!==1)throw bad();
  const raw=params.get('limit')??'20';if(!/^[1-9][0-9]?$/.test(raw)||Number(raw)>50)throw bad();
  const projectId=params.get('projectId');if(projectId!==null&&!uuidPattern.test(projectId))throw bad();
  const types=params.has('types')?params.get('types')!.split(','):[];
  if(types.length>activityTypes.length||new Set(types).size!==types.length||types.some(t=>!activityTypes.includes(t as ActivityType)))throw bad();
  const cursor=params.get('cursor');if(cursor!==null&&(!cursor||cursor.length>2048))throw bad('INVALID_CURSOR');
  return {limit:Number(raw),projectId,types:types.sort() as ActivityType[],cursor};
}
export type ActivityQuery=ReturnType<typeof activityQuery>;
const signature=(payload:string,secret:string)=>createHmac('sha256',secret).update(`videocraft:activity:v1:${payload}`).digest();
const filters=(q:ActivityQuery)=>JSON.stringify([q.limit,q.projectId,q.types]);
export function activityCursor(q:ActivityQuery,workspaceId:string,userId:string,before:number,upper:number,secret:string,now=Date.now()){
  const payload=Buffer.from(JSON.stringify({v:1,workspaceId,userId,filters:filters(q),before,upper,expiresAt:now+3600000})).toString('base64url');
  return `${payload}.${signature(payload,secret).toString('base64url')}`;
}
export function readActivityCursor(token:string,q:ActivityQuery,workspaceId:string,userId:string,secret:string,now=Date.now()){
  try{
    if(token.length>2048||!/^[-_A-Za-z0-9]+\.[-_A-Za-z0-9]+$/.test(token))throw Error();
    const [payload,signed]=token.split('.'),actual=Buffer.from(signed,'base64url'),expected=signature(payload,secret);
    if(actual.length!==expected.length||!timingSafeEqual(actual,expected)||actual.toString('base64url')!==signed)throw Error();
    const c=JSON.parse(Buffer.from(payload,'base64url').toString('utf8'));
    if(c.v!==1||c.workspaceId!==workspaceId||c.userId!==userId||c.filters!==filters(q)||!Number.isSafeInteger(c.before)||c.before<1||!Number.isSafeInteger(c.upper)||c.upper<c.before||!Number.isSafeInteger(c.expiresAt)||c.expiresAt<=now||c.expiresAt>now+3600000)throw Error();
    return {before:c.before as number,upper:c.upper as number};
  }catch{throw bad('INVALID_CURSOR');}
}
export function readThroughBody(value:unknown){
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==1||!Object.hasOwn(value,'throughSequence'))throw new ProjectError('INVALID_BODY',400,'Include only throughSequence.');
  const n=(value as {throughSequence:unknown}).throughSequence;
  if(typeof n!=='number'||!Number.isSafeInteger(n)||n<0)throw new ProjectError('VALIDATION_FAILED',422,'Use a nonnegative activity sequence.');
  return n;
}
