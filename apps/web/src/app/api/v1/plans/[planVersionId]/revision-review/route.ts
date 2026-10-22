import {authenticatedRevisionReview} from '@/server/planning/runtime';
import {dataResponse} from '@/server/http/envelope';
import {ProjectError} from '@/server/projects/contracts';
import {projectErrorResponse} from '@/server/projects/http';
export const runtime = 'nodejs';
export async function GET(request: Request, context: {params: Promise<{planVersionId:string}>}) {
  try {
    const service=await authenticatedRevisionReview();
    if (new URL(request.url).search) throw new ProjectError('INVALID_QUERY',400,'Revision review does not accept query parameters.');
    return dataResponse(await service.review((await context.params).planVersionId));
  } catch (error) {return projectErrorResponse(error);}
}
