import {createHash, randomUUID} from 'node:crypto';
import {Long, ObjectId, type ClientSession, type Db, type Document, type MongoClient} from 'mongodb';
import {databaseTransaction} from '../db/transactions';
import {assertVoiceSelection} from '../providers/catalog';
import type {Env} from '../providers/contracts';
import type {Job} from '../planning/contracts';
import {decodeProjectCursor, encodeProjectCursor} from './cursor';
import {ProjectError, requireProjectId, type ProjectContext, type ProjectDetail, type ProjectInput, type ProjectPage, type ProjectSummary} from './contracts';
import {escapeLiteralSearch, graphemes, parseProjectInput, parseProjectPatch, requireIdempotencyKey, searchTitle, type ListOptions} from './validation';

type Row = Document & {_id: string};
type Actor = {kind: 'user'; userId: string} | {kind: 'system'; service: string};
export type ProjectRecord = Row & {
  workspaceId: string; displayTitle: string; brief: ProjectDetail['brief']; settings: ProjectInput['settings'];
  revision: Long; briefRevision: Long; createdAt: Date; updatedAt: Date; createdBy: Actor; updatedBy: Actor;
};
const routeScope = 'POST /api/v1/projects';
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const notFound = () => new ProjectError('RESOURCE_NOT_FOUND', 404, 'This project could not be found.');
const counter = (value: Long) => {
  if (!Long.isLong(value) || value.isNegative() || value.greaterThan(Long.fromNumber(Number.MAX_SAFE_INTEGER))) throw new Error('Invalid stored counter');
  return value.toNumber();
};
const safeName = (value: unknown) => typeof value === 'string' && value.trim() ? graphemes(value.trim()).slice(0, 120).join('') : 'Team member';

export class ProjectService {
  private readonly db: Db;
  constructor(private readonly client: MongoClient, private readonly databaseName: string,
    private readonly context: ProjectContext, private readonly cursorSecret: string, private readonly providerEnv: Env = {}) {
    this.db = client.db(databaseName);
    if (!/^[a-f0-9]{24}$/.test(context.userId) || !context.workspaceId || cursorSecret.length < 32) throw new Error('Invalid service context');
  }

  private async authorize(db = this.db, session?: ClientSession) {
    const member = await db.collection('memberships').findOne({workspaceId: this.context.workspaceId, userId: this.context.userId, status: 'active'}, {session, projection: {_id: 1}, maxTimeMS: session ? undefined : 5000});
    if (!member) throw new ProjectError('TEAM_ACCESS_DENIED', 403, 'This account does not have team access.');
  }

  private async names(rows: ProjectRecord[], db = this.db, session?: ClientSession) {
    const ids = [...new Set(rows.flatMap(row => [row.createdBy, row.updatedBy]).filter(actor => actor.kind === 'user').map(actor => actor.userId))];
    const users = ids.length ? await db.collection('users').find({_id: {$in: ids.map(id => new ObjectId(id))}}, {session, projection: {name: 1}, maxTimeMS: 5000}).toArray() : [];
    return new Map(users.map(user => [user._id.toHexString(), safeName(user.name)]));
  }

  private summary(row: ProjectRecord, names: Map<string, string>): ProjectSummary {
    const actor = (value: Actor) => value.kind === 'system' ? {id: null, name: 'VideoCraft'} : {id: value.userId, name: names.get(value.userId) ?? 'Team member'};
    return {id: row._id, displayTitle: row.displayTitle, language: row.settings.language, targetSeconds: row.settings.targetSeconds,
      revision: counter(row.revision), briefRevision: counter(row.briefRevision), createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
      createdBy: actor(row.createdBy), updatedBy: actor(row.updatedBy), draftState: 'draft', latestRun: null, latestReadyVideo: null, publishing: []};
  }

