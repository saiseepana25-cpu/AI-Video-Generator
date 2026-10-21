import fs from 'node:fs/promises';
import path from 'node:path';
import {storageFiles, storageKinds, StorageFault, type ArtifactReader, type StorageSource, type StorageKind} from '../../apps/web/src/server/storage/contracts';
import {requireProjectId} from '../../apps/web/src/server/projects/contracts';
import {sha256} from '../../apps/web/src/server/storage/r2';
import {canonicalJson, generationHash, validateRenderPlan} from './render-contract.js';
import {selectedSrt} from './selected-timing.js';
import {inspectVideo} from './probe.js';
import type {SelectedCue} from './selected-types.js';
export class LocalArtifactReader implements ArtifactReader {
  constructor(private root: string, private inspect = inspectVideo) {}
  async read({run, artifact, approval}: StorageSource): Promise<Record<StorageKind, Buffer>> {
    requireProjectId(run._id); requireProjectId(artifact._id);
    const expectedBase = path.join(await fs.realpath(this.root), 'output', 'dashboard-renders');
    const base = await fs.realpath(expectedBase); if (base !== expectedBase) throw new StorageFault('STORAGE_SOURCE_UNAVAILABLE');
    const folder = path.join(base, run._id, artifact._id), real = await fs.realpath(folder);
    if (real !== folder) throw new StorageFault('STORAGE_SOURCE_UNAVAILABLE');
    const bytes = {} as Record<StorageKind, Buffer>;
    for (const kind of storageKinds) {
      const file = path.join(folder, storageFiles[kind].name), stat = await fs.lstat(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > storageFiles[kind].max || await fs.realpath(file) !== file) throw new StorageFault('STORAGE_SOURCE_UNAVAILABLE');
      const handle = await fs.open(file, 'r');
      try {const info = await handle.stat(); if (!info.isFile() || info.size !== stat.size) throw new Error(); bytes[kind] = Buffer.alloc(info.size); let offset = 0;
        while (offset < bytes[kind].length) {const n = await handle.read(bytes[kind], offset, bytes[kind].length - offset, offset); if (!n.bytesRead) throw new Error(); offset += n.bytesRead;}
      } finally {await handle.close();}
    }
    const manifest = JSON.parse(bytes.manifest.toString('utf8')), timing = JSON.parse(bytes.timing.toString('utf8'));
    const plan = validateRenderPlan(JSON.parse(bytes.input.toString('utf8')));
    if (sha256(bytes.manifest) !== artifact.manifestHash || canonicalJson(plan) !== approval.inputCanonical || generationHash(plan) !== run.inputHash
      || manifest.state !== 'validated_local' || manifest.mode !== 'elevenlabs-evaluation' || manifest.diagnostic !== false || manifest.voicePinSatisfied !== true || manifest.publicationAllowed !== false
      || manifest.inputHash !== run.inputHash || manifest.rendererBuildHash !== artifact.rendererBuildHash || manifest.language !== plan.language || manifest.fps !== 30
      || !Number.isInteger(manifest.durationInFrames) || manifest.durationInFrames < 1 || manifest.durationInFrames > 2700 || canonicalJson(manifest.media) !== canonicalJson(artifact.media)
      || timing.audioHash !== manifest.audioHash || !Array.isArray(timing.cues) || timing.cues.length !== plan.narration.length || timing.layout?.scenes?.length !== plan.narration.length) throw new StorageFault('STORAGE_SOURCE_CHANGED');
    let end = 0;
    const cues = timing.cues.map((cue: SelectedCue, i: number) => {
      if (cue.text !== plan.narration[i].text || cue.segmentId !== plan.narration[i].segmentId || cue.sceneId !== plan.scenes[i].sceneId
        || ![cue.startFrame, cue.speechEndFrame, cue.endFrame, cue.sampleStart, cue.sampleEnd].every(Number.isSafeInteger)
        || cue.startFrame < end || cue.speechEndFrame <= cue.startFrame || cue.endFrame < cue.speechEndFrame || cue.endFrame > manifest.durationInFrames || cue.sampleStart < 0 || cue.sampleEnd <= cue.sampleStart) throw new StorageFault('STORAGE_SOURCE_CHANGED');
      end = cue.endFrame;
      const lines = timing.layout.scenes[i].caption.lines;
      if (!Array.isArray(lines) || lines.length < 1 || lines.length > 2 || !lines.every((s: unknown) => typeof s === 'string')) throw new StorageFault('STORAGE_SOURCE_CHANGED');
      if (lines.join('').replace(/\s/gu, '') !== cue.text.replace(/\s/gu, '')) throw new StorageFault('STORAGE_SOURCE_CHANGED');
      return {...cue, text: lines.join('\n')};
    });
    if (bytes.srt.toString('utf8') !== selectedSrt(cues)) throw new StorageFault('STORAGE_SOURCE_CHANGED');
    const media = await this.inspect(path.join(folder, 'video.mp4'), manifest.durationInFrames / 30, 1, true);
    if (canonicalJson(media) !== canonicalJson(artifact.media) || sha256(await fs.readFile(path.join(folder, 'video.mp4'))) !== sha256(bytes.mp4)) throw new StorageFault('STORAGE_SOURCE_CHANGED');
    return bytes;
  }
}
