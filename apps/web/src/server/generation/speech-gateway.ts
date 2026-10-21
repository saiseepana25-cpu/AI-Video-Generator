import type {RenderPlan} from '../rendering/contract';
import {providerConfig} from '../providers/config';
import type {Env} from '../providers/contracts';
import {GenerationFault, type MeasuredSpeech} from './engine';
export class GenerationSpeechGateway {
  constructor(private env: Env, private request: typeof fetch = fetch) {}
  async synthesize(plan: RenderPlan, segmentId: string, signal: AbortSignal): Promise<MeasuredSpeech> {
    const config = providerConfig('elevenlabs', this.env), speech = plan.settingsSnapshot.speech, text = plan.narration.find(n => n.segmentId === segmentId)?.text;
    if (!config.key || config.model !== speech.model || config.voiceId !== speech.voiceId || !text || text.length > 1000) throw new GenerationFault('SPEECH_CONFIG_CHANGED');
    signal.throwIfAborted();
    try {
      const response = await this.request(`https://api.elevenlabs.io/v1/text-to-speech/${speech.voiceId}?output_format=pcm_24000`, {method: 'POST', headers: {'xi-api-key': config.key, 'Content-Type': 'application/json', Accept: 'application/octet-stream'}, redirect: 'error',
        signal: AbortSignal.any([signal, AbortSignal.timeout(60000)]), body: JSON.stringify({text, model_id: speech.model, language_code: plan.language,
          voice_settings: {stability: speech.settings.stability, similarity_boost: speech.settings.similarityBoost, speed: speech.settings.speed}})});
      if (!response.ok) {await response.body?.cancel(); throw new GenerationFault([401, 402, 403, 429].includes(response.status) ? 'SPEECH_ACCESS_REFUSED' : 'SPEECH_OUTCOME_UNKNOWN', ![401, 402, 403, 429].includes(response.status));}
      const max = 24000 * 2 * 90, reader = response.body?.getReader(); if (!reader) throw new GenerationFault('SPEECH_OUTCOME_UNKNOWN', true);
      const chunks: Uint8Array[] = []; let size = 0;
      try {while (true) {const next = await reader.read(); if (next.done) break; size += next.value.length; if (size > max) {await reader.cancel(); throw new GenerationFault('SPEECH_OUTCOME_UNKNOWN', true);} chunks.push(next.value);}}
      finally {reader.releaseLock();}
      const bytes = Buffer.concat(chunks);
      if (size < 4800 || size % 2) throw new GenerationFault('SPEECH_OUTCOME_UNKNOWN', true);
      const samples = new Float32Array(size / 2); let sum = 0, clipped = 0;
      for (let i = 0; i < samples.length; i++) {samples[i] = bytes.readInt16LE(i * 2) / 32768; sum += samples[i] ** 2; if (Math.abs(samples[i]) >= .999) clipped++;}
      if (10 * Math.log10(sum / samples.length) < -55 || clipped / samples.length > .01) throw new GenerationFault('SPEECH_OUTCOME_UNKNOWN', true);
      return {samples, sampleRate: 24000};
    } catch (error) {if (error instanceof GenerationFault) throw error; throw new GenerationFault('SPEECH_OUTCOME_UNKNOWN', true);}
  }
}
