import type {Long} from 'mongodb';
import type {StorageObject} from '../storage/contracts';
export type LocalFile={name:string;sha256:string;size:number};
export type LocalSource={runId:string;artifactId:string;manifestHash:string;inputHash:string;rendererBuildHash:string;objects:StorageObject[]};
export type LocalTask={_id:string;workspaceId:string;projectId:string;runId:string;rootHash:string;source:LocalSource;files:LocalFile[];state:'pending'|'retry'|'cleaned';revision:Long;attempts:Long;error:'LOCAL_REMOVAL_FAILED'|null;createdAt:Date;updatedAt:Date;cleanedAt:Date|null};
export type LocalStatus={state:'no_completed_artifacts'|'not_started'|'pending'|'retry_required'|'partial'|'known_files_removed';totalArtifacts:number;cleanedArtifacts:number;retainedContent:true};
export interface LocalFileCleaner{rootHash:string;inspect(source:LocalSource):Promise<LocalFile[]>;remove(source:LocalSource,files:LocalFile[]):Promise<void>;}
