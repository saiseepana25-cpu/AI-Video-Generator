import type {ProjectDetail} from '../server/projects/contracts';
import {parseProjectPatch, type ProjectPatch} from '../server/projects/validation';

export type Draft = Pick<ProjectDetail, 'brief' | 'settings'>;
export type PendingEdit = {key: string; body: ProjectPatch; submitted: Draft};
export type Recovery = {version: 1; scope: string; base: ProjectDetail; draft: Draft; pending: PendingEdit | null; review: boolean};
export const editable = (project: Draft): Draft => ({brief: structuredClone(project.brief), settings: structuredClone(project.settings)});
export const sameDraft = (a: Draft, b: Draft) => JSON.stringify(a.brief) === JSON.stringify(b.brief) && JSON.stringify(a.settings) === JSON.stringify(b.settings);
export function changes(base: Draft, draft: Draft): ProjectPatch['patch'] {
  return {...(JSON.stringify(base.brief) !== JSON.stringify(draft.brief) ? {brief: draft.brief} : {}),
    ...(JSON.stringify(base.settings) !== JSON.stringify(draft.settings) ? {settings: draft.settings} : {})};
}
// An acknowledgement may cover an older draft while the user is still typing.
export function acknowledge(current: Draft, submitted: Draft, saved: ProjectDetail): Draft {
  return sameDraft(current, submitted) ? editable(saved) : current;
}
export const recoveryKey = (workspace: string, user: string, project: string) => `videocraft:draft:v1:${workspace}:${user}:${project}`;
const boundedDraft = (value: Draft) => {
  if (!value || typeof value.brief?.idea !== 'string' || value.brief.idea.length > 80000 || typeof value.brief.audience !== 'string' || value.brief.audience.length > 8000 || !Array.isArray(value.brief.references) || value.brief.references.length > 10) return false;
  if (!value.brief.references.every(r => r && typeof r.referenceId === 'string' && /^[a-z][a-z0-9_-]{0,63}$/.test(r.referenceId) && typeof r.text === 'string' && r.text.length <= 800000 && (r.suppliedUrl === null || (typeof r.suppliedUrl === 'string' && r.suppliedUrl.length <= 81920)))) return false;
  try {parseProjectPatch({expectedProjectRevision: 1, patch: {settings: value.settings}}); return true;} catch {return false;}
};
export function readRecovery(raw: string | null, scope: string, projectId: string): Recovery | null {
  try {
    if (!raw || raw.length > 1000000) return null;
    const value = JSON.parse(raw) as Recovery;
    if (value.version !== 1 || value.scope !== scope || value.base?.id !== projectId || !Number.isSafeInteger(value.base.revision) || value.base.revision < 1 || typeof value.review !== 'boolean' || !boundedDraft(value.base) || !boundedDraft(value.draft)) return null;
    if (value.pending) {
      if (!/^[0-9a-f-]{36}$/.test(value.pending.key) || !boundedDraft(value.pending.submitted)) return null;
      parseProjectPatch(value.pending.body);
      // The receipt must belong to this exact recovered base/command.
      if (value.pending.body.expectedProjectRevision !== value.base.revision || JSON.stringify(changes(value.base, value.pending.submitted)) !== JSON.stringify(value.pending.body.patch)) return null;
    }
    return value;
  } catch {return null;}
}
