import {isDeepStrictEqual as equal} from 'node:util';
import type {MongoClient} from 'mongodb';
import {databaseTransaction} from '../db/transactions';
import {ProjectError, requireProjectId, type ProjectContext, type ProjectSettings} from '../projects/contracts';
import type {ProjectRecord} from '../projects/service';
import type {ReadyVideo} from '../videos/contracts';
import type {Approval} from '../generation/contracts';
import {generationHash, validateRenderPlan, type RenderPlan} from '../rendering/contract';
import type {Plan, PlanVersion} from './contracts';
import {digest} from '../providers/config';

/** Advisory content comparison only; this never authorizes synthesis or reuse. */
export function compareRevision(plan: Plan, settings: ProjectSettings, baseline: RenderPlan) {
  const ids = [...new Set([...baseline.scenes.map(s=>s.sceneId),...plan.scenes.map(s=>s.sceneId)])];
  const scenes = ids.map(sceneId => {
    const previous = baseline.scenes.find(s=>s.sceneId===sceneId), next = plan.scenes.find(s=>s.sceneId===sceneId);
    const oldText = baseline.narration.find(n=>n.segmentId===`segment_${sceneId}`)?.text;
    return {sceneId,added:!previous,removed:!next,narrationChanged:oldText!==next?.narration,
      headingChanged:previous?.props.heading!==next?.heading,
      diagramChanged:!equal(previous?.props.nodes.map(n=>n.label),next?.labels) || previous?.templateId!== (next ? `diagram.${next.layout}` : undefined)};
  }).filter(s=>s.added||s.removed||s.narrationChanged||s.headingChanged||s.diagramChanged);
  const before = {language:baseline.language,targetSeconds:baseline.targetSeconds,voiceCatalogId:baseline.settingsSnapshot.voiceCatalogId,
    accentId:baseline.settingsSnapshot.accentId,brandKitRevisionId:baseline.settingsSnapshot.brand.revisionId,themeId:baseline.settingsSnapshot.themeId,captionStyleId:baseline.settingsSnapshot.captionStyleId};
  const settingsChanged = (Object.keys(before) as (keyof ProjectSettings)[]).filter(k=>!equal(before[k],settings[k]));
  const sceneOrderChanged = !equal(baseline.scenes.map(s=>s.sceneId),plan.scenes.map(s=>s.sceneId));
  const titleChanged = baseline.title!==plan.title, objectiveChanged = baseline.learningObjective!==plan.learningObjective;
  return {hasChanges:!!(scenes.length||settingsChanged.length||sceneOrderChanged||titleChanged||objectiveChanged),scenes,settingsChanged,sceneOrderChanged,titleChanged,objectiveChanged};
}
export class RevisionReviewService {
  constructor(private client: MongoClient, private name: string, private context: ProjectContext) {}
  async review(id: string) {
    requireProjectId(id);
    return databaseTransaction(this.client,this.name,async (db,session) => {
      if (!await db.collection('memberships').findOne({workspaceId:this.context.workspaceId,userId:this.context.userId,status:'active'},{session})) throw new ProjectError('TEAM_ACCESS_DENIED',403,'This account does not have team access.');
      const version = await db.collection<PlanVersion>('plan_versions').findOne({_id:id,workspaceId:this.context.workspaceId},{session});
      const project = version && await db.collection<ProjectRecord>('projects').findOne({_id:version.projectId,workspaceId:this.context.workspaceId,deletedAt:null},{session});
      if (!version||!project) throw new ProjectError('RESOURCE_NOT_FOUND',404,'This plan could not be found.');
      if (project.currentPlanVersionId!==id || !project.briefRevision.equals(version.sourceBriefRevision) || project.planningRequestId!==version.sourcePlanningRequestId || !equal(project.settings,version.settingsSnapshot)
        || digest(JSON.stringify({brief:project.brief,settings:version.settingsSnapshot}))!==version.inputHash) throw new ProjectError('PLAN_OUTDATED',409,'Save and review the current plan for the current brief and settings.');
      if (project.activePlanningJobId||project.latestRunId) throw new ProjectError('REVISION_REVIEW_UNAVAILABLE',409,'Finish active work before comparing a revision.');
      const identity = {projectId:project._id,planVersionId:id,projectRevision:project.revision.toNumber(),speechReuse:false as const,requiresNewApproval:true as const};
      if (!project.latestReadyVideoId) return {...identity,baseline:null,changes:null};
      const video = await db.collection<ReadyVideo>('ready_videos').findOne({_id:project.latestReadyVideoId,workspaceId:this.context.workspaceId,projectId:project._id},{session});
      const approval = video && await db.collection<Approval>('approvals').findOne({_id:video.approvalId,workspaceId:this.context.workspaceId,projectId:project._id,planVersionId:video.planVersionId,inputHash:video.inputHash},{session});
      let approved: RenderPlan;
      try {if (!approval) throw new Error(); approved=validateRenderPlan(JSON.parse(approval.inputCanonical)); if (generationHash(approved)!==video!.inputHash) throw new Error();}
      catch {throw new ProjectError('REVISION_BASELINE_UNAVAILABLE',503,'The completed video comparison could not be verified. Your existing video is retained.',[],true);}
      const changes=compareRevision(version.plan,version.settingsSnapshot,approved), sourceBriefChanged=!version.sourceBriefRevision.equals(approval!.sourceBriefRevision);
      return {...identity,baseline:{videoId:video!._id,versionNumber:video!.versionNumber.toNumber(),planVersionId:video!.planVersionId},
        changes:{...changes,hasChanges:changes.hasChanges||sourceBriefChanged,sourceBriefChanged}};
    });
  }
}
export type RevisionReview = Awaited<ReturnType<RevisionReviewService['review']>>;
