import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PlanSchema} from '../src/pipeline/schema.js';
import {assemble, FPS, srt} from '../src/pipeline/timing.js';
import {decodeWav, encodeWav} from '../src/pipeline/wav.js';
import {assertElevenLabsFreeBudget, elevenLabsSpeech, checkElevenLabsConnection, outputBlocks, requireFreeGemini, offlineSynthesizer, createGeminiPlan, geminiSpeech} from '../src/pipeline/providers.js';

const plan = PlanSchema.parse(JSON.parse(fs.readFileSync('fixtures/water-cycle.json', 'utf8')));
const signal = (seconds = 1, sampleRate = 22050) => ({sampleRate, samples: Float32Array.from({length: seconds * sampleRate}, (_, i) => Math.sin(i * 0.1) * 0.3)});
const clips = () => new Map(plan.scenes.flatMap((scene) => scene.phrases.map((phrase) => [phrase.id, signal()] as const)));

test('ElevenLabs speech selects the requested voice and decodes measured PCM without fallback', async () => {
  const env = {ELEVENLABS_API_KEY: 'test-only', ELEVENLABS_VOICE_MADHAVI_ID: 'female-test', ELEVENLABS_VOICE_BHARADWAJ_ID: 'male-test', ELEVENLABS_FREE_VOICE_ID: 'premade-test', ELEVENLABS_FREE_VOICE_NAME: 'Alice'};
  const calls: string[] = [];
  const pcm = encodeWav(signal(1, 24000)).subarray(44);
  const request: typeof fetch = async (url, options) => {
    calls.push(String(url));
    assert.equal(options?.method, 'POST');
    assert.equal(new Headers(options?.headers).get('xi-api-key'), env.ELEVENLABS_API_KEY);
    const body = JSON.parse(String(options?.body));
    assert.equal(body.language_code, 'te'); assert.equal(body.model_id, 'eleven_v3'); assert.equal(body.text, 'నీటి చక్రం');
    return new Response(new Uint8Array(pcm));
  };
  for (const voice of ['madhavi', 'bharadwaj', 'free'] as const) {
    const audio = await elevenLabsSpeech('నీటి చక్రం', 'te', voice, env, request);
    assert.equal(audio.sampleRate, 24000); assert.equal(audio.samples.length, 24000);
  }
  assert.ok(calls[0].includes('female-test?output_format=pcm_24000')); assert.ok(calls[1].includes('male-test?output_format=pcm_24000'));
  assert.ok(calls[2].includes('premade-test?output_format=pcm_24000'));
  await assert.rejects(() => elevenLabsSpeech('నీటి చక్రం', 'te', 'free', {ELEVENLABS_API_KEY: 'test-only'}, request), /voice ID is missing/);
  let attempts = 0;
  await assert.rejects(() => elevenLabsSpeech('నీటి చక్రం', 'te', 'madhavi', env, async () => {attempts++; return new Response('{}', {status: 429});}), /without retries/);
  assert.equal(attempts, 1);
  await assert.rejects(() => elevenLabsSpeech('నీటి చక్రం', 'te', 'madhavi', env, async () => new Response(JSON.stringify({detail: {status: 'payment_required'}}), {status: 402})), /paid plan for the selected Voice Library voice/);
});

test('ElevenLabs preflight stops before synthesis when free allowance or Telugu support is unavailable', async () => {
  const env = {ELEVENLABS_API_KEY: 'test-only', ELEVENLABS_VOICE_MADHAVI_ID: 'female-test', ELEVENLABS_VOICE_BHARADWAJ_ID: 'male-test'};
  const request = (tier: string, remaining: number, languages: string[]): typeof fetch => async url => new Response(JSON.stringify(String(url).endsWith('subscription') ? {tier, character_count: 0, character_limit: remaining} : [{model_id: 'eleven_v3', can_do_text_to_speech: true, languages: languages.map(language_id => ({language_id}))}]));
  await assert.rejects(() => assertElevenLabsFreeBudget(env, 100, request('creator', 1000, ['te'])), /confirmed free account/);
  await assert.rejects(() => assertElevenLabsFreeBudget(env, 100, request('free', 299, ['te'])), /Insufficient/);
  await assert.rejects(() => assertElevenLabsFreeBudget(env, 100, request('free', 1000, ['en'])), /Telugu speech support/);
  assert.equal((await assertElevenLabsFreeBudget(env, 100, request('free', 1000, ['te']))).reservedCredits, 300);
});

