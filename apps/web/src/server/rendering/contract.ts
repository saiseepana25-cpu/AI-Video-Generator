// Pure selected-language contract shared with the isolated pipeline adapter.
// No React, database, credentials, network or filesystem dependencies.
import {createHash} from 'node:crypto';
import type {Plan} from '../planning/contracts';
import type {ProjectDetail, ProjectSettings} from '../projects/contracts';

export const RENDER_CONTRACT = 'educational-diagrams-v1';
export const EVALUATION_VOICE_ID = 'Xb7hH8MSUJpSbSDYk0k2';
export type FontPins = {heading: string; body: string; telugu: string};
export class RenderInputError extends Error {
  constructor(public readonly code: string, message: string) {super(message);}
}
const fail = (message: string): never => {throw new RenderInputError('INVALID_RENDER_INPUT', message);};
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'string') return JSON.stringify(value.normalize('NFC').replace(/\r\n?/g, '\n'));
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${Array.from(value, canonicalJson).join(',')}]`;
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`).join(',')}}`;
  return fail('Only finite JSON values can enter an approval snapshot.');
}
function object(value: unknown, keys: string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length || keys.some(k => !Object.hasOwn(value, k))) return fail('Use the exact supported render contract.');
}
function text(value: unknown, max: number, language?: 'en' | 'te', numericLabel = false, narrationWhitespace = false): string {
  if (typeof value !== 'string') return fail('Use bounded plain text without markup or control characters.');
  // Match the editor's narration normalization without relaxing single-line fields.
  const normalized = (narrationWhitespace ? value.replace(/\r\n?/g, '\n') : value).normalize('NFC');
  const result = normalized.trim();
  const invalidCharacters = narrationWhitespace ? /[<>\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\uD800-\uDFFF]/u : /[<>\u0000-\u001f\u007f\uD800-\uDFFF]/u;
  if (result.length > max || !result || invalidCharacters.test(normalized)) return fail('Use bounded plain text without markup or control characters.');
  if (language && ([...result].some(c => /[\p{L}\p{M}]/u.test(c) && !(language === 'te' ? /[\p{Script=Latin}\p{Script=Telugu}\p{Script=Inherited}]/u : /[\p{Script=Latin}\p{Script=Inherited}]/u).test(c)) || language === 'te' && (!numericLabel || /\p{L}/u.test(result)) && !/[\u0c00-\u0c7f]/u.test(result))) return fail('Keep spoken and visible video text in the selected language.');
  return result;
}
function array(value: unknown, min: number, max: number): asserts value is unknown[] {
  if (!Array.isArray(value) || value.length < min || value.length > max) return fail('Unsupported render-contract collection size.');
}
function metadata(value: unknown, max: number) {
  if (typeof value !== 'string' || value.length > max * 40 || !value.trim() || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\uD800-\uDFFF]/u.test(value)) return fail('Use bounded source text without invalid characters.');
  const normalized = value.normalize('NFC').replace(/\r\n?/g, '\n').trim();
  if ([...new Intl.Segmenter(undefined, {granularity: 'grapheme'}).segment(normalized)].length > max) return fail('Source text exceeds its supported size.');
  return normalized;
}
function fonts(pins: FontPins) {
  object(pins, ['heading', 'body', 'telugu']);
  if (Object.values(pins).some(v => typeof v !== 'string' || !/^[a-f0-9]{64}$/.test(v))) return fail('Local font checksums are required.');
  return [{id: 'sora-latin-400', role: 'heading', sha256: pins.heading}, {id: 'inter-latin-400', role: 'body', sha256: pins.body}, {id: 'noto-sans-telugu-400', role: 'telugu', sha256: pins.telugu}];
}
export function buildRenderPlan(proposal: Plan, brief: Pick<ProjectDetail['brief'], 'audience' | 'references'>, selection: ProjectSettings, pins: FontPins) {
  object(proposal, ['schemaVersion', 'title', 'learningObjective', 'language', 'targetSeconds', 'scenes', 'captions', 'reviewNotes']);
  object(selection, ['language', 'targetSeconds', 'accentId', 'voiceCatalogId', 'brandKitRevisionId', 'themeId', 'captionStyleId']);
  if (proposal.schemaVersion !== 2 || !['en', 'te'].includes(proposal.language) || ![30, 60, 90].includes(proposal.targetSeconds) || proposal.language !== selection.language || proposal.targetSeconds !== selection.targetSeconds) return fail('Plan language and duration must match the saved settings.');
  if (!selection.voiceCatalogId || !selection.accentId) throw new RenderInputError('VOICE_REQUIRED', 'Select a voice and its accent separately before preparing video input.');
  if (selection.voiceCatalogId !== 'alice-evaluation' || selection.accentId !== 'source-voice') throw new RenderInputError('VOICE_UNSUPPORTED', 'This voice/accent is not supported by the free evaluation adapter.');
  if (selection.brandKitRevisionId !== null || selection.themeId !== 'clean-educational-v1' || selection.captionStyleId !== 'readable-default-v1') throw new RenderInputError('SETTINGS_UNSUPPORTED', 'This brand or visual style needs a supported, reviewed adapter.');
  array(proposal.scenes, 3, 8); array(proposal.captions, 3, 8); array(proposal.reviewNotes, 0, 5); array(brief.references, 0, 10);
  const ids = new Set<string>();
  const scenes = proposal.scenes.map(scene => {
    object(scene, ['sceneId', 'heading', 'narration', 'labels', 'layout']);
    if (typeof scene.sceneId !== 'string' || !/^scene_[1-8]$/.test(scene.sceneId) || ids.has(scene.sceneId) || !['sequence', 'cycle', 'comparison'].includes(scene.layout)) return fail('Scene IDs and layouts must be unique and supported.');
    ids.add(scene.sceneId); array(scene.labels, 2, 5);
    return {sceneId: scene.sceneId, heading: text(scene.heading, 140, proposal.language), narration: text(scene.narration, 1000, proposal.language, false, true), labels: scene.labels.map(label => text(label, 100, proposal.language, true)), layout: scene.layout};
  });
  // Never silently fix wrong captions, missing coverage, duplicate IDs or anchors.
  if (proposal.captions.length !== scenes.length || new Set(proposal.captions.map(c => c.captionId)).size !== scenes.length || new Set(proposal.captions.map(c => c.sourceSegmentId)).size !== scenes.length) return fail('Every narration segment requires one unique matching caption.');
  for (const caption of proposal.captions) {
    object(caption, ['captionId', 'sourceSegmentId', 'text']);
    const scene = scenes.find(s => s.sceneId === caption.sourceSegmentId);
    if (!scene || caption.captionId !== `caption_${scene.sceneId}` || text(caption.text, 1000, proposal.language, false, true) !== scene.narration) return fail('Captions must exactly match their selected-language narration.');
  }
  const referenceIds = new Set<string>();
  const suppliedReferences = brief.references.map(ref => {
    object(ref, ['referenceId', 'text', 'suppliedUrl']);
    if (typeof ref.referenceId !== 'string' || !/^[a-z][a-z0-9_-]{0,63}$/.test(ref.referenceId) || referenceIds.has(ref.referenceId)) return fail('References need unique stable IDs.');
    referenceIds.add(ref.referenceId);
    if (ref.suppliedUrl !== null) {
      try {const url = new URL(ref.suppliedUrl); if (typeof ref.suppliedUrl !== 'string' || ref.suppliedUrl.length > 2048 || !['http:', 'https:'].includes(url.protocol) || url.username || url.password) return fail('References are provenance only; use safe HTTP source URLs.');}
      catch {return fail('References are provenance only; use safe HTTP source URLs.');}
    }
    return {referenceId: ref.referenceId, text: metadata(ref.text, 20000), suppliedUrl: ref.suppliedUrl};
  });
  if (suppliedReferences.reduce((sum, ref) => sum + [...new Intl.Segmenter(undefined, {granularity: 'grapheme'}).segment(ref.text)].length, 0) > 20000) return fail('References must total at most 20,000 characters.');
  const settingsSnapshot = {language: proposal.language, captionLanguage: proposal.language, targetSeconds: proposal.targetSeconds,
    voiceCatalogId: selection.voiceCatalogId, accentId: selection.accentId,
    speech: {provider: 'elevenlabs', model: 'eleven_v3', voiceId: EVALUATION_VOICE_ID, outputFormat: 'pcm_24000', settings: {stability: 0.5, similarityBoost: 0.75, speed: 1}, adapterVersion: 'elevenlabs-phrase-v1', pronunciationPolicy: 'approved-text-only-v1'},
    brand: {revisionId: null, logoAsset: null, colors: {canvas: '#101218', surface: '#1B1E27', text: '#F4F2FA', accent: '#B7A4FF', secondary: '#7EDDCF'}, fonts: fonts(pins)},
    themeId: selection.themeId, captionStyleId: selection.captionStyleId,
    output: {width: 1080, height: 1920, fps: 30, videoCodec: 'h264', pixelFormat: 'yuv420p', audioCodec: 'aac', audioSampleRate: 48000, audioBitrate: 128000, maxSeconds: 90},
    compilerVersion: 'staged-diagrams-compiler-v1', rendererContractVersion: RENDER_CONTRACT,
    timing: {version: 'measured-phrase-v1', anchors: 'phrase-only', introMs: 350, outroMs: 550, minimumGapMs: 120, captionMaxLines: 2, finalFrames: 'measured-audio-required'},
    safeArea: {left: 72, right: 72, top: 160, bottom: 240}, usagePolicy: 'evaluation_only', policyVersion: 'free-evaluation-v1', normalizationVersion: 'nfc-lf-v1'};
  const plan = {schemaVersion: 2 as const, contract: RENDER_CONTRACT as typeof RENDER_CONTRACT, title: text(proposal.title, 160, proposal.language), learningObjective: text(proposal.learningObjective, 400, proposal.language),
    audience: metadata(brief.audience, 200), language: proposal.language, targetSeconds: proposal.targetSeconds,
    narration: scenes.map(s => ({segmentId: `segment_${s.sceneId}`, text: s.narration})),
    captions: scenes.map(s => ({captionId: `caption_${s.sceneId}`, sourceSegmentId: `segment_${s.sceneId}`, text: s.narration})),
    scenes: scenes.map(s => ({sceneId: s.sceneId, templateId: `diagram.${s.layout}` as `diagram.${Plan['scenes'][number]['layout']}`, templateVersion: '1' as const, segmentIds: [`segment_${s.sceneId}`],
      props: {heading: s.heading, nodes: s.labels.map((label, i) => ({nodeId: `${s.sceneId}_node_${i + 1}`, label}))},
      events: [{eventId: `show_${s.sceneId}`, segmentId: `segment_${s.sceneId}`, anchor: 'phrase_start' as const, offsetMs: 0, action: 'reveal_diagram' as const}, {eventId: `hold_${s.sceneId}`, segmentId: `segment_${s.sceneId}`, anchor: 'phrase_end' as const, offsetMs: 0, action: 'hold_diagram' as const}]})),
    suppliedReferences, reviewNotes: proposal.reviewNotes.map((note, i) => ({id: `review_${i + 1}`, severity: 'warning', message: text(note, 300)})), settingsSnapshot};
  if (Buffer.byteLength(canonicalJson(plan)) > 512 * 1024) return fail('The resolved video input exceeds 512 KiB.');
  return plan;
}
export type RenderPlan = ReturnType<typeof buildRenderPlan>;
/** Rebuild and compare the exact whitelist, rejecting extra keys/code/events/IDs.
 * Workers must additionally verify these font pins against their local bytes.
 */
export function validateRenderPlan(raw: unknown): RenderPlan {
  try {
    if (Buffer.byteLength(JSON.stringify(raw)) > 512 * 1024) return fail('The video input exceeds 512 KiB.');
    const p = raw as RenderPlan, settings = p.settingsSnapshot, brandFonts = settings.brand.fonts;
    const proposal: Plan = {schemaVersion: 2, title: p.title, learningObjective: p.learningObjective, language: p.language, targetSeconds: p.targetSeconds,
      scenes: p.scenes.map(s => ({sceneId: s.sceneId, heading: s.props.heading, narration: p.narration.find(n => n.segmentId === `segment_${s.sceneId}`)!.text, labels: s.props.nodes.map(n => n.label), layout: s.templateId.slice(8) as 'sequence'})),
      captions: p.captions.map(c => ({...c, sourceSegmentId: c.sourceSegmentId.replace(/^segment_/, '')})), reviewNotes: p.reviewNotes.map(n => n.message)};
    const rebuilt = buildRenderPlan(proposal, {audience: p.audience, references: p.suppliedReferences}, {language: p.language, targetSeconds: p.targetSeconds, voiceCatalogId: settings.voiceCatalogId, accentId: settings.accentId, brandKitRevisionId: null, themeId: settings.themeId, captionStyleId: settings.captionStyleId},
      {heading: brandFonts[0].sha256, body: brandFonts[1].sha256, telugu: brandFonts[2].sha256});
    if (canonicalJson(raw) !== canonicalJson(rebuilt)) return fail('Unsupported fields, coverage, anchors or pinned settings in the video input.');
    return rebuilt;
  } catch (error) {if (error instanceof RenderInputError) throw error; return fail('Malformed video input.');}
}
export function generationHash(raw: unknown) {return hash(canonicalJson(validateRenderPlan(raw)));}
