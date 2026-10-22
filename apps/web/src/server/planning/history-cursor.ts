import {createHmac, timingSafeEqual} from 'node:crypto';
import {ProjectError} from '../projects/contracts';
export function historyQuery(params: URLSearchParams) {
  if ([...params.keys()].some(k => !['kind', 'limit', 'cursor'].includes(k) || params.getAll(k).length !== 1) || params.get('kind') !== 'plan') throw new ProjectError('INVALID_QUERY', 400, 'Use kind=plan for plan history.');
  const value = params.get('limit') ?? '10';
  if (!/^\d{1,2}$/.test(value) || +value < 1 || +value > 50 || params.has('cursor') && !params.get('cursor')) throw new ProjectError('INVALID_QUERY', 400, 'Choose a page size from 1 to 50 and a valid cursor.');
  return {limit: +value, cursor: params.get('cursor')};
}
const sign = (payload: string, secret: string) => createHmac('sha256', secret).update(`videocraft:plan-history:v1:${payload}`).digest();
export function historyCursor(workspaceId: string, projectId: string, limit: number, before: number, secret: string, now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({v: 1, workspaceId, projectId, kind: 'plan', limit, before, expiresAt: now + 3600000})).toString('base64url');
  return `${payload}.${sign(payload, secret).toString('base64url')}`;
}
export function readHistoryCursor(token: string, workspaceId: string, projectId: string, limit: number, secret: string, now = Date.now()) {
  try {
    if (token.length > 2048 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) throw new Error();
    const [payload, signature] = token.split('.'), expected = sign(payload, secret), actual = Buffer.from(signature, 'base64url');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected) || actual.toString('base64url') !== signature) throw new Error();
    const c = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (c.v !== 1 || c.kind !== 'plan' || c.workspaceId !== workspaceId || c.projectId !== projectId || c.limit !== limit || !Number.isSafeInteger(c.before) || c.before < 1 || !Number.isSafeInteger(c.expiresAt) || c.expiresAt <= now || c.expiresAt > now + 3600000) throw new Error();
    return c.before as number;
  } catch {throw new ProjectError('INVALID_CURSOR', 400, 'This history page expired or changed. Refresh plan history.');}
}
