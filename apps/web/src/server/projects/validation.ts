import {ProjectError, uuidPattern, type ProjectInput} from './contracts';

const segmenter = new Intl.Segmenter('en', {granularity: 'grapheme'});
export const graphemes = (value: string) => [...segmenter.segment(value)].map(segment => segment.segment);
export const normalizeText = (value: string) => value.replace(/\r\n?/g, '\n').normalize('NFC').trim();
export const searchTitle = (value: string) => normalizeText(value).toLowerCase();
export const escapeLiteralSearch = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function fail(path: string, message: string): never {
  throw new ProjectError('VALIDATION_FAILED', 422, 'Check the highlighted fields.', [{path, code: 'INVALID_VALUE', message}]);
}
function object(value: unknown, keys: string[], path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path, 'Use an object.');
  if (Object.keys(value).some(key => !keys.includes(key))) throw new ProjectError('UNKNOWN_FIELD', 400, 'The request contains an unsupported field.', [{path, code: 'UNKNOWN_FIELD', message: 'Remove unsupported fields.'}]);
  return value as Record<string, unknown>;
}
function text(value: unknown, path: string, max: number, fallback?: string): string {
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== 'string' || value.length > max * 40) fail(path, `Enter between 1 and ${max} characters.`);
  const normalized = normalizeText(value);
  if (!normalized || graphemes(normalized).length > max || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(normalized) || /[\uD800-\uDFFF]/u.test(normalized)) fail(path, `Enter between 1 and ${max} characters.`);
  return normalized;
}
function unresolved(value: unknown, path: string) {
  if (value === undefined) fail(path, 'Include this field as null until selection is available.');
  if (value !== null) throw new ProjectError('VOICE_UNAVAILABLE', 503, 'Voice selection is not connected yet. Save a draft with voice and accent unselected.', [{path, code: 'VOICE_UNAVAILABLE', message: 'Use null until the compatible voice catalog is available.'}]);
  return null;
}

export function parseProjectInput(value: unknown): ProjectInput {
  const body = object(value, ['displayTitle', 'idea', 'audience', 'references', 'settings'], '/');
  const idea = text(body.idea, '/idea', 2000);
  const displayTitle = text(body.displayTitle, '/displayTitle', 120, graphemes(idea.replace(/\s+/g, ' ')).slice(0, 70).join(''));
  const audience = text(body.audience, '/audience', 200, 'Beginners');
  const selected = object(body.settings, ['language', 'targetSeconds', 'accentId', 'voiceCatalogId', 'brandKitRevisionId', 'themeId', 'captionStyleId'], '/settings');
  if (selected.language !== 'en' && selected.language !== 'te') fail('/settings/language', 'Choose English or Telugu.');
  if (![30, 60, 90].includes(selected.targetSeconds as number)) fail('/settings/targetSeconds', 'Choose 30, 60 or 90 seconds.');
  const accentId = unresolved(selected.accentId, '/settings/accentId');
  const voiceCatalogId = unresolved(selected.voiceCatalogId, '/settings/voiceCatalogId');
  if (selected.brandKitRevisionId !== null) fail('/settings/brandKitRevisionId', 'Brand kits are not available yet.');
  if (selected.themeId !== 'clean-educational-v1') fail('/settings/themeId', 'Use the supported educational theme.');
  if (selected.captionStyleId !== 'readable-default-v1') fail('/settings/captionStyleId', 'Use the supported caption style.');
  const references: ProjectInput['references'] = [];
  if (body.references !== undefined) {
    if (!Array.isArray(body.references) || body.references.length > 10) fail('/references', 'Use at most 10 references.');
    let length = 0;
    for (const [index, raw] of body.references.entries()) {
      const path = `/references/${index}`;
      const ref = object(raw, ['referenceId', 'text', 'suppliedUrl'], path);
      if (typeof ref.referenceId !== 'string' || !/^[a-z][a-z0-9_-]{0,63}$/.test(ref.referenceId) || references.some(item => item.referenceId === ref.referenceId)) fail(`${path}/referenceId`, 'Use a unique reference ID.');
      const content = text(ref.text, `${path}/text`, 20000);
      length += graphemes(content).length;
      if (length > 20000) fail('/references', 'References must total at most 20,000 characters.');
      let suppliedUrl: string | null = null;
      if (ref.suppliedUrl !== undefined && ref.suppliedUrl !== null) {
        suppliedUrl = text(ref.suppliedUrl, `${path}/suppliedUrl`, 2048);
        try {
          const url = new URL(suppliedUrl);
          if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error();
        } catch { fail(`${path}/suppliedUrl`, 'Use an HTTP or HTTPS source URL without credentials.'); }
      }
      references.push({referenceId: ref.referenceId, text: content, suppliedUrl});
    }
  }
  return {idea, displayTitle, audience, references, settings: {
    language: selected.language, targetSeconds: selected.targetSeconds as 30 | 60 | 90, accentId, voiceCatalogId,
    brandKitRevisionId: null, themeId: selected.themeId, captionStyleId: selected.captionStyleId,
  }};
}

