import type {Long} from 'mongodb';
export type SpeechSource={runId:string;attemptId:string;audioHash:string;byteLength:number;sampleRate:24000;inputHash:string;providerConfigHash:string;textHash:string;segmentId:string};
export type SpeechCleanupTask={_id:string;workspaceId:string;projectId:string;source:SpeechSource;rootHash:string;state:'pending'|'retry'|'removed';revision:Long;attempts:Long;error:'SPEECH_REMOVAL_FAILED'|null;createdAt:Date;updatedAt:Date;removedAt:Date|null};
export interface SpeechFileCleaner{rootHash:string;inspect(source:SpeechSource):Promise<void>;remove(source:SpeechSource):Promise<void>;}
