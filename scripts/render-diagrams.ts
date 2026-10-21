import {config} from 'dotenv';
import fs from 'node:fs/promises';
import path from 'node:path';
import {selectedFixture} from '../fixtures/selected-diagrams.js';
import {buildRenderPlan, generationHash, validateRenderPlan} from '../src/pipeline/render-contract.js';
import {offlineSynthesizer} from '../src/pipeline/providers.js';
import {renderSelectedVideo, selectedFontAssets} from '../src/pipeline/selected-renderer.js';

config({path: '.env.local', quiet: true} as Parameters<typeof config>[0]);
async function main() {
  const args = process.argv.slice(2);
  if (!args.includes('--diagnostic')) throw new Error('Pass --diagnostic explicitly. This command uses offline speech only, never provider keys.');
  const option = (name: string) => {const i = args.indexOf(name); return i < 0 ? null : args[i + 1];};
  const language = option('--language') ?? 'en';
  if (!['en', 'te'].includes(language)) throw new Error('Choose --language en or --language te. Captions match automatically.');
  const root = process.cwd(), {pins} = await selectedFontAssets(root), f = selectedFixture(language as 'en' | 'te');
  const input = option('--input'), expected = option('--hash');
  if (input && (!expected || !/^[a-f0-9]{64}$/.test(expected))) throw new Error('A supplied input requires its exact reviewed --hash.');
  if (input && (await fs.stat(path.resolve(input))).size > 524288) throw new Error('Input exceeds 512 KiB.');
  const raw = input ? await fs.readFile(path.resolve(input), 'utf8') : null;
  if (raw && Buffer.byteLength(raw) > 524288) throw new Error('Input exceeds 512 KiB.');
  const plan = raw ? validateRenderPlan(JSON.parse(raw)) : buildRenderPlan(f.proposal, f.brief, f.settings, pins);
  if (plan.language !== language) throw new Error('Selected diagnostic language differs from input.');
  const hash = expected ?? generationHash(plan);
  if (hash !== generationHash(plan)) throw new Error('Reviewed input hash mismatch.');
  if (process.env.REMOTION_FREE_LICENSE_CONFIRMED !== 'true') throw new Error('Confirm Remotion license eligibility before rendering.');
  const synth = await offlineSynthesizer();
  const clips = plan.narration.map(n => ({segmentId: n.segmentId, text: n.text, audio: synth(n.text, plan.language), source: {provider: 'offline-diagnostic' as const, model: 'espeak-ng', voiceId: plan.language}}));
  const controller = new AbortController(), stop = () => controller.abort(); process.once('SIGINT', stop);
  let last = -1;
  try {
    const result = await renderSelectedVideo({root, outputRoot: path.join(root, 'output', 'selected-diagrams'), plan, expectedHash: hash, clips, mode: 'offline-diagnostic', licenseConfirmed: true, signal: controller.signal,
      onProgress: value => {const step = Math.floor(value * 4); if (step > last) {last = step; console.log(`Local diagnostic render: ${Math.round(value * 100)}%`);}}});
    console.log(JSON.stringify({...result, providerRequests: 0, warning: 'Robotic offline diagnostic; pinned Alice voice is not satisfied. Not a dashboard-ready or publication artifact.'}, null, 2));
  } finally {process.removeListener('SIGINT', stop);}
}
main().catch((error: unknown) => {
  const message = error instanceof Error && /^Local (video|text\/font)/.test(error.message) ? error.message : 'Selected-language diagnostic did not finish. Check input hash, license confirmation, local fonts and text bounds. Private details redacted.';
  console.error(message); process.exitCode = 1;
});
