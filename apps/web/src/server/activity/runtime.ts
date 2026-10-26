import 'server-only';
import {workspaceContext} from '../auth/context';
import {AccessError} from '../auth/access-policy';
import {inspectAuthSettings} from '../configuration/auth';
import {mongoClient} from '../db/connection';
import {ActivityService} from './service';
import {OperationsService} from './operations';
export async function authenticatedActivity(){
  const scope=await workspaceContext(),{settings}=inspectAuthSettings(process.env);
  if(!settings)throw new AccessError('CONNECTION_UNAVAILABLE');
  const context={workspaceId:scope.workspace._id,userId:scope.identity.userId,userName:scope.identity.name},client=mongoClient(settings).client;
  return {activity:new ActivityService(client,settings.databaseName,context,settings.secret),operations:new OperationsService(client,settings.databaseName,context,process.env)};
}
