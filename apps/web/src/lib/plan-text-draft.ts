import type {TextEditInput} from '../server/planning/text-edits';
import type {Scene} from '../server/planning/contracts';
import {splitNarrationScenes} from './split-narration';
export type TextScene = {sceneId: string; heading: string; narration: string; labels?: string[]; layout?: Scene['layout']};
export type TextBase = {id: string; projectRevision: number; versionNumber: number; language: 'en' | 'te'; scenes: TextScene[]};
export type TextCommand = {key: string; body: TextEditInput};
export type TextRecovery = {version: 1; scope: string; base: TextBase; scenes: TextScene[]; pending: TextCommand | null; mode?: 'split'};
export const planTextBody = (work: TextRecovery): TextEditInput => work.mode === 'split'
  ? {expectedProjectRevision: work.base.projectRevision, edits: {splitNarration: true}} : textChanges(work.base, work.scenes);
export function textChanges(base: TextBase, scenes: TextScene[]): TextEditInput {
  const narration = scenes.filter(s => s.narration !== base.scenes.find(b => b.sceneId === s.sceneId)?.narration).map(s => ({segmentId: s.sceneId, text: s.narration}));
  const headings = scenes.filter(s => s.heading !== base.scenes.find(b => b.sceneId === s.sceneId)?.heading).map(s => ({sceneId: s.sceneId, text: s.heading}));
  const diagrams = scenes.filter(s => {
    const original = base.scenes.find(b => b.sceneId === s.sceneId);
    return original?.labels && original.layout && s.labels && s.layout && (JSON.stringify(s.labels) !== JSON.stringify(original.labels) || s.layout !== original.layout);
  }).map(s => ({sceneId: s.sceneId, labels: s.labels!, layout: s.layout!}));
  return {expectedProjectRevision: base.projectRevision, edits: {...(narration.length ? {narration} : {}), ...(headings.length ? {headings} : {}), ...(diagrams.length ? {diagrams} : {})}};
}
export function recoverPlanText(raw: string | null, scope: string): TextRecovery | null {
  try {
    if (!raw || raw.length > 1000000) return null;
    const v = JSON.parse(raw) as TextRecovery;
    const uuid = (id: unknown) => typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id);
    const scenes = (items: unknown): items is TextScene[] => Array.isArray(items) && items.length >= 3 && items.length <= 8 && items.every(s => s && /^scene_[1-8]$/.test(s.sceneId) && typeof s.heading === 'string' && s.heading.length <= 10000 && typeof s.narration === 'string' && s.narration.length <= 10000
      && (s.labels === undefined && s.layout === undefined || Array.isArray(s.labels) && s.labels.length >= 2 && s.labels.length <= 5 && s.labels.every((v: unknown) => typeof v === 'string' && v.length <= 1000) && ['sequence', 'cycle', 'comparison'].includes(s.layout))) && new Set(items.map(s => s.sceneId)).size === items.length;
    if (v.version !== 1 || v.scope !== scope || !v.base || !uuid(v.base.id) || !Number.isSafeInteger(v.base.projectRevision) || v.base.projectRevision < 1 || !Number.isSafeInteger(v.base.versionNumber) || v.base.versionNumber < 1 || !['en', 'te'].includes(v.base.language) || !scenes(v.base.scenes) || !scenes(v.scenes)) return null;
    if (v.mode !== undefined && v.mode !== 'split') return null;
    if (v.mode === 'split') {
      if (JSON.stringify(v.scenes) !== JSON.stringify(splitNarrationScenes(v.base.scenes))) return null;
    } else {
      if (v.scenes.map(s => s.sceneId).join() !== v.base.scenes.map(s => s.sceneId).join()) return null;
      if (v.scenes.some((s, i) => (s.labels === undefined) !== (v.base.scenes[i].labels === undefined))) return null;
    }
    // Preserve incomplete/temporarily invalid text independently of save validation.
    if (v.pending !== null && (!v.pending || !uuid(v.pending.key) || JSON.stringify(v.pending.body) !== JSON.stringify(planTextBody(v)))) return null;
    return v;
  } catch {return null;}
}
