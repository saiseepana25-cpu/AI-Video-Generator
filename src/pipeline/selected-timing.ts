import {generationHash, validateRenderPlan} from './render-contract.js';
import type {SelectedClip, SelectedCue, SelectedVideoProps} from './selected-types.js';
import type {Audio} from './wav.js';

/** Measured phrase timing only. No estimated word boundaries or cross-language captions. */
export function assembleSelected(raw: unknown, expectedHash: string, clips: SelectedClip[], mode: SelectedVideoProps['mode']) {
  const plan = validateRenderPlan(raw);
  if (generationHash(plan) !== expectedHash) throw new Error('Approved input hash does not match the resolved video plan.');
  if (!['offline-diagnostic', 'elevenlabs-evaluation'].includes(mode)) throw new Error('Choose an explicit supported speech source.');
  if (!Array.isArray(clips) || clips.length !== plan.narration.length || new Set(clips.map(c => c.segmentId)).size !== clips.length) throw new Error('Supply exactly one measured clip for every approved narration segment.');
  const ordered = plan.narration.map(n => {
    const clip = clips.find(c => c.segmentId === n.segmentId);
    if (!clip || clip.text !== n.text) throw new Error('Speech clip text/identity differs from the approved narration.');
    const speech = plan.settingsSnapshot.speech;
    if (mode === 'elevenlabs-evaluation' ? clip.source.provider !== 'elevenlabs' || clip.source.model !== speech.model || clip.source.voiceId !== speech.voiceId : clip.source.provider !== 'offline-diagnostic') throw new Error('Speech source does not match the requested render mode and pinned voice.');
    const {audio} = clip;
    if (!(audio.samples instanceof Float32Array) || ![22050, 24000, 48000].includes(audio.sampleRate) || audio.samples.length < audio.sampleRate * .1 || audio.samples.length > audio.sampleRate * 90) throw new Error('Speech must be bounded measured mono PCM of at least 100 ms.');
    let sum = 0, clipped = 0;
    for (const sample of audio.samples) {if (!Number.isFinite(sample) || Math.abs(sample) > 1) throw new Error('Speech contains invalid PCM samples.'); sum += sample * sample; if (Math.abs(sample) >= .999) clipped++;}
    if (10 * Math.log10(sum / audio.samples.length) < -55 || clipped / audio.samples.length > .01) throw new Error('Speech is silent or excessively clipped.');
    return clip;
  });
  const sampleRate = ordered[0].audio.sampleRate, fps = plan.settingsSnapshot.output.fps;
  if (ordered.some(c => c.audio.sampleRate !== sampleRate)) throw new Error('Normalize clip sample rates before assembly.');
  if (mode === 'elevenlabs-evaluation' && sampleRate !== 24000) throw new Error('Pinned ElevenLabs source must be pcm_24000.');
  const timing = plan.settingsSnapshot.timing;
  const intro = Math.round(timing.introMs * sampleRate / 1000), outro = Math.round(timing.outroMs * sampleRate / 1000);
  const spoken = ordered.reduce((n, c) => n + c.audio.samples.length, 0);
  const gap = Math.max(Math.ceil(timing.minimumGapMs * sampleRate / 1000), Math.floor((plan.targetSeconds * sampleRate - intro - outro - spoken) / ordered.length));
  const total = intro + spoken + ordered.length * gap + outro, durationInFrames = Math.ceil(total * fps / sampleRate);
  if (durationInFrames > plan.settingsSnapshot.output.maxSeconds * fps) throw new Error('Measured narration exceeds 90 seconds. Shorten and approve a new plan.');
  if (durationInFrames > (plan.targetSeconds + 3) * fps) throw new Error('Measured narration exceeds the selected target tolerance. Shorten and approve a new plan.');
  const samples = new Float32Array(Math.ceil(durationInFrames * sampleRate / fps)), cues: SelectedCue[] = [];
  let cursor = intro;
  for (const clip of ordered) {
    const scene = plan.scenes.find(s => s.segmentIds.includes(clip.segmentId))!;
    const sampleStart = cursor; samples.set(clip.audio.samples, cursor); cursor += clip.audio.samples.length;
    const sampleEnd = cursor; cursor += gap;
    cues.push({segmentId: clip.segmentId, sceneId: scene.sceneId, text: clip.text, sampleStart, sampleEnd,
      startFrame: Math.round(sampleStart * fps / sampleRate), speechEndFrame: Math.round(sampleEnd * fps / sampleRate), endFrame: Math.round(cursor * fps / sampleRate)});
  }
  return {plan, audio: {samples, sampleRate} satisfies Audio, cues, durationInFrames, sourceMode: mode, timingPrecision: 'measured-phrase-only' as const};
}

export function selectedSrt(cues: SelectedCue[], fps = 30) {
  const stamp = (frame: number) => {
    const ms = Math.round(frame * 1000 / fps);
    return `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
  };
  return cues.map((cue, i) => `${i + 1}\n${stamp(cue.startFrame)} --> ${stamp(cue.endFrame)}\n${cue.text}\n`).join('\n');
}