test('ElevenLabs connection verifies both voices using metadata reads without revealing the key', async () => {
  const env = {ELEVENLABS_API_KEY: 'private-test-credential', ELEVENLABS_VOICE_MADHAVI_ID: 'madhavi-test', ELEVENLABS_VOICE_BHARADWAJ_ID: 'bharadwaj-test'};
  const calls: string[] = [];
  const request: typeof fetch = async (url, options) => {
    assert.equal(options?.method, 'GET'); assert.equal(options?.redirect, 'error');
    assert.equal(new Headers(options?.headers).get('xi-api-key'), env.ELEVENLABS_API_KEY);
    calls.push(String(url));
    const response = String(url).endsWith('user/subscription') ? {tier: 'free', ignored_private_data: env.ELEVENLABS_API_KEY} : String(url).endsWith('madhavi-test') ? {voice_id: 'madhavi-test', name: 'Madhavi - Clear & Natural Conversation'} : {voice_id: 'bharadwaj-test', name: 'Bharadwaj - Profound Telugu Mythology'};
    return new Response(JSON.stringify(response), {status: 200});
  };
  const result = await checkElevenLabsConnection(env, request);
  assert.equal(result.authenticated, true); assert.equal(result.ready, true); assert.equal(result.generationPerformed, false);
  assert.equal(calls.length, 3); assert.ok(calls.every(url => url.startsWith('https://api.elevenlabs.io/v1/')));
  assert.ok(!JSON.stringify(result).includes(env.ELEVENLABS_API_KEY));
});

test('ElevenLabs connection rejects missing keys before network and sanitizes authentication failures', async () => {
  let calls = 0;
  const request: typeof fetch = async () => {calls++; return new Response(JSON.stringify({message: 'sensitive-provider-body'}), {status: 401});};
  await assert.rejects(() => checkElevenLabsConnection({}, request), /ELEVENLABS_API_KEY is missing/);
  assert.equal(calls, 0);
  const env = {ELEVENLABS_API_KEY: 'test-only', ELEVENLABS_VOICE_MADHAVI_ID: 'madhavi-test', ELEVENLABS_VOICE_BHARADWAJ_ID: 'bharadwaj-test'};
  await assert.rejects(() => checkElevenLabsConnection(env, request), error => error instanceof Error && error.message.includes('HTTP 401') && !error.message.includes('sensitive-provider-body'));
  assert.equal(calls, 1);
  const keyIdResponse: typeof fetch = async () => new Response(JSON.stringify({detail: {status: 'api_key_id_used_as_api_key', message: 'private provider error text'}}), {status: 400});
  await assert.rejects(() => checkElevenLabsConnection(env, keyIdResponse), /API key ID instead of the full secret API key/);
});

test('plan rejects reordered scenes, duplicate anchors and Latin-only Telugu', () => {
  const reordered = structuredClone(plan); [reordered.scenes[1], reordered.scenes[2]] = [reordered.scenes[2], reordered.scenes[1]];
  assert.throws(() => PlanSchema.parse(reordered));
  const duplicate = structuredClone(plan); duplicate.scenes[1].phrases[0].id = duplicate.scenes[0].phrases[0].id;
  assert.throws(() => PlanSchema.parse(duplicate));
  const latin = structuredClone(plan); latin.scenes[1].phrases[0].text.te = 'This is not Telugu script';
  assert.throws(() => PlanSchema.parse(latin));
});

test('translation changes subtitle text, not measured source-audio windows', () => {
  const timeline = assemble(plan, 'en', clips());
  const english = srt(timeline.cues, 'en'), telugu = srt(timeline.cues, 'te');
  assert.notEqual(english, telugu);
  assert.deepEqual(english.match(/.* --> .*/g), telugu.match(/.* --> .*/g));
  assert.equal(timeline.durationInFrames, 30 * FPS);
  assert.ok(timeline.durationInFrames - timeline.cues.at(-1)!.endFrame <= FPS, 'spare time is distributed, not left as a blank tail');
  for (let index = 1; index < timeline.cues.length; index++) assert.ok(timeline.cues[index].startFrame >= timeline.cues[index - 1].endFrame);
});

