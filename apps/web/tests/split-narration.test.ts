import {test} from 'node:test';
import assert from 'node:assert/strict';
import {splitNarrationScenes} from '../src/lib/split-narration';
import {parseTextEdits, applyTextEdits} from '../src/server/planning/text-edits';
import {planTextBody, recoverPlanText, type TextRecovery} from '../src/lib/plan-text-draft';
import type {Plan} from '../src/server/planning/contracts';
const rows = ['Water rises.\nClouds form.', 'Water cools. Tiny drops form.', 'Drops grow. Rain falls.'].map((narration, i) => ({sceneId: `scene_${i + 1}`, heading: 'Water', narration, labels: ['Water', 'Air'], layout: 'sequence' as const}));
test('sentence splitting retains words and diagrams, creates stable consecutive scene/caption IDs and leaves base immutable', () => {
  const original = structuredClone(rows), scenes = splitNarrationScenes(rows);
  assert.equal(scenes.length, 6); assert.deepEqual(scenes.map(s => s.sceneId), [1, 2, 3, 4, 5, 6].map(i => `scene_${i}`));
  assert.equal(scenes.map(s => s.narration).join(' '), rows.map(s => s.narration).join(' ').replace(/\s+/g, ' '));
  assert.deepEqual(scenes[1].labels, rows[0].labels); scenes[1].labels[0] = 'Changed'; assert.deepEqual(rows, original);
  const plan = {schemaVersion: 2, title: 'Water', learningObjective: 'Explain water', language: 'en', targetSeconds: 30, scenes: rows, captions: [], reviewNotes: []} as Plan;
  const result = applyTextEdits(plan, parseTextEdits({expectedProjectRevision: 1, edits: {splitNarration: true}}));
  assert.equal(result.scenes.length, 6); assert.equal(plan.scenes.length, 3);
  assert.deepEqual(result.captions, result.scenes.map(s => ({captionId: `caption_${s.sceneId}`, sourceSegmentId: s.sceneId, text: s.narration})));
});
test('Telugu and punctuation splits preserve Unicode text; no boundary and over-eight plans refuse without truncation', () => {
  const te = rows.map(s => ({...s, narration: 'నీరు ఆవిరవుతుంది. మేఘాలు ఏర్పడతాయి.'}));
  assert.equal(splitNarrationScenes(te).length, 6);
  assert.equal(splitNarrationScenes(te)[0].narration, 'నీరు ఆవిరవుతుంది.');
  assert.throws(() => splitNarrationScenes(rows.map(s => ({...s, narration: 'One sentence.'}))), /No sentence boundary/);
  assert.throws(() => splitNarrationScenes([...rows, ...rows.slice(0, 2)]), /eight scenes/);
});
test('split command is explicit, exclusive and revision-bound', () => {
  for (const splitNarration of [false, 'true', 1, null]) assert.throws(() => parseTextEdits({expectedProjectRevision: 1, edits: {splitNarration}}));
  assert.throws(() => parseTextEdits({expectedProjectRevision: 1, edits: {splitNarration: true, headings: [{sceneId: 'scene_1', text: 'New'}]}}));
  assert.throws(() => parseTextEdits({edits: {splitNarration: true}}), {code: 'PRECONDITION_REQUIRED'});
});
test('split preview and uncertain command recover exactly; changed preview/body/mode cannot silently become another save', () => {
  const work: TextRecovery = {version: 1, scope: 'test-split', mode: 'split', base: {id: '10000000-0000-4000-8000-000000000001', projectRevision: 7, versionNumber: 4, language: 'en', scenes: rows}, scenes: splitNarrationScenes(rows), pending: null};
  assert.deepEqual(recoverPlanText(JSON.stringify(work), work.scope), work);
  work.pending = {key: '10000000-0000-4000-8000-000000000002', body: planTextBody(work)};
  assert.deepEqual(recoverPlanText(JSON.stringify(work), work.scope), work);
  assert.equal(recoverPlanText(JSON.stringify({...work, mode: 'unknown'}), work.scope), null);
  const changed = structuredClone(work); changed.scenes[0].narration = 'Modified';
  assert.equal(recoverPlanText(JSON.stringify(changed), work.scope), null);
  const command = structuredClone(work); command.pending!.body.expectedProjectRevision++;
  assert.equal(recoverPlanText(JSON.stringify(command), work.scope), null);
});
