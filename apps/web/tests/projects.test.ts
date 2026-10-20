import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {ProjectError} from '../src/server/projects/contracts';
import {parseProjectInput, parseListOptions, readProjectBody, requireMutationOrigin, rejectIfMatch, escapeLiteralSearch, graphemes} from '../src/server/projects/validation';
import {decodeProjectCursor, encodeProjectCursor} from '../src/server/projects/cursor';
import {projectErrorResponse} from '../src/server/projects/http';

export const inputFixture = () => ({idea: 'Explain the water cycle.', settings: {
  language: 'en', targetSeconds: 60, voiceCatalogId: null, accentId: null,
  brandKitRevisionId: null, themeId: 'clean-educational-v1', captionStyleId: 'readable-default-v1',
}});
const hasCode = (code: string) => (error: unknown) => error instanceof ProjectError && error.code === code;
const secret = 'cursor-unit-test-key-'.repeat(3);
const workspaceId = '10000000-0000-4000-8000-000000000001';

test('draft validation normalizes text, derives title/defaults, and leaves voice/accent unselected', () => {
  const input = parseProjectInput({...inputFixture(), idea: '  First\r\nsecond  '});
  assert.equal(input.idea, 'First\nsecond'); assert.equal(input.displayTitle, 'First second');
  assert.equal(input.audience, 'Beginners'); assert.deepEqual(input.references, []);
  assert.equal(input.settings.voiceCatalogId, null); assert.equal(input.settings.accentId, null);
  const telugu = parseProjectInput({...inputFixture(), idea: 'నీటి చక్రం గురించి వివరించండి.', settings: {...inputFixture().settings, language: 'te'}});
  assert.equal(telugu.settings.language, 'te');
  assert.equal(graphemes('👩‍👩‍👧‍👦').length, 1);
  assert.doesNotThrow(() => parseProjectInput({...inputFixture(), displayTitle: '👩‍👩‍👧‍👦'.repeat(120)}));
});

test('strict draft validation rejects unknown fields, cross-language captions, unsafe references and oversized input', () => {
  for (const raw of [{...inputFixture(), workspaceId}, {...inputFixture(), settings: {...inputFixture().settings, captionLanguage: 'te'}}]) assert.throws(() => parseProjectInput(raw), hasCode('UNKNOWN_FIELD'));
  for (const idea of ['', '  ', 'x'.repeat(2001), '\u0000', '\uD800']) assert.throws(() => parseProjectInput({...inputFixture(), idea}), hasCode('VALIDATION_FAILED'));
  for (const language of ['hi', 'EN', null]) assert.throws(() => parseProjectInput({...inputFixture(), settings: {...inputFixture().settings, language}}));
  assert.throws(() => parseProjectInput({...inputFixture(), settings: {...inputFixture().settings, voiceCatalogId: 'unknown-voice'}}), hasCode('VOICE_UNAVAILABLE'));
  for (const suppliedUrl of ['file:///etc/passwd', 'javascript:alert(1)', 'https://user:password@example.com']) assert.throws(() => parseProjectInput({...inputFixture(), references: [{referenceId: 'ref1', text: 'Source', suppliedUrl}]}));
  assert.throws(() => parseProjectInput({...inputFixture(), references: [{referenceId: 'ref1', text: 'a'}, {referenceId: 'ref1', text: 'b'}]}));
  assert.throws(() => parseProjectInput({...inputFixture(), references: [{referenceId: 'a', text: 'a'.repeat(15000)}, {referenceId: 'b', text: 'a'.repeat(10000)}]}));
});

test('project search is literal, bounds limits and rejects duplicate/unsupported query fields', () => {
  const options = parseListOptions(new URLSearchParams('q=HELLO&limit=7'));
  assert.equal(options.q, 'hello'); assert.equal(options.limit, 7);
  for (const q of ['limit=0', 'limit=51', 'limit=1.2', 'limit=1e1', 'limit=01', 'q=a&q=b', 'order=oldest', 'workspaceId=x', 'generationState=ready']) assert.throws(() => parseListOptions(new URLSearchParams(q)), hasCode('INVALID_QUERY'));
  const regex = new RegExp(escapeLiteralSearch('.*[a]+'));
  assert.equal(regex.test('anything'), false); assert.equal(regex.test('literal .*[a]+ title'), true);
});

