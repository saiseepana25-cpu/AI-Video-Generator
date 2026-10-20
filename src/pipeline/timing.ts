import type {Audio} from './wav.js';
import type {Cue, Language, Plan} from './schema.js';

export const FPS = 30;
export function assemble(plan: Plan, language: Language, clips: Map<string, Audio>): {audio: Audio; cues: Cue[]; durationInFrames: number} {
  const phrases = plan.scenes.flatMap((scene) => scene.phrases.map((phrase) => ({scene, phrase})));
  const first = clips.get(phrases[0].phrase.id);
  if (!first) throw new Error('Missing speech clip');
  const sampleRate = first.sampleRate;
  const intro = Math.round(sampleRate * 0.35), outro = Math.round(sampleRate * 0.55);
  const spokenSamples = phrases.reduce((count, {phrase}) => count + (clips.get(phrase.id)?.samples.length || 0), 0);
  // Give viewers short visual-reading holds between phrases, instead of dumping
  // all spare target time into one empty tail after the narration finishes.
  const gap = Math.max(Math.round(sampleRate * 0.12), Math.floor((plan.targetSeconds * sampleRate - intro - outro - spokenSamples) / phrases.length));
  let cursor = intro;
  const cues: Cue[] = [];
  const chunks: Float32Array[] = [new Float32Array(intro)];
  for (const {scene, phrase} of phrases) {
    const clip = clips.get(phrase.id);
    if (!clip?.samples.length || clip.sampleRate !== sampleRate) throw new Error(`Missing or incompatible audio for ${phrase.id}`);
    const startFrame = Math.round(cursor / sampleRate * FPS);
    chunks.push(clip.samples); cursor += clip.samples.length;
    const speechEndFrame = Math.round(cursor / sampleRate * FPS);
    chunks.push(new Float32Array(gap)); cursor += gap;
    cues.push({id: phrase.id, sceneId: scene.id, phase: scene.phase, label: scene.label, text: phrase.text, startFrame, speechEndFrame, endFrame: Math.round(cursor / sampleRate * FPS)});
  }
  const durationInFrames = Math.max(plan.targetSeconds * FPS, Math.ceil((cursor + outro) / sampleRate * FPS));
  if (durationInFrames > 90 * FPS) throw new Error('Narration exceeds 90 seconds; shorten the approved plan');
  const totalSamples = Math.ceil(durationInFrames / FPS * sampleRate);
  const samples = new Float32Array(totalSamples);
  let offset = 0;
  for (const chunk of chunks) {samples.set(chunk, offset); offset += chunk.length;}
  return {audio: {samples, sampleRate}, cues, durationInFrames};
}

export function srt(cues: Cue[], captionLanguage: Language): string {
  const stamp = (frame: number) => {
    const milliseconds = Math.round(frame / FPS * 1000);
    return `${String(Math.floor(milliseconds / 3600000)).padStart(2, '0')}:${String(Math.floor(milliseconds / 60000) % 60).padStart(2, '0')}:${String(Math.floor(milliseconds / 1000) % 60).padStart(2, '0')},${String(milliseconds % 1000).padStart(3, '0')}`;
  };
  return cues.map((cue, index) => `${index + 1}\n${stamp(cue.startFrame)} --> ${stamp(cue.endFrame)}\n${cue.text[captionLanguage]}\n`).join('\n');
}
