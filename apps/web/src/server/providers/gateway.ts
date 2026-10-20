import {providerConfig} from './config';
import type {Env, Language, Provider} from './contracts';

export class ProviderFault extends Error {constructor(public readonly code: string) {super(code);}}
export type Observation = {state: 'enabled' | 'paused' | 'disabled'; reasonCode: string | null; languages: Language[]; remaining: number | null; periodId: string | null};
export class ProviderGateway {
  constructor(private readonly env: Env, private readonly request: typeof fetch = fetch) {}
  private async send(url: string, headers: Record<string, string>, body?: string) {
    let response: Response;
    try {response = await this.request(url, {method: body ? 'POST' : 'GET', headers, body, redirect: 'error', signal: AbortSignal.timeout(body ? 45000 : 8000)});}
    catch {throw new ProviderFault('PROVIDER_UNREACHABLE');}
    if (!response.ok) {await response.body?.cancel(); throw new ProviderFault(response.status === 401 ? 'PROVIDER_AUTH_INVALID' : response.status === 403 ? 'PROVIDER_ACCESS_DENIED' : response.status === 402 ? 'PAID_ACCESS_BLOCKED' : response.status === 429 ? 'FREE_ALLOWANCE_EXHAUSTED' : 'PROVIDER_UNAVAILABLE');}
    return response;
  }
  private async bytes(response: Response, max: number) {
    if (Number(response.headers.get('content-length')) > max) {await response.body?.cancel(); throw new ProviderFault('PROVIDER_INVALID_RESPONSE');}
    const reader = response.body?.getReader(); if (!reader) throw new ProviderFault('PROVIDER_INVALID_RESPONSE');
    const chunks: Uint8Array[] = []; let size = 0;
    try {while (true) {const item = await reader.read(); if (item.done) break; size += item.value.length; if (size > max) {await reader.cancel(); throw new ProviderFault('PROVIDER_INVALID_RESPONSE');} chunks.push(item.value);}}
    finally {reader.releaseLock();}
    return Buffer.concat(chunks);
  }
  private async json(url: string, headers: Record<string, string>) {
    try {return JSON.parse((await this.bytes(await this.send(url, headers), 256 * 1024)).toString('utf8'));}
    catch (error) {if (error instanceof ProviderFault) throw error; throw new ProviderFault('PROVIDER_INVALID_RESPONSE');}
  }
  async observe(provider: Provider): Promise<Observation> {
    const config = providerConfig(provider, this.env);
    const disabled = (reasonCode: string): Observation => ({state: 'paused', reasonCode, languages: [], remaining: null, periodId: null});
    if (!config.key) return disabled('INTEGRATION_NOT_CONFIGURED');
    if (!config.confirmedFree) return disabled('FREE_TIER_UNCONFIRMED');
    if (!config.reviewed) return disabled('MODEL_UNREVIEWED');
    if (provider === 'gemini') {
      const model = await this.json(`https://generativelanguage.googleapis.com/v1beta/models/${config.model}`, {'x-goog-api-key': config.key});
      if (model.name !== `models/${config.model}` || !Array.isArray(model.supportedGenerationMethods) || !model.supportedGenerationMethods.includes('generateContent')) throw new ProviderFault('MODEL_UNAVAILABLE');
      // Model discovery does not expose remaining quota or verify billing.
      return disabled('FREE_ALLOWANCE_UNVERIFIED');
    }
    const headers = {'xi-api-key': config.key};
    const subscription = await this.json('https://api.elevenlabs.io/v1/user/subscription', headers);
    if (subscription.tier !== 'free') return disabled('PAID_ACCOUNT_BLOCKED');
    const limit = subscription.character_limit, used = subscription.character_count;
    if (!Number.isSafeInteger(limit) || !Number.isSafeInteger(used) || limit < 0 || used < 0) throw new ProviderFault('FREE_ALLOWANCE_UNVERIFIED');
    const remaining = Math.max(0, limit - used);
    const models = await this.json('https://api.elevenlabs.io/v1/models', headers);
    if (!Array.isArray(models)) throw new ProviderFault('PROVIDER_INVALID_RESPONSE');
    const model = models.find(m => m.model_id === config.model);
    if (!model?.can_do_text_to_speech || model.requires_alpha_access === true || !Array.isArray(model.languages)) throw new ProviderFault('MODEL_UNAVAILABLE');
    // Our conservative two-credit reservation must cover the reported model rate.
    if (typeof model.token_cost_factor !== 'number' || !Number.isFinite(model.token_cost_factor) || model.token_cost_factor <= 0 || model.token_cost_factor > 2) throw new ProviderFault('MODEL_RATE_UNVERIFIED');
    const voice = await this.json(`https://api.elevenlabs.io/v1/voices/${config.voiceId}`, headers);
    if (voice.voice_id !== config.voiceId || voice.category !== 'premade') throw new ProviderFault('VOICE_UNVERIFIED');
    const languages = (['en', 'te'] as const).filter(language => model.languages.some((l: {language_id?: string}) => l.language_id === language));
    return {state: remaining ? 'enabled' : 'paused', reasonCode: remaining ? null : 'FREE_ALLOWANCE_EXHAUSTED', languages, remaining,
      periodId: Number.isSafeInteger(subscription.next_character_count_reset_unix) ? String(subscription.next_character_count_reset_unix) : 'unknown'};
  }
  async testSpeech(language: Language): Promise<Buffer> {
    const config = providerConfig('elevenlabs', this.env);
    // Called only by the explicit operator probe after a fresh free-account check
    // and atomic allowance reservation. No arbitrary text/voice or paid fallback.
    const text = testPhrase(language);
    const response = await this.send(`https://api.elevenlabs.io/v1/text-to-speech/${config.voiceId}?output_format=pcm_24000`, {'xi-api-key': config.key, 'Content-Type': 'application/json', Accept: 'application/octet-stream'}, JSON.stringify({text, model_id: config.model, language_code: language}));
    const pcm = await this.bytes(response, 24000 * 2 * 45);
    if (pcm.length < 2400 || pcm.length % 2 || !Array.from({length: pcm.length / 2}, (_, i) => Math.abs(pcm.readInt16LE(i * 2))).some(n => n > 32)) throw new ProviderFault('VOICE_TEST_FAILED');
    return pcm;
  }
}
export const testPhrase = (language: Language) => language === 'en' ? 'Sunlight helps plants make their food. This is an evaluation voice test.' : 'మొక్కలు సూర్యరశ్మి సహాయంతో ఆహారాన్ని తయారు చేసుకుంటాయి. ఇది స్వర పరీక్ష.';
