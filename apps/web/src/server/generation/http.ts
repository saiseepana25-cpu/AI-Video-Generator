import {dataResponse} from '../http/envelope';
import {ProjectError} from '../projects/contracts';
import {projectErrorResponse} from '../projects/http';
import {readProjectBody, rejectIfMatch, requireIdempotencyKey, requireMutationOrigin} from '../projects/validation';
import {authenticatedGeneration} from './runtime';
export async function generationHttp(request: Request, id: string, mutation: boolean) {
  try {
    const service = await authenticatedGeneration(); rejectIfMatch(request);
    if (new URL(request.url).search) throw new ProjectError('INVALID_QUERY', 400, 'This endpoint does not accept query parameters.');
    if (!mutation) return dataResponse(await service.overview(id));
    requireMutationOrigin(request, new URL(process.env.AUTH_URL!).origin);
    const key = requireIdempotencyKey(request.headers.get('idempotency-key'));
    const result = await service.approve(id, await readProjectBody(request), key);
    return dataResponse(result.job, {status: ['queued', 'running', 'cancellation_requested'].includes(result.job.state) ? 202 : 200, headers: {'Idempotency-Replayed': String(result.replayed)}});
  } catch (error) {return projectErrorResponse(error);}
}
