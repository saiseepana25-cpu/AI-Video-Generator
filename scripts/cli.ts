import {config} from 'dotenv';
import fs from 'node:fs/promises';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {bundle} from '@remotion/bundler';
import {openBrowser, renderMedia, renderStill, selectComposition} from '@remotion/renderer';
import {PlanSchema, Language, digest, type Plan, type VideoProps} from '../src/pipeline/schema.js';
import {assemble, FPS, srt} from '../src/pipeline/timing.js';
import {decodeWav, encodeWav, type Audio} from '../src/pipeline/wav.js';
import {assertElevenLabsFreeBudget, checkElevenLabsConnection, createGeminiPlan, elevenLabsConfig, elevenLabsSpeech, geminiSpeech, offlineSynthesizer, requireFreeGemini, type ElevenLabsVoice} from '../src/pipeline/providers.js';
import {inspectVideo} from '../src/pipeline/probe.js';

config({path: '.env.local', quiet: true} as Parameters<typeof config>[0]);
const root = process.cwd();
const [command = 'doctor', ...args] = process.argv.slice(2);
const option = (name: string, fallback: string) => {const index = args.indexOf(`--${name}`); return index < 0 ? fallback : args[index + 1] || fallback;};
const mode = option('mode', 'offline');
const fixture = path.join(root, 'fixtures', 'water-cycle.json');
const safeError = (error: unknown): string => {
  const value = error instanceof Error ? error.stack || error.message : typeof error === 'string' ? error : JSON.stringify(error);
  return [process.env.GEMINI_API_KEY, process.env.ELEVENLABS_API_KEY].filter(Boolean).reduce<string>((message, key) => message.replaceAll(key!, '[redacted]'), value || 'Unknown pipeline error');
};
const cache = path.join(root, '.cache');
const publicDir = path.join(cache, 'public');
const readPlan = async (file: string): Promise<Plan> => PlanSchema.parse(JSON.parse(await fs.readFile(file, 'utf8')));
const writeJson = async (file: string, value: unknown) => {await fs.mkdir(path.dirname(file), {recursive: true}); await fs.writeFile(file, JSON.stringify(value, null, 2) + '\n');};

