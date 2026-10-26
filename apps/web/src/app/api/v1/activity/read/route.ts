import {authenticatedActivity} from '@/server/activity/runtime';
import {ProjectError} from '@/server/projects/contracts';
import {projectErrorResponse} from '@/server/projects/http';
import {readProjectBody,rejectIfMatch,requireMutationOrigin} from '@/server/projects/validation';
import {dataResponse} from '@/server/http/envelope';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function POST(request:Request){try{const {activity}=await authenticatedActivity();requireMutationOrigin(request,new URL(process.env.AUTH_URL!).origin);rejectIfMatch(request);if(new URL(request.url).search)throw new ProjectError('INVALID_QUERY',400,'Read acknowledgement does not accept query fields.');return dataResponse(await activity.markRead(await readProjectBody(request)));}catch(error){return projectErrorResponse(error);}}
