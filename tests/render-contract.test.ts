import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildRenderPlan, validateRenderPlan, generationHash} from '../src/pipeline/render-contract';
import {renderFixture, pins} from '../apps/web/tests/fixtures/rendering';
test('isolated prototype adapter shares the exact selected-language contract without changing bilingual v1', () => {
  for (const language of ['en', 'te'] as const) {
    const {proposal, settings, brief, plan} = renderFixture(language);
    assert.deepEqual(buildRenderPlan(proposal, brief, settings, pins), plan);
    assert.deepEqual(validateRenderPlan(plan), plan); assert.match(generationHash(plan), /^[a-f0-9]{64}$/);
  }
});
