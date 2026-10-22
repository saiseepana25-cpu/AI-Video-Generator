import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {ProviderGateway} from '../../apps/web/src/server/providers/gateway';
import {GenerationSpeechGateway} from '../../apps/web/src/server/generation/speech-gateway';
import {GenerationFault, type GenerationEngine, type MeasuredSpeech, type SpeechClip} from '../../apps/web/src/server/generation/engine';
import {LogoObjectStore} from '../../apps/web/src/server/logos/store';
import type {LogoObject} from '../../apps/web/src/server/logos/contracts';
import {brandLogoCapability,brandPaletteCapability,requiredCapabilities} from '../../apps/web/src/server/generation/contracts';
import {requireProjectId} from '../../apps/web/src/server/projects/contracts';
import type {Env} from '../../apps/web/src/server/providers/contracts';
import type {RenderPlan} from './render-contract.js';
import {renderSelectedVideo, selectedFontAssets, selectedRendererBuildHash} from './selected-renderer.js';
import {encodeWav} from './wav.js';
import {binary} from './probe.js';
import {readVerifiedSpeech, type SpeechFile} from './speech-reader.js';
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
export class LiveGenerationEngine implements GenerationEngine {
  capabilities = [...requiredCapabilities,brandPaletteCapability,brandLogoCapability];
  constructor(private root: string, private env: Env) {}
  async inspect() {
    if (this.env.REMOTION_FREE_LICENSE_CONFIRMED !== 'true' || !this.env.ELEVENLABS_API_KEY?.trim()) throw new GenerationFault('GENERATION_CONFIGURATION_REQUIRED');
    const browsers = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'];
    if (!(await Promise.all(browsers.map(file => fs.access(file).then(() => true, () => false)))).some(Boolean)) throw new GenerationFault('LOCAL_BROWSER_REQUIRED');
    await fs.access(await binary('ffmpeg')); await fs.access(await binary('ffprobe'));
    const {pins} = await selectedFontAssets(this.root); return {fonts: pins, rendererBuildHash: await selectedRendererBuildHash(this.root, pins)};
  }
  async observe() {try {return await new ProviderGateway(this.env).observe('elevenlabs');} catch {throw new GenerationFault('FREE_SPEECH_UNAVAILABLE');}}
  speech(plan: RenderPlan, segmentId: string, signal: AbortSignal) {return new GenerationSpeechGateway(this.env).synthesize(plan, segmentId, signal);}
  readSpeech(source: SpeechFile, signal: AbortSignal) {return readVerifiedSpeech(this.root,source,signal);}
  async persistSpeech(runId: string, attemptId: string, audio: MeasuredSpeech) {
    requireProjectId(runId); requireProjectId(attemptId);
    const folder = path.join(this.root, 'output', 'dashboard-speech', runId); await fs.mkdir(folder, {recursive: true});
    const bytes = encodeWav(audio), file = path.join(folder, `${attemptId}.wav`); await fs.writeFile(file, bytes, {flag: 'wx'});
    const audioHash = sha(bytes); if (sha(await fs.readFile(file)) !== audioHash) throw new GenerationFault('LOCAL_AUDIO_WRITE_FAILED');
    return {audioHash, byteLength: bytes.length};
  }
  async logo(object:LogoObject,signal:AbortSignal){signal.throwIfAborted();const store=new LogoObjectStore(this.env);try{const bytes=await store.read(object);signal.throwIfAborted();return bytes;}finally{store.close();}}
  async render(runId: string, plan: RenderPlan, hash: string, clips: SpeechClip[], signal: AbortSignal, logo?:Buffer) {
    requireProjectId(runId);
    const result = await renderSelectedVideo({root: this.root, outputRoot: path.join(this.root, 'output', 'dashboard-renders', runId), plan, expectedHash: hash, clips, mode: 'elevenlabs-evaluation',
      logoBytes:logo,licenseConfirmed: this.env.REMOTION_FREE_LICENSE_CONFIRMED === 'true', signal});
    const id = path.basename(result.folder); requireProjectId(id);
    const manifest = await fs.readFile(path.join(result.folder, 'manifest.json'));
    if (sha(manifest) !== result.manifestHash) throw new GenerationFault('LOCAL_MANIFEST_CHANGED');
    return {_id: id, manifestHash: result.manifestHash, media: result.media, rendererBuildHash: result.rendererBuildHash};
  }
}
