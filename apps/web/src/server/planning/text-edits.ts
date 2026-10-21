import {ProjectError} from '../projects/contracts';
import type {Plan, Scene} from './contracts';

export type TextEditInput = {expectedProjectRevision: number; edits: {
  narration?: {segmentId: string; text: string}[]; headings?: {sceneId: string; text: string}[];
  diagrams?: {sceneId: string; labels: string[]; layout: Scene['layout']}[];
}};
const invalid = (message: string): never => {throw new ProjectError('VALIDATION_FAILED', 422, message);};
function object(value: unknown, allowed: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid('Use the documented edit object.');
  if (Object.keys(value).some(k => !allowed.includes(k))) return invalid('Use supported narration, heading or diagram fields for existing scenes only.');
  return value as Record<string, unknown>;
}
export function parseTextEdits(raw: unknown): TextEditInput {
  const body = object(raw, ['expectedProjectRevision', 'edits']);
  if (body.expectedProjectRevision === undefined) throw new ProjectError('PRECONDITION_REQUIRED', 428, 'Include the saved project revision.');
  if (!Number.isSafeInteger(body.expectedProjectRevision) || (body.expectedProjectRevision as number) < 1) return invalid('Use a positive safe integer revision.');
  const source = object(body.edits, ['narration', 'headings', 'diagrams']), edits: TextEditInput['edits'] = {};
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
  if ('diagrams' in source) {
    if (!Array.isArray(source.diagrams) || source.diagrams.length < 1 || source.diagrams.length > 8) return invalid('Replace diagrams for between one and eight existing scenes.');
    edits.diagrams = source.diagrams.map(item => {
      const row = object(item, ['sceneId', 'labels', 'layout']);
      if (typeof row.sceneId !== 'string' || !/^scene_[1-8]$/.test(row.sceneId) || !['sequence', 'cycle', 'comparison'].includes(row.layout as string)) return invalid('Use an existing scene ID and supported diagram layout.');
      if (!Array.isArray(row.labels) || row.labels.length < 2 || row.labels.length > 5) return invalid('Each diagram needs two to five labels.');
      const labels = row.labels.map(value => {
        if (typeof value !== 'string') return invalid('Use plain text diagram labels.');
        const text = value.normalize('NFC').trim();
        if (!text || text.length > 100 || /[<>\u0000-\u001f\u007f\uD800-\uDFFF]/u.test(text)) return invalid('Each diagram label needs 1–100 plain text characters.');
        return text;
      });
      return {sceneId: row.sceneId, labels, layout: row.layout as Scene['layout']};
    });
    if (new Set(edits.diagrams.map(d => d.sceneId)).size !== edits.diagrams.length) return invalid('Each scene diagram may be replaced only once.');
    edits.diagrams.sort((a, b) => a.sceneId.localeCompare(b.sceneId));
  }
  if (!edits.narration && !edits.headings && !edits.diagrams) return invalid('Include narration, heading or diagram changes.');
  return {expectedProjectRevision: body.expectedProjectRevision as number, edits};
}
export function applyTextEdits(base: Plan, input: TextEditInput): Plan {
  const plan = structuredClone(base), ids = new Set(plan.scenes.map(s => s.sceneId));
  for (const change of [...(input.edits.narration ?? []).map(c => ({id: c.segmentId, text: c.text, label: false})), ...(input.edits.headings ?? []).map(c => ({id: c.sceneId, text: c.text, label: false})), ...(input.edits.diagrams ?? []).flatMap(c => c.labels.map(text => ({id: c.sceneId, text, label: true})))]) {
    if (!ids.has(change.id)) return invalid('Structural scene changes are not supported.');
    if (plan.language === 'te' && (!change.label || /\p{L}/u.test(change.text)) && !/[\u0c00-\u0c7f]/u.test(change.text)) return invalid('Use Telugu text for a Telugu plan.');
    if ([...change.text].some(c => /[\p{L}\p{M}]/u.test(c) && !(plan.language === 'te' ? /[\p{Script=Latin}\p{Script=Telugu}\p{Script=Inherited}]/u : /[\p{Script=Latin}\p{Script=Inherited}]/u).test(c))) return invalid('Keep narration and headings in the selected language.');
  }
  for (const scene of plan.scenes) {
    scene.narration = input.edits.narration?.find(c => c.segmentId === scene.sceneId)?.text ?? scene.narration;
    scene.heading = input.edits.headings?.find(c => c.sceneId === scene.sceneId)?.text ?? scene.heading;
    const diagram = input.edits.diagrams?.find(c => c.sceneId === scene.sceneId);
    if (diagram) {scene.labels = [...diagram.labels]; scene.layout = diagram.layout;}
  }
  plan.captions = plan.scenes.map(s => ({captionId: `caption_${s.sceneId}`, sourceSegmentId: s.sceneId, text: s.narration}));
  return plan;
}
