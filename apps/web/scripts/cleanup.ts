import {MongoClient} from 'mongodb';
import {databaseClientOptions,inspectDatabaseSettings} from '../src/server/db/connection';
import {assertDatabaseReady} from '../src/server/db/migrations';
import {MediaCleanupService,mediaCleanupStatus} from '../src/server/cleanup/service';
import {CleanupFault} from '../src/server/cleanup/contracts';
import {R2ObjectStore} from '../src/server/storage/r2';
import {requireProjectId} from '../src/server/projects/contracts';
import type {ProjectRecord} from '../src/server/projects/service';
import path from 'node:path';
import {LocalRenderFiles} from '../src/server/cleanup/local-files';
import {LocalCleanupService,localRenderStatus} from '../src/server/cleanup/local-service';
import {SpeechFiles} from '../src/server/cleanup/speech-files';
import {SpeechCleanupService,speechCleanupStatus} from '../src/server/cleanup/speech-service';
import {ReuseReleaseService} from '../src/server/cleanup/reuse-release';
import {reuseReleaseStatus} from '../src/server/cleanup/reuse-pins';
async function main(){
  const [command,projectId,...rest]=process.argv.slice(2);
  if(rest.length||!['worker','project','local','speech','release-reuse','status'].includes(command)||(command==='worker'?!!projectId:!projectId))throw new CleanupFault('Use cleanup worker | project <deleted-project-id> | local <deleted-project-id> | release-reuse <deleted-project-id> | speech <deleted-project-id> | status <deleted-project-id>');
  if(projectId)requireProjectId(projectId);const settings=inspectDatabaseSettings(process.env);if(!settings)throw new CleanupFault('DATABASE_CONFIGURATION_REQUIRED');
  const client=new MongoClient(settings.mongoUri,databaseClientOptions);let store:R2ObjectStore|undefined;
  try{await client.connect();const db=client.db(settings.databaseName);await assertDatabaseReady(db);
    if(projectId&&!await db.collection<ProjectRecord>('projects').findOne({_id:projectId,deletedAt:{$type:'date'}},{projection:{_id:1}}))throw new CleanupFault('DELETED_PROJECT_REQUIRED');
    if(command==='status'){const project=await db.collection<ProjectRecord>('projects').findOne({_id:projectId},{projection:{workspaceId:1}});console.log({mediaCleanup:await mediaCleanupStatus(db,project!.workspaceId,projectId!),localRenderCleanup:await localRenderStatus(db,project!.workspaceId,projectId!),speechCleanup:await speechCleanupStatus(db,project!.workspaceId,projectId!),reuseRelease:await reuseReleaseStatus(db,project!.workspaceId,projectId!)});return;}
    if(command==='release-reuse'){const service=new ReuseReleaseService(client,settings.databaseName);let count=0;while(count<100&&await service.next(projectId!))count++;console.log({releasedReferences:count,batchLimit:100,retainedContent:true});return;}
    if(command==='speech'){const service=new SpeechCleanupService(client,settings.databaseName,await SpeechFiles.create(path.resolve(process.cwd(),'../..')));let count=0;while(count<100&&await service.next(projectId!))count++;console.log({processedSpeechFiles:count,batchLimit:100,retainedContent:true});return;}
    if(command==='local'){const service=new LocalCleanupService(client,settings.databaseName,await LocalRenderFiles.create(path.resolve(process.cwd(),'../..')));let count=0;while(count<100&&await service.next(projectId!))count++;console.log({processedArtifacts:count,batchLimit:100,retainedContent:true});return;}
    store=new R2ObjectStore(process.env);const service=new MediaCleanupService(client,settings.databaseName,store);
    if(command==='project'){let count=0;while(count<100&&await service.next(projectId))count++;console.log({processedAssets:count,batchLimit:100});return;}
    let stop=false;const stopping=()=>{stop=true;};process.once('SIGINT',stopping);process.once('SIGTERM',stopping);
    console.log('Ready-media cleanup worker started. Deleted projects only; no local files, provider calls or prefix deletion.');
    try{while(!stop){try{await service.next();}catch(error){console.error(error instanceof CleanupFault?error.code:'CLEANUP_FAILED');}if(!stop)await new Promise(resolve=>setTimeout(resolve,5000));}}finally{process.removeListener('SIGINT',stopping);process.removeListener('SIGTERM',stopping);}
  }finally{store?.close();await client.close();}
}
main().catch(error=>{console.error(error instanceof CleanupFault?error.code:'Cleanup failed. Private details redacted.');process.exitCode=1;});
