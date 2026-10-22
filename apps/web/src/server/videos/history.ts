import {Long, type MongoClient} from 'mongodb';
import {databaseTransaction} from '../db/transactions';
import {ProjectError, requireProjectId, type ProjectContext} from '../projects/contracts';
import type {Row} from '../planning/service';
import type {ReadyVideo} from './contracts';
import {videoHistoryQuery, videoHistoryCursor, readVideoHistoryCursor} from './history-cursor';
export class VideoHistoryService {
  constructor(private client: MongoClient, private name: string, private context: ProjectContext, private secret: string) {}
  async versions(projectId: string, params: URLSearchParams) {
    requireProjectId(projectId); const options = videoHistoryQuery(params);
    if (!this.secret) throw new Error('CONFIGURATION_UNAVAILABLE');
    const before = options.cursor ? readVideoHistoryCursor(options.cursor,this.context.workspaceId,projectId,options.limit,this.secret) : null;
    return databaseTransaction(this.client,this.name,async (db,session) => {
      if (!await db.collection('memberships').findOne({workspaceId:this.context.workspaceId,userId:this.context.userId,status:'active'},{session})) throw new ProjectError('TEAM_ACCESS_DENIED',403,'This account does not have team access.');
      const project = await db.collection<Row>('projects').findOne({_id:projectId,workspaceId:this.context.workspaceId,deletedAt:null},{session});
      if (!project) throw new ProjectError('RESOURCE_NOT_FOUND',404,'This project could not be found.');
      const rows = await db.collection<ReadyVideo>('ready_videos').find({workspaceId:this.context.workspaceId,projectId,...(before ? {versionNumber:{$lt:Long.fromNumber(before)}} : {})},{session})
        .sort({versionNumber:-1}).limit(options.limit+1).toArray();
      const hasMore = rows.length > options.limit, page = rows.slice(0,options.limit);
      return {items:page.map(row => ({id:row._id,projectId:row.projectId,versionNumber:row.versionNumber.toNumber(),planVersionId:row.planVersionId,
        language:row.language,captionLanguage:row.captionLanguage,durationSeconds:row.media.durationSeconds,readyAt:row.readyAt.toISOString(),usagePolicy:row.usagePolicy,isLatest:row._id===project.latestReadyVideoId})),
        page:{hasMore,nextCursor:hasMore ? videoHistoryCursor(this.context.workspaceId,projectId,options.limit,page.at(-1)!.versionNumber.toNumber(),this.secret) : null}};
    });
  }
}
export type VideoHistoryPage = Awaited<ReturnType<VideoHistoryService['versions']>>;
