import {authenticatedRenderInput} from '@/server/planning/runtime';
import {dataResponse} from '@/server/http/envelope';
import {ProjectError} from '@/server/projects/contracts';
import {projectErrorResponse} from '@/server/projects/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: {params: Promise<{planVersionId: string}>}) {
  try {
    const service = await authenticatedRenderInput();
    if (new URL(request.url).search) throw new ProjectError('INVALID_QUERY', 400, 'Video input checks do not accept query parameters.');
    return dataResponse(await service.check((await context.params).planVersionId));
  } catch (error) {return projectErrorResponse(error);}
}
