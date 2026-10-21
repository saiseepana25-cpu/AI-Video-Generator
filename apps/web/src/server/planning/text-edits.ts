import {ProjectError} from '../projects/contracts';
import type {Plan} from './contracts';

export type TextEditInput = {expectedProjectRevision: number; edits: {
  narration?: {segmentId: string; text: string}[]; headings?: {sceneId: string; text: string}[];
}};
const invalid = (message: string): never => {throw new ProjectError('VALIDATION_FAILED', 422, message);};
function object(value: unknown, allowed: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid('Use the documented edit object.');
  if (Object.keys(value).some(k => !allowed.includes(k))) return invalid('This increment supports narration and existing scene headings only.');
  return value as Record<string, unknown>;
}
export function parseTextEdits(raw: unknown): TextEditInput {
  const body = object(raw, ['expectedProjectRevision', 'edits']);
  if (body.expectedProjectRevision === undefined) throw new ProjectError('PRECONDITION_REQUIRED', 428, 'Include the saved project revision.');
  if (!Number.isSafeInteger(body.expectedProjectRevision) || (body.expectedProjectRevision as number) < 1) return invalid('Use a positive safe integer revision.');
  const source = object(body.edits, ['narration', 'headings']), edits: TextEditInput['edits'] = {};
  for (const field of ['narration', 'headings'] as const) {
    if (!(field in source)) continue;
    const items = source[field], idKey = field === 'narration' ? 'segmentId' : 'sceneId';
    if (!Array.isArray(items) || items.length < 1 || items.length > 8) return invalid('Edit between one and eight existing scenes.');
    const checked = items.map(item => {
      const row = object(item, [idKey, 'text']);
      if (typeof row[idKey] !== 'string' || !/^scene_[1-8]$/.test(row[idKey] as string)) return invalid('Use an existing scene ID.');
      if (typeof row.text !== 'string') return invalid('Enter text for each edit.');
      const text = row.text.replace(/\r\n?/g, '\n').normalize('NFC').trim();
      if (!text || text.length > (field === 'narration' ? 1000 : 140) || /[<>\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\uD800-\uDFFF]/u.test(text) || field === 'headings' && /[\n\t]/u.test(text)) return invalid('Use plain nonempty text within the scene limit.');
      return {id: row[idKey] as string, text};
    });
    if (new Set(checked.map(r => r.id)).size !== checked.length) return invalid('Each scene may be edited once per field.');
    checked.sort((a, b) => a.id.localeCompare(b.id));
    if (field === 'narration') edits.narration = checked.map(r => ({segmentId: r.id, text: r.text}));
    else edits.headings = checked.map(r => ({sceneId: r.id, text: r.text}));
  }
  if (!edits.narration && !edits.headings) return invalid('Include narration or heading changes.');
  return {expectedProjectRevision: body.expectedProjectRevision as number, edits};
}
export function applyTextEdits(base: Plan, input: TextEditInput): Plan {
  const plan = structuredClone(base), ids = new Set(plan.scenes.map(s => s.sceneId));
  for (const change of [...(input.edits.narration ?? []).map(c => ({id: c.segmentId, text: c.text})), ...(input.edits.headings ?? []).map(c => ({id: c.sceneId, text: c.text}))]) {
    if (!ids.has(change.id)) return invalid('Structural scene changes are not supported.');
    if (plan.language === 'te' && !/[\u0c00-\u0c7f]/u.test(change.text)) return invalid('Use Telugu text for a Telugu plan.');
    if ([...change.text].some(c => /[\p{L}\p{M}]/u.test(c) && !(plan.language === 'te' ? /[\p{Script=Latin}\p{Script=Telugu}\p{Script=Inherited}]/u : /[\p{Script=Latin}\p{Script=Inherited}]/u).test(c))) return invalid('Keep narration and headings in the selected language.');
  }
  for (const scene of plan.scenes) {
    scene.narration = input.edits.narration?.find(c => c.segmentId === scene.sceneId)?.text ?? scene.narration;
    scene.heading = input.edits.headings?.find(c => c.sceneId === scene.sceneId)?.text ?? scene.heading;
  }
  plan.captions = plan.scenes.map(s => ({captionId: `caption_${s.sceneId}`, sourceSegmentId: s.sceneId, text: s.narration}));
  return plan;
}
