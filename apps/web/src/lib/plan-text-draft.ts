import type {TextEditInput} from '../server/planning/text-edits';
export type TextScene = {sceneId: string; heading: string; narration: string};
export type TextBase = {id: string; projectRevision: number; versionNumber: number; language: 'en' | 'te'; scenes: TextScene[]};
export type TextCommand = {key: string; body: TextEditInput};
export type TextRecovery = {version: 1; scope: string; base: TextBase; scenes: TextScene[]; pending: TextCommand | null};
export function textChanges(base: TextBase, scenes: TextScene[]): TextEditInput {
  const narration = scenes.filter(s => s.narration !== base.scenes.find(b => b.sceneId === s.sceneId)?.narration).map(s => ({segmentId: s.sceneId, text: s.narration}));
  const headings = scenes.filter(s => s.heading !== base.scenes.find(b => b.sceneId === s.sceneId)?.heading).map(s => ({sceneId: s.sceneId, text: s.heading}));
  return {expectedProjectRevision: base.projectRevision, edits: {...(narration.length ? {narration} : {}), ...(headings.length ? {headings} : {})}};
}
export function recoverPlanText(raw: string | null, scope: string): TextRecovery | null {
  try {
    if (!raw || raw.length > 1000000) return null;
    const v = JSON.parse(raw) as TextRecovery;
    const uuid = (id: unknown) => typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id);
    const scenes = (items: unknown): items is TextScene[] => Array.isArray(items) && items.length >= 3 && items.length <= 8 && items.every(s => s && /^scene_[1-8]$/.test(s.sceneId) && typeof s.heading === 'string' && s.heading.length <= 10000 && typeof s.narration === 'string' && s.narration.length <= 10000) && new Set(items.map(s => s.sceneId)).size === items.length;
    if (v.version !== 1 || v.scope !== scope || !v.base || !uuid(v.base.id) || !Number.isSafeInteger(v.base.projectRevision) || v.base.projectRevision < 1 || !Number.isSafeInteger(v.base.versionNumber) || v.base.versionNumber < 1 || !['en', 'te'].includes(v.base.language) || !scenes(v.base.scenes) || !scenes(v.scenes)) return null;
    if (v.scenes.map(s => s.sceneId).join() !== v.base.scenes.map(s => s.sceneId).join()) return null;
    // Preserve incomplete/temporarily invalid text independently of save validation.
    if (v.pending !== null && (!v.pending || !uuid(v.pending.key) || JSON.stringify(v.pending.body) !== JSON.stringify(textChanges(v.base, v.scenes)))) return null;
    return v;
  } catch {return null;}
}