async function main() {
  if (!['offline', 'gemini', 'elevenlabs'].includes(mode)) throw new Error('Mode must be offline, gemini, or elevenlabs; there is no automatic provider fallback.');
  if (command === 'check-elevenlabs') {
    const result = await checkElevenLabsConnection(process.env);
    console.log(JSON.stringify(result, null, 2));
    if (!result.ready) process.exitCode = 1;
    return;
  }
  if (command === 'doctor') {
    console.log(JSON.stringify({node: process.version, geminiKeyConfigured: Boolean(process.env.GEMINI_API_KEY), freeTierConfirmed: process.env.GEMINI_FREE_TIER_CONFIRMED === 'true', remotionEligibilityConfirmed: process.env.REMOTION_FREE_LICENSE_CONFIRMED === 'true', offlineAvailable: true, liveApiVerified: false, output: path.join(root, 'output')}, null, 2));
    return;
  }
  if (command === 'plan') {
    if (mode === 'elevenlabs') throw new Error('ElevenLabs supplies narration. Use a reviewed plan file or Gemini planning.');
    const plan = mode === 'gemini' ? await createGeminiPlan(option('idea', 'Explain the water cycle to beginners'), process.env) : await readPlan(fixture);
    const file = path.resolve(option('out', 'output/plan.json'));
    await writeJson(file, plan);
    console.log(`${mode === 'offline' ? 'Curated diagnostic fixture copied (not AI-generated)' : 'AI plan generated; human review required'}: ${file}\nPlan fingerprint: ${digest(plan)}\nReview both languages before running render --approve.`);
    return;
  }
  if (!['demo', 'render'].includes(command)) throw new Error('Commands: doctor, plan, demo, render. See README.md.');
  if (args.includes('--captions')) throw new Error('Subtitles now follow the video language automatically. Choose --spoken en or --spoken te and remove --captions.');
  const spoken: ('en' | 'te')[] = command === 'demo' ? ['en', 'te'] : [Language.parse(option('spoken', 'en'))];
  if (process.env.REMOTION_FREE_LICENSE_CONFIRMED !== 'true') throw new Error('Confirm Remotion free-license eligibility in .env.local before rendering.');
  if (command === 'render' && !args.includes('--approve')) throw new Error('Review the plan first, then explicitly pass --approve. No narration or rendering started.');
  if (command === 'demo' && mode !== 'offline') throw new Error('demo is strictly offline. For live requests, create/review a plan and use render --mode gemini --approve.');
  if (mode === 'gemini') requireFreeGemini(process.env);
  const scale = Number(option('scale', '1'));
  if (![0.5, 1].includes(scale)) throw new Error('Use --scale 1 for 1080p, or --scale 0.5 for a 540p diagnostic preview.');
  const plan = await readPlan(command === 'demo' ? fixture : path.resolve(option('plan', 'output/plan.json')));
  const planHash = digest(plan);
  const voiceChoice = option('voices', 'madhavi');
  if (!['madhavi', 'bharadwaj', 'both', 'free'].includes(voiceChoice)) throw new Error('Use --voices madhavi, bharadwaj, both, or free.');
  const eleven = mode === 'elevenlabs' ? elevenLabsConfig(process.env) : undefined;
  const freeBudget = eleven ? await assertElevenLabsFreeBudget(process.env, spoken.reduce((count, language) => count + plan.scenes.flatMap(scene => scene.phrases).reduce((sum, phrase) => sum + phrase.text[language].length, 0), 0)) : undefined;
  const accent = option('accent', 'Indian');
  if (!['Indian', 'Neutral'].includes(accent)) throw new Error('Accent must be Indian or Neutral.');
  const folder = path.resolve(option('out', `output/${mode}-water-cycle`));
  await fs.mkdir(folder, {recursive: true});
  await fs.mkdir(cache, {recursive: true});
  const lock = path.join(cache, 'pipeline.lock');
  const handle = await fs.open(lock, 'wx').catch(() => {throw new Error('This workspace has an active/stale .cache/pipeline.lock. Check its recorded PID before manually removing it; parallel runs share a bundle and are blocked.');});
  await handle.writeFile(JSON.stringify({pid: process.pid, startedAt: new Date().toISOString()}));
  const started = Date.now();
  const manifest: Record<string, unknown> = {status: 'running', mode, planHash, accent, targetSeconds: plan.targetSeconds, speechRequests: 0, reusedSpeechClips: 0, planSource: command === 'demo' ? 'curated-bilingual-fixture' : 'user-reviewed-plan-file', liveApiVerified: false, planApproval: {method: command === 'demo' ? 'explicit-demo-command-on-fixed-fixture' : 'explicit-render-approve-command', timestamp: new Date().toISOString()}, outputProfile: {width: 1080 * scale, height: 1920 * scale, fps: FPS}, warnings: mode === 'offline' ? ['Offline diagnostic: robotic eSpeak voice, not AI narration. Indian accent is not simulated.', 'Fixture translations require native Telugu speaker review.', 'Visual timing is measured per phrase, not word-level alignment.'] : ['Live Gemini integration requires account and pronunciation review.', 'Phrase-level timing; no claim of word alignment.'], videos: []};
  let browser: Awaited<ReturnType<typeof openBrowser>> | undefined;
  try {
    await writeJson(path.join(folder, 'plan.json'), plan);
    if (eleven) {manifest.provider = 'ElevenLabs'; manifest.model = eleven.model; manifest.voices = eleven.voices; manifest.voiceChoice = voiceChoice; manifest.freeBudget = freeBudget; manifest.durationPolicy = args.includes('--natural-duration') ? 'Natural narration length, minimum target and 90-second cap' : 'Selected target'; manifest.warnings = ['ElevenLabs free-account voice test; native Telugu pronunciation review required.', 'Captions and animation follow measured phrase windows, not word-level alignment.', 'Uses the curated water-cycle script; no Gemini inference performed.'];}
    manifest.title = plan.title;
    await writeJson(path.join(folder, 'manifest.json'), manifest);
    await fs.mkdir(path.join(publicDir, 'audio'), {recursive: true});
    const synth = mode === 'offline' ? await offlineSynthesizer() : undefined;
    console.log(`${mode.toUpperCase()}: ${mode === 'offline' ? 'No API requests. Robotic diagnostic speech.' : 'Explicit live provider; no paid fallback.'}\nPlan ${planHash.slice(0, 12)} · output ${folder}`);
    const serveUrl = await bundle({entryPoint: path.join(root, 'src/video/index.tsx'), publicDir, outDir: path.join(cache, 'bundle'), onProgress: () => undefined});
    const browserCandidates = [process.env.BROWSER_EXECUTABLE, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'];
    const browserExecutable = browserCandidates.find((candidate) => candidate && existsSync(candidate));
    browser = await openBrowser('chrome', {browserExecutable, logLevel: 'error'});
    for (const language of spoken) {
      const clips = new Map<string, Audio>();
      for (const [sceneIndex, scene] of plan.scenes.entries()) for (const phrase of scene.phrases) {
        const selectedVoice = voiceChoice === 'both' ? (sceneIndex % 2 === 0 ? 'madhavi' : 'bharadwaj') : voiceChoice as ElevenLabsVoice;
        const key = digest({version: 1, provider: mode === 'offline' ? 'espeak-ng-0.3.5' : eleven ? eleven.model : process.env.GEMINI_SPEECH_MODEL || 'gemini-3.8-flash-tts', voice: mode === 'offline' ? `${language}-diagnostic-185-195` : eleven ? eleven.voices[selectedVoice].id : process.env.GEMINI_VOICE || 'Kore', accent: mode === 'offline' ? 'Indian' : accent, language, text: phrase.text[language]});
        const clipFile = path.join(cache, 'speech', `${key}.wav`);
        let audio: Audio;
        if (existsSync(clipFile)) {audio = decodeWav(await fs.readFile(clipFile)); manifest.reusedSpeechClips = Number(manifest.reusedSpeechClips) + 1;}
        else {
          console.log(`Narration ${language}: ${phrase.id}${eleven ? ` · ${eleven.voices[selectedVoice].name}` : ''}`);
          audio = synth ? synth(phrase.text[language], language) : eleven ? await elevenLabsSpeech(phrase.text[language], language, selectedVoice, process.env) : await geminiSpeech(phrase.text[language], language, accent, process.env);
          if (!synth) manifest.speechRequests = Number(manifest.speechRequests) + 1;
          await fs.mkdir(path.dirname(clipFile), {recursive: true}); await fs.writeFile(clipFile, encodeWav(audio));
        }
        clips.set(phrase.id, audio);
      }
      const timeline = assemble(plan, language, clips);
      if (eleven) for (const cue of timeline.cues) {const index = plan.scenes.findIndex(scene => scene.id === cue.sceneId); const selected = voiceChoice === 'both' ? (index % 2 === 0 ? 'madhavi' : 'bharadwaj') : voiceChoice as ElevenLabsVoice; cue.voiceName = eleven.voices[selected].name;}
      if (!(eleven && args.includes('--natural-duration')) && timeline.durationInFrames / FPS > Math.min(90, plan.targetSeconds + 3)) throw new Error(`Narration is too long for the ${plan.targetSeconds}s target. Shorten the approved script; saved speech clips can be reused.`);
      const audioHash = digest({planHash, language, mode, accent, voice: process.env.GEMINI_VOICE || 'Kore', timeline: timeline.cues, duration: timeline.durationInFrames});
      const audioFile = `audio/${audioHash}.wav`;
      await fs.writeFile(path.join(publicDir, audioFile), encodeWav(timeline.audio));
      await fs.writeFile(path.join(folder, `narration-${language}.wav`), encodeWav(timeline.audio));
      // bundle() copies public assets at build time; update its local served copy too.
      await fs.mkdir(path.join(serveUrl, 'public', 'audio'), {recursive: true});
      await fs.copyFile(path.join(publicDir, audioFile), path.join(serveUrl, 'public', audioFile));
      for (const captionLanguage of [language]) {
        const pair = `${language}-${captionLanguage}`;
        const props: VideoProps = {template: plan.template, scenes: plan.scenes.map(({id, label}) => ({id, label})), title: plan.title, cues: timeline.cues, spokenLanguage: language, captionLanguage, audioFile, durationInFrames: timeline.durationInFrames, mode: mode === 'offline' ? 'offline-diagnostic' : eleven ? 'elevenlabs' : 'gemini'};
        await writeJson(path.join(folder, `${pair}.props.json`), props);
        await fs.writeFile(path.join(folder, `${pair}.srt`), srt(timeline.cues, captionLanguage));
        const composition = await selectComposition({serveUrl, id: 'WaterCycle', inputProps: props, puppeteerInstance: browser, logLevel: 'error'});
        const outputLocation = path.join(folder, `${plan.template}.${pair}.mp4`);
        console.log(`Rendering ${pair}: ${(timeline.durationInFrames / FPS).toFixed(2)}s at ${1080 * scale}×${1920 * scale}`);
        let lastProgress = -1;
        await renderMedia({composition, serveUrl, codec: 'h264', audioCodec: 'aac', audioBitrate: '128k', sampleRate: 48000, pixelFormat: 'yuv420p', inputProps: props, outputLocation, puppeteerInstance: browser, scale, concurrency: 2, crf: 23, x264Preset: 'veryfast', logLevel: 'error', onProgress: ({progress}) => {const step = Math.floor(progress * 4); if (step > lastProgress) {lastProgress = step; console.log(`  ${pair}: ${Math.round(progress * 100)}%`);}}});
        const media = await inspectVideo(outputLocation, timeline.durationInFrames / FPS, scale);
        const representativeFrames: string[] = [];
        for (const scene of plan.scenes) {
          const cue = timeline.cues.find((item) => item.sceneId === scene.id)!;
          const file = path.join(folder, `${pair}.${scene.id}.png`);
          await renderStill({composition, serveUrl, inputProps: props, output: file, frame: Math.min(cue.startFrame + 22, cue.speechEndFrame - 1), puppeteerInstance: browser, scale: 0.5, logLevel: 'error'});
          representativeFrames.push(path.basename(file));
        }
        (manifest.videos as unknown[]).push({pair, file: path.basename(outputLocation), captions: `${pair}.srt`, media, representativeFrames, durationTargetMet: timeline.durationInFrames / FPS >= plan.targetSeconds && timeline.durationInFrames / FPS <= Math.min(90, plan.targetSeconds + 3), captionTiming: 'measured-source-phrase-windows'});
        await writeJson(path.join(folder, 'manifest.json'), manifest);
      }
    }
    manifest.status = 'complete'; manifest.elapsedSeconds = Number(((Date.now() - started) / 1000).toFixed(1));
    manifest.liveApiVerified = Number(manifest.speechRequests) > 0;
    await writeJson(path.join(folder, 'manifest.json'), manifest);
    console.log(`Finished. Media validation passed. Visual/pronunciation review still required.\n${folder}`);
  } catch (error) {
    manifest.status = 'failed'; manifest.failure = safeError(error);
    await writeJson(path.join(folder, 'manifest.json'), manifest);
    throw error;
  } finally {
    if (browser) await browser.close({silent: true}).catch(() => undefined);
    await handle.close(); await fs.unlink(lock);
  }
}

main().catch((error) => {console.error(safeError(error)); process.exitCode = 1;});
