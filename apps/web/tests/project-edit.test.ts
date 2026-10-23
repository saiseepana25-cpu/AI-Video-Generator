import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseProjectInput, parseProjectPatch} from '../src/server/projects/validation';
import {ProjectError, type ProjectDetail} from '../src/server/projects/contracts';
import {acknowledge, changes, editable, readRecovery, recoveryKey, sameDraft, type Recovery} from '../src/lib/project-draft';
import {projectErrorResponse} from '../src/server/projects/http';

const input = parseProjectInput({idea: 'Water cycle', settings: {language: 'en', targetSeconds: 60, voiceCatalogId: null, accentId: null, brandKitRevisionId: null, themeId: 'clean-educational-v1', captionStyleId: 'readable-default-v1'}});
const base = {id: '10000000-0000-4000-8000-000000000001', revision: 1, brief: {idea: input.idea, audience: input.audience, references: input.references}, settings: input.settings} as ProjectDetail;
test('editing requires a safe revision, whole bounded brief/settings and supported patch keys', () => {
  assert.throws(() => parseProjectPatch({patch: {brief: base.brief}}), (e: unknown) => e instanceof ProjectError && e.status === 428);
  for (const revision of [0, -1, 1.2, '1', Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => parseProjectPatch({expectedProjectRevision: revision, patch: {brief: base.brief}}));
  for (const patch of [{}, {brief: {idea: 'Only idea'}}, {displayTitle: ''}, {settings: {...input.settings, captionLanguage: 'te'}}, {brief: {...base.brief, idea: ''}}]) assert.throws(() => parseProjectPatch({expectedProjectRevision: 1, patch}));
  const parsed = parseProjectPatch({expectedProjectRevision: 1, patch: {brief: {...base.brief, idea: '  Changed\r\nidea '}, settings: {...input.settings, language: 'te'}}});
  assert.equal(parsed.patch.brief?.idea, 'Changed\nidea'); assert.equal(parsed.patch.settings?.language, 'te');
});
test('save acknowledgement preserves newer keystrokes and queues only remaining differences', () => {
  assert.equal(sameDraft(base, editable(base)), true, 'Project metadata must not mark an unchanged brief dirty.');
  const submitted = editable(base); submitted.brief.idea = 'Sent';
  const current = editable(submitted); current.brief.idea = 'Typed while saving';
  const saved = {...base, ...submitted, revision: 2};
  assert.equal(acknowledge(current, submitted, saved).brief.idea, 'Typed while saving');
  assert.deepEqual(changes(saved, acknowledge(current, submitted, saved)), {brief: current.brief});
  assert.deepEqual(changes(saved, acknowledge(submitted, submitted, saved)), {});
});
test('tab recovery is scoped, bounded and preserves the exact uncertain command', () => {
  const scope = recoveryKey('workspace', 'user', base.id), draft = editable(base); draft.brief.idea = 'Unsaved';
  const value: Recovery = {version: 1, scope, base, draft, pending: {key: '20000000-0000-4000-8000-000000000001', body: {expectedProjectRevision: 1, patch: changes(base, draft)}, submitted: draft}, review: false};
  assert.deepEqual(readRecovery(JSON.stringify(value), scope, base.id), value);
  assert.equal(readRecovery(JSON.stringify(value), recoveryKey('workspace', 'other-user', base.id), base.id), null);
  assert.equal(readRecovery(JSON.stringify(value), scope, 'different-project'), null);
  assert.equal(readRecovery('{bad', scope, base.id), null);
  assert.equal(readRecovery(JSON.stringify({...value, pending: {...value.pending, body: {expectedProjectRevision: 2, patch: {brief: draft.brief}}}}), scope, base.id), null);
  assert.equal(readRecovery('x'.repeat(1000001), scope, base.id), null);
});
test('conflict envelope returns safe current revision and explicit recovery action', async () => {
  const response = projectErrorResponse(new ProjectError('STALE_REVISION', 409, 'Review changes.', [], false, {currentRevision: 2, updatedAt: '2026-10-20T12:00:00.000Z', updatedBy: {id: null, name: 'Team member'}}));
  const value = await response.json(); assert.equal(response.status, 409); assert.equal(value.error.details.currentRevision, 2); assert.equal(value.error.action, 'reload_and_resolve');
});

test('unfinished offline edits recover before and after autosave captures a pending command', () => {
  const scope = recoveryKey('workspace', 'user', base.id);
  for (const unfinished of ['empty-reference', 'blank-idea', 'blank-audience', 'unfinished-url', 'long-idea', 'incomplete-settings']) {
    const submitted = editable(base);
    submitted.brief.idea = 'Keep this useful unsaved explanation';
    submitted.brief.audience = 'Keep this audience edit too';
    if (unfinished === 'empty-reference') submitted.brief.references.push({referenceId: 'ref_empty', text: '', suppliedUrl: null});
    if (unfinished === 'blank-idea') submitted.brief.idea = '';
    if (unfinished === 'blank-audience') submitted.brief.audience = '';
    if (unfinished === 'unfinished-url') submitted.brief.references.push({referenceId: 'ref_url', text: 'Source', suppliedUrl: 'https://'});
    if (unfinished === 'long-idea') submitted.brief.idea = 'x'.repeat(2001);
    if (unfinished === 'incomplete-settings') submitted.settings.themeId = '';
    const before: Recovery = {version: 1, scope, base, draft: submitted, pending: null, review: false};
    assert.deepEqual(readRecovery(JSON.stringify(before), scope, base.id), before, unfinished);
    const body = {expectedProjectRevision: base.revision, patch: changes(base, submitted)};
    assert.throws(() => parseProjectPatch(body), `Save must still reject ${unfinished}`);
    const later = editable(submitted); later.brief.audience += ' — typed during save';
    const after: Recovery = {...before, draft: later, pending: {key: '20000000-0000-4000-8000-000000000001', body, submitted}};
    assert.deepEqual(readRecovery(JSON.stringify(after), scope, base.id), after, unfinished);
  }
});

test('recovery still rejects malformed pending shapes and commands detached from their submitted input', () => {
  const scope = recoveryKey('workspace', 'user', base.id), draft = editable(base);
  draft.brief.references.push({referenceId: 'ref_empty', text: '', suppliedUrl: null});
  const value: Recovery = {version: 1, scope, base, draft, pending: {key: '20000000-0000-4000-8000-000000000001', body: {expectedProjectRevision: 1, patch: changes(base, draft)}, submitted: draft}, review: false};
  for (const body of [null, [], {expectedProjectRevision: 1, patch: []}, {...value.pending!.body, extra: true}, {expectedProjectRevision: 1, patch: {brief: base.brief}}]) {
    assert.equal(readRecovery(JSON.stringify({...value, pending: {...value.pending, body}}), scope, base.id), null);
  }
  const malformed = structuredClone(value); (malformed.pending!.submitted.settings as unknown) = null;
  assert.equal(readRecovery(JSON.stringify(malformed), scope, base.id), null);
  for (const pending of [false, 0, 'pending', []]) assert.equal(readRecovery(JSON.stringify({...value, pending}), scope, base.id), null);
  const recovered = readRecovery(JSON.stringify(value), scope, base.id)!;
  recovered.draft.brief.references[0].text = 'Completed source text';
  assert.doesNotThrow(() => parseProjectPatch({expectedProjectRevision: recovered.base.revision, patch: changes(recovered.base, recovered.draft)}));
});
