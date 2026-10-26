export const activityTypes = ['project_created', 'project_updated', 'project_deleted', 'planning_changed', 'generation_changed', 'workspace_settings_changed', 'workspace_brand_changed'] as const;
export type ActivityType = typeof activityTypes[number];
export type ActivityItem = {id:string; sequence:number; type:ActivityType; projectId:string|null; projectTitle:string|null; message:string; actor:string; createdAt:string; safeActionRoute:string; actionNeeded:boolean};
export type ActivityPage = {items:ActivityItem[]; page:{limit:number; hasMore:boolean; nextCursor:string|null}; readThroughSequence:number; latestSequence:number; timezone:string};
export type RecoveryItem = {id:string; projectId:string; projectTitle:string; kind:'planning'|'generation'|'storage'; message:string; actionLabel:string; safeActionRoute:string};
export type Operations = {checkedAt:string; worker:{state:'healthy'|'stale'|'not_started'|'disabled'|'draining'; lastSeenAt:string|null; renderCapacity:1; activeRenders:number};
  planningWorker:{state:'healthy'|'stale'|'not_started'; lastSeenAt:string|null}; providers:{id:'gemini'|'elevenlabs'; state:'observed'|'paused'|'disabled'|'unverified'|'exhausted'; message:string}[];
  queues:{generationWaiting:number; planningWaiting:number; publishingNeedsReview:null}; scheduling:{enabled:false; reasonCode:'NOT_IMPLEMENTED'}; recovery:{items:RecoveryItem[]; scope:'recent_projects'}};