  private detail(row: ProjectRecord, names: Map<string, string>): ProjectDetail {
    return {...this.summary(row, names), brief: row.brief, settings: row.settings,
      currentPlanVersionId: row.currentPlanVersionId ?? null, currentPlanInputHash: null, activePlanningJobId: row.activePlanningJobId ?? null, allowedActions: ['edit'],
      blockedReasons: [
        {action: 'generate', code: 'FEATURE_NOT_IMPLEMENTED', message: 'Dashboard generation is not connected yet.'},
      ]};
  }

  async get(id: string): Promise<ProjectDetail> {
    await this.authorize();
    requireProjectId(id);
    const row = await this.db.collection<ProjectRecord>('projects').findOne({_id: id, workspaceId: this.context.workspaceId, deletedAt: null}, {maxTimeMS: 5000});
    if (!row) throw notFound();
    return this.detail(row, await this.names([row]));
  }

  async list(options: ListOptions): Promise<ProjectPage> {
    await this.authorize();
    const after = options.cursor ? decodeProjectCursor(options.cursor, this.context.workspaceId, options, this.cursorSecret) : null;
    const filter: Document = {workspaceId: this.context.workspaceId, deletedAt: null};
    if (options.q) filter.searchTitle = {$regex: escapeLiteralSearch(options.q)};
    if (after) filter.$or = [{updatedAt: {$lt: after.updatedAt}}, {updatedAt: after.updatedAt, _id: {$lt: after.id}}];
    const rows = await this.db.collection<ProjectRecord>('projects').find(filter, {
      projection: {_id: 1, displayTitle: 1, 'settings.language': 1, 'settings.targetSeconds': 1, revision: 1, briefRevision: 1, createdAt: 1, updatedAt: 1, createdBy: 1, updatedBy: 1},
      maxTimeMS: 5000,
    }).sort({updatedAt: -1, _id: -1}).limit(options.limit + 1).toArray();
    const hasMore = rows.length > options.limit;
    const visible = rows.slice(0, options.limit);
    const names = await this.names(visible);
    return {items: visible.map(row => this.summary(row, names)), page: {
      limit: options.limit, hasMore, nextCursor: hasMore ? encodeProjectCursor(this.context.workspaceId, options, visible[visible.length - 1], this.cursorSecret) : null,
    }};
  }

