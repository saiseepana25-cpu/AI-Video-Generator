import {createHash} from 'node:crypto';
import {Long,type ClientSession,type Db} from 'mongodb';
import type {Row} from '../planning/service';
export type ReuseRelease={_id:string;workspaceId:string;projectId:string;targetRunId:string;sourceRunId:string;sourceAttemptId:string;reuseHash:string;reason:'deleted_target_render_cleaned';releasedAt:Date};
/** Includes every immutable field, independent of MongoDB property order. */
export function reuseRecordHash(row:Row){return createHash('sha256').update(JSON.stringify(Object.keys(row).sort().map(key=>{const value=row[key];return [key,Long.isLong(value)?value.toString():value instanceof Date?value.toISOString():value];}))).digest('hex');}
export function matchesReuseRelease(row:Row,release:ReuseRelease|null){return !!release&&release._id===row._id&&release.workspaceId===row.workspaceId&&release.projectId===row.projectId&&release.targetRunId===row.runId&&release.sourceRunId===row.sourceRunId&&release.sourceAttemptId===row.sourceAttemptId&&release.reuseHash===reuseRecordHash(row)&&release.reason==='deleted_target_render_cleaned'&&release.releasedAt instanceof Date;}
export async function hasRetainedSpeechPin(db:Db,attemptId:string,session?:ClientSession){
  const refs=await db.collection<Row>('generation_speech_reuses').find({sourceAttemptId:attemptId},{session}).limit(201).toArray();if(refs.length>200)return true;
  for(const ref of refs)if(!matchesReuseRelease(ref,await db.collection<ReuseRelease>('speech_reuse_releases').findOne({_id:ref._id},{session})))return true;return false;
}
export async function reuseReleaseStatus(db:Db,workspaceId:string,projectId:string){const scope={workspaceId,projectId};return {reuseRecords:await db.collection('generation_speech_reuses').countDocuments(scope),releaseReceipts:await db.collection('speech_reuse_releases').countDocuments(scope),retainedContent:true};}
