import {authenticatedActivity} from '@/server/activity/runtime';
import {ProjectError} from '@/server/projects/contracts';
import {projectErrorResponse} from '@/server/projects/http';
import {rejectIfMatch} from '@/server/projects/validation';
import {dataResponse} from '@/server/http/envelope';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(request:Request){try{const {operations}=await authenticatedActivity();rejectIfMatch(request);if(new URL(request.url).search)throw new ProjectError('INVALID_QUERY',400,'Operations does not accept query fields.');return dataResponse(await operations.read());}catch(error){return projectErrorResponse(error);}}
