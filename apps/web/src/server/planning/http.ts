import {dataResponse} from '../http/envelope';
import {ProjectError} from '../projects/contracts';
import {projectErrorResponse} from '../projects/http';
import {readProjectBody, rejectIfMatch, requireIdempotencyKey, requireMutationOrigin} from '../projects/validation';
import {authenticatedPlanning} from './runtime';
import type {Kind} from './contracts';
import {authenticatedGeneration} from '../generation/runtime';

export async function planningCommand(request: Request, id: string, action: Kind | 'cancel' | 'retry') {
  try {
    const service = await authenticatedPlanning();
    requireMutationOrigin(request, new URL(process.env.AUTH_URL!).origin); rejectIfMatch(request);
    if (new URL(request.url).search) throw new ProjectError('INVALID_QUERY', 400, 'This endpoint does not accept query parameters.');
    const key = requireIdempotencyKey(request.headers.get('idempotency-key'));
    const body = await readProjectBody(request);
    if (action === 'cancel' || action === 'retry') {
      const generation = await authenticatedGeneration();
      if (await generation.job(id)) {
        if (action === 'retry') throw new ProjectError('GENERATION_RETRY_UNAVAILABLE', 409, 'Generation retries will be available with the renderer.');
        const result = await generation.cancel(id, body, key);
        return dataResponse(result.job, {headers: {'Idempotency-Replayed': String(result.replayed)}});
      }
    }
    const result = await service.command(action === 'plan' || action === 'brainstorm' ? id : null, action === 'cancel' || action === 'retry' ? id : null, action, body, key);
    return dataResponse(result, {status: result.state === 'cancelled' ? 200 : 202});
  } catch (error) {return projectErrorResponse(error);}
}
export async function planningRead(request: Request, id: string, kind: 'job' | 'plan' | 'overview') {
  try {
    const service = await authenticatedPlanning(); rejectIfMatch(request);
    if (new URL(request.url).search) throw new ProjectError('INVALID_QUERY', 400, 'This endpoint does not accept query parameters.');
    if (kind === 'job') {const generation = await (await authenticatedGeneration()).job(id); if (generation) return dataResponse(generation);}
    return dataResponse(kind === 'job' ? await service.job(id) : kind === 'plan' ? await service.plan(id) : await service.overview(id));
  } catch (error) {return projectErrorResponse(error);}
}
