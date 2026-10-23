'use client';
import {useEffect} from 'react';
import Link from 'next/link';
import {Panel,PageHeading} from './ui';
import {recoveryKey} from '@/lib/project-draft';
import type {DeletionReceipt} from '@/server/projects/deletion';
export function ProjectDeletionResult({receipt,workspaceId,userId}:{receipt:DeletionReceipt;workspaceId:string;userId:string}){
  useEffect(()=>{try{const scope=recoveryKey(workspaceId,userId,receipt.projectId);for(const suffix of ['',':delete-command:v1',':duplicate-command:v1',':rename-command:v1'])sessionStorage.removeItem(`${scope}${suffix}`);}catch{}},[receipt.projectId,workspaceId,userId]);
  return <><PageHeading eyebrow="PROJECT REMOVED" title="Team access has been removed." description="The project is no longer available in the studio."/><Panel><h2>Physical cleanup is pending</h2><p className="muted-copy">{receipt.message}</p><p className="muted-copy">No restore action is available. Shared assets remain retained. Removing team access does not retract an external Instagram post.</p><Link className="text-button" href="/projects">Return to projects</Link></Panel></>;
}
