import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildRenderPlan, canonicalJson, generationHash, validateRenderPlan} from '../src/server/rendering/contract';
import {loadFontPins} from '../src/server/rendering/assets';
import {pins, renderFixture} from './fixtures/rendering';
import {applyTextEdits, parseTextEdits} from '../src/server/planning/text-edits';
import {initialBrand,contrast} from '../src/server/brand/palette';
import {randomUUID} from 'node:crypto';
import {speechIdentity} from '../src/server/generation/speech-identity';

test('brand snapshots round-trip English/Telugu, pin exact colors and change approval hash without changing speech identity',()=>{
  for(const language of ['en','te'] as const){
    const f=renderFixture(language),id=randomUUID(),brand={...initialBrand,revisionId:id,backgroundColor:'#F5F3EB',primaryColor:'#3660D9',secondaryColor:'#173342'};
    const plan=buildRenderPlan(f.proposal,f.brief,{...f.settings,brandKitRevisionId:id},pins,brand);
    assert.deepEqual(validateRenderPlan(plan),plan);assert.notEqual(generationHash(plan),generationHash(f.plan));
    assert.deepEqual(plan.settingsSnapshot.brand.colors,{canvas:brand.backgroundColor,surface:brand.backgroundColor,text:'#000000',accent:brand.primaryColor,secondary:brand.secondaryColor});
    assert.ok(contrast(plan.settingsSnapshot.brand.colors.text,brand.backgroundColor)>=4.5);
    assert.equal(speechIdentity('workspace','project',plan,'segment_scene_1'),speechIdentity('workspace','project',f.plan,'segment_scene_1'));
    const changed=buildRenderPlan(f.proposal,f.brief,{...f.settings,brandKitRevisionId:id},pins,{...brand,primaryColor:'#173342'});
    assert.notEqual(generationHash(changed),generationHash(plan));
    for(const change of [(p:typeof plan)=>{p.settingsSnapshot.brand.colors.text='#FFFFFF';},(p:typeof plan)=>{p.settingsSnapshot.brand.colors.surface='#FFFFFF';},(p:typeof plan)=>{p.settingsSnapshot.brand.colors.accent=brand.backgroundColor;},(p:typeof plan)=>{p.settingsSnapshot.brand.revisionId=null;},(p:typeof plan)=>{p.settingsSnapshot.brand.fonts[1].id='external-font';}]){const invalid=structuredClone(plan);change(invalid);assert.throws(()=>validateRenderPlan(invalid));}
    assert.throws(()=>buildRenderPlan(f.proposal,f.brief,{...f.settings,brandKitRevisionId:id},pins));
    assert.throws(()=>buildRenderPlan(f.proposal,f.brief,f.settings,pins,brand));
    assert.throws(()=>buildRenderPlan(f.proposal,f.brief,{...f.settings,brandKitRevisionId:randomUUID()},pins,brand));
  }
});

test('editor-supported narration whitespace compiles with exact matching captions in both languages', () => {
  for (const language of ['en', 'te'] as const) {
    const {proposal, settings, brief} = renderFixture(language);
    const input = language === 'en' ? 'Water rises.\r\n\tClouds form.\rRain falls.' : 'నీరు ఆవిరవుతుంది.\r\n\tమేఘాలు ఏర్పడతాయి.\rవర్షం కురుస్తుంది.';
    const edited = applyTextEdits(proposal, parseTextEdits({expectedProjectRevision: 1, edits: {narration: [{segmentId: 'scene_1', text: input}]}}));
    const plan = buildRenderPlan(edited, brief, settings, pins), expected = input.replace(/\r\n?/g, '\n');
    assert.equal(plan.narration[0].text, expected); assert.equal(plan.captions[0].text, expected);
    const unnormalized = structuredClone(edited); unnormalized.scenes[0].narration = unnormalized.captions[0].text = input;
    assert.deepEqual(buildRenderPlan(unnormalized, brief, settings, pins), plan);
    assert.deepEqual(validateRenderPlan(plan), plan); assert.match(generationHash(plan), /^[a-f0-9]{64}$/);
    const mismatched = structuredClone(edited); mismatched.captions[0].text = expected.replace('\n\t', ' ');
    assert.throws(() => buildRenderPlan(mismatched, brief, settings, pins), /exactly match/);
  }
});
test('narration formatting does not relax heading/label restrictions or allow unsafe narration characters', () => {
  const {proposal, settings, brief} = renderFixture();
  for (const whitespace of ['\n', '\t', '\r\n', '\r']) {
    const heading = structuredClone(proposal); heading.scenes[0].heading = `Water${whitespace}rises`;
    assert.throws(() => buildRenderPlan(heading, brief, settings, pins));
    const label = structuredClone(proposal); label.scenes[0].labels[0] = `Water${whitespace}rises`;
    assert.throws(() => buildRenderPlan(label, brief, settings, pins));
  }
  for (const character of ['\u0000', '\u0008', '\u000b', '\u000c', '\u000e', '\u001f', '\u007f', '\ud800', '\udfff', '<', '>']) {
    const invalid = structuredClone(proposal); invalid.scenes[0].narration = invalid.captions[0].text = `Water${character}rises.`;
    assert.throws(() => buildRenderPlan(invalid, brief, settings, pins));
  }
});

