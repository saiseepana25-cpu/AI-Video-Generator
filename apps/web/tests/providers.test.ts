import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseVoiceQuery, voiceCatalog} from '../src/server/providers/catalog';
import {ProviderGateway, ProviderFault} from '../src/server/providers/gateway';
import {providerEnv, providerFixture, providerMock} from './fixtures/providers';

const query = () => parseVoiceQuery(new URLSearchParams('language=te&includeUnavailable=true'));
test('voice query bounds language, use, accent and duplicate/unknown fields', () => {
  for (const raw of ['', 'language=hi', 'language=te&language=en', 'language=en&includeUnavailable=1', 'language=en&intendedUse=commercial', 'language=en&accentId=arbitrary', 'language=te&token=hidden']) assert.throws(() => parseVoiceQuery(new URLSearchParams(raw)));
  assert.equal(parseVoiceQuery(new URLSearchParams('language=en')).includeUnavailable, false);
});
test('operator disablement takes precedence over healthy observations, expiry and configuration changes', () => {
  const row = providerFixture();
  for (const disabled of [{...row, operatorDisabled: true}, {...row, state: 'disabled' as const}, {...row, operatorDisabled: true, expiresAt: new Date(0), configHash: '0'.repeat(64)}]) {
    const catalog = voiceCatalog(query(), [disabled], providerEnv);
    assert.equal(catalog.providers[0].state, 'disabled'); assert.equal(catalog.providers[0].reasonCode, 'PROVIDER_DISABLED'); assert.equal(catalog.items[0].available, false);
  }
});
test('catalog requires current tested language, free capacity and exact configuration; no public provider IDs or secrets', () => {
  const row = providerFixture();
  assert.equal(voiceCatalog(query(), [row], providerEnv).items[0].available, true);
  for (const changed of [{...row, tests: []}, {...row, configHash: '0'.repeat(64)}, {...row, expiresAt: new Date(0)}, {...row, allowance: {...row.allowance, observedRemaining: 0}}, {...row, languages: []}]) assert.equal(voiceCatalog(query(), [changed], providerEnv).items[0].available, false);
  assert.equal(voiceCatalog({...query(), intendedUse: 'publication'}, [row], providerEnv).items[0].reasonCode, 'MEDIA_USAGE_RESTRICTED');
  assert.equal(voiceCatalog({...query(), accentId: 'te-IN'}, [row], providerEnv).items[0].available, false);
  const data = voiceCatalog(query(), [row], providerEnv);
  assert.ok(data.items.slice(1).every(i => !i.available && i.reasonCode === 'PAID_VOICE_UNAVAILABLE'));
  for (const forbidden of ['test-only-eleven-key', 'Xb7hH8MSUJpSbSDYk0k2', row.configHash, 'reservations']) assert.ok(!JSON.stringify(data).includes(forbidden));
});
test('metadata observation uses only fixed GETs and verifies a free account, model rate and built-in voice', async () => {
  const calls: {url: string; method: string}[] = [];
  const observation = await new ProviderGateway(providerEnv, providerMock(calls)).observe('elevenlabs');
  assert.equal(observation.remaining, 1000); assert.deepEqual(observation.languages, ['en', 'te']); assert.ok(calls.every(c => c.method === 'GET'));
  const paidCalls: typeof calls = [];
  assert.equal((await new ProviderGateway(providerEnv, providerMock(paidCalls, {tier: 'starter'})).observe('elevenlabs')).reasonCode, 'PAID_ACCOUNT_BLOCKED');
  assert.equal(paidCalls.length, 1);
});
test('Gemini model access never invents billing or remaining free quota, and missing confirmation makes no request', async () => {
  const calls: {url: string; method: string}[] = [];
  assert.equal((await new ProviderGateway(providerEnv, providerMock(calls)).observe('gemini')).reasonCode, 'FREE_ALLOWANCE_UNVERIFIED');
  calls.length = 0;
  assert.equal((await new ProviderGateway({...providerEnv, GEMINI_FREE_TIER_CONFIRMED: 'false'}, providerMock(calls)).observe('gemini')).reasonCode, 'FREE_TIER_UNCONFIRMED');
  assert.equal(calls.length, 0);
});
test('provider failures are sanitized without retries or payment fallback', async () => {
  for (const status of [401, 402, 403, 429, 500]) {
    let count = 0;
    const request = (async () => {count++; return new Response('private-provider-body', {status});}) as typeof fetch;
    await assert.rejects(new ProviderGateway(providerEnv, request).observe('elevenlabs'), (e: unknown) => e instanceof ProviderFault && !e.message.includes('private-provider-body'));
    assert.equal(count, 1);
  }
});
test('invalid model rates, malformed metadata, oversized responses and silent speech fail closed', async () => {
  for (const response of [() => Response.json({tier: 'free', character_limit: '1000', character_count: 0}), () => new Response('x'.repeat(256 * 1024 + 1))]) {
    await assert.rejects(new ProviderGateway(providerEnv, (async () => response()) as typeof fetch).observe('elevenlabs'), ProviderFault);
  }
  const calls: {url: string; method: string}[] = [];
  const original = providerMock(calls);
  const badRate = (async (url, options) => String(url).endsWith('/v1/models') ? Response.json([{model_id: 'eleven_v3', can_do_text_to_speech: true, token_cost_factor: 3, languages: []}]) : original(url, options)) as typeof fetch;
  await assert.rejects(new ProviderGateway(providerEnv, badRate).observe('elevenlabs'), /MODEL_RATE_UNVERIFIED/);
  await assert.rejects(new ProviderGateway(providerEnv, providerMock([], {post: async () => new Response(Buffer.alloc(4800))})).testSpeech('en'), /VOICE_TEST_FAILED/);
});
