import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildRenderPlan, generationHash, canonicalJson} from '../src/pipeline/render-contract.js';
import {assembleSelected, selectedSrt} from '../src/pipeline/selected-timing.js';
import {fitMeasured, wrapMeasured, computeSelectedLayout} from '../src/video/selected-layout.js';
import {selectedFixture} from '../fixtures/selected-diagrams.js';
import {renderSelectedVideo, selectedFontAssets, selectedRendererBuildHash} from '../src/pipeline/selected-renderer.js';
import type {SelectedClip, SelectedVideoProps} from '../src/pipeline/selected-types.js';

const pins = {heading: 'a'.repeat(64), body: 'b'.repeat(64), telugu: 'c'.repeat(64)};
const setup = (language: 'en' | 'te' = 'en') => {
  const f = selectedFixture(language), plan = buildRenderPlan(f.proposal, f.brief, f.settings, pins);
  const clips: SelectedClip[] = plan.narration.map(n => ({segmentId: n.segmentId, text: n.text, source: {provider: 'offline-diagnostic', model: 'espeak', voiceId: language}, audio: {sampleRate: 24000, samples: Float32Array.from({length: 24000}, (_, i) => Math.sin(i / 10) * .2)}}));
  return {plan, clips, hash: generationHash(plan)};
};
test('English/Telugu measured timelines preserve approved text/IDs, exact source samples, phrase anchors and duration cap', () => {
  for (const language of ['en', 'te'] as const) {
    const {plan, clips, hash} = setup(language), t = assembleSelected(plan, hash, clips, 'offline-diagnostic');
    assert.equal(t.plan.language, language); assert.equal(t.durationInFrames, 900); assert.equal(t.timingPrecision, 'measured-phrase-only');
    t.cues.forEach((cue, i) => {
      assert.equal(cue.text, plan.captions[i].text); assert.equal(cue.sampleEnd - cue.sampleStart, clips[i].audio.samples.length);
      assert.deepEqual(t.audio.samples.slice(cue.sampleStart, cue.sampleEnd), clips[i].audio.samples);
      assert.ok(Math.abs(cue.startFrame / 30 - cue.sampleStart / 24000) <= 1 / 60); assert.ok(cue.speechEndFrame <= cue.endFrame);
      if (i) assert.ok(t.cues[i - 1].endFrame <= cue.startFrame);
    });
    assert.equal(canonicalJson(t.plan), canonicalJson(plan));
    const srt = selectedSrt(t.cues); assert.ok(srt.includes('00:00:00,367')); assert.ok(srt.includes(plan.narration[0].text));
  }
});
test('approval mismatch, text mismatch, duplicate/missing/extra clips and changed voice cannot render', () => {
  const {plan, clips, hash} = setup();
  assert.throws(() => assembleSelected(plan, 'f'.repeat(64), clips, 'offline-diagnostic'), /hash/);
  for (const bad of [clips.slice(1), [...clips, clips[0]], [clips[0], clips[0], clips[2]], [{...clips[0], text: 'Other text'}, ...clips.slice(1)]]) assert.throws(() => assembleSelected(plan, hash, bad, 'offline-diagnostic'));
  assert.throws(() => assembleSelected(plan, hash, clips, 'elevenlabs-evaluation'), /pinned voice/);
  const valid = clips.map(c => ({...c, source: {provider: 'elevenlabs' as const, model: plan.settingsSnapshot.speech.model, voiceId: plan.settingsSnapshot.speech.voiceId}}));
  assert.equal(assembleSelected(plan, hash, valid, 'elevenlabs-evaluation').sourceMode, 'elevenlabs-evaluation');
  assert.throws(() => assembleSelected(plan, hash, valid.map(c => ({...c, source: {...c.source, voiceId: 'other'}})), 'elevenlabs-evaluation'), /pinned voice/);
});
test('invalid/silent/clipped PCM, mixed sample rates and measured speech beyond 90 seconds are rejected', () => {
  const {plan, clips, hash} = setup();
  const invalidSamples = clips[0].audio.samples.slice(); invalidSamples[100] = NaN;
  assert.throws(() => assembleSelected(plan, hash, [{...clips[0], audio: {...clips[0].audio, samples: invalidSamples}}, ...clips.slice(1)], 'offline-diagnostic'), /invalid PCM/);
  for (const audio of [{sampleRate: 24000, samples: new Float32Array(24000)}, {sampleRate: 24000, samples: Float32Array.of(NaN)}, {sampleRate: 24000, samples: Float32Array.of(1.5)}, {sampleRate: 24000, samples: new Float32Array(24000).fill(1)}, {sampleRate: 16000, samples: clips[0].audio.samples}, {...clips[0].audio, sampleRate: 22050}]) assert.throws(() => assembleSelected(plan, hash, [{...clips[0], audio}, ...clips.slice(1)], 'offline-diagnostic'));
  const tooLong = clips.map(c => ({...c, audio: {...c.audio, samples: new Float32Array(31 * 24000).fill(.2)}}));
  assert.throws(() => assembleSelected(plan, hash, tooLong, 'offline-diagnostic'), /90 seconds/);
  const offTarget = clips.map(c => ({...c, audio: {...c.audio, samples: new Float32Array(12 * 24000).fill(.2)}}));
  assert.throws(() => assembleSelected(plan, hash, offTarget, 'offline-diagnostic'), /target tolerance/);
});
test('all supported target lengths use measured speech and deterministic reading holds without exceeding 90 seconds', () => {
  for (const targetSeconds of [30, 60, 90] as const) {
    const f = selectedFixture('en'); f.proposal.targetSeconds = f.settings.targetSeconds = targetSeconds;
    const plan = buildRenderPlan(f.proposal, f.brief, f.settings, pins), {clips} = setup();
    const timeline = assembleSelected(plan, generationHash(plan), clips, 'offline-diagnostic'); assert.equal(timeline.durationInFrames, targetSeconds * 30);
  }
});
test('font measurement wraps at words/graphemes, keeps explicit narration breaks and refuses unreadable overflow', () => {
  const measure = (text: string, size: number) => [...new Intl.Segmenter(undefined, {granularity: 'grapheme'}).segment(text)].length * size;
  assert.deepEqual(wrapMeasured('Water rises.\nClouds form.', 200, 10, measure), ['Water rises.', 'Clouds form.']);
  const telugu = 'క్షిక్షిక్షి'; const lines = wrapMeasured(telugu, 10, 10, measure); assert.equal(lines.join(''), telugu); assert.ok(lines.every(s => s === 'క్షి'));
  const box = {width: 200, height: 80, max: 20, min: 10, maxLines: 2, leading: 1.4};
  assert.equal(fitMeasured('Water moves', box, measure).lines.join(' '), 'Water moves');
  assert.throws(() => fitMeasured('Water '.repeat(200), box, measure), /readable size/);
});
test('layout enforces two-line selected-language captions, known template bounds and readable phrase rate', () => {
  const {plan, clips, hash} = setup(), timeline = assembleSelected(plan, hash, clips, 'offline-diagnostic');
  const props: SelectedVideoProps = {plan, cues: timeline.cues, audioFile: 'audio.wav', durationInFrames: timeline.durationInFrames, mode: 'offline-diagnostic', layout: null};
  const layout = computeSelectedLayout(props, (_role, text, size) => text.length * size * .4); assert.equal(layout.scenes.length, 3); assert.ok(layout.scenes.every(s => s.caption.lines.length <= 2));
  assert.ok(layout.scenes.every(s => s.heading.lines.length * s.heading.lineHeight <= 220));
  assert.throws(() => computeSelectedLayout({...props, cues: timeline.cues.map(c => ({...c, endFrame: c.startFrame + 1}))}, (_r, s, z) => s.length * z * .4), /too fast/);
});
test('license refusal and pre-cancelled execution stop before reading fonts, writing outputs or starting a renderer', async () => {
  const {plan, clips, hash} = setup(), options = {root: '/not-a-project', outputRoot: '/not-an-output', plan, clips, expectedHash: hash, mode: 'offline-diagnostic' as const};
  await assert.rejects(renderSelectedVideo({...options, licenseConfirmed: false}), /license/);
  await assert.rejects(renderSelectedVideo({...options, licenseConfirmed: true, signal: AbortSignal.abort()}), e => e instanceof Error && e.name === 'AbortError');
});
test('adapter pins the actual installed web fonts and build identity is deterministic', async () => {
  const {pins} = await selectedFontAssets(process.cwd()); assert.ok(Object.values(pins).every(p => /^[a-f0-9]{64}$/.test(p)));
  assert.equal(await selectedRendererBuildHash(process.cwd(), pins), await selectedRendererBuildHash(process.cwd(), pins));
  assert.notEqual(await selectedRendererBuildHash(process.cwd(), pins), await selectedRendererBuildHash(process.cwd(), {...pins, body: 'f'.repeat(64)}));
});
