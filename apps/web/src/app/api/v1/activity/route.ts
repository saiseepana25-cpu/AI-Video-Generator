import {authenticatedActivity} from '@/server/activity/runtime';
import {projectErrorResponse} from '@/server/projects/http';
import {rejectIfMatch} from '@/server/projects/validation';
import {dataResponse} from '@/server/http/envelope';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(request:Request){try{const {activity}=await authenticatedActivity();rejectIfMatch(request);return dataResponse(await activity.list(new URL(request.url).searchParams));}catch(error){return projectErrorResponse(error);}}
