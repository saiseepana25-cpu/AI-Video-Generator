import {StorageFault, type StorageSource, type StorageKind} from './contracts';
import {sha256} from './r2';
/** The DB pins the completed manifest, which pins the actual completed MP4.
 * Never establish provenance by hashing today's file into a legacy manifest. */
export function verifyCompletedMp4(bytes: Record<StorageKind, Buffer>, source: StorageSource) {
  if (sha256(bytes.manifest) !== source.artifact.manifestHash) throw new StorageFault('STORAGE_SOURCE_CHANGED');
  let manifest: {mp4Sha256?: unknown};
  try {manifest = JSON.parse(bytes.manifest.toString('utf8'));} catch {throw new StorageFault('STORAGE_SOURCE_CHANGED');}
  if (!manifest || typeof manifest.mp4Sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(manifest.mp4Sha256)) throw new StorageFault('STORAGE_VIDEO_CHECKSUM_REQUIRED');
  if (sha256(bytes.mp4) !== manifest.mp4Sha256) throw new StorageFault('STORAGE_SOURCE_CHANGED');
}
