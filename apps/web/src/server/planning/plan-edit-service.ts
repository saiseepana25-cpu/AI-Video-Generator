import {randomUUID} from 'node:crypto';
import {Long, type ClientSession, type Db, type MongoClient} from 'mongodb';
import {databaseTransaction} from '../db/transactions';
import {digest} from '../providers/config';
import {ProjectError, requireProjectId, type ProjectContext} from '../projects/contracts';
import {requireIdempotencyKey} from '../projects/validation';
import type {ProjectRecord} from '../projects/service';
import type {PlanVersion} from './contracts';
import {applyTextEdits, parseTextEdits} from './text-edits';
import {PlanningService, type Row} from './service';

export class PlanEditService {
  constructor(private client: MongoClient, private name: string, private context: ProjectContext) {}
  private async authorize(db: Db, session?: ClientSession) {
    if (!await db.collection('memberships').findOne({workspaceId: this.context.workspaceId, userId: this.context.userId, status: 'active'}, {session})) throw new ProjectError('TEAM_ACCESS_DENIED', 403, 'This account does not have team access.');
  }
  async edit(baseId: string, raw: unknown, key: string) {
    const db = this.client.db(this.name); await this.authorize(db); requireProjectId(baseId); requireIdempotencyKey(key);
    const input = parseTextEdits(raw), requestHash = digest(JSON.stringify(input)), now = new Date();
    const id = randomUUID(), receiptId = randomUUID(), eventId = randomUUID();
    const identity = {workspaceId: this.context.workspaceId, userId: this.context.userId, basePlanVersionId: baseId, keyHash: digest(key)};
    const replay = async (database: Db, session?: ClientSession) => {
      const receipt = await database.collection<Row>('plan_edit_commands').findOne(identity, {session});
      if (!receipt) return null;
      if (receipt.requestHash !== requestHash) throw new ProjectError('IDEMPOTENCY_MISMATCH', 409, 'This request key was used for different plan edits.');
      if (!await database.collection<Row>('projects').findOne({_id: receipt.projectId, workspaceId: this.context.workspaceId, deletedAt: null}, {session})) throw new ProjectError('RESOURCE_NOT_FOUND', 404, 'This plan could not be found.');
      return {id: receipt.planVersionId as string, revision: receipt.projectRevision as Long, replayed: true};
    };
    let result;
    try {result = await databaseTransaction(this.client, this.name, async (database, session) => {
      await this.authorize(database, session); const prior = await replay(database, session); if (prior) return prior;
      const base = await database.collection<PlanVersion>('plan_versions').findOne({_id: baseId, workspaceId: this.context.workspaceId}, {session});
      const project = base && await database.collection<ProjectRecord>('projects').findOne({_id: base.projectId, workspaceId: this.context.workspaceId, deletedAt: null}, {session});
      if (!base || !project) throw new ProjectError('RESOURCE_NOT_FOUND', 404, 'This plan could not be found.');
      if (!project.revision.equals(Long.fromNumber(input.expectedProjectRevision)) || project.currentPlanVersionId !== baseId || !project.briefRevision.equals(base.sourceBriefRevision) || project.planningRequestId !== base.sourcePlanningRequestId) throw new ProjectError('STALE_REVISION', 409, 'The project or plan has changed. Your edits are retained; review the latest plan before editing again.');
      if (project.activePlanningJobId || project.latestRunId) throw new ProjectError('PLAN_EDIT_UNAVAILABLE', 409, 'Finish or cancel the active planning job before editing. Generated-project editing is a later feature.');
      const plan = applyTextEdits(base.plan, input);
      if (JSON.stringify(plan) === JSON.stringify(base.plan)) throw new ProjectError('NO_CHANGES', 422, 'Change narration, a heading or a diagram before saving a new version.');
      if ([project.revision, project.nextPlanVersionNumber].some(v => !Long.isLong(v) || v.greaterThanOrEqual(Long.fromNumber(Number.MAX_SAFE_INTEGER)))) throw new ProjectError('PLAN_EDIT_UNAVAILABLE', 409, 'This project has reached its version limit.');
      const versionNumber = (project.nextPlanVersionNumber as Long).add(Long.ONE), revision = project.revision.add(Long.ONE);
      const version: PlanVersion = {...base, _id: id, versionNumber, source: 'direct_edit', parentPlanVersionId: baseId,
        sourcePlanningRequestId: id, contentHash: digest(JSON.stringify({plan, settings: base.settingsSnapshot})), plan, createdAt: now, createdBy: this.context.userId};
      await database.collection<PlanVersion>('plan_versions').insertOne(version, {session});
      const updated = await database.collection<Row>('projects').updateOne({_id: project._id, workspaceId: this.context.workspaceId, deletedAt: null, revision: project.revision, currentPlanVersionId: baseId, activePlanningJobId: null},
        {$set: {currentPlanVersionId: id, planningRequestId: id, nextPlanVersionNumber: versionNumber, updatedAt: now, updatedBy: {kind: 'user', userId: this.context.userId}}, $inc: {revision: Long.ONE, guardRevision: Long.ONE}}, {session});
      if (!updated.matchedCount) throw new ProjectError('STALE_REVISION', 409, 'The project has changed. Review the latest plan.');
      const workspace = await database.collection<Row>('workspaces').findOneAndUpdate({_id: this.context.workspaceId}, {$inc: {nextActivitySequence: Long.ONE}}, {session, returnDocument: 'after'});
      if (!workspace) throw new Error('WORKSPACE_UNAVAILABLE');
      await database.collection<Row>('activity_events').insertOne({_id: eventId, schemaVersion: 1, workspaceId: this.context.workspaceId, projectId: project._id,
        sequence: workspace.nextActivitySequence, dedupeKey: `plan_edit:${id}`, type: 'planning_changed', actor: {kind: 'user', userId: this.context.userId}, resourceRefs: {projectId: project._id},
        message: 'A new plan version was saved with direct edits.', actionNeeded: false, safeActionRoute: `/projects/${project._id}`, createdAt: now}, {session});
      await database.collection<Row>('plan_edit_commands').insertOne({_id: receiptId, ...identity, requestHash, projectId: project._id, planVersionId: id, projectRevision: revision, createdAt: now}, {session});
      return {id, revision, replayed: false};
    });} catch (error) {
      if (!(error && typeof error === 'object' && 'code' in error && error.code === 11000)) throw error;
      await this.authorize(db); result = await replay(db); if (!result) throw error;
    }
    const view = await new PlanningService(this.client, this.name, this.context, {}).plan(result.id);
    return {plan: {...view, projectRevision: result.revision.toNumber(), changeSummary: 'Updated narration, headings and/or diagrams.'}, replayed: result.replayed};
  }
}
