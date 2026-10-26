import {ProjectError} from './contracts';
import type {MediaCleanupStatus} from '../cleanup/contracts';
import type {LocalStatus} from '../cleanup/local-contracts';
export type DeleteInput={expectedProjectRevision:number;acknowledgeActiveWork?:true;expectedWorkRevision?:number};
export type DeletionImpact={projectId:string;projectRevision:number;workRevision:number;queuedPlanning:number;queuedGenerations:number;canDelete:boolean;blockReason:string|null};
export type DeletionReceipt={projectId:string;accessRemoved:true;cleanupState:'retained';cleanupJobId:null;externalPublicationState:'none_pending';message:string};
export type DeletionStatus=DeletionReceipt&{mediaCleanup:MediaCleanupStatus;localRenderCleanup:LocalStatus};
export function parseDeleteInput(params:URLSearchParams):DeleteInput {
  for(const key of params.keys())if(!['expectedProjectRevision','acknowledgeActiveWork','expectedWorkRevision'].includes(key)||params.getAll(key).length!==1)throw new ProjectError('INVALID_QUERY',400,'Use only the documented deletion fields once each.');
  const value=params.get('expectedProjectRevision');
  if(value===null)throw new ProjectError('PRECONDITION_REQUIRED',428,'Reload and review the saved project before deleting.');
  if(!/^[1-9][0-9]{0,15}$/.test(value)||!Number.isSafeInteger(Number(value)))throw new ProjectError('INVALID_QUERY',400,'Use a positive safe project revision.');
  const input:DeleteInput={expectedProjectRevision:Number(value)};
  if(params.has('acknowledgeActiveWork')||params.has('expectedWorkRevision')){
    const work=params.get('expectedWorkRevision');
    if(params.get('acknowledgeActiveWork')!=='true'||work===null||!/^(?:0|[1-9][0-9]{0,15})$/.test(work)||!Number.isSafeInteger(Number(work)))throw new ProjectError('INVALID_QUERY',400,'Queued-work acknowledgement requires its reviewed safe work revision.');
    input.acknowledgeActiveWork=true;input.expectedWorkRevision=Number(work);
  }
  return input;
}
export function deleteQuery(input:DeleteInput){const params=new URLSearchParams({expectedProjectRevision:String(input.expectedProjectRevision)});if(input.acknowledgeActiveWork){params.set('acknowledgeActiveWork','true');params.set('expectedWorkRevision',String(input.expectedWorkRevision));}return params;}