test('English and Telugu compile into exact same-language narration/captions, stable IDs and trusted phrase anchors', () => {
  for (const language of ['en', 'te'] as const) {
    const {plan, proposal} = renderFixture(language);
    assert.deepEqual(validateRenderPlan(plan), plan); assert.equal(plan.settingsSnapshot.captionLanguage, language);
    assert.deepEqual(plan.narration.map(n => n.text), proposal.scenes.map(s => s.narration));
    assert.deepEqual(plan.captions.map(c => c.text), plan.narration.map(n => n.text));
    assert.deepEqual(plan.scenes.map(s => s.templateId), ['diagram.sequence', 'diagram.cycle', 'diagram.comparison']);
    assert.deepEqual(plan.scenes.flatMap(s => s.segmentIds), plan.narration.map(n => n.segmentId));
    assert.ok(plan.scenes.every(s => s.events.every(e => e.offsetMs === 0 && ['phrase_start', 'phrase_end'].includes(e.anchor))));
    assert.equal(plan.settingsSnapshot.timing.finalFrames, 'measured-audio-required'); assert.equal(plan.settingsSnapshot.usagePolicy, 'evaluation_only');
    assert.equal(plan.suppliedReferences[0].text, 'Supplied notes\nSecond line');
  }
});
test('canonical hash is deterministic across object construction order, NFC/LF normalization, and changes with video meaning/pins', () => {
  const {plan} = renderFixture(), digest = generationHash(plan);
  const reorder = (v: unknown): unknown => Array.isArray(v) ? v.map(reorder) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).reverse().map(([k, item]) => [k, reorder(item)])) : v;
  assert.equal(generationHash(reorder(plan)), digest); assert.equal(generationHash(structuredClone(plan)), digest);
  assert.equal(canonicalJson({text: 'cafe\u0301\r\nnext'}), canonicalJson({text: 'café\nnext'}));
  for (const change of [(p: typeof plan) => {p.title = 'Rivers';}, (p: typeof plan) => {p.scenes[0].props.nodes[0].label = 'Cloud';}, (p: typeof plan) => {p.settingsSnapshot.brand.fonts[0].sha256 = 'd'.repeat(64);}, (p: typeof plan) => {p.narration[0].text = p.captions[0].text = 'Rain moves into rivers.';}, (p: typeof plan) => {p.suppliedReferences[0].text = 'New source notes';}]) {
    const changed = structuredClone(plan); change(changed); assert.notEqual(generationHash(changed), digest);
  }
  assert.throws(() => canonicalJson({x: undefined})); assert.throws(() => canonicalJson({x: Infinity})); assert.throws(() => canonicalJson(new Date()));
  assert.throws(() => canonicalJson(new Array(2)));
});
test('execution contract refuses arbitrary fields, code/URLs, duplicate IDs, missing/extra coverage, word anchors and unreviewed settings', () => {
  const {plan} = renderFixture();
  const changes: ((p: any) => void)[] = [p => {p.html = '<script />';}, p => {p.scenes[0].props.svg = '<svg />';}, p => {p.scenes[0].templateId = 'external-template';}, p => {p.scenes[0].templateVersion = '999';},
    p => {p.scenes[1].sceneId = p.scenes[0].sceneId;}, p => {p.narration.push(p.narration[0]);}, p => {p.narration.pop();}, p => {p.captions.pop();}, p => {p.captions[0].text = 'Different words';},
    p => {p.scenes[0].events[0].anchor = {word: 'water', occurrence: 1};}, p => {p.scenes[0].events[0].offsetMs = 500;}, p => {p.scenes[0].events[0].action = 'fetch';}, p => {p.scenes[0].events[0].segmentId = 'missing';},
    p => {p.scenes[0].props.nodes[0].nodeId = 'missing';}, p => {p.settingsSnapshot.speech.voiceId = 'unreviewed';}, p => {p.settingsSnapshot.speech.settings.speed = 2;}, p => {p.settingsSnapshot.output.fps = 60;}, p => {p.settingsSnapshot.brand.logoAsset = 'https://example.com/logo';},
    p => {p.settingsSnapshot.captionLanguage = 'te';}, p => {p.settingsSnapshot.usagePolicy = 'publication_permitted';}, p => {p.settingsSnapshot.rendererContractVersion = 'other';}, p => {p.settingsSnapshot.brand.fonts[0].sha256 = 'bad';}, p => {p.settingsSnapshot.brand.fonts.reverse();}];
  for (const change of changes) {const invalid = structuredClone(plan); change(invalid); assert.throws(() => validateRenderPlan(invalid));}
});
test('staged compiler does not silently repair captions, default voices, unsupported brands/languages or malformed source data', () => {
  const {proposal, settings, brief} = renderFixture();
  for (const selection of [{...settings, voiceCatalogId: null}, {...settings, accentId: null}, {...settings, voiceCatalogId: 'madhavi'}, {...settings, accentId: 'en-IN'}, {...settings, brandKitRevisionId: 'id'}, {...settings, targetSeconds: 60 as const}]) assert.throws(() => buildRenderPlan(proposal, brief, selection, pins));
  const bad = structuredClone(proposal); bad.captions[0].text = 'Mismatching caption'; assert.throws(() => buildRenderPlan(bad, brief, settings, pins));
  assert.throws(() => buildRenderPlan(proposal, {...brief, references: [{...brief.references[0], suppliedUrl: 'https://user:pass@example.com'}]}, settings, pins));
  assert.throws(() => buildRenderPlan(proposal, {...brief, references: [...brief.references, brief.references[0]]}, settings, pins));
  const numeric = renderFixture('te'); numeric.proposal.scenes[0].labels = ['1', '2']; assert.doesNotThrow(() => buildRenderPlan(numeric.proposal, numeric.brief, numeric.settings, pins));
});
test('font pins come from installed local bytes and remain deterministic', async () => {
  const first = await loadFontPins(); assert.deepEqual(await loadFontPins(), first);
  assert.ok(Object.values(first).every(v => /^[a-f0-9]{64}$/.test(v))); assert.equal(new Set(Object.values(first)).size, 3);
});
