import 'server-only';
import {workspaceContext} from '../auth/context';
import {inspectAuthSettings} from '../configuration/auth';
import {mongoClient} from '../db/connection';
import {PlanningService} from './service';
import {PlanEditService} from './plan-edit-service';
import {RenderInputService} from '../rendering/service';
import {RevisionReviewService} from './revision-review';
export async function authenticatedRevisionReview() {
  const context = await workspaceContext(), {settings} = inspectAuthSettings(process.env);
  if (!settings) throw new Error('CONFIGURATION_UNAVAILABLE');
  return new RevisionReviewService(mongoClient(settings).client,settings.databaseName,{workspaceId:context.workspace._id,userId:context.identity.userId,userName:context.identity.name});
}

export async function authenticatedPlanning() {
  const context = await workspaceContext(), {settings} = inspectAuthSettings(process.env);
  if (!settings) throw new Error('CONFIGURATION_UNAVAILABLE');
  return new PlanningService(mongoClient(settings).client, settings.databaseName, {workspaceId: context.workspace._id, userId: context.identity.userId, userName: context.identity.name}, process.env);
}
export async function authenticatedPlanEdits() {
  const context = await workspaceContext(), {settings} = inspectAuthSettings(process.env);
  if (!settings) throw new Error('CONFIGURATION_UNAVAILABLE');
  return new PlanEditService(mongoClient(settings).client, settings.databaseName, {workspaceId: context.workspace._id, userId: context.identity.userId, userName: context.identity.name});
}
export async function authenticatedRenderInput() {
  const context = await workspaceContext(), {settings} = inspectAuthSettings(process.env);
  if (!settings) throw new Error('CONFIGURATION_UNAVAILABLE');
  return new RenderInputService(mongoClient(settings).client, settings.databaseName, {workspaceId: context.workspace._id, userId: context.identity.userId, userName: context.identity.name}, process.env);
}
