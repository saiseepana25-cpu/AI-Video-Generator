export type ProjectSettings = {
  language: 'en' | 'te'; targetSeconds: 30 | 60 | 90; accentId: string | null; voiceCatalogId: string | null;
  brandKitRevisionId: string | null; themeId: string; captionStyleId: string;
};
export type ProjectInput = {
  displayTitle: string; idea: string; audience: string;
  references: {referenceId: string; text: string; suppliedUrl: string | null}[];
  settings: ProjectSettings;
};
export type ActorSummary = {id: string | null; name: string};
export type ProjectSummary = {
  id: string; displayTitle: string; language: 'en' | 'te'; targetSeconds: 30 | 60 | 90;
  revision: number; briefRevision: number; createdAt: string; updatedAt: string;
  createdBy: ActorSummary; updatedBy: ActorSummary; draftState: 'draft';
  latestRun: null; latestReadyVideo: null; publishing: never[];
};
export type ProjectDetail = ProjectSummary & {
  brief: {idea: string; audience: string; references: ProjectInput['references']}; settings: ProjectSettings;
  currentPlanVersionId: string | null; currentPlanInputHash: null; activePlanningJobId: string | null;
  allowedActions: string[]; blockedReasons: {action: string; code: string; message: string}[];
};
export type ProjectPage = {items: ProjectSummary[]; page: {limit: number; hasMore: boolean; nextCursor: string | null}};
export type ProjectContext = {workspaceId: string; userId: string; userName: string};
export type FieldError = {path: string; code: string; message: string};

export class ProjectError extends Error {
  constructor(public readonly code: string, public readonly status: number, message: string,
    public readonly fieldErrors: FieldError[] = [], public readonly retryable = false,
    public readonly details: {currentRevision?: number; updatedAt?: string; updatedBy?: ActorSummary} = {}) { super(message); }
}

export const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export function requireProjectId(id: string) {
  if (!uuidPattern.test(id)) throw new ProjectError('INVALID_ID', 400, 'Use a valid project ID.');
  return id;
}
