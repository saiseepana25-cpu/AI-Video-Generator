import {authenticatedProjects} from '@/server/projects/runtime';
import {ProjectError} from '@/server/projects/contracts';
import {rejectIfMatch, requireMutationOrigin, requireIdempotencyKey, readProjectBody} from '@/server/projects/validation';
import {projectErrorResponse} from '@/server/projects/http';
import {dataResponse} from '@/server/http/envelope';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: {params: Promise<{projectId: string}>}) {
  try {
    const service = await authenticatedProjects();
    rejectIfMatch(request);
    if (new URL(request.url).search) throw new ProjectError('INVALID_QUERY', 400, 'Project details do not accept query fields.');
    return dataResponse(await service.get((await context.params).projectId));
  } catch (error) { return projectErrorResponse(error); }
}

export async function PATCH(request: Request, context: {params: Promise<{projectId: string}>}) {
  try {
    const service = await authenticatedProjects();
    requireMutationOrigin(request, new URL(process.env.AUTH_URL!).origin); rejectIfMatch(request);
    if (new URL(request.url).search) throw new ProjectError('INVALID_QUERY', 400, 'Project edits do not accept query fields.');
    const key = requireIdempotencyKey(request.headers.get('idempotency-key'));
    const result = await service.patch((await context.params).projectId, await readProjectBody(request), key);
    return dataResponse(result.project, {headers: result.replayed ? {'Idempotency-Replayed': 'true'} : {}});
  } catch (error) {return projectErrorResponse(error);}
}
