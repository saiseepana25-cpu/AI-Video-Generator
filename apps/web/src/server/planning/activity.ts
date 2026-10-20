import {Long, type ClientSession, type Db} from 'mongodb';
import type {Job} from './contracts';
import type {Row} from './service';

export async function planningActivity(db: Db, session: ClientSession, job: Job, eventId: string, now: Date, message: string) {
  const workspace = await db.collection<Row>('workspaces').findOneAndUpdate({_id: job.workspaceId}, {$inc: {nextActivitySequence: Long.ONE}}, {session, returnDocument: 'after'});
  if (!workspace) throw new Error('WORKSPACE_UNAVAILABLE');
  await db.collection<Row>('activity_events').insertOne({_id: eventId, schemaVersion: 1, workspaceId: job.workspaceId, projectId: job.projectId,
    sequence: workspace.nextActivitySequence, dedupeKey: `planning:${eventId}`, type: 'planning_changed', actor: {kind: 'user', userId: job.userId},
    resourceRefs: {projectId: job.projectId}, message, actionNeeded: false, safeActionRoute: `/projects/${job.projectId}`, createdAt: now}, {session});
}
