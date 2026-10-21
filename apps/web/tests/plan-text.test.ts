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

test('diagram replacements are bounded, canonical and reject unsafe labels, layouts and repeated scene IDs', () => {
  const good = {sceneId: 'scene_1', labels: [' Water ', 'Air'], layout: 'sequence'};
  const parsed = parseTextEdits({expectedProjectRevision: 1, edits: {diagrams: [good]}});
  assert.deepEqual(parsed.edits.diagrams?.[0].labels, ['Water', 'Air']);
  for (const diagrams of [[], [good, good], [{...good, sceneId: 'new'}], [{...good, layout: 'html'}], [{...good, labels: ['one']}], [{...good, labels: Array(6).fill('x')}], [{...good, labels: ['', 'two']}], [{...good, labels: ['<svg>', 'two']}], [{...good, labels: ['line\nbreak', 'two']}], [{...good, labels: ['x'.repeat(101), 'two']}], [{...good, labels: [1, 'two']}], [{...good, code: 'run'}]]) assert.throws(() => parseTextEdits({expectedProjectRevision: 1, edits: {diagrams}}));
});
test('diagram edits preserve narration, captions, other scenes and originals; selected language remains enforced', () => {
  const input = parseTextEdits({expectedProjectRevision: 1, edits: {diagrams: [{sceneId: 'scene_1', labels: ['Rain', 'River', 'Sea'], layout: 'sequence'}]}});
  const before = structuredClone(plan), edited = applyTextEdits(plan, input);
  assert.deepEqual(plan, before); assert.deepEqual(edited.captions, plan.captions); assert.equal(edited.scenes[0].narration, plan.scenes[0].narration);
  assert.deepEqual(edited.scenes[0].labels, ['Rain', 'River', 'Sea']); assert.equal(edited.scenes[0].layout, 'sequence'); assert.deepEqual(edited.scenes[1], plan.scenes[1]);
  assert.throws(() => applyTextEdits(plan, parseTextEdits({expectedProjectRevision: 1, edits: {diagrams: [{sceneId: 'scene_8', labels: ['One', 'Two'], layout: 'cycle'}]}})));
  const telugu = {...plan, language: 'te' as const};
  assert.throws(() => applyTextEdits(telugu, input));
  const te = applyTextEdits(telugu, parseTextEdits({expectedProjectRevision: 1, edits: {diagrams: [{sceneId: 'scene_1', labels: ['వర్షం', 'నది', '10%'], layout: 'cycle'}]}}));
  assert.equal(te.scenes[0].labels[2], '10%');
});
test('diagram recovery preserves empty labels and exact pending saves, including legacy text-only records', () => {
  const base: TextBase = {id: '10000000-0000-4000-8000-000000000001', projectRevision: 1, versionNumber: 1, language: 'en', scenes: structuredClone(plan.scenes)};
  const scenes = structuredClone(base.scenes); scenes[0].labels!.push(''); scenes[0].layout = 'comparison';
  const value: TextRecovery = {version: 1, scope: 'diagram-scope', base, scenes, pending: {key: '20000000-0000-4000-8000-000000000001', body: textChanges(base, scenes)}};
  assert.deepEqual(recoverPlanText(JSON.stringify(value), value.scope), value);
  assert.throws(() => parseTextEdits(value.pending!.body));
  const legacyBase = {...base, scenes: base.scenes.map(({sceneId, heading, narration}) => ({sceneId, heading, narration}))};
  const legacyScenes = structuredClone(legacyBase.scenes); legacyScenes[0].heading = 'Recovered heading';
  const legacy: TextRecovery = {...value, base: legacyBase, scenes: legacyScenes, pending: {key: value.pending!.key, body: textChanges(legacyBase, legacyScenes)}};
  assert.equal(legacy.pending!.body.edits.diagrams, undefined); assert.deepEqual(recoverPlanText(JSON.stringify(legacy), legacy.scope), legacy);
  const bad = structuredClone(value); bad.scenes[0].labels = ['only one']; assert.equal(recoverPlanText(JSON.stringify(bad), value.scope), null);
});
