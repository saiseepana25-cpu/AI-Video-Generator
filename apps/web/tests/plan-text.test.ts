import {test} from 'node:test';
import assert from 'node:assert/strict';
import {applyTextEdits, parseTextEdits} from '../src/server/planning/text-edits';
import {recoverPlanText, textChanges, type TextBase, type TextRecovery} from '../src/lib/plan-text-draft';
import type {Plan} from '../src/server/planning/contracts';
const plan: Plan = {schemaVersion: 2, title: 'Water', learningObjective: 'Understand water', language: 'en', targetSeconds: 30,
  scenes: [1, 2, 3].map(i => ({sceneId: `scene_${i}`, heading: 'Water', narration: 'Water moves.', labels: ['Water', 'Air'], layout: 'cycle'})),
  captions: [1, 2, 3].map(i => ({captionId: `caption_scene_${i}`, sourceSegmentId: `scene_${i}`, text: 'Water moves.'})), reviewNotes: []};
test('text edits are bounded, normalized, canonical and reject structural or unsupported changes', () => {
  assert.deepEqual(parseTextEdits({expectedProjectRevision: 1, edits: {narration: [{segmentId: 'scene_2', text: ' Second '}, {segmentId: 'scene_1', text: 'First'}]}}).edits.narration?.map(c => c.segmentId), ['scene_1', 'scene_2']);
  for (const edits of [{}, {settings: {}}, {narration: []}, {narration: [{segmentId: 'new', text: 'x'}]}, {headings: [{sceneId: 'scene_1', text: ''}]}, {headings: [{sceneId: 'scene_1', text: '<img>'}]}, {narration: [{segmentId: 'scene_1', text: 'x'.repeat(1001)}]}, {narration: [{segmentId: 'scene_1', text: 'a'}, {segmentId: 'scene_1', text: 'b'}]}]) assert.throws(() => parseTextEdits({expectedProjectRevision: 1, edits}));
  assert.throws(() => parseTextEdits({edits: {headings: [{sceneId: 'scene_1', text: 'Heading'}]}}));
});
test('editing derives exact captions, preserves diagrams/IDs and rejects unknown scenes or mixed languages', () => {
  const original = structuredClone(plan), edited = applyTextEdits(plan, parseTextEdits({expectedProjectRevision: 1, edits: {narration: [{segmentId: 'scene_1', text: 'Rain falls.'}], headings: [{sceneId: 'scene_1', text: 'Rain'}]}}));
  assert.deepEqual(plan, original); assert.equal(edited.captions[0].text, 'Rain falls.'); assert.deepEqual(edited.scenes[0].labels, plan.scenes[0].labels);
  assert.throws(() => applyTextEdits(plan, {expectedProjectRevision: 1, edits: {narration: [{segmentId: 'scene_8', text: 'Unknown scene'}]}}));
  assert.throws(() => applyTextEdits(plan, {expectedProjectRevision: 1, edits: {narration: [{segmentId: 'scene_1', text: 'నీరు'}]}}));
  const telugu = {...plan, language: 'te' as const};
  assert.equal(applyTextEdits(telugu, {expectedProjectRevision: 1, edits: {narration: [{segmentId: 'scene_1', text: 'వర్షపు నీరు నదులలోకి చేరుతుంది.'}]}}).captions[0].text, 'వర్షపు నీరు నదులలోకి చేరుతుంది.');
});
test('plan recovery retains blank/unfinished text and exact pending commands but rejects detached structure', () => {
  const base: TextBase = {id: '10000000-0000-4000-8000-000000000001', projectRevision: 1, versionNumber: 1, language: 'en', scenes: plan.scenes};
  const scenes = structuredClone(base.scenes); scenes[0].narration = ''; scenes[1].heading = 'Useful edit';
  const value: TextRecovery = {version: 1, scope: 'test-scope', base, scenes, pending: null};
  assert.deepEqual(recoverPlanText(JSON.stringify(value), value.scope), value);
  value.pending = {key: '20000000-0000-4000-8000-000000000001', body: textChanges(base, scenes)};
  assert.deepEqual(recoverPlanText(JSON.stringify(value), value.scope), value);
  assert.equal(recoverPlanText(JSON.stringify(value), 'another-scope'), null);
  assert.equal(recoverPlanText(JSON.stringify({...value, pending: {...value.pending, body: {expectedProjectRevision: 1, edits: {}}}}), value.scope), null);
  assert.equal(recoverPlanText(JSON.stringify({...value, scenes: [...scenes, scenes[0]]}), value.scope), null);
});
