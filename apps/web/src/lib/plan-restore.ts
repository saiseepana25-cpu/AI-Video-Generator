// Shared validation for the small restore command; never contains provider data.
export type RestoreInput = {expectedProjectRevision: number; expectedCurrentPlanVersionId: string};
export type RestoreCommand = {key: string; sourceId: string; body: RestoreInput};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export function parseRestoreInput(raw: unknown): RestoreInput | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const v = raw as RestoreInput;
  if (Object.keys(v).length !== 2 || !Number.isSafeInteger(v.expectedProjectRevision) || v.expectedProjectRevision < 1 || typeof v.expectedCurrentPlanVersionId !== 'string' || !uuid.test(v.expectedCurrentPlanVersionId)) return null;
  return {expectedProjectRevision: v.expectedProjectRevision, expectedCurrentPlanVersionId: v.expectedCurrentPlanVersionId};
}
export function recoverRestore(raw: string): RestoreCommand | null {
  try {
    if (raw.length > 2000) return null;
    const c = JSON.parse(raw) as RestoreCommand;
    const body = parseRestoreInput(c.body);
    return Object.keys(c).length === 3 && typeof c.key === 'string' && typeof c.sourceId === 'string' && uuid.test(c.key) && uuid.test(c.sourceId) && body ? {key: c.key, sourceId: c.sourceId, body} : null;
  } catch {return null;}
}
