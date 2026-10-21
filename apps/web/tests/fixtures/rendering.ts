import type {Plan} from '../../src/server/planning/contracts';
import type {ProjectSettings} from '../../src/server/projects/contracts';
import {buildRenderPlan} from '../../src/server/rendering/contract';
export const pins = {heading: 'a'.repeat(64), body: 'b'.repeat(64), telugu: 'c'.repeat(64)};
export function renderFixture(language: 'en' | 'te' = 'en') {
  const settings: ProjectSettings = {language, targetSeconds: 30, voiceCatalogId: 'alice-evaluation', accentId: 'source-voice', brandKitRevisionId: null, themeId: 'clean-educational-v1', captionStyleId: 'readable-default-v1'};
  const narration = language === 'en' ? 'Water moves into rivers.' : 'నీరు నదులలోకి ప్రవహిస్తుంది.';
  const proposal: Plan = {schemaVersion: 2, title: language === 'en' ? 'Water' : 'నీరు', learningObjective: narration, language, targetSeconds: 30,
    scenes: [1, 2, 3].map((i) => ({sceneId: `scene_${i}`, heading: language === 'en' ? 'Water' : 'నీరు', narration, labels: language === 'en' ? ['Rain', 'River'] : ['వర్షం', 'నది'], layout: (['sequence', 'cycle', 'comparison'] as const)[i - 1]})),
    captions: [1, 2, 3].map(i => ({captionId: `caption_scene_${i}`, sourceSegmentId: `scene_${i}`, text: narration})), reviewNotes: ['Review facts before generating.']};
  const brief = {audience: 'Beginners', references: [{referenceId: 'ref_1', text: 'Supplied notes\nSecond line', suppliedUrl: 'https://example.com/source'}]};
  return {proposal, settings, brief, plan: buildRenderPlan(proposal, brief, settings, pins)};
}
