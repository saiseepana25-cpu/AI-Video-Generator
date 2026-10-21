import {authenticatedPlanEdits} from '@/server/planning/runtime';
import {dataResponse} from '@/server/http/envelope';
import {ProjectError} from '@/server/projects/contracts';
import {projectErrorResponse} from '@/server/projects/http';
import {readProjectBody, rejectIfMatch, requireIdempotencyKey, requireMutationOrigin} from '@/server/projects/validation';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: Request, context: {params: Promise<{planVersionId: string}>}) {
  try {
    const service = await authenticatedPlanEdits(); requireMutationOrigin(request, new URL(process.env.AUTH_URL!).origin); rejectIfMatch(request);
    if (new URL(request.url).search) throw new ProjectError('INVALID_QUERY', 400, 'Restore does not accept query parameters.');
    const key = requireIdempotencyKey(request.headers.get('idempotency-key'));
    const result = await service.restore((await context.params).planVersionId, await readProjectBody(request), key);
    return dataResponse(result.plan, {status: 201, headers: result.replayed ? {'Idempotency-Replayed': 'true'} : {}});
  } catch (error) {return projectErrorResponse(error);}
}
