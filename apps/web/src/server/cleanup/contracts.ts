import type {Long} from 'mongodb';
import type {StorageObject} from '../storage/contracts';
export type MediaCleanupStatus={state:'no_ready_media'|'not_started'|'pending'|'retry_required'|'partial'|'ready_media_removed';totalAssets:number;deletedAssets:number;retainedContent:true};
export type CleanupTask={_id:string;workspaceId:string;projectId:string;videoId:string;bundleId:string;configHash:string;bucket:string;object:StorageObject;referenceRevision:Long;attempts:Long;state:'pending'|'retry'|'deleted';error:'OBJECT_REMOVAL_FAILED'|null;createdAt:Date;updatedAt:Date;deletedAt:Date|null;nextAttemptAt:Date};
export interface CleanupStore{configHash:string;bucket:string;remove(object:StorageObject):Promise<void>;}
export class CleanupFault extends Error{constructor(public code:string){super(code);}}
