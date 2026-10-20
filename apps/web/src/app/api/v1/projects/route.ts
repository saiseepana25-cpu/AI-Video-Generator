import {authenticatedProjects} from '@/server/projects/runtime';
import {ProjectError} from '@/server/projects/contracts';
import {parseListOptions, readProjectBody, rejectIfMatch, requireIdempotencyKey, requireMutationOrigin} from '@/server/projects/validation';
import {projectErrorResponse} from '@/server/projects/http';
import {dataResponse} from '@/server/http/envelope';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const service = await authenticatedProjects();
    rejectIfMatch(request);
    return dataResponse(await service.list(parseListOptions(new URL(request.url).searchParams)));
  } catch (error) { return projectErrorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const service = await authenticatedProjects();
    requireMutationOrigin(request, new URL(process.env.AUTH_URL!).origin);
    rejectIfMatch(request);
    if (new URL(request.url).search) throw new ProjectError('INVALID_QUERY', 400, 'Project creation does not accept query fields.');
    const key = requireIdempotencyKey(request.headers.get('idempotency-key'));
    const result = await service.create(await readProjectBody(request), key);
    return dataResponse(result.project, {status: 201, headers: {
      Location: `/api/v1/projects/${result.project.id}`,
      ...(result.replayed ? {'Idempotency-Replayed': 'true'} : {}),
    }});
  } catch (error) { return projectErrorResponse(error); }
}
