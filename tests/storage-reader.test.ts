import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {LocalArtifactReader} from '../src/pipeline/storage-reader.js';
import {sha256} from '../apps/web/src/server/storage/r2';
import type {StorageSource} from '../apps/web/src/server/storage/contracts';
import {canonicalJson, generationHash} from '../src/pipeline/render-contract.js';
import {selectedSrt} from '../src/pipeline/selected-timing.js';
import {renderFixture} from '../apps/web/tests/fixtures/rendering';
async function fixture(work: (f: {reader: LocalArtifactReader; source: StorageSource; folder: string}) => Promise<void>) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'videocraft-storage-reader-'));
  const plan = renderFixture().plan, runId = randomUUID(), artifactId = randomUUID(), inputHash = generationHash(plan), build = 'a'.repeat(64);
  const folder = path.join(root, 'output', 'dashboard-renders', runId, artifactId); await fs.mkdir(folder, {recursive: true});
  const media = {width: 1080, height: 1920, videoCodec: 'h264', audioCodec: 'aac', audioSampleRate: 48000, durationSeconds: 30.016, meanVolumeDb: -20};
  const manifest = {state: 'validated_local', mode: 'elevenlabs-evaluation', diagnostic: false, voicePinSatisfied: true, publicationAllowed: false, inputHash,
    rendererBuildHash: build, language: plan.language, fps: 30, durationInFrames: 900, audioHash: 'b'.repeat(64), mp4Sha256: sha256('fake fixture media'), media};
  const cues = plan.narration.map((n, i) => ({segmentId: n.segmentId, sceneId: plan.scenes[i].sceneId, text: n.text, startFrame: i * 300, speechEndFrame: i * 300 + 250, endFrame: (i + 1) * 300, sampleStart: i * 240000, sampleEnd: (i + 1) * 240000}));
  const files = {'manifest.json': JSON.stringify(manifest), 'input.json': canonicalJson(plan), 'video.mp4': 'fake fixture media', 'captions.srt': selectedSrt(cues),
    'timing.json': JSON.stringify({audioHash: manifest.audioHash, cues, layout: {scenes: cues.map(c => ({caption: {lines: [c.text]}}))}})};
  for (const [name, bytes] of Object.entries(files)) await fs.writeFile(path.join(folder, name), bytes);
  const source = {run: {_id: runId, inputHash}, artifact: {_id: artifactId, manifestHash: sha256(files['manifest.json']), rendererBuildHash: build, media}, approval: {inputCanonical: canonicalJson(plan)}} as StorageSource;
  try {await work({reader: new LocalArtifactReader(root, async () => media), source, folder});}
  finally {const target = path.resolve(root); if (path.dirname(target) !== path.resolve(os.tmpdir()) || !path.basename(target).startsWith('videocraft-storage-reader-')) throw new Error('Unsafe test cleanup'); await fs.rm(target, {recursive: true, force: true});}
}
test('local storage reader verifies bounded files and exact matching-language subtitles', async () => {
  await fixture(async ({reader, source}) => {const data = await reader.read(source); assert.equal(Object.keys(data).length, 5); assert.equal(sha256(data.manifest), source.artifact.manifestHash);});
});
test('local storage reader refuses diagnostic or changed manifests', async () => {
  await fixture(async ({reader, source, folder}) => {const file = path.join(folder, 'manifest.json'), m = JSON.parse(await fs.readFile(file, 'utf8')); m.diagnostic = true; const bytes = JSON.stringify(m); await fs.writeFile(file, bytes);
    source.artifact.manifestHash = sha256(bytes); await assert.rejects(reader.read(source), /STORAGE_SOURCE_CHANGED/);});
});
test('local storage reader refuses altered captions and independently checks media', async () => {
  await fixture(async ({reader, source, folder}) => {await fs.writeFile(path.join(folder, 'captions.srt'), 'unapproved words'); await assert.rejects(reader.read(source), /STORAGE_SOURCE_CHANGED/);});
  await fixture(async ({source, folder}) => {const root = path.resolve(folder, '../../../..'); await assert.rejects(new LocalArtifactReader(root, async () => {throw new Error('invalid media');}).read(source), /invalid media/);});
});
test('local storage reader refuses path traversal and oversized sidecars', async () => {
  await fixture(async ({reader, source, folder}) => {await assert.rejects(reader.read({...source, artifact: {...source.artifact, _id: '../escape'}}));
    await fs.writeFile(path.join(folder, 'captions.srt'), Buffer.alloc(262145)); await assert.rejects(reader.read(source), /STORAGE_SOURCE_UNAVAILABLE/);});
});
test('replaced MP4 bytes are refused even when all profile, duration and audio measurements still match', async () => {
  await fixture(async ({reader, source, folder}) => {
    const original = await reader.read(source);
    const replacement = Buffer.from('FAKE fixture media'); assert.equal(replacement.length, original.mp4.length);
    await fs.writeFile(path.join(folder, 'video.mp4'), replacement);
    // The injected inspector always returns the exact original media metrics.
    await assert.rejects(reader.read(source), /STORAGE_SOURCE_CHANGED/);
  });
});
test('legacy completed manifests without a valid MP4 checksum cannot be promoted from current bytes', async () => {
  for (const checksum of [undefined, null, 'invalid']) await fixture(async ({reader, source, folder}) => {
    const file = path.join(folder, 'manifest.json'), manifest = JSON.parse(await fs.readFile(file, 'utf8'));
    manifest.mp4Sha256 = checksum; const bytes = JSON.stringify(manifest); await fs.writeFile(file, bytes);
    source.artifact.manifestHash = sha256(bytes);
    await assert.rejects(reader.read(source), /STORAGE_VIDEO_CHECKSUM_REQUIRED/);
  });
});
test('rewriting a manifest checksum to match replacement video cannot bypass the DB-pinned manifest hash', async () => {
  await fixture(async ({reader, source, folder}) => {
    const file = path.join(folder, 'manifest.json'), manifest = JSON.parse(await fs.readFile(file, 'utf8'));
    const replacement = Buffer.from('FAKE fixture media'); manifest.mp4Sha256 = sha256(replacement);
    await fs.writeFile(path.join(folder, 'video.mp4'), replacement); await fs.writeFile(file, JSON.stringify(manifest));
    await assert.rejects(reader.read(source), /STORAGE_SOURCE_CHANGED/);
  });
});
