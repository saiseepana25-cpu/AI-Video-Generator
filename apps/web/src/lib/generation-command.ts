export type ApprovalInput = {expectedProjectRevision: number; planVersionId: string; generationInputHash: string};
export type GenerationCommand = {projectId: string; key: string; action: 'approve'; targetId: string; body: ApprovalInput} | {projectId: string; key: string; action: 'cancel'; targetId: string; body: {expectedRevision: number}};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const revision = (v: unknown) => typeof v === 'number' && Number.isSafeInteger(v) && v > 0;
export function approvalInput(raw: unknown): ApprovalInput | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const v = raw as ApprovalInput;
  if (Object.keys(v).length !== 3 || !revision(v.expectedProjectRevision) || typeof v.planVersionId !== 'string' || !uuid.test(v.planVersionId) || typeof v.generationInputHash !== 'string' || !/^[a-f0-9]{64}$/.test(v.generationInputHash)) return null;
  return {expectedProjectRevision: v.expectedProjectRevision, planVersionId: v.planVersionId, generationInputHash: v.generationInputHash};
}
export function recoverGenerationCommand(raw: string, projectId: string): GenerationCommand | null {
  try {
    if (raw.length > 3000) return null;
    const c = JSON.parse(raw) as GenerationCommand;
    if (Object.keys(c).length !== 5 || c.projectId !== projectId || typeof c.key !== 'string' || !uuid.test(c.key) || typeof c.targetId !== 'string' || !uuid.test(c.targetId)) return null;
    if (c.action === 'approve') {const body = approvalInput(c.body); return body && c.targetId === projectId ? {...c, body} : null;}
    if (c.action === 'cancel' && c.body && Object.keys(c.body).length === 1 && revision(c.body.expectedRevision)) return c;
    return null;
  } catch {return null;}
}
