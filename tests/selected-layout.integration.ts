import {test} from 'node:test';
import assert from 'node:assert/strict';
import {selectedFixture} from '../fixtures/selected-diagrams';
import {buildRenderPlan, generationHash} from '../src/pipeline/render-contract';
import {selectedFontAssets, selectedRendererBuildHash} from '../src/pipeline/selected-renderer';
import {preflightSelectedLayout} from '../src/pipeline/layout-preflight';
import {LiveGenerationEngine} from '../src/pipeline/generation-engine';
import {GenerationFault} from '../apps/web/src/server/generation/engine';

// Explicit local-browser suite, excluded from the fast *.test.ts suite.
// No credentials, provider calls, speech, database, R2 or video frames.
for (const language of ['en','te'] as const) {
  test(`actual pinned fonts accept ${language} text and refuse overflowing captions before speech`,async()=>{
    const root=process.cwd(),{pins}=await selectedFontAssets(root),fixture=selectedFixture(language);
    const plan=buildRenderPlan(fixture.proposal,fixture.brief,fixture.settings,pins),hash=generationHash(plan);
    const result=await preflightSelectedLayout({root,plan,expectedHash:hash,signal:new AbortController().signal});
    assert.equal(result.rendererBuildHash,await selectedRendererBuildHash(root,pins));assert.equal(generationHash(plan),hash);
    const overflow=language==='en'
      ? 'Sunlight warms rivers, lakes, and oceans. Some liquid water becomes invisible water vapour and rises into the air.'
      : 'సూర్యుని వేడితో నీరు ఆవిరిగా మారుతుంది. '.repeat(8).trim();
    fixture.proposal.scenes[0].narration=fixture.proposal.captions[0].text=overflow;
    const bad=buildRenderPlan(fixture.proposal,fixture.brief,fixture.settings,pins);
    const engine=new LiveGenerationEngine(root,{});
    await assert.rejects(engine.preflight(bad,generationHash(bad),new AbortController().signal),e=>e instanceof GenerationFault&&e.code==='TEXT_LAYOUT_EXCEEDED'&&!e.unknown);
  });
}
