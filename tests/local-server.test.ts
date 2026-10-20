import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {createLocalServer, samplePlan} from '../scripts/local-server.js';
import {assemble} from '../src/pipeline/timing.js';
import {offlineSynthesizer} from '../src/pipeline/providers.js';

test('both curated lessons have distinct 30/60/90-second scripts that fit measured audio', async () => {
  const synth = await offlineSynthesizer();
  for (const topic of ['water-cycle', 'seed-growth'] as const) for (const seconds of [30, 60, 90] as const) {
    const plan = await samplePlan(process.cwd(), topic, seconds);
    assert.equal(plan.targetSeconds, seconds);
    assert.equal(plan.scenes.flatMap((scene) => scene.phrases).length, seconds / 3);
    for (const language of ['en', 'te'] as const) {
      const clips = new Map(plan.scenes.flatMap((scene) => scene.phrases.map((phrase) => [phrase.id, synth(phrase.text[language], language)] as const)));
      const timeline = assemble(plan, language, clips);
      assert.ok(timeline.durationInFrames / 30 <= Math.min(90, seconds + 3), `${topic} ${seconds}s ${language} narration is too long`);
      assert.ok(timeline.durationInFrames - timeline.cues.at(-1)!.endFrame < 30);
    }
  }
});

test('local HTTP workflow persists edits, rejects stale approvals and protects file access', async () => {
  const base = path.resolve('.cache', `http-test-${randomUUID()}`);
  assert.ok(base.startsWith(path.resolve('.cache') + path.sep));
  await fs.mkdir(path.join(base, 'fixtures'), {recursive: true});
  for (const file of ['water-cycle.json', 'lessons.json']) await fs.copyFile(path.join('fixtures', file), path.join(base, 'fixtures', file));
  await fs.mkdir(path.join(base, 'output'), {recursive: true});
  await fs.writeFile(path.join(base, 'output', 'range.mp4'), '0123456789');
  let server = await createLocalServer(base);
  const listen = async () => {await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve)); const address = server.address(); assert.ok(address && typeof address !== 'string'); return `http://127.0.0.1:${address.port}`;};
  const close = () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  let origin = await listen();
  const post = (route: string, input: unknown, extra = {}) => fetch(origin + route, {method: 'POST', headers: {'Content-Type': 'application/json', 'X-VideoCraft-Local': '1', ...extra}, body: JSON.stringify(input)});
  try {
    const settings = {mode: 'offline', spoken: 'te', accent: 'Indian', scale: .5};
    const request = {idea: 'Explain how seeds grow', topic: 'seed-growth', template: 'concept-flow', duration: 30, settings};
    assert.equal((await post('/api/projects', request, {Origin: 'https://other.example'})).status, 403);
    assert.equal((await post('/api/projects', {...request, settings: {...settings, captions: 'en'}})).status, 400, 'A separate subtitle-language choice is rejected');
    const created = await post('/api/projects', request); assert.equal(created.status, 201);
    const project = await created.json();
    assert.equal(project.plan.template, 'concept-flow');
    assert.equal(project.settings.spoken, 'te');
    assert.equal('captions' in project.settings, false);
    assert.equal((await post(`/api/projects/${project.id}/render`, {approvedHash: 'incorrect', settingsHash: project.settingsHash})).status, 409);
    project.plan.title.en = 'How seeds become plants';
    const saved = await post(`/api/projects/${project.id}/save`, {plan: project.plan, settings, previousHash: project.versionHash}); assert.equal(saved.status, 200);
    assert.equal((await post(`/api/projects/${project.id}/save`, {plan: project.plan, settings, previousHash: project.versionHash})).status, 409);
    assert.equal((await post(`/api/projects/${project.id}/render`, {approvedHash: project.planHash, settingsHash: project.settingsHash})).status, 409);
    const invalid = structuredClone(project.plan); invalid.scenes[0].phrases[0].text.te = '';
    assert.equal((await post(`/api/projects/${project.id}/save`, {plan: invalid, settings, previousHash: (await saved.json()).versionHash})).status, 400);
    const ranged = await fetch(origin + '/media/range.mp4', {headers: {Range: 'bytes=2-5'}}); assert.equal(ranged.status, 206); assert.equal(await ranged.text(), '2345');
    const suffix = await fetch(origin + '/media/range.mp4', {headers: {Range: 'bytes=-3'}}); assert.equal(await suffix.text(), '789');
    assert.equal((await fetch(origin + '/media/range.mp4', {headers: {Range: 'bytes=99-100'}})).status, 416);
    assert.notEqual((await fetch(origin + '/media/..%5c..%5cpackage.json')).status, 200);
    await close();
    const file = path.join(base, 'output/projects', project.id, 'project.json');
    const stored = JSON.parse(await fs.readFile(file, 'utf8'));
    stored.settings.captions = 'en'; // Legacy projects migrate to the single language choice.
    stored.jobs.push({id: randomUUID(), status: 'rendering', settings, logs: [], startedAt: new Date().toISOString()});
    await fs.writeFile(file, JSON.stringify(stored));
    await fs.mkdir(path.join(base, 'output/offline-water-cycle'), {recursive: true});
    const video = {file: 'sample.mp4', captions: 'sample.srt', representativeFrames: ['sample.png'], media: {durationSeconds: 30}};
    await fs.writeFile(path.join(base, 'output/offline-water-cycle/manifest.json'), JSON.stringify({mode: 'offline', videos: ['en-en', 'en-te', 'te-en', 'te-te'].map(pair => ({...video, pair}))}));
    server = await createLocalServer(base); origin = await listen();
    const state = await (await fetch(origin + '/api/state')).json();
    assert.equal(state.projects[0].plan.title.en, 'How seeds become plants');
    assert.equal(state.projects[0].settings.spoken, 'te');
    assert.equal('captions' in state.projects[0].settings, false);
    assert.equal(state.projects[0].jobs[0].status, 'interrupted');
    assert.equal(state.active, null);
    assert.deepEqual(state.library.map((video: {pair: string}) => video.pair), ['en-en', 'te-te']);
  } finally {await close(); await fs.rm(base, {recursive: true, force: true});}
});

test('CLI refuses an independent subtitle language before starting generation', () => {
  const result = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/cli.ts', 'render', '--spoken', 'te', '--captions', 'en', '--approve'], {encoding: 'utf8', windowsHide: true});
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Subtitles now follow the video language automatically/);
});
