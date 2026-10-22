import {authenticatedBrand} from '@/server/brand/runtime';
import {dataResponse} from '@/server/http/envelope';
import {ProjectError} from '@/server/projects/contracts';
import {projectErrorResponse} from '@/server/projects/http';
import {readProjectBody,rejectIfMatch,requireMutationOrigin,requireIdempotencyKey} from '@/server/projects/validation';
export const runtime='nodejs';
function query(request:Request){if(new URL(request.url).search)throw new ProjectError('INVALID_QUERY',400,'Brand settings do not accept query parameters.');rejectIfMatch(request);}
export async function GET(request:Request){try{const service=await authenticatedBrand();query(request);return dataResponse(await service.get());}catch(error){return projectErrorResponse(error);}}
export async function PUT(request:Request){try{const service=await authenticatedBrand();query(request);requireMutationOrigin(request,new URL(process.env.AUTH_URL!).origin);const key=requireIdempotencyKey(request.headers.get('idempotency-key'));const result=await service.put(await readProjectBody(request),key);return dataResponse(result.brand,{status:201,headers:{'Idempotency-Replayed':String(result.replayed)}});}catch(error){return projectErrorResponse(error);}}
