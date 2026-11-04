import {createHash} from 'node:crypto';
import {canonicalJson} from './render-contract';
export function artifactOwner(executionId:string,runId:string,artifactId:string,inputHash:string,rendererBuildHash:string){
  const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
  if(![executionId,runId,artifactId].every(value=>uuid.test(value))||![inputHash,rendererBuildHash].every(value=>/^[a-f0-9]{64}$/.test(value)))throw new Error('Invalid execution ownership.');
  const bytes=Buffer.from(canonicalJson({protocol:'windows-job-v1',executionId,runId,artifactId,inputHash,rendererBuildHash}));return {bytes,sha256:createHash('sha256').update(bytes).digest('hex')};
}
export function workspaceOwner(executionId:string,runId:string,inputHash:string,rendererBuildHash:string){
  artifactOwner(executionId,runId,executionId,inputHash,rendererBuildHash);
  const bytes=Buffer.from(canonicalJson({protocol:'windows-job-v1',area:'work',executionId,runId,inputHash,rendererBuildHash}));return {bytes,sha256:createHash('sha256').update(bytes).digest('hex')};
}
