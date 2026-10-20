import {randomUUID} from 'node:crypto';
import {AccessError} from '../auth/access-policy';

const headers = {'Cache-Control':'private, no-store','Vary':'Cookie','X-Content-Type-Options':'nosniff'};
function meta() { return {requestId:randomUUID(),serverTime:new Date().toISOString()}; }
export function dataResponse(data: unknown) { return Response.json({data,meta:meta()},{headers}); }
export function authErrorResponse(error: unknown) {
  const code = error instanceof AccessError ? error.code : 'INTERNAL_ERROR';
  const status = code === 'TEAM_ACCESS_DENIED' ? 403 : code === 'CONNECTION_UNAVAILABLE' ? 503 : code === 'INTERNAL_ERROR' ? 500 : 401;
  const message = status === 401 ? 'Sign in to continue.' : status === 403 ? 'This account does not have team access.' : 'The studio is temporarily unavailable. Try again.';
  return Response.json({error:{code,message,retryable:status===503,action:status===401?'sign_in':status===403?'contact_operator':'try_again'},meta:meta()},{status,headers});
}
