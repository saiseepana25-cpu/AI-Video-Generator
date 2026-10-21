import {createHash} from 'node:crypto';
import type {Env, Provider} from './contracts';
import {EVALUATION_VOICE_ID} from '../rendering/contract';
export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export function providerConfig(provider: Provider, env: Env) {
  const key = (provider === 'gemini' ? env.GEMINI_API_KEY : env.ELEVENLABS_API_KEY)?.trim() ?? '';
  const model = provider === 'gemini' ? env.GEMINI_PLANNING_MODEL?.trim() || 'gemini-3.5-flash-lite' : 'eleven_v3';
  // Alice is the reviewed built-in evaluation alternative. Arbitrary library IDs
  // are never enabled merely by changing environment variables.
  const voiceId = EVALUATION_VOICE_ID;
  const confirmedFree = provider === 'elevenlabs' || env.GEMINI_FREE_TIER_CONFIRMED === 'true';
  const reviewed = provider !== 'gemini' || ['gemini-3.8-flash', 'gemini-3.5-flash-lite'].includes(model);
  const configHash = digest(JSON.stringify({key, model, voiceId, confirmedFree, reviewed, policy: 'free-evaluation-v1'}));
  return {key, model, voiceId, confirmedFree, reviewed, configHash};
}
