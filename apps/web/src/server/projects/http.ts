import {randomUUID} from 'node:crypto';
import {authErrorResponse} from '../http/envelope';
import {ProjectError} from './contracts';

export function projectErrorResponse(error: unknown) {
  if (!(error instanceof ProjectError)) return authErrorResponse(error);
  const requestId = randomUUID();
  return Response.json({error: {code: error.code, message: error.message, retryable: error.retryable,
    action: error.status === 404 ? 'return_to_projects' : error.status === 401 ? 'sign_in' : error.retryable ? 'retry_same_request' : 'correct_request',
    fieldErrors: error.fieldErrors, details: {}}, meta: {requestId, serverTime: new Date().toISOString()}},
  {status: error.status, headers: {'Cache-Control': 'private, no-store', Vary: 'Cookie', 'X-Content-Type-Options': 'nosniff', 'X-Request-ID': requestId}});
}