export type ListOptions = {q: string; limit: number; cursor: string | null; order: 'updated_desc'};
export type ProjectPatch = {expectedProjectRevision: number; patch: {brief?: {idea: string; audience: string; references: ProjectInput['references']}; settings?: ProjectInput['settings']}};
export function parseProjectPatch(value: unknown): ProjectPatch {
  const body = object(value, ['expectedProjectRevision', 'patch'], '/');
  if (body.expectedProjectRevision === undefined) throw new ProjectError('PRECONDITION_REQUIRED', 428, 'Include the saved project revision.');
  if (!Number.isSafeInteger(body.expectedProjectRevision) || (body.expectedProjectRevision as number) < 1) fail('/expectedProjectRevision', 'Use a positive safe integer revision.');
  const raw = object(body.patch, ['brief', 'settings'], '/patch');
  if (!Object.keys(raw).length) fail('/patch', 'Include a brief or settings replacement.');
  const patch: ProjectPatch['patch'] = {};
  const defaults = {language: 'en', targetSeconds: 60, accentId: null, voiceCatalogId: null, brandKitRevisionId: null, themeId: 'clean-educational-v1', captionStyleId: 'readable-default-v1'};
  if ('brief' in raw) {
    const brief = object(raw.brief, ['idea', 'audience', 'references'], '/patch/brief');
    for (const key of ['idea', 'audience', 'references']) if (brief[key] === undefined) fail(`/patch/brief/${key}`, 'Include every brief field for replacement.');
    const checked = parseProjectInput({...brief, settings: defaults});
    patch.brief = {idea: checked.idea, audience: checked.audience, references: checked.references};
  }
  if ('settings' in raw) patch.settings = parseProjectInput({idea: 'Validation', settings: raw.settings}).settings;
  return {expectedProjectRevision: body.expectedProjectRevision as number, patch};
}
export function parseListOptions(params: URLSearchParams): ListOptions {
  const allowed = ['q', 'limit', 'cursor', 'order'];
  for (const key of params.keys()) if (!allowed.includes(key) || params.getAll(key).length !== 1) throw new ProjectError('INVALID_QUERY', 400, 'Use supported query fields once each.');
  const rawLimit = params.get('limit') ?? '20';
  if (!/^(?:[1-9]|[1-4][0-9]|50)$/.test(rawLimit)) throw new ProjectError('INVALID_QUERY', 400, 'Limit must be an integer between 1 and 50.');
  const q = searchTitle(params.get('q') ?? '');
  if (q.length > 4800 || graphemes(q).length > 120) throw new ProjectError('INVALID_QUERY', 400, 'Search must contain at most 120 characters.');
  if (params.has('order') && params.get('order') !== 'updated_desc') throw new ProjectError('INVALID_QUERY', 400, 'Only most recently updated ordering is supported.');
  const cursor = params.get('cursor');
  if (cursor !== null && (!cursor || cursor.length > 2048)) throw new ProjectError('INVALID_CURSOR', 400, 'Refresh the project library to continue.');
  return {q, limit: Number(rawLimit), cursor, order: 'updated_desc'};
}

export function requireIdempotencyKey(key: string | null): string {
  if (!key || !uuidPattern.test(key)) throw new ProjectError('VALIDATION_FAILED', 422, 'A UUID Idempotency-Key header is required.');
  return key;
}

export function requireMutationOrigin(request: Request, origin: string) {
  if (request.headers.get('origin') !== origin || request.headers.get('host') !== new URL(origin).host) throw new ProjectError('ORIGIN_NOT_ALLOWED', 403, 'This request is not allowed.');
}
export function rejectIfMatch(request: Request) {
  if (request.headers.has('if-match')) throw new ProjectError('UNSUPPORTED_PRECONDITION', 400, 'Use the documented revision field instead of If-Match.');
}
export async function readProjectBody(request: Request): Promise<unknown> {
  const type = request.headers.get('content-type') ?? '';
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(type) || !['identity', null].includes(request.headers.get('content-encoding'))) throw new ProjectError('UNSUPPORTED_MEDIA_TYPE', 415, 'Send an uncompressed UTF-8 JSON request.');
  const max = 128 * 1024;
  if (Number(request.headers.get('content-length')) > max) throw new ProjectError('INPUT_TOO_LARGE', 413, 'The request exceeds 128 KiB.');
  if (!request.body) throw new ProjectError('MALFORMED_JSON', 400, 'Send a valid JSON object.');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > max) { await reader.cancel(); throw new ProjectError('INPUT_TOO_LARGE', 413, 'The request exceeds 128 KiB.'); }
      chunks.push(next.value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) {bytes.set(chunk, offset); offset += chunk.byteLength;}
    return JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes));
  } catch (error) {
    if (error instanceof ProjectError) throw error;
    throw new ProjectError('MALFORMED_JSON', 400, 'Send valid UTF-8 JSON.');
  } finally {reader.releaseLock();}
}
