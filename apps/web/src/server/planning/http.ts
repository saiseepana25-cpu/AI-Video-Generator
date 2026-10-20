import {dataResponse} from '../http/envelope';
import {ProjectError} from '../projects/contracts';
import {projectErrorResponse} from '../projects/http';
import {readProjectBody, rejectIfMatch, requireIdempotencyKey, requireMutationOrigin} from '../projects/validation';
import {authenticatedPlanning} from './runtime';
import type {Kind} from './contracts';

export async function planningCommand(request: Request, id: string, action: Kind | 'cancel' | 'retry') {
  try {
    const service = await authenticatedPlanning();
    requireMutationOrigin(request, new URL(process.env.AUTH_URL!).origin); rejectIfMatch(request);
    if (new URL(request.url).search) throw new ProjectError('INVALID_QUERY', 400, 'This endpoint does not accept query parameters.');
    const key = requireIdempotencyKey(request.headers.get('idempotency-key'));
    const result = await service.command(action === 'plan' || action === 'brainstorm' ? id : null, action === 'cancel' || action === 'retry' ? id : null, action, await readProjectBody(request), key);
    return dataResponse(result, {status: result.state === 'cancelled' ? 200 : 202});
  } catch (error) {return projectErrorResponse(error);}
}
export async function planningRead(request: Request, id: string, kind: 'job' | 'plan' | 'overview') {
  try {
    const service = await authenticatedPlanning(); rejectIfMatch(request);
    if (new URL(request.url).search) throw new ProjectError('INVALID_QUERY', 400, 'This endpoint does not accept query parameters.');
    return dataResponse(kind === 'job' ? await service.job(id) : kind === 'plan' ? await service.plan(id) : await service.overview(id));
  } catch (error) {return projectErrorResponse(error);}
}
