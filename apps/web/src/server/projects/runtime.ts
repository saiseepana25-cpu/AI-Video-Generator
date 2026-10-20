import 'server-only';
import {workspaceContext} from '../auth/context';
import {AccessError} from '../auth/access-policy';
import {inspectAuthSettings} from '../configuration/auth';
import {mongoClient} from '../db/connection';
import {ProjectService} from './service';

export function projectServiceForContext(context: Awaited<ReturnType<typeof workspaceContext>>) {
  const {settings} = inspectAuthSettings(process.env);
  if (!settings) throw new AccessError('CONNECTION_UNAVAILABLE');
  return new ProjectService(mongoClient(settings).client, settings.databaseName, {
    workspaceId: context.workspace._id, userId: context.identity.userId, userName: context.identity.name,
  }, settings.secret, process.env);
}
export async function authenticatedProjects() {
  const context = await workspaceContext();
  return projectServiceForContext(context);
}
