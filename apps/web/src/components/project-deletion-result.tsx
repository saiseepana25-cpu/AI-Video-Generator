'use client';
import {useEffect} from 'react';
import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {Panel,PageHeading} from './ui';
import {recoveryKey} from '@/lib/project-draft';
import type {DeletionStatus} from '@/server/projects/deletion';
import {Button} from './ui';
export function ProjectDeletionResult({receipt,workspaceId,userId}:{receipt:DeletionStatus;workspaceId:string;userId:string}){
  const router=useRouter(),status=receipt.mediaCleanup;
  useEffect(()=>{try{const scope=recoveryKey(workspaceId,userId,receipt.projectId);for(const suffix of ['',':delete-command:v1',':duplicate-command:v1',':rename-command:v1'])sessionStorage.removeItem(`${scope}${suffix}`);}catch{}},[receipt.projectId,workspaceId,userId]);
  const labels={no_ready_media:'No owned ready-video files found',not_started:'Ready-video cleanup has not started',pending:'Ready-video cleanup is pending',retry_required:'Ready-video cleanup needs an operator retry',partial:'Some ready-video files have been removed',ready_media_removed:'Owned ready-video files have been removed'};
  const local=receipt.localRenderCleanup,localLabels={no_completed_artifacts:'No completed local render bundles found',not_started:'Local render cleanup has not started',pending:'Local render cleanup is pending',retry_required:'Local render cleanup needs an operator retry',partial:'Some local render bundles have been cleaned',known_files_removed:'Verified local render files have been removed'};
  return <><PageHeading eyebrow="PROJECT REMOVED" title="Team access has been removed." description="The project is no longer available in the studio."/><Panel><h2>Cleanup status</h2><p role="status">{labels[status.state]}</p><p className="muted-copy">{status.deletedAssets} of {status.totalAssets} owned ready-video files confirmed removed.</p><h3>Local render files</h3><p role="status">{localLabels[local.state]}</p><p className="muted-copy">{local.cleanedArtifacts} of {local.totalArtifacts} completed bundles cleaned.</p><p className="muted-copy">Cleanup runs through explicit operator commands. Local render cleanup follows confirmed ready-video cleanup. Speech files, source records, scratch files, unpromoted storage and shared branding remain retained. This is not confirmation that all project data has been erased.</p><p className="muted-copy">No restore action is available. Removing team access does not retract an external Instagram post.</p><div className="editor-actions"><Button variant="secondary" onClick={()=>router.refresh()}>Refresh cleanup status</Button><Link className="text-button" href="/projects">Return to projects</Link></div></Panel></>;
}
