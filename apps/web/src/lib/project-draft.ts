import type {ProjectDetail} from '../server/projects/contracts';
import type {ProjectPatch} from '../server/projects/validation';

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
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const boundedString = (value: unknown, max: number) => typeof value === 'string' && value.length <= max;
// Recovery holds unfinished input, including commands captured before an offline
// check. Validate its shape/bounds here; only the server decides save eligibility.
const boundedSettings = (value: Draft['settings']) => record(value)
  && boundedString(value.language, 80) && Number.isSafeInteger(value.targetSeconds)
  && (['accentId', 'voiceCatalogId', 'brandKitRevisionId'] as const).every(key => value[key] === null || boundedString(value[key], 81920))
  && boundedString(value.themeId, 81920) && boundedString(value.captionStyleId, 81920);
const boundedDraft = (value: Draft) => {
  if (!value || typeof value.brief?.idea !== 'string' || value.brief.idea.length > 80000 || typeof value.brief.audience !== 'string' || value.brief.audience.length > 8000 || !Array.isArray(value.brief.references) || value.brief.references.length > 10) return false;
  if (!value.brief.references.every(r => r && typeof r.referenceId === 'string' && /^[a-z][a-z0-9_-]{0,63}$/.test(r.referenceId) && typeof r.text === 'string' && r.text.length <= 800000 && (r.suppliedUrl === null || (typeof r.suppliedUrl === 'string' && r.suppliedUrl.length <= 81920)))) return false;
  return boundedSettings(value.settings);
};
export function readRecovery(raw: string | null, scope: string, projectId: string): Recovery | null {
  try {
    if (!raw || raw.length > 1000000) return null;
    const value = JSON.parse(raw) as Recovery;
    if (value.version !== 1 || value.scope !== scope || value.base?.id !== projectId || !Number.isSafeInteger(value.base.revision) || value.base.revision < 1 || typeof value.review !== 'boolean' || !boundedDraft(value.base) || !boundedDraft(value.draft)) return null;
    if (value.pending !== null) {
      if (!record(value.pending) || typeof value.pending.key !== 'string' || !/^[0-9a-f-]{36}$/.test(value.pending.key) || !boundedDraft(value.pending.submitted)) return null;
      if (!record(value.pending.body) || Object.keys(value.pending.body).sort().join(',') !== 'expectedProjectRevision,patch' || !record(value.pending.body.patch)) return null;
      // The receipt must belong to this exact recovered base/command.
      if (value.pending.body.expectedProjectRevision !== value.base.revision || JSON.stringify(changes(value.base, value.pending.submitted)) !== JSON.stringify(value.pending.body.patch)) return null;
    }
    return value;
  } catch {return null;}
}
