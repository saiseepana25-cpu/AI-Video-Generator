import 'server-only';
import {workspaceContext} from '../auth/context';
import {inspectAuthSettings} from '../configuration/auth';
import {mongoClient} from '../db/connection';
import {R2ObjectStore} from '../storage/r2';
import {VideoService} from './service';
import {ProjectError} from '../projects/contracts';
import {VideoHistoryService} from './history';
export async function authenticatedVideoHistory() {
  const context = await workspaceContext(), {settings} = inspectAuthSettings(process.env);
  if (!settings) throw new Error('CONFIGURATION_UNAVAILABLE');
  return new VideoHistoryService(mongoClient(settings).client, settings.databaseName,
    {workspaceId:context.workspace._id,userId:context.identity.userId,userName:context.identity.name}, settings.secret);
}
export async function authenticatedVideo() {
  const context = await workspaceContext(), {settings} = inspectAuthSettings(process.env);
  if (!settings) throw new Error('CONFIGURATION_UNAVAILABLE');
  let store: R2ObjectStore;
  try {store = new R2ObjectStore(process.env);} catch {throw new ProjectError('VIDEO_UNAVAILABLE', 503, 'Private video storage is temporarily unavailable.', [], true);}
  return {store, service: new VideoService(mongoClient(settings).client, settings.databaseName,
    {workspaceId: context.workspace._id, userId: context.identity.userId, userName: context.identity.name}, store)};
}
