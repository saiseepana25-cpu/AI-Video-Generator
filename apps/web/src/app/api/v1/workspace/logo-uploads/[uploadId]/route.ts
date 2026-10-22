import {authenticatedLogos} from '@/server/logos/runtime';
import {dataResponse} from '@/server/http/envelope';
import {ProjectError,requireProjectId} from '@/server/projects/contracts';
import {projectErrorResponse} from '@/server/projects/http';
import {rejectIfMatch,requireMutationOrigin,requireIdempotencyKey} from '@/server/projects/validation';
import {readLogoBody} from '@/server/logos/http';
export const runtime='nodejs';export const maxDuration=120;
type Context={params:Promise<{uploadId:string}>};
function query(request:Request){if(new URL(request.url).search)throw new ProjectError('INVALID_QUERY',400,'Logo uploads do not accept query parameters.');rejectIfMatch(request);}
export async function GET(request:Request,context:Context){try{const service=await authenticatedLogos();query(request);return dataResponse(await service.get((await context.params).uploadId));}catch(error){return projectErrorResponse(error);}}
export async function PUT(request:Request,context:Context){try{const service=await authenticatedLogos();query(request);requireMutationOrigin(request,new URL(process.env.AUTH_URL!).origin);const id=requireProjectId((await context.params).uploadId);if(requireIdempotencyKey(request.headers.get('idempotency-key'))!==id)throw new ProjectError('INVALID_IDEMPOTENCY_KEY',400,'Use the upload ID as this request key.');const {file,bytes}=await readLogoBody(request);return dataResponse(await service.put(id,file,bytes));}catch(error){return projectErrorResponse(error);}}
