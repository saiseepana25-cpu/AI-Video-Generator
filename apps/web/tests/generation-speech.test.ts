import {test} from 'node:test';
import assert from 'node:assert/strict';
import {GenerationSpeechGateway} from '../src/server/generation/speech-gateway';
import {GenerationFault} from '../src/server/generation/engine';
import {renderFixture} from './fixtures/rendering';
import {providerEnv} from './fixtures/providers';
test('speech gateway submits only pinned approved text/settings with measured pcm and no retries', async () => {
  for (const language of ['en', 'te'] as const) {
    const plan = renderFixture(language).plan; let calls = 0;
    const pcm = Buffer.alloc(48000); for (let i = 0; i < 24000; i++) pcm.writeInt16LE(Math.sin(i / 10) * 5000, i * 2);
    const gateway = new GenerationSpeechGateway(providerEnv, async (url, options) => {
      calls++; assert.ok(String(url).includes(plan.settingsSnapshot.speech.voiceId)); assert.equal(options?.method, 'POST'); assert.equal(options?.redirect, 'error');
      const body = JSON.parse(String(options?.body)); assert.equal(body.text, plan.narration[0].text); assert.equal(body.language_code, language); assert.equal(body.model_id, 'eleven_v3');
      assert.deepEqual(body.voice_settings, {stability: .5, similarity_boost: .75, speed: 1}); return new Response(pcm);
    });
    const audio = await gateway.synthesize(plan, plan.narration[0].segmentId, AbortSignal.timeout(1000)); assert.equal(audio.sampleRate, 24000); assert.equal(audio.samples.length, 24000); assert.equal(calls, 1);
  }
});
test('speech gateway fails closed on refused/uncertain/invalid responses without fallback or echoed provider text', async () => {
  const plan = renderFixture().plan;
  for (const status of [401, 402, 403, 429, 500]) {
    let calls = 0; const gateway = new GenerationSpeechGateway(providerEnv, async () => {calls++; return new Response('private provider body', {status});});
    await assert.rejects(gateway.synthesize(plan, plan.narration[0].segmentId, new AbortController().signal), e => e instanceof GenerationFault && e.unknown === (status === 500) && !e.message.includes('private'));
    assert.equal(calls, 1);
  }
  for (const bytes of [Buffer.alloc(4800), Buffer.alloc(4801), Buffer.alloc(1)]) await assert.rejects(new GenerationSpeechGateway(providerEnv, async () => new Response(bytes)).synthesize(plan, plan.narration[0].segmentId, new AbortController().signal), e => e instanceof GenerationFault && e.unknown);
  await assert.rejects(new GenerationSpeechGateway(providerEnv, async () => {throw new Error('private network details');}).synthesize(plan, plan.narration[0].segmentId, new AbortController().signal), /SPEECH_OUTCOME_UNKNOWN/);
});
