import {randomUUID} from 'node:crypto';
import {dataResponse} from '../http/envelope';
import {ProjectError} from '../projects/contracts';
import {projectErrorResponse} from '../projects/http';
import {authenticatedVideo} from './runtime';
export async function videoHttp(request: Request, id: string, mode: 'latest'|'detail'|'playback') {
  let connection: Awaited<ReturnType<typeof authenticatedVideo>> | undefined;
  try {
    connection = await authenticatedVideo();
    if (new URL(request.url).search) throw new ProjectError('INVALID_QUERY', 400, 'This endpoint does not accept query parameters.');
    if (mode !== 'playback') return dataResponse(mode === 'latest' ? await connection.service.latest(id) : await connection.service.get(id));
    if (request.headers.get('sec-fetch-site') === 'cross-site') throw new ProjectError('CROSS_SITE_DENIED', 403, 'Open this video in the studio.');
    const result = await connection.service.playback(id, request.method === 'HEAD' ? null : request.headers.get('range'), request.method === 'HEAD');
    return new Response(result.body, {status: result.status, headers: {...result.headers, 'X-Request-ID': randomUUID()}});
  } catch (error) {
    const response = projectErrorResponse(error);
    if (error instanceof ProjectError && error.status === 416 && typeof error.details?.size === 'number') response.headers.set('Content-Range', `bytes */${error.details.size}`);
    return response;
  } finally {connection?.store.close();}
}
