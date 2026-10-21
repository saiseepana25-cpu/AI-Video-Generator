import 'server-only';
import {workspaceContext} from '../auth/context';
import {inspectAuthSettings} from '../configuration/auth';
import {mongoClient} from '../db/connection';
import {GenerationService} from './service';
export async function authenticatedGeneration() {
  const context = await workspaceContext(), {settings} = inspectAuthSettings(process.env);
  if (!settings) throw new Error('CONFIGURATION_UNAVAILABLE');
  return new GenerationService(mongoClient(settings).client, settings.databaseName, {workspaceId: context.workspace._id, userId: context.identity.userId, userName: context.identity.name}, process.env);
}
