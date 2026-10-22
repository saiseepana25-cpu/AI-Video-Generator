import {authenticatedLogos} from '@/server/logos/runtime';
import {dataResponse} from '@/server/http/envelope';
import {ProjectError} from '@/server/projects/contracts';
import {projectErrorResponse} from '@/server/projects/http';
import {rejectIfMatch} from '@/server/projects/validation';
export const runtime='nodejs';
export async function GET(request:Request){try{const service=await authenticatedLogos();rejectIfMatch(request);if(new URL(request.url).search)throw new ProjectError('INVALID_QUERY',400,'Logo choices do not accept query parameters.');return dataResponse(await service.list());}catch(error){return projectErrorResponse(error);}}
