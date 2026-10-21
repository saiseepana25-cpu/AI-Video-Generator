import type {Long} from 'mongodb';
import type {GenerationRun, LocalArtifact, Approval} from '../generation/contracts';
export const storageFiles = {
  mp4: {name: 'video.mp4', mime: 'video/mp4', max: 128 * 1024 * 1024},
  srt: {name: 'captions.srt', mime: 'application/x-subrip', max: 256 * 1024},
  input: {name: 'input.json', mime: 'application/json', max: 512 * 1024},
  timing: {name: 'timing.json', mime: 'application/json', max: 2 * 1024 * 1024},
  manifest: {name: 'manifest.json', mime: 'application/json', max: 256 * 1024},
} as const;
export type StorageKind = keyof typeof storageFiles;
export const storageKinds = Object.keys(storageFiles) as StorageKind[];
export const maxBundleBytes = 132 * 1024 * 1024;
export type StorageObject = {kind: StorageKind; key: string; sha256: string; size: number; mime: string};
export type StorageBundle = {_id: string; schemaVersion: 1; workspaceId: string; projectId: string; runId: string; approvalId: string; artifactId: string;
  inputHash: string; manifestHash: string; rendererBuildHash: string; configHash: string; bucket: string; objects: StorageObject[];
  state: 'pending' | 'uploading' | 'failed' | 'stored'; revision: Long; owner: string | null; epoch: Long; leaseUntil: Date | null;
  createdAt: Date; updatedAt: Date; storedAt: Date | null; error: string | null};
export type StorageSource = {run: GenerationRun; artifact: LocalArtifact; approval: Approval};
export interface ArtifactReader {read(source: StorageSource): Promise<Record<StorageKind, Buffer>>;}
export interface ObjectStore {configHash: string; bucket: string; ensure(object: StorageObject, bytes: Buffer): Promise<void>;}
export class StorageFault extends Error {constructor(public code: string) {super(code);}}
