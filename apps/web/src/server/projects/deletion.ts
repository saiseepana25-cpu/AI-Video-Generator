import {ProjectError} from './contracts';
export type DeleteInput={expectedProjectRevision:number};
export type DeletionReceipt={projectId:string;accessRemoved:true;cleanupState:'retained';cleanupJobId:null;externalPublicationState:'none_pending';message:string};
export function parseDeleteInput(params:URLSearchParams):DeleteInput {
  for(const key of params.keys())if(key!=='expectedProjectRevision'||params.getAll(key).length!==1)throw new ProjectError('INVALID_QUERY',400,'Only one expectedProjectRevision is accepted.');
  const value=params.get('expectedProjectRevision');
  if(value===null)throw new ProjectError('PRECONDITION_REQUIRED',428,'Reload and review the saved project before deleting.');
  if(!/^[1-9][0-9]{0,15}$/.test(value)||!Number.isSafeInteger(Number(value)))throw new ProjectError('INVALID_QUERY',400,'Use a positive safe project revision.');
  return {expectedProjectRevision:Number(value)};
}