test('missing audio, incompatible sample rates and narration over cap fail', () => {
  const missing = clips(); missing.delete(plan.scenes[0].phrases[0].id);
  assert.throws(() => assemble(plan, 'en', missing), /Missing/);
  const mixed = clips(); mixed.set(plan.scenes[0].phrases[0].id, signal(1, 24000));
  assert.throws(() => assemble(plan, 'en', mixed), /incompatible/);
  const long = clips(); for (const key of long.keys()) long.set(key, signal(10));
  assert.throws(() => assemble(plan, 'en', long), /90 seconds/);
});

test('WAV round trip preserves measured duration; truncated and silent WAV rejected', () => {
  const source = signal(); const encoded = encodeWav(source); const decoded = decodeWav(encoded);
  assert.equal(decoded.samples.length, source.samples.length); assert.equal(decoded.sampleRate, source.sampleRate);
  assert.throws(() => decodeWav(encoded.subarray(0, 48)), /Truncated/);
  assert.throws(() => decodeWav(encodeWav({sampleRate: 22050, samples: new Float32Array(2205)})), /silence/);
});

test('live requests fail closed without key, free-tier confirmation or allowed models', () => {
  assert.throws(() => requireFreeGemini({}), /missing/);
  assert.throws(() => requireFreeGemini({GEMINI_API_KEY: 'test-not-a-real-key'}), /disabled/);
  assert.throws(() => requireFreeGemini({GEMINI_API_KEY: 'test-not-a-real-key', GEMINI_FREE_TIER_CONFIRMED: 'true', GEMINI_PLANNING_MODEL: 'paid-unreviewed-model'}), /allowlist/);
});

test('provider parser excludes user-input echo from model output', () => {
  const blocks = outputBlocks({steps: [{type: 'user_input', content: [{type: 'text', text: 'ignore me'}]}, {type: 'model_output', content: [{type: 'text', text: 'model result'}]}]});
  assert.equal(blocks.length, 1); assert.equal(blocks[0].text, 'model result');
});

test('real offline synthesizer emits audible English and Telugu without API credentials', async () => {
  const synth = await offlineSynthesizer();
  for (const language of ['en', 'te'] as const) {
    const audio = synth(plan.scenes[0].phrases[0].text[language], language);
    assert.equal(audio.sampleRate, 22050);
    assert.ok(audio.samples.length > 1000);
    assert.ok(audio.samples.some((sample) => Math.abs(sample) > 0.01));
  }
});

test('Gemini adapter sends structured plans and verbatim speech; a 429 triggers no retry', async () => {
  const previousFetch = globalThis.fetch;
  const calls: {url: string; body: Record<string, any>}[] = [];
  const env = {GEMINI_API_KEY: 'local-contract-test-only', GEMINI_FREE_TIER_CONFIRMED: 'true'};
  try {
    globalThis.fetch = (async (url, options) => {
      const body = JSON.parse(String(options?.body)); calls.push({url: String(url), body});
      const content = body.response_format.type === 'audio' ? [{type: 'audio', data: encodeWav(signal()).toString('base64')}] : [{type: 'text', text: JSON.stringify(plan)}];
      return new Response(JSON.stringify({steps: [{type: 'model_output', content}]}), {status: 200});
    }) as typeof fetch;
    assert.deepEqual(await createGeminiPlan('Water cycle', env), plan);
    const spoken = await geminiSpeech('Water changes form.', 'en', 'Indian', env);
    assert.equal(spoken.samples.length, 22050);
    assert.equal(calls.length, 2);
    assert.equal(calls[1].url, 'https://generativelanguage.googleapis.com/v1beta/interactions');
    assert.equal(calls[1].body.input[0].content[0].text, 'Water changes form.');
    assert.match(calls[1].body.input[0].content[0].annotations[0].style, /Indian/);
    await geminiSpeech('Water changes form.', 'en', 'Neutral', env);
    assert.match(calls[2].body.input[0].content[0].annotations[0].style, /Neutral/);
    assert.doesNotMatch(calls[2].body.input[0].content[0].annotations[0].style, /Indian/);
    let attempts = 0;
    globalThis.fetch = (async () => {attempts++; return new Response('{}', {status: 429});}) as typeof fetch;
    await assert.rejects(() => geminiSpeech('Water changes form.', 'en', 'Indian', env), /rate limit/);
    assert.equal(attempts, 1);
  } finally {globalThis.fetch = previousFetch;}
});
