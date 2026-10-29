import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {selectedFixture} from '../fixtures/selected-diagrams';
import {buildRenderPlan, generationHash} from '../src/pipeline/render-contract';
import {renderSelectedVideo, selectedFontAssets} from '../src/pipeline/selected-renderer';
import type {SelectedClip} from '../src/pipeline/selected-types';

type ProcessIdentity = {id: number; parent: number; name: string; created: string};
const execute = promisify(execFile);
// Read process identity only, never command lines, credentials or browser data.
async function processes(): Promise<ProcessIdentity[]> {
  const {stdout} = await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command',
    'Get-CimInstance Win32_Process | ForEach-Object { @{id=[int]$_.ProcessId;parent=[int]$_.ParentProcessId;name=$_.Name;created=$_.CreationDate.ToUniversalTime().ToString("o")} } | ConvertTo-Json -Compress'], {windowsHide: true, timeout: 20000, maxBuffer: 2 * 1024 * 1024});
  return JSON.parse(stdout);
}
function descendants(rows: ProcessIdentity[]) {
  const owned = new Set([process.pid]);
  for (let old = -1; old !== owned.size;) {old = owned.size; for (const row of rows) if (owned.has(row.parent)) owned.add(row.id);}
  return rows.filter(row => owned.has(row.id) && /^(chrome|msedge|ffmpeg|ffprobe|remotion).*\.exe$/i.test(row.name));
}

// Explicit Windows-only real renderer test. Sine-wave fixture; no keys/providers,
// DB, R2 or retained user files. Generated test artifacts remain in ignored cache.
test('real render cancellation returns without a usable artifact and observed owned media processes exit', {skip: process.platform !== 'win32', timeout: 180000}, async () => {
  const root = process.cwd(), outputRoot = path.join(root, '.cache', 'render-stop-test', randomUUID());
  const {pins} = await selectedFontAssets(root), fixture = selectedFixture('en');
  const plan = buildRenderPlan(fixture.proposal, fixture.brief, fixture.settings, pins);
  const clips: SelectedClip[] = plan.narration.map(segment => ({segmentId: segment.segmentId, text: segment.text,
    source: {provider: 'offline-diagnostic', model: 'fixture', voiceId: 'sine'},
    audio: {sampleRate: 24000, samples: Float32Array.from({length: 48000}, (_, i) => Math.sin(i / 10) * .1)}}));
  const controller = new AbortController(); let observation: Promise<void> | undefined, observed: ProcessIdentity[] = [];
  await assert.rejects(renderSelectedVideo({root, outputRoot, plan, expectedHash: generationHash(plan), clips, mode: 'offline-diagnostic', licenseConfirmed: true,
    signal: controller.signal, onProgress: progress => {
      if (progress > .05 && !observation) observation = processes().then(rows => {observed = descendants(rows); controller.abort();});
    }}));
  await observation; assert(controller.signal.aborted); assert(observed.some(row => /^(chrome|msedge)/i.test(row.name)), 'An owned renderer browser must be observed before cancellation.');
  const after = await processes();
  assert.deepEqual(observed.filter(row => after.some(live => live.id === row.id && live.created === row.created)), [], 'A tracked owned media process survived the returned cancellation.');
  const folders = await fs.readdir(outputRoot); assert.equal(folders.length, 1);
  const manifest = JSON.parse(await fs.readFile(path.join(outputRoot, folders[0], 'manifest.json'), 'utf8'));
  assert.equal(manifest.state, 'cancelled'); assert.equal(manifest.media, null); assert.equal(manifest.mp4Sha256, undefined);
});
