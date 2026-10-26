import {Long,type ClientSession,type Db,type MongoClient} from 'mongodb';
import {databaseTransaction} from '../db/transactions';
import {ProjectError,type ProjectContext} from '../projects/contracts';
import type {Row} from '../planning/service';
import {activityCursor,activityQuery,readActivityCursor,readThroughBody} from './query';
import {activityTypes,type ActivityPage,type ActivityType} from './contracts';
const count=(n:Long)=>{const value=n.toNumber();if(!Number.isSafeInteger(value)||value<0)throw Error('INVALID_ACTIVITY_COUNTER');return value;};
export async function activityScope(db:Db,session:ClientSession,context:ProjectContext){
  const member=await db.collection<Row>('memberships').findOne({workspaceId:context.workspaceId,userId:context.userId,status:'active'},{session});
  if(!member)throw new ProjectError('TEAM_ACCESS_DENIED',403,'This account does not have team access.');
  const workspace=await db.collection<Row>('workspaces').findOne({_id:context.workspaceId},{session});
  if(!workspace)throw new ProjectError('CONNECTION_UNAVAILABLE',503,'The workspace is unavailable.',[],true);
  return {member,workspace};
}
export class ActivityService{
  constructor(private client:MongoClient,private name:string,private context:ProjectContext,private secret:string){}
  async list(params:URLSearchParams):Promise<ActivityPage>{
    const q=activityQuery(params);if(!this.secret)throw Error('CONFIGURATION_UNAVAILABLE');
    const cursor=q.cursor?readActivityCursor(q.cursor,q,this.context.workspaceId,this.context.userId,this.secret):null;
    return databaseTransaction(this.client,this.name,async(db,session)=>{
      const {member,workspace}=await activityScope(db,session,this.context),latest=count(workspace.nextActivitySequence),upper=cursor?.upper??latest;
      if(upper>latest)throw new ProjectError('INVALID_CURSOR',400,'Refresh activity to see the latest updates.');
      if(q.projectId&&!await db.collection<Row>('projects').findOne({_id:q.projectId,workspaceId:this.context.workspaceId,deletedAt:null},{session,projection:{_id:1}}))throw new ProjectError('RESOURCE_NOT_FOUND',404,'This project could not be found.');
      const rows=await db.collection<Row>('activity_events').find({workspaceId:this.context.workspaceId,sequence:{$lte:Long.fromNumber(upper),...(cursor?{$lt:Long.fromNumber(cursor.before)}:{})},...(q.projectId?{projectId:q.projectId}:{}),...(q.types.length?{type:{$in:q.types}}:{})},{session}).sort({sequence:-1}).limit(q.limit+1).toArray();
      const page=rows.slice(0,q.limit),ids=[...new Set(page.map(r=>r.projectId).filter((id):id is string=>typeof id==='string'))];
      const projects=await db.collection<Row>('projects').find({_id:{$in:ids},workspaceId:this.context.workspaceId,deletedAt:null},{session,projection:{_id:1,displayTitle:1}}).toArray(),live=new Map(projects.map(p=>[p._id,p]));
      const items=page.map(row=>{
        if(!activityTypes.includes(row.type)||typeof row.message!=='string'||row.message.length>240)throw Error('INVALID_ACTIVITY_EVENT');
        const project=row.projectId?live.get(row.projectId):null,removed=!!row.projectId&&!project;
        return {id:row._id,sequence:count(row.sequence),type:row.type as ActivityType,projectId:project?project._id:null,projectTitle:project?project.displayTitle:null,
          message:removed?'An update belongs to a project removed from team access.':row.message,actor:removed?'Studio':row.actor?.kind==='user'?'Team member':'Studio',createdAt:row.createdAt.toISOString(),
          safeActionRoute:project?`/projects/${project._id}`:removed?'/projects':row.type.startsWith('workspace_')?'/settings':'/projects',actionNeeded:!removed&&row.actionNeeded===true};
      });
      const hasMore=rows.length>q.limit;return {items,page:{limit:q.limit,hasMore,nextCursor:hasMore?activityCursor(q,this.context.workspaceId,this.context.userId,count(page.at(-1)!.sequence),upper,this.secret):null},readThroughSequence:count(member.activityReadThroughSequence),latestSequence:upper,timezone:workspace.timezone};
    });
  }
  async markRead(value:unknown){
    const through=readThroughBody(value);
    return databaseTransaction(this.client,this.name,async(db,session)=>{
      const {member,workspace}=await activityScope(db,session,this.context);
      if(through>count(workspace.nextActivitySequence))throw new ProjectError('VALIDATION_FAILED',422,'Refresh activity before marking newer updates as read.');
      const next=Math.max(through,count(member.activityReadThroughSequence));
      // Write the same member record that revocation updates; concurrent acknowledgements use $max.
      const saved=await db.collection<Row>('memberships').findOneAndUpdate({_id:member._id,workspaceId:this.context.workspaceId,userId:this.context.userId,status:'active'},{$max:{activityReadThroughSequence:Long.fromNumber(next)}},{session,returnDocument:'after'});
      if(!saved)throw new ProjectError('TEAM_ACCESS_DENIED',403,'This account does not have team access.');
      return {readThroughSequence:count(saved.activityReadThroughSequence)};
    });
  }
}
