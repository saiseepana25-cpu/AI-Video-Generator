import {verifiedLogoBytes} from './logo-bytes.js';
import {createHash, randomUUID} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createReadStream, existsSync} from 'node:fs';
import {bundle} from '@remotion/bundler';
import {openBrowser, renderMedia, renderStill, selectComposition} from '@remotion/renderer';
import {assembleSelected, selectedSrt} from './selected-timing.js';
import {canonicalJson, type FontPins} from './render-contract.js';
import type {SelectedClip, SelectedVideoProps} from './selected-types.js';
import {encodeWav} from './wav.js';
import {inspectVideo} from './probe.js';
import {TextLayoutError, isTextLayoutRefusal} from '../video/selected-layout';
import {requireBrowserStopped} from './executor-stop';

const sha = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
async function fileHash(file: string) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
const fontSources = {
  heading: 'apps/web/node_modules/@fontsource/sora/files/sora-latin-400-normal.woff2',
  body: 'apps/web/node_modules/@fontsource/inter/files/inter-latin-400-normal.woff2',
  telugu: 'apps/web/node_modules/@fontsource/noto-sans-telugu/files/noto-sans-telugu-telugu-400-normal.woff2',
};
export async function selectedFontAssets(root: string) {
  const fonts = await Promise.all(Object.entries(fontSources).map(async ([role, file]) => ({role: role as keyof FontPins, bytes: await fs.readFile(path.join(root, file))})));
  return {fonts, pins: Object.fromEntries(fonts.map(f => [f.role, sha(f.bytes)])) as FontPins};
}
export async function selectedRendererBuildHash(root: string, pins: FontPins) {
  const files = ['src/video/selected-index.tsx', 'src/video/SelectedDiagrams.tsx', 'src/video/selected-layout.ts', 'src/pipeline/selected-types.ts', 'src/pipeline/selected-renderer.ts', 'src/pipeline/selected-timing.ts', 'src/pipeline/probe.ts', 'src/pipeline/wav.ts', 'apps/web/src/server/rendering/contract.ts', 'apps/web/src/server/brand/palette.ts', 'src/pipeline/logo-bytes.ts','apps/web/src/server/logos/bytes.ts','apps/web/src/server/brand/logo.ts','package-lock.json'];
  files.push('src/video/selected-preflight-index.tsx', 'src/video/selected-font-layout.ts', 'src/pipeline/layout-preflight.ts', 'src/pipeline/executor-stop.ts');
  files.push('src/pipeline/windows-job.ps1','src/pipeline/windows-executor.ts','scripts/render-executor.ts','src/pipeline/generation-engine.ts','apps/web/src/server/generation/executor-service.ts','apps/web/src/server/generation/executor-contracts.ts');
  const parts = await Promise.all(files.map(async file => ({file, sha256: sha(await fs.readFile(path.join(root, file)))})));
  return sha(canonicalJson({adapter: 'educational-diagrams-renderer-v1', pins, files: parts}));
}

/** Root-only adapter. No MongoDB/env/provider access and no changes to the v1 renderer.
 * The caller supplies decoded clips, exact approval hash and a trusted output root.
 */
