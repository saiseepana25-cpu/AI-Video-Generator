import 'server-only';
import {workspaceContext} from '../auth/context';
import {inspectAuthSettings} from '../configuration/auth';
import {mongoClient} from '../db/connection';
import {LogoService} from './service';
import {LogoObjectStore} from './store';
export async function authenticatedLogos(){
  const context=await workspaceContext(),{settings}=inspectAuthSettings(process.env);if(!settings)throw new Error('CONFIGURATION_UNAVAILABLE');
  return new LogoService(mongoClient(settings).client,settings.databaseName,{workspaceId:context.workspace._id,userId:context.identity.userId,userName:context.identity.name},()=>new LogoObjectStore(process.env));
}