  async create(raw: unknown, key: string): Promise<{project: ProjectDetail; replayed: boolean}> {
    await this.authorize();
    requireIdempotencyKey(key);
    const input = parseProjectInput(raw);
    const requestHash = hash(JSON.stringify(input));
    const now = new Date();
    const identity = {workspaceId: this.context.workspaceId, userId: this.context.userId, routeScope, keyHash: hash(key)};
    // All IDs/time/input hashes are prepared before a callback that may retry.
    const projectId = randomUUID(), eventId = randomUUID(), receiptId = randomUUID();
    const actor = {kind: 'user' as const, userId: this.context.userId};
    const record: ProjectRecord = {
      _id: projectId, schemaVersion: 1, workspaceId: this.context.workspaceId, displayTitle: input.displayTitle, searchTitle: searchTitle(input.displayTitle),
      brief: {idea: input.idea, audience: input.audience, references: input.references}, settings: input.settings,
      revision: Long.ONE, briefRevision: Long.ONE, guardRevision: Long.ZERO,
      currentPlanVersionId: null, latestReadyVideoId: null, latestRunId: null, activePlanningJobId: null, planningRequestId: null,
      nextPlanVersionNumber: Long.ZERO, nextVideoVersionNumber: Long.ZERO, nextMessageSequence: Long.ZERO,
      createdBy: actor, updatedBy: actor, createdAt: now, updatedAt: now,
      deletedAt: null, deletedBy: null, cleanupJobId: null, deletionReceipt: null, sourceProjectId: null,
    };
    const snapshot = this.detail(record, new Map([[this.context.userId, safeName(this.context.userName)]]));

    const replay = async (db: Db, session?: ClientSession) => {
      const receipt = await db.collection<Row>('idempotency_records').findOne({...identity, expiresAt: {$gt: now}}, {session});
      if (!receipt) return null;
      if (receipt.requestHash !== requestHash) throw new ProjectError('IDEMPOTENCY_MISMATCH', 409, 'This request key was already used for a different project.');
      const accessible = await db.collection<Row>('projects').findOne({_id: receipt.safeResultRef.id, workspaceId: this.context.workspaceId, deletedAt: null}, {session, projection: {_id: 1}});
      if (!accessible) throw notFound();
      return {project: receipt.safeResponseSnapshot as ProjectDetail, replayed: true};
    };
    try {
      return await databaseTransaction(this.client, this.databaseName, async (db, session) => {
        await this.authorize(db, session);
        const existing = await replay(db, session);
        if (existing) return existing;
        await assertVoiceSelection(db, input.settings, this.providerEnv, session);
        // TTL is asynchronous. Expired receipts cannot block a new logical action.
        await db.collection('idempotency_records').deleteOne({...identity, expiresAt: {$lte: now}}, {session});
        const workspace = await db.collection<Row>('workspaces').findOneAndUpdate({_id: this.context.workspaceId}, {$inc: {nextActivitySequence: Long.ONE}}, {session, returnDocument: 'after'});
        if (!workspace) throw new ProjectError('CONNECTION_UNAVAILABLE', 503, 'The workspace is unavailable.', [], true);
        await db.collection<ProjectRecord>('projects').insertOne(record, {session});
        await db.collection<Row>('activity_events').insertOne({_id: eventId, schemaVersion: 1, workspaceId: this.context.workspaceId,
          projectId, sequence: workspace.nextActivitySequence, dedupeKey: `project_created:${projectId}`, type: 'project_created', actor,
          resourceRefs: {projectId}, message: 'A project was created.', actionNeeded: false, safeActionRoute: `/projects/${projectId}`, createdAt: now}, {session});
        await db.collection<Row>('idempotency_records').insertOne({_id: receiptId, schemaVersion: 1, ...identity, requestHash,
          committedHttpStatus: 201, safeResultRef: {kind: 'project', id: projectId}, safeResponseSnapshot: snapshot,
          createdAt: now, expiresAt: new Date(now.getTime() + 24 * 3600000)}, {session});
        return {project: snapshot, replayed: false};
      });
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 11000) {
        await this.authorize();
        const winner = await replay(this.db);
        if (winner) return winner;
      }
      throw error;
    }
  }

  async patch(id: string, raw: unknown, key: string): Promise<{project: ProjectDetail; replayed: boolean}> {
    await this.authorize(); requireProjectId(id); requireIdempotencyKey(key);
    const input = parseProjectPatch(raw), requestHash = hash(JSON.stringify(input));
    const now = new Date(), eventId = randomUUID(), receiptId = randomUUID();
    const actor = {kind: 'user' as const, userId: this.context.userId};
    const identity = {workspaceId: this.context.workspaceId, userId: this.context.userId, routeScope: `PATCH /api/v1/projects/${id}`, keyHash: hash(key)};
    const replay = async (db: Db, session?: ClientSession) => {
      const receipt = await db.collection<Row>('idempotency_records').findOne({...identity, expiresAt: {$gt: now}}, {session});
      if (!receipt) return null;
      if (receipt.requestHash !== requestHash) throw new ProjectError('IDEMPOTENCY_MISMATCH', 409, 'This request key was used for different edits.');
      if (!await db.collection<Row>('projects').findOne({_id: id, workspaceId: this.context.workspaceId, deletedAt: null}, {session, projection: {_id: 1}})) throw notFound();
      return {project: receipt.safeResponseSnapshot as ProjectDetail, replayed: true};
    };
    try {
      return await databaseTransaction(this.client, this.databaseName, async (db, session) => {
        await this.authorize(db, session);
        const existing = await replay(db, session); if (existing) return existing;
        const filter = {_id: id, workspaceId: this.context.workspaceId, deletedAt: null};
        const row = await db.collection<ProjectRecord>('projects').findOne(filter, {session});
        if (!row) throw notFound();
        const names = await this.names([row], db, session);
        if (counter(row.revision) !== input.expectedProjectRevision) {
          const current = this.summary(row, names);
          throw new ProjectError('STALE_REVISION', 409, 'This project has newer saved changes. Review them before saving yours.', [], false,
            {currentRevision: current.revision, updatedAt: current.updatedAt, updatedBy: current.updatedBy});
        }
        const brief = input.patch.brief ?? row.brief, settings = input.patch.settings ?? row.settings;
        if (input.patch.brainstormSelection) {
          const selection = input.patch.brainstormSelection;
          const source = await db.collection<Job>('jobs').findOne({_id: selection.jobId, workspaceId: this.context.workspaceId, projectId: id, kind: 'brainstorm', state: 'ready', sourceBriefRevision: row.briefRevision}, {session});
          const angle = source?.result && 'angles' in source.result ? source.result.angles.find(a => a.id === selection.angleId) : null;
          if (!angle || brief.idea !== `${angle.title}\n${angle.hook}\n${angle.learningObjective}`) throw new ProjectError('INVALID_BRAINSTORM_SELECTION', 422, 'Use a current saved angle from this project.');
        }
        const changed = JSON.stringify(brief) !== JSON.stringify(row.brief) || JSON.stringify(settings) !== JSON.stringify(row.settings);
        let saved = row;
        if (changed) {
          if (JSON.stringify(settings) !== JSON.stringify(row.settings)) await assertVoiceSelection(db, settings, this.providerEnv, session);
          if (['latestRunId', 'latestReadyVideoId'].some(field => row[field] != null)) throw new ProjectError('EDIT_UNAVAILABLE', 409, 'Editing generated projects is not available yet.');
          if (counter(row.revision) >= Number.MAX_SAFE_INTEGER || counter(row.briefRevision) >= Number.MAX_SAFE_INTEGER) throw new ProjectError('EDIT_UNAVAILABLE', 409, 'This project has reached its revision limit.');
          const updated = await db.collection<ProjectRecord>('projects').findOneAndUpdate({...filter, revision: Long.fromNumber(input.expectedProjectRevision)}, {
            $set: {brief, settings, updatedAt: now, updatedBy: actor, activePlanningJobId: null, planningRequestId: null}, $inc: {revision: Long.ONE, briefRevision: Long.ONE, guardRevision: Long.ONE},
          }, {session, returnDocument: 'after'});
          if (!updated) throw new ProjectError('STALE_REVISION', 409, 'Reload and review the latest saved changes.');
          saved = updated;
          const workspace = await db.collection<Row>('workspaces').findOneAndUpdate({_id: this.context.workspaceId}, {$inc: {nextActivitySequence: Long.ONE}}, {session, returnDocument: 'after'});
          if (!workspace) throw new ProjectError('CONNECTION_UNAVAILABLE', 503, 'The workspace is unavailable.', [], true);
          await db.collection<Row>('activity_events').insertOne({_id: eventId, schemaVersion: 1, workspaceId: this.context.workspaceId,
            projectId: id, sequence: workspace.nextActivitySequence, dedupeKey: `project_updated:${id}:${counter(saved.revision)}`, type: 'project_updated', actor,
            resourceRefs: {projectId: id}, message: 'A project brief was updated.', actionNeeded: false, safeActionRoute: `/projects/${id}`, createdAt: now}, {session});
        }
        const snapshot = this.detail(saved, await this.names([saved], db, session));
        await db.collection('idempotency_records').deleteOne({...identity, expiresAt: {$lte: now}}, {session});
        await db.collection<Row>('idempotency_records').insertOne({_id: receiptId, schemaVersion: 1, ...identity, requestHash,
          committedHttpStatus: 200, safeResultRef: {kind: 'project', id}, safeResponseSnapshot: snapshot,
          createdAt: now, expiresAt: new Date(now.getTime() + 24 * 3600000)}, {session});
        return {project: snapshot, replayed: false};
      });
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 11000) {
        await this.authorize(); const winner = await replay(this.db); if (winner) return winner;
      }
      throw error;
    }
  }
}
