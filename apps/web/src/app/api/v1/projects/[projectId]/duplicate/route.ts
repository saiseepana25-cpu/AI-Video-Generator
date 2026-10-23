import {authenticatedProjects} from '@/server/projects/runtime';
import {ProjectError} from '@/server/projects/contracts';
import {rejectIfMatch,requireMutationOrigin,requireIdempotencyKey,readProjectBody} from '@/server/projects/validation';
import {projectErrorResponse} from '@/server/projects/http';
import {dataResponse} from '@/server/http/envelope';
export const runtime='nodejs';
export async function POST(request:Request,context:{params:Promise<{projectId:string}>}){
  try{
    const service=await authenticatedProjects();requireMutationOrigin(request,new URL(process.env.AUTH_URL!).origin);rejectIfMatch(request);
    if(new URL(request.url).search)throw new ProjectError('INVALID_QUERY',400,'Project duplication does not accept query fields.');
    const result=await service.duplicate((await context.params).projectId,await readProjectBody(request),requireIdempotencyKey(request.headers.get('idempotency-key')));
    return dataResponse(result.project,{status:201,headers:result.replayed?{'Idempotency-Replayed':'true'}:{}});
  }catch(error){return projectErrorResponse(error);}
}
