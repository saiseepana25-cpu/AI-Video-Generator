import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PlanningGateway, PlanningFault} from '../src/server/planning/gateway';
import {planningPrompt, revisionInput, validateOutput} from '../src/server/planning/validation';
import type {Job} from '../src/server/planning/contracts';
import {parseProjectPatch} from '../src/server/projects/validation';
import {editable, readRecovery, recoveryKey, type Recovery} from '../src/lib/project-draft';
import type {ProjectDetail} from '../src/server/projects/contracts';

export const planningInput: Job['input'] = {brief: {idea: 'Explain the water cycle.', audience: 'School students', references: []}, settings: {
  language: 'en', targetSeconds: 30, voiceCatalogId: null, accentId: null, brandKitRevisionId: null, themeId: 'clean-educational-v1', captionStyleId: 'readable-default-v1'}};
export const planOutput = () => ({title: 'The water cycle', learningObjective: 'Explain how water moves.', scenes: ['Evaporation', 'Condensation', 'Rain'].map(heading => ({heading, narration: `Water moves through ${heading.toLowerCase()}.`, labels: ['Water', 'Movement'], layout: 'sequence'}))});
test('planning revisions are mandatory, safe and reject hidden conversation/client model fields', () => {
  assert.equal(revisionInput({expectedProjectRevision: 1}), 1);
  for (const value of [{}, null, [], {expectedProjectRevision: 0}, {expectedProjectRevision: 1, model: 'paid'}, {expectedProjectRevision: 1, conversationThroughSequence: 1}]) assert.throws(() => revisionInput(value));
});
test('structured plans derive exact matching captions and reject code, wrong language and malformed diagrams', () => {
  const plan = validateOutput(planOutput(), planningInput, 'plan'); assert.ok('scenes' in plan);
  assert.deepEqual(plan.captions.map(c => c.text), plan.scenes.map(s => s.narration));
  assert.equal(plan.language, 'en');
  for (const mutate of [(p: ReturnType<typeof planOutput>) => {p.scenes[0].narration = '<script>bad</script>';}, (p: ReturnType<typeof planOutput>) => {p.scenes[0].labels = [];}, (p: ReturnType<typeof planOutput>) => {p.scenes[0].layout = 'arbitrary_html';}]) {
    const p = planOutput(); mutate(p); assert.throws(() => validateOutput(p, planningInput, 'plan'));
  }
  assert.throws(() => validateOutput(planOutput(), {...planningInput, settings: {...planningInput.settings, language: 'te'}}, 'plan'));
  assert.throws(() => validateOutput({...planOutput(), executable: 'code'}, planningInput, 'plan'));
  const mixed = {angles: [1, 2, 3].map(i => ({title: `నీటి చక్రం ${i}`, hook: 'బాष्పీభవనం', learningObjective: 'నీరు నేర్చుకోండి'}))};
  assert.throws(() => validateOutput(mixed, {...planningInput, settings: {...planningInput.settings, language: 'te'}}, 'brainstorm'));
  assert.throws(() => planningPrompt({...planningInput, brief: {...planningInput.brief, references: [{referenceId: 'ref', text: 'a'.repeat(25000), suppliedUrl: null}]}}, 'plan'));
});
test('brainstorming requires exactly three distinct alternatives with server-owned IDs', () => {
  const raw = {angles: [1, 2, 3].map(i => ({title: `Angle ${i}`, hook: 'A clear hook', learningObjective: 'Explain a concept'}))};
  const result = validateOutput(raw, planningInput, 'brainstorm'); assert.ok('angles' in result); assert.equal(result.angles[0].id, 'angle_1');
  assert.throws(() => validateOutput({angles: raw.angles.slice(1)}, planningInput, 'brainstorm'));
  assert.throws(() => validateOutput({angles: [raw.angles[0], raw.angles[0], raw.angles[0]]}, planningInput, 'brainstorm'));
});
test('gateway uses bounded structured output with no tools, redirects, automatic retries or raw error exposure', async () => {
  const env = {GEMINI_API_KEY: 'test-private-key', GEMINI_FREE_TIER_CONFIRMED: 'true'}; let calls = 0;
  const request: typeof fetch = async (url, init) => {
    calls++; assert.equal(String(url), 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent');
    const body = JSON.parse(init!.body as string); assert.equal(body.generationConfig.maxOutputTokens, 8192); assert.ok(body.generationConfig.responseJsonSchema); assert.equal(body.tools, undefined); assert.equal(init?.redirect, 'error');
    return Response.json({candidates: [{finishReason: 'STOP', content: {parts: [{text: JSON.stringify(planOutput())}]}}]});
  };
  assert.deepEqual(await new PlanningGateway(env, request).generate(planningInput, 'plan', new AbortController().signal), planOutput()); assert.equal(calls, 1);
  await assert.rejects(new PlanningGateway({}, request).generate(planningInput, 'plan', new AbortController().signal), /FREE_ACCESS_UNVERIFIED/); assert.equal(calls, 1);
  await assert.rejects(new PlanningGateway(env, async () => {throw new Error('secret provider internals');}).generate(planningInput, 'plan', new AbortController().signal), e => e instanceof PlanningFault && e.uncertain && !e.message.includes('secret'));
  await assert.rejects(new PlanningGateway(env, async () => new Response('private', {status: 429})).generate(planningInput, 'plan', new AbortController().signal), e => e instanceof PlanningFault && !e.uncertain && e.retryable);
});
test('selected-angle pending commands recover alongside unfinished later edits', () => {
  const base = {id: '10000000-0000-4000-8000-000000000001', revision: 1, brief: planningInput.brief, settings: planningInput.settings} as ProjectDetail;
  const submitted = editable(base); submitted.brief.idea = 'Selected idea';
  const patch = {brief: submitted.brief, brainstormSelection: {jobId: '20000000-0000-4000-8000-000000000001', angleId: 'angle_1'}};
  assert.doesNotThrow(() => parseProjectPatch({expectedProjectRevision: 1, patch}));
  const draft = editable(submitted); draft.brief.references.push({referenceId: 'ref_unfinished', text: '', suppliedUrl: null});
  const scope = recoveryKey('workspace', 'user', base.id);
  const recovery: Recovery = {version: 1, scope, base, draft, pending: {key: '30000000-0000-4000-8000-000000000001', body: {expectedProjectRevision: 1, patch}, submitted}, review: false};
  assert.deepEqual(readRecovery(JSON.stringify(recovery), scope, base.id), recovery);
});
