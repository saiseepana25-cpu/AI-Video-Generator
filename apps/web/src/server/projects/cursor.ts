import {createHash, createHmac, timingSafeEqual} from 'node:crypto';
import {ProjectError, uuidPattern} from './contracts';
import type {ListOptions} from './validation';

type Cursor = {v: 1; endpoint: 'projects'; workspaceId: string; filters: string; updatedAt: string; id: string; expiresAt: number};
function fingerprint(options: ListOptions) {
  return createHash('sha256').update(JSON.stringify({q: options.q, order: options.order})).digest('hex');
}
function signature(payload: string, secret: string) { return createHmac('sha256', secret).update(`videocraft:projects:cursor:v1:${payload}`).digest(); }
export function encodeProjectCursor(workspaceId: string, options: ListOptions, last: {updatedAt: Date; _id: string}, secret: string, now = Date.now()) {
  const cursor: Cursor = {v: 1, endpoint: 'projects', workspaceId, filters: fingerprint(options), updatedAt: last.updatedAt.toISOString(), id: last._id, expiresAt: now + 3600000};
  const payload = Buffer.from(JSON.stringify(cursor)).toString('base64url');
  return `${payload}.${signature(payload, secret).toString('base64url')}`;
}
export function decodeProjectCursor(token: string, workspaceId: string, options: ListOptions, secret: string, now = Date.now()) {
  try {
    if (token.length > 2048 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) throw new Error();
    const [payload, signed] = token.split('.');
    const received = Buffer.from(signed, 'base64url');
    const expected = signature(payload, secret);
    if (received.length !== expected.length || !timingSafeEqual(received, expected) || received.toString('base64url') !== signed) throw new Error();
    const parsed: Cursor = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (parsed.v !== 1 || parsed.endpoint !== 'projects' || parsed.workspaceId !== workspaceId || parsed.filters !== fingerprint(options)
      || !Number.isSafeInteger(parsed.expiresAt) || parsed.expiresAt <= now || parsed.expiresAt > now + 3600000
      || !uuidPattern.test(parsed.id) || new Date(parsed.updatedAt).toISOString() !== parsed.updatedAt) throw new Error();
    return {updatedAt: new Date(parsed.updatedAt), id: parsed.id};
  } catch { throw new ProjectError('INVALID_CURSOR', 400, 'This page link expired or no longer matches your search. Refresh the library.'); }
}
