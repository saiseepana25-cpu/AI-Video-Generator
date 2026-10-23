import {createHash, randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {Long, ObjectId, type ClientSession, type Db, type Document, type MongoClient} from 'mongodb';
import {databaseTransaction} from '../db/transactions';
import {assertVoiceSelection} from '../providers/catalog';
import {readBrandSelection} from '../brand/selection';
import type {Env} from '../providers/contracts';
import type {Job,PlanVersion} from '../planning/contracts';
import type {DeleteInput,DeletionReceipt} from './deletion';
import {decodeProjectCursor, encodeProjectCursor} from './cursor';
import {ProjectError, requireProjectId, type ProjectContext, type ProjectDetail, type ProjectInput, type ProjectPage, type ProjectSummary} from './contracts';
import {escapeLiteralSearch, graphemes, parseProjectInput, parseProjectPatch, parseDuplicateInput, defaultDuplicateTitle, requireIdempotencyKey, searchTitle, type ListOptions} from './validation';

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

  async deletionStatus(id:string):Promise<DeletionReceipt>{
    await this.authorize();requireProjectId(id);
    const row=await this.db.collection<Row>('projects').findOne({_id:id,workspaceId:this.context.workspaceId,deletedAt:{$ne:null}},{projection:{deletionReceipt:1}});
    if(!row?.deletionReceipt)throw notFound();
    // Deliberately excludes title, source content, storage addresses and actor identity.
    return row.deletionReceipt as DeletionReceipt;
  }

  async delete(id:string,input:DeleteInput,key:string):Promise<{receipt:DeletionReceipt;replayed:boolean}>{
    await this.authorize();requireProjectId(id);requireIdempotencyKey(key);
    if(!input||Object.keys(input).join(',')!=='expectedProjectRevision'||!Number.isSafeInteger(input.expectedProjectRevision)||input.expectedProjectRevision<1)throw new ProjectError('INVALID_QUERY',400,'Use a positive safe project revision.');
    const identity={workspaceId:this.context.workspaceId,userId:this.context.userId,projectId:id,keyHash:hash(key)},requestHash=hash(JSON.stringify(input));
    const now=new Date(),receiptId=randomUUID(),eventId=randomUUID(),actor={kind:'user' as const,userId:this.context.userId};
    const receipt:DeletionReceipt={projectId:id,accessRemoved:true,cleanupState:'retained',cleanupJobId:null,externalPublicationState:'none_pending',message:'Project removed from team access. Files and records are retained; physical cleanup is not implemented yet.'};
    const replay=async(db:Db,session?:ClientSession)=>{
      const row=await db.collection<Row>('project_delete_commands').findOne(identity,{session});if(!row)return null;
      if(row.requestHash!==requestHash)throw new ProjectError('IDEMPOTENCY_MISMATCH',409,'This request key was used for a different deletion.');
      if(!await db.collection<Row>('projects').findOne({_id:id,workspaceId:this.context.workspaceId,deletedAt:{$ne:null}},{session,projection:{_id:1}}))throw notFound();
      return {receipt:row.snapshot as DeletionReceipt,replayed:true};
    };
    try{return await databaseTransaction(this.client,this.databaseName,async(db,session)=>{
      await this.authorize(db,session);const prior=await replay(db,session);if(prior)return prior;
      const scope={workspaceId:this.context.workspaceId,projectId:id};
      const source=await db.collection<ProjectRecord>('projects').findOne({_id:id,workspaceId:this.context.workspaceId,deletedAt:null},{session});if(!source)throw notFound();
      if(counter(source.revision)!==input.expectedProjectRevision)throw new ProjectError('STALE_REVISION',409,'The project has newer saved changes. Reload and review before deleting.');
      // No timer/lease expiry proves an executor stopped. This increment refuses
      // unresolved work instead of cancelling it or releasing any physical slot.
      const planning=await db.collection<Row>('jobs').findOne({...scope,$or:[{state:{$nin:['ready','failed','cancelled','superseded']}},{submission:{$in:['submitted','uncertain']}}]},{session,projection:{_id:1}});
      const generation=await db.collection<Row>('generation_runs').findOne({...scope,state:{$nin:['cancelled','failed','rendered_local']}},{session,projection:{_id:1}});
      const storage=await db.collection<Row>('generation_storage_bundles').findOne({...scope,state:{$ne:'stored'}},{session,projection:{_id:1}});
      // Also refuse completed local renders awaiting discovery by storage.
      const unstored=await db.collection<Row>('generation_runs').aggregate([
        {$match:{...scope,state:'rendered_local'}},{$lookup:{from:'generation_storage_bundles',localField:'_id',foreignField:'runId',as:'bundles'}},
        {$match:{bundles:{$not:{$elemMatch:{workspaceId:this.context.workspaceId,projectId:id,state:'stored'}}}}},{$limit:1},{$project:{_id:1}},
      ],{session}).next();
      if(source.activePlanningJobId||source.latestRunId||planning||generation||storage||unstored)throw new ProjectError('PROJECT_WORK_UNRESOLVED',409,'Finish or resolve planning, generation and storage work before deleting. Expired leases do not prove work has stopped.');
      // Publication is not implemented. Fail closed if future/imported records
      // exist until its cancellation/reconciliation contract is integrated.
      if(await db.collection('publishing_intents').findOne(scope,{session,projection:{_id:1}}))throw new ProjectError('PROJECT_WORK_UNRESOLVED',409,'Publishing work must be resolved before this project can be deleted.');
      if(counter(source.revision)>=Number.MAX_SAFE_INTEGER||counter(source.guardRevision)>=Number.MAX_SAFE_INTEGER)throw new ProjectError('DELETE_UNAVAILABLE',409,'The project has reached its revision limit.');
      const member=await db.collection<Row>('memberships').findOne({workspaceId:this.context.workspaceId,userId:this.context.userId,status:'active'},{session});
      if(!member)throw new ProjectError('TEAM_ACCESS_DENIED',403,'This account does not have team access.');
      if(member.generationGuardRevision&&counter(member.generationGuardRevision)>=Number.MAX_SAFE_INTEGER)throw new ProjectError('DELETE_UNAVAILABLE',409,'The membership guard has reached its limit.');
      if(!(await db.collection<Row>('memberships').updateOne({_id:member._id,status:'active'},{$inc:{generationGuardRevision:Long.ONE}},{session})).matchedCount)throw new ProjectError('TEAM_ACCESS_DENIED',403,'This account does not have team access.');
      if(!(await db.collection<Row>('projects').updateOne({_id:id,workspaceId:this.context.workspaceId,deletedAt:null,revision:source.revision,guardRevision:source.guardRevision},{$set:{deletedAt:now,deletedBy:actor,deletionReceipt:receipt,updatedAt:now,updatedBy:actor},$inc:{revision:Long.ONE,guardRevision:Long.ONE}},{session})).matchedCount)throw new ProjectError('STALE_REVISION',409,'Reload and review the saved project before deleting.');
      const workspace=await db.collection<Row>('workspaces').findOneAndUpdate({_id:this.context.workspaceId},{$inc:{nextActivitySequence:Long.ONE}},{session,returnDocument:'after'});if(!workspace)throw new ProjectError('CONNECTION_UNAVAILABLE',503,'The workspace is unavailable.',[],true);
      await db.collection<Row>('activity_events').insertOne({_id:eventId,schemaVersion:1,workspaceId:this.context.workspaceId,projectId:id,sequence:workspace.nextActivitySequence,dedupeKey:`project_deleted:${id}`,type:'project_deleted',actor,resourceRefs:{projectId:id},message:'A project was removed from team access.',actionNeeded:false,safeActionRoute:'/projects',createdAt:now},{session});
      await db.collection<Row>('project_delete_commands').insertOne({_id:receiptId,...identity,requestHash,snapshot:receipt,createdAt:now},{session});
      return {receipt,replayed:false};
    });}catch(error){if(error&&typeof error==='object'&&'code'in error&&error.code===11000){await this.authorize();const prior=await replay(this.db);if(prior)return prior;}throw error;}
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
        await readBrandSelection(db,session,this.context.workspaceId,input.settings.brandKitRevisionId);
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

  async duplicate(id:string,raw:unknown,key:string):Promise<{project:ProjectDetail;replayed:boolean}>{
    await this.authorize();requireProjectId(id);requireIdempotencyKey(key);
    const input=parseDuplicateInput(raw),requestHash=hash(JSON.stringify(input)),now=new Date();
    const projectId=randomUUID(),planId=randomUUID(),receiptId=randomUUID(),eventId=randomUUID(),actor={kind:'user' as const,userId:this.context.userId};
    const identity={workspaceId:this.context.workspaceId,userId:this.context.userId,sourceProjectId:id,keyHash:hash(key)};
    const replay=async(db:Db,session?:ClientSession)=>{
      const receipt=await db.collection<Row>('project_duplicate_commands').findOne(identity,{session});if(!receipt)return null;
      if(receipt.requestHash!==requestHash)throw new ProjectError('IDEMPOTENCY_MISMATCH',409,'This request key was used for a different duplicate.');
      for(const target of [id,receipt.projectId])if(!await db.collection<Row>('projects').findOne({_id:target,workspaceId:this.context.workspaceId,deletedAt:null},{session,projection:{_id:1}}))throw notFound();
      return {project:receipt.snapshot as ProjectDetail,replayed:true};
    };
    try{return await databaseTransaction(this.client,this.databaseName,async(db,session)=>{
      await this.authorize(db,session);const prior=await replay(db,session);if(prior)return prior;
      const source=await db.collection<ProjectRecord>('projects').findOne({_id:id,workspaceId:this.context.workspaceId,deletedAt:null},{session});if(!source)throw notFound();
      if(counter(source.revision)!==input.expectedProjectRevision)throw new ProjectError('STALE_REVISION',409,'The source project has newer saved changes. Reload and review before duplicating.');
      await readBrandSelection(db,session,this.context.workspaceId,source.settings.brandKitRevisionId);
      let proposal:PlanVersion|null=null;
      if(source.currentPlanVersionId){
        const candidate=await db.collection<PlanVersion>('plan_versions').findOne({_id:source.currentPlanVersionId,workspaceId:this.context.workspaceId,projectId:id},{session});
        if(!candidate)throw new ProjectError('DUPLICATE_SOURCE_INVALID',409,'The source plan is unavailable. Review the original project.');
        if(source.briefRevision.equals(candidate.sourceBriefRevision)&&source.planningRequestId===candidate.sourcePlanningRequestId&&isDeepStrictEqual(source.settings,candidate.settingsSnapshot)&&hash(JSON.stringify({brief:source.brief,settings:source.settings}))===candidate.inputHash)proposal=candidate;
      }
      // Fence concurrent source changes/deletion and membership revocation without
      // advancing the source editor revision or changing its active work.
      const member=await db.collection<Row>('memberships').findOne({workspaceId:this.context.workspaceId,userId:this.context.userId,status:'active'},{session});
      if(!member)throw new ProjectError('TEAM_ACCESS_DENIED',403,'This account does not have team access.');
      if(counter(source.guardRevision)>=Number.MAX_SAFE_INTEGER||member.generationGuardRevision&&counter(member.generationGuardRevision)>=Number.MAX_SAFE_INTEGER)throw new ProjectError('DUPLICATE_UNAVAILABLE',409,'This project cannot be duplicated at its current counter limit.');
      if(!(await db.collection<Row>('memberships').updateOne({_id:member._id,status:'active'},{$inc:{generationGuardRevision:Long.ONE}},{session})).matchedCount)throw new ProjectError('TEAM_ACCESS_DENIED',403,'This account does not have team access.');
      if(!(await db.collection<Row>('projects').updateOne({_id:id,workspaceId:this.context.workspaceId,deletedAt:null,revision:source.revision},{$inc:{guardRevision:Long.ONE}},{session})).matchedCount)throw new ProjectError('STALE_REVISION',409,'Reload the source project before duplicating.');
      const displayTitle=input.displayTitle??defaultDuplicateTitle(source.displayTitle);
      const record:ProjectRecord={_id:projectId,schemaVersion:1,workspaceId:this.context.workspaceId,displayTitle,searchTitle:searchTitle(displayTitle),brief:structuredClone(source.brief),settings:structuredClone(source.settings),
        revision:Long.ONE,briefRevision:Long.ONE,guardRevision:Long.ZERO,currentPlanVersionId:proposal?planId:null,planningRequestId:proposal?planId:null,activePlanningJobId:null,latestRunId:null,latestReadyVideoId:null,
        nextPlanVersionNumber:proposal?Long.ONE:Long.ZERO,nextVideoVersionNumber:Long.ZERO,nextMessageSequence:Long.ZERO,createdBy:actor,updatedBy:actor,createdAt:now,updatedAt:now,
        deletedAt:null,deletedBy:null,cleanupJobId:null,deletionReceipt:null,sourceProjectId:id};
      await db.collection<ProjectRecord>('projects').insertOne(record,{session});
      if(proposal){
        const copied:PlanVersion={_id:planId,schemaVersion:1,workspaceId:this.context.workspaceId,projectId,versionNumber:Long.ONE,sourceBriefRevision:Long.ONE,sourcePlanningRequestId:planId,
          inputHash:hash(JSON.stringify({brief:record.brief,settings:record.settings})),settingsSnapshot:structuredClone(record.settings),plan:structuredClone(proposal.plan),
          source:'duplicate',parentPlanVersionId:null,restoredFromPlanVersionId:null,duplicatedFromPlanVersionId:proposal._id,contentHash:hash(JSON.stringify({plan:proposal.plan,settings:record.settings})),
          plannerModelId:proposal.plannerModelId,promptContractVersion:proposal.promptContractVersion,createdAt:now,createdBy:this.context.userId};
        await db.collection<PlanVersion>('plan_versions').insertOne(copied,{session});
      }
      const workspace=await db.collection<Row>('workspaces').findOneAndUpdate({_id:this.context.workspaceId},{$inc:{nextActivitySequence:Long.ONE}},{session,returnDocument:'after'});if(!workspace)throw new ProjectError('CONNECTION_UNAVAILABLE',503,'The workspace is unavailable.',[],true);
      await db.collection<Row>('activity_events').insertOne({_id:eventId,schemaVersion:1,workspaceId:this.context.workspaceId,projectId,sequence:workspace.nextActivitySequence,dedupeKey:`project_created:${projectId}`,type:'project_created',actor,resourceRefs:{projectId},message:'A project was duplicated.',actionNeeded:false,safeActionRoute:`/projects/${projectId}`,createdAt:now},{session});
      const snapshot=this.detail(record,await this.names([record],db,session));
      await db.collection<Row>('project_duplicate_commands').insertOne({_id:receiptId,...identity,sourceRevision:source.revision,requestHash,projectId,snapshot,createdAt:now},{session});
      return {project:snapshot,replayed:false};
    });}catch(error){if(error&&typeof error==='object'&&'code'in error&&error.code===11000){await this.authorize();const prior=await replay(this.db);if(prior)return prior;}throw error;}
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
        const inputsChanged = JSON.stringify(brief) !== JSON.stringify(row.brief) || JSON.stringify(settings) !== JSON.stringify(row.settings);
        const displayTitle = input.patch.displayTitle ?? row.displayTitle;
        const titleChanged = displayTitle !== row.displayTitle;
        const changed = inputsChanged || titleChanged;
        let saved = row;
        if (changed) {
          if (inputsChanged && JSON.stringify(settings) !== JSON.stringify(row.settings)) {await readBrandSelection(db,session,this.context.workspaceId,settings.brandKitRevisionId);await assertVoiceSelection(db, settings, this.providerEnv, session);}
          if (inputsChanged && ['latestRunId', 'latestReadyVideoId'].some(field => row[field] != null)) throw new ProjectError('EDIT_UNAVAILABLE', 409, 'Editing generated projects is not available yet.');
          if (counter(row.revision) >= Number.MAX_SAFE_INTEGER || inputsChanged && counter(row.briefRevision) >= Number.MAX_SAFE_INTEGER) throw new ProjectError('EDIT_UNAVAILABLE', 409, 'This project has reached its revision limit.');
          const updated = await db.collection<ProjectRecord>('projects').findOneAndUpdate({...filter, revision: Long.fromNumber(input.expectedProjectRevision)}, {
            $set: {updatedAt: now, updatedBy: actor,
              ...(titleChanged ? {displayTitle, searchTitle: searchTitle(displayTitle)} : {}),
              ...(inputsChanged ? {brief, settings, activePlanningJobId: null, planningRequestId: null} : {})},
            $inc: {revision: Long.ONE, ...(inputsChanged ? {briefRevision: Long.ONE, guardRevision: Long.ONE} : {})},
          }, {session, returnDocument: 'after'});
          if (!updated) throw new ProjectError('STALE_REVISION', 409, 'Reload and review the latest saved changes.');
          saved = updated;
          const workspace = await db.collection<Row>('workspaces').findOneAndUpdate({_id: this.context.workspaceId}, {$inc: {nextActivitySequence: Long.ONE}}, {session, returnDocument: 'after'});
          if (!workspace) throw new ProjectError('CONNECTION_UNAVAILABLE', 503, 'The workspace is unavailable.', [], true);
          await db.collection<Row>('activity_events').insertOne({_id: eventId, schemaVersion: 1, workspaceId: this.context.workspaceId,
            projectId: id, sequence: workspace.nextActivitySequence, dedupeKey: `project_updated:${id}:${counter(saved.revision)}`, type: 'project_updated', actor,
            resourceRefs: {projectId: id}, message: inputsChanged ? 'A project brief was updated.' : 'A project was renamed.', actionNeeded: false, safeActionRoute: `/projects/${id}`, createdAt: now}, {session});
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
