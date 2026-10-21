import type {Plan} from '../apps/web/src/server/planning/contracts';
import type {ProjectSettings} from '../apps/web/src/server/projects/contracts';
export function selectedFixture(language: 'en' | 'te') {
  const en = language === 'en';
  const text = en ? ['Sunlight warms water. Some water becomes water vapour.', 'Water vapour forms clouds. Rain brings water back to the ground.', 'Liquid water flows. Water vapour is an invisible gas.'] : ['సూర్యుని వేడితో నీరు ఆవిరిగా మారుతుంది.', 'నీరు ఆవిరిగా మారి మేఘాలను చేరుతుంది. వర్షం నీటిని భూమికి చేరుస్తుంది.', 'నీరు ద్రవ రూపంలో ప్రవహిస్తుంది. నీటి ఆవిరి వాయు రూపంలో ఉంటుంది.'];
  const headings = en ? ['From water to vapour', 'The water cycle', 'Two forms of water'] : ['నీటి నుండి ఆవిరి', 'నీటి చక్రం', 'నీటి రెండు రూపాలు'];
  const labels = en ? [['Sunlight', 'Warm water', 'Water vapour'], ['Water', 'Vapour', 'Clouds', 'Rain'], ['Liquid water', 'Water vapour']] : [['సూర్యరశ్మి', 'వేడి నీరు', 'నీటి ఆవిరి'], ['నీరు', 'ఆవిరి', 'మేఘాలు', 'వర్షం'], ['ద్రవ నీరు', 'నీటి ఆవిరి']];
  const proposal: Plan = {schemaVersion: 2, language, targetSeconds: 30, title: en ? 'How water moves' : 'నీటి ప్రయాణం', learningObjective: en ? 'Explain evaporation and the water cycle.' : 'నీరు ప్రకృతిలో ఎలా ప్రయాణిస్తుందో వివరించండి.',
    scenes: text.map((narration, i) => ({sceneId: `scene_${i + 1}`, heading: headings[i], narration, labels: labels[i], layout: (['sequence', 'cycle', 'comparison'] as const)[i]})),
    captions: text.map((value, i) => ({captionId: `caption_scene_${i + 1}`, sourceSegmentId: `scene_${i + 1}`, text: value})), reviewNotes: ['Curated diagnostic fixture. Review facts and Telugu wording before production.']};
  const settings: ProjectSettings = {language, targetSeconds: 30, accentId: 'source-voice', voiceCatalogId: 'alice-evaluation', brandKitRevisionId: null, themeId: 'clean-educational-v1', captionStyleId: 'readable-default-v1'};
  return {proposal, settings, brief: {audience: 'Beginners', references: []}};
}