export async function renderSelectedVideo(options: {root: string; outputRoot: string; plan: unknown; expectedHash: string; clips: SelectedClip[]; mode: SelectedVideoProps['mode']; licenseConfirmed: boolean; logoBytes?:Buffer; signal?: AbortSignal; onProgress?: (progress: number) => void; artifactId?:string; scratchRoot?:string}) {
  if (!options.licenseConfirmed) throw new Error('Confirm Remotion free-license eligibility before rendering.');
  options.signal?.throwIfAborted();
  const timeline = assembleSelected(options.plan, options.expectedHash, options.clips, options.mode), {fonts, pins} = await selectedFontAssets(options.root);
  for (const font of timeline.plan.settingsSnapshot.brand.fonts) if (font.sha256 !== pins[font.role as keyof FontPins]) throw new Error('Installed font bytes do not match the reviewed input.');
  const logo=verifiedLogoBytes(timeline.plan.settingsSnapshot.brand.logoAsset,options.logoBytes);
  const rendererBuildHash = await selectedRendererBuildHash(options.root, pins), id = options.artifactId??randomUUID();
  if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id))throw new Error('Invalid artifact identity.');
  if(options.scratchRoot&&!/^\.cache\/executors\/[a-f0-9]{32}\/scratch$/.test(path.relative(options.root,options.scratchRoot).split(path.sep).join('/')))throw new Error('Invalid executor workspace.');
  const folder = path.join(options.outputRoot, id), scratch = options.scratchRoot??path.join(options.root, '.cache', 'selected-renderer', id), publicDir = path.join(scratch, 'public');
  await fs.mkdir(folder, {recursive: true}); await fs.mkdir(path.join(publicDir, 'fonts'), {recursive: true});
  if(logo)await fs.writeFile(path.join(publicDir,'brand-logo.png'),logo,{flag:'wx'});
  for (const font of fonts) await fs.writeFile(path.join(publicDir, 'fonts', `${font.role}.woff2`), font.bytes);
  const audio = encodeWav(timeline.audio), audioHash = sha(audio), audioFile = `audio-${audioHash}.wav`;
  await fs.writeFile(path.join(publicDir, audioFile), audio); await fs.writeFile(path.join(folder, 'narration.wav'), audio);
  await fs.writeFile(path.join(folder, 'input.json'), canonicalJson(timeline.plan));
  const manifest: Record<string, unknown> = {schemaVersion: 1, state: 'rendering', inputHash: options.expectedHash, rendererBuildHash, audioHash, language: timeline.plan.language,
    mode: options.mode, voicePinSatisfied: options.mode === 'elevenlabs-evaluation', timingPrecision: timeline.timingPrecision, publicationAllowed: false,
    durationInFrames: timeline.durationInFrames, fps: 30, diagnostic: options.mode === 'offline-diagnostic', pacing:timeline.pacing, media: null};
  const saveManifest = () => fs.writeFile(path.join(folder, 'manifest.json'), JSON.stringify(manifest, null, 2));
  await saveManifest(); let browser: Awaited<ReturnType<typeof openBrowser>> | undefined, stage = 'bundle';
  try {
    const serveUrl = await bundle({entryPoint: path.join(options.root, 'src/video/selected-index.tsx'), publicDir, outDir: path.join(scratch, 'bundle'), onProgress: () => undefined});
    options.signal?.throwIfAborted();
    const executable = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(file => existsSync(file));
    stage = 'browser'; browser = await openBrowser('chrome', {browserExecutable: executable, logLevel: 'error'});
    const inputProps: SelectedVideoProps = {plan: timeline.plan, cues: timeline.cues, audioFile, durationInFrames: timeline.durationInFrames, mode: options.mode, layout: null};
    stage = 'layout'; const composition = await selectComposition({serveUrl, id: 'SelectedDiagrams', inputProps, puppeteerInstance: browser, logLevel: 'error'});
    const resolved = composition.props as SelectedVideoProps;
    if (!resolved.layout) throw new Error('Font-measured layout was not produced.');
    const wrappedCues = timeline.cues.map((cue, i) => ({...cue, text: resolved.layout!.scenes[i].caption.lines.join('\n')}));
    await fs.writeFile(path.join(folder, 'captions.srt'), selectedSrt(wrappedCues));
    await fs.writeFile(path.join(folder, 'timing.json'), JSON.stringify({cues: timeline.cues, sampleRate: timeline.audio.sampleRate, audioHash, layout: resolved.layout}, null, 2));
    const {makeCancelSignal} = await import('@remotion/renderer'), cancellation = makeCancelSignal();
    const abort = () => cancellation.cancel(); options.signal?.addEventListener('abort', abort, {once: true});
    try {
      options.signal?.throwIfAborted();
      stage = 'render';
      await renderMedia({composition, serveUrl, inputProps, outputLocation: path.join(folder, 'video.mp4'), puppeteerInstance: browser,
        codec: 'h264', audioCodec: 'aac', audioBitrate: '128k', sampleRate: 48000, pixelFormat: 'yuv420p', colorSpace: 'bt709', concurrency: 2, crf: 23, x264Preset: 'veryfast',
        cancelSignal: cancellation.cancelSignal, logLevel: 'error', overwrite: false, onProgress: ({progress}) => options.onProgress?.(progress)});
    } finally {options.signal?.removeEventListener('abort', abort);}
    options.signal?.throwIfAborted();
    stage = 'media_validation';
    const videoFile = path.join(folder, 'video.mp4'), mp4Sha256 = await fileHash(videoFile);
    const media = await inspectVideo(videoFile, timeline.durationInFrames / 30, 1, true);
    stage = 'stills';
    for (const [i, cue] of timeline.cues.entries()) {
      options.signal?.throwIfAborted();
      await renderStill({composition, serveUrl, inputProps, output: path.join(folder, `scene-${i + 1}.png`), frame: Math.min(cue.startFrame + 20, cue.speechEndFrame - 1), puppeteerInstance: browser, logLevel: 'error'});
    }
    options.signal?.throwIfAborted();
    if (await fileHash(videoFile) !== mp4Sha256) throw new Error('Video bytes changed during validation.');
    manifest.state = options.mode === 'offline-diagnostic' ? 'diagnostic_complete' : 'validated_local'; manifest.media = media; manifest.mp4Sha256 = mp4Sha256;
    const manifestHash = sha(JSON.stringify(manifest, null, 2));
    await saveManifest(); return {folder, media, rendererBuildHash, manifestHash, inputHash: options.expectedHash, diagnostic: options.mode === 'offline-diagnostic'};
  } catch (error) {
    manifest.state = options.signal?.aborted ? 'cancelled' : 'failed'; manifest.failedStage = stage;
    manifest.error = stage === 'layout' ? 'Local text/font layout did not finish. Shorten overflowing captions/headings/labels and verify installed fonts.' : `Local video ${stage} did not finish. No provider fallback was performed.`;
    await saveManifest();
    if (stage === 'layout' && isTextLayoutRefusal(error)) throw new TextLayoutError('Approved text does not fit at a readable size.');
    throw new Error(manifest.error as string, {cause: error});
  } finally {
    if (browser) try {await requireBrowserStopped(() => browser!.close({silent: true}));}
    catch (error) {
      // A return value and a ready-looking manifest must not outlive an
      // unconfirmed shutdown. Database promotion still requires a returned
      // validated artifact and remains blocked by the retained active run.
      manifest.state = 'executor_stop_unconfirmed';
      await saveManifest().catch(() => undefined);
      throw error;
    }
  }
}
