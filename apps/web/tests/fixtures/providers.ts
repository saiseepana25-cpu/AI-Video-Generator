import {Long} from 'mongodb';
import {providerConfig} from '../../src/server/providers/config';
import type {ProviderControl} from '../../src/server/providers/contracts';
export const providerEnv = {ELEVENLABS_API_KEY: 'test-only-eleven-key', GEMINI_API_KEY: 'test-only-google-key', GEMINI_FREE_TIER_CONFIRMED: 'true'};
export function providerFixture(): ProviderControl {
  const now = new Date();
  return {_id: 'elevenlabs', schemaVersion: 1, configHash: providerConfig('elevenlabs', providerEnv).configHash, revision: Long.ONE, model: 'eleven_v3',
    state: 'enabled', reasonCode: null, checkedAt: now, expiresAt: new Date(now.getTime() + 300000), languages: ['en', 'te'],
    allowance: {unit: 'credits', observedRemaining: 1000, periodId: 'test-period'}, tests: [{language: 'en', testedAt: now}, {language: 'te', testedAt: now}], reservations: []};
}
export function providerMock(calls: {url: string; method: string}[], overrides: {tier?: string; remaining?: number; post?: () => Promise<Response>} = {}): typeof fetch {
  return (async (url: string | URL | Request, options: RequestInit = {}) => {
    const path = String(url); calls.push({url: path, method: options.method ?? 'GET'});
    if (options.method === 'POST') return overrides.post ? overrides.post() : new Response(Buffer.alloc(4800, 1));
    if (path.includes('/user/subscription')) return Response.json({tier: overrides.tier ?? 'free', character_limit: 1000, character_count: 1000 - (overrides.remaining ?? 1000), next_character_count_reset_unix: 9999999999});
    if (path.endsWith('/v1/models')) return Response.json([{model_id: 'eleven_v3', can_do_text_to_speech: true, token_cost_factor: 1, languages: [{language_id: 'en'}, {language_id: 'te'}]}]);
    if (path.includes('/v1/voices/')) return Response.json({voice_id: 'Xb7hH8MSUJpSbSDYk0k2', category: 'premade', name: 'Alice'});
    if (path.includes('generativelanguage.googleapis.com')) return Response.json({name: 'models/gemini-3.5-flash-lite', supportedGenerationMethods: ['generateContent']});
    throw new Error('Unexpected test endpoint');
  }) as typeof fetch;
}