test('cursor integrity binds workspace, filters, order, expiry and typed sort tuple', () => {
  const options = parseListOptions(new URLSearchParams('q=water'));
  const last = {_id: randomUUID(), updatedAt: new Date('2026-10-20T10:00:00.000Z')};
  const now = Date.now();
  const token = encodeProjectCursor(workspaceId, options, last, secret, now);
  assert.deepEqual(decodeProjectCursor(token, workspaceId, options, secret, now), {id: last._id, updatedAt: last.updatedAt});
  for (const invalid of [token + 'a', token.replace(/^./, token[0] === 'a' ? 'b' : 'a'), 'bad', 'a'.repeat(2049)]) assert.throws(() => decodeProjectCursor(invalid, workspaceId, options, secret, now), hasCode('INVALID_CURSOR'));
  assert.throws(() => decodeProjectCursor(token, randomUUID(), options, secret, now), hasCode('INVALID_CURSOR'));
  assert.throws(() => decodeProjectCursor(token, workspaceId, {...options, q: 'different'}, secret, now), hasCode('INVALID_CURSOR'));
  assert.throws(() => decodeProjectCursor(token, workspaceId, options, secret, now + 3600000), hasCode('INVALID_CURSOR'));
});

test('mutation origin requires canonical host and exact origin; If-Match is unsupported', () => {
  const origin = 'http://127.0.0.1:3000';
  const request = (headers: HeadersInit) => new Request(origin + '/api/v1/projects', {method: 'POST', headers});
  assert.doesNotThrow(() => requireMutationOrigin(request({Host: '127.0.0.1:3000', Origin: origin}), origin));
  const rejectedHeaders: HeadersInit[] = [{}, {Host: 'localhost:3000', Origin: origin}, {Host: '127.0.0.1:3000', Origin: 'https://evil.example'}];
  for (const headers of rejectedHeaders) assert.throws(() => requireMutationOrigin(request(headers), origin), hasCode('ORIGIN_NOT_ALLOWED'));
  assert.throws(() => rejectIfMatch(request({'If-Match': '1'})), hasCode('UNSUPPORTED_PRECONDITION'));
});

test('JSON body reader enforces actual bytes, UTF-8, content type and malformed JSON independently of Content-Length', async () => {
  const request = (body: BodyInit, headers: HeadersInit = {'Content-Type': 'application/json'}) => new Request('http://127.0.0.1:3000/api/v1/projects', {method: 'POST', body, headers});
  assert.deepEqual(await readProjectBody(request('{"idea":"hello"}')), {idea: 'hello'});
  await assert.rejects(readProjectBody(request('{broken')), hasCode('MALFORMED_JSON'));
  await assert.rejects(readProjectBody(request('plain', {'Content-Type': 'text/plain'})), hasCode('UNSUPPORTED_MEDIA_TYPE'));
  await assert.rejects(readProjectBody(request('x'.repeat(128 * 1024 + 1), {'Content-Type': 'application/json', 'Content-Length': '0'})), hasCode('INPUT_TOO_LARGE'));
  await assert.rejects(readProjectBody(request(new Uint8Array([0xff]))), hasCode('MALFORMED_JSON'));
});

test('project errors preserve safe envelopes and redact unexpected internal causes', async () => {
  const known = projectErrorResponse(new ProjectError('RESOURCE_NOT_FOUND', 404, 'Project not found.'));
  assert.equal(known.status, 404); assert.equal(known.headers.get('cache-control'), 'private, no-store');
  assert.ok((await known.json()).meta.requestId);
  const unknown = projectErrorResponse(new Error('private database connection details'));
  assert.equal(unknown.status, 500); assert.ok(unknown.headers.get('x-request-id')); assert.ok(!(await unknown.text()).includes('private database connection details'));
});
