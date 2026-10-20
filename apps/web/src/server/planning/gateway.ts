import {providerConfig} from '../providers/config';
import type {Env} from '../providers/contracts';
import type {Job, Kind} from './contracts';
import {outputSchema, planningPrompt} from './validation';

export class PlanningFault extends Error {
  constructor(public readonly code: string, public readonly uncertain: boolean, public readonly retryable = false) {super(code);}
}
export class PlanningGateway {
  constructor(private env: Env, private request: typeof fetch = fetch) {}
  async generate(input: Job['input'], kind: Kind, signal: AbortSignal): Promise<unknown> {
    const config = providerConfig('gemini', this.env);
    if (!config.key || !config.confirmedFree || !config.reviewed) throw new PlanningFault('FREE_ACCESS_UNVERIFIED', false);
    const prompt = planningPrompt(input, kind);
    try {
      const response = await this.request(`https://generativelanguage.googleapis.com/v1beta/models/${config.model}:generateContent`, {
        method: 'POST', redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(45000)]),
        headers: {'Content-Type': 'application/json', 'x-goog-api-key': config.key}, body: JSON.stringify({
          contents: [{role: 'user', parts: [{text: prompt}]}], generationConfig: {maxOutputTokens: 8192, responseMimeType: 'application/json', responseJsonSchema: outputSchema(kind)},
        }),
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new PlanningFault(response.status === 429 ? 'PROVIDER_RATE_LIMITED' : response.status === 401 || response.status === 403 ? 'PROVIDER_ACCESS_DENIED' : 'PROVIDER_REQUEST_FAILED', response.status >= 500, response.status === 429);
      }
      const reader = response.body?.getReader(); if (!reader) throw new PlanningFault('PROVIDER_EMPTY_RESPONSE', true);
      const chunks: Uint8Array[] = []; let size = 0;
      try {while (true) {const item = await reader.read(); if (item.done) break; size += item.value.length; if (size > 128 * 1024) {await reader.cancel(); throw new PlanningFault('PROVIDER_RESPONSE_TOO_LARGE', false, true);} chunks.push(item.value);}}
      finally {reader.releaseLock();}
      const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const candidate = value.candidates?.[0];
      if (candidate?.finishReason !== 'STOP') throw new PlanningFault('PROVIDER_INCOMPLETE_OUTPUT', false, true);
      const parts = candidate.content?.parts;
      if (!Array.isArray(parts)) throw new PlanningFault('PROVIDER_INVALID_OUTPUT', false, true);
      const text = parts.filter((p: {thought?: boolean}) => !p.thought).map((p: {text?: string}) => p.text ?? '').join('');
      try {return JSON.parse(text);} catch {throw new PlanningFault('PROVIDER_INVALID_OUTPUT', false, true);}
    } catch (error) {
      if (error instanceof PlanningFault) throw error;
      throw new PlanningFault('PROVIDER_OUTCOME_UNKNOWN', true);
    }
  }
}
