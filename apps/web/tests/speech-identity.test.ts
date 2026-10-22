import {test} from 'node:test';
import assert from 'node:assert/strict';
import {speechIdentity} from '../src/server/generation/speech-identity';
import {renderFixture} from './fixtures/rendering';
test('speech identity permits visual edits but isolates exact words, voice, settings, language and workspace/project',()=>{
  const plan=renderFixture().plan,segment=plan.narration[0].segmentId,identity=speechIdentity('workspace','project',plan,segment);
  const visual=structuredClone(plan);visual.scenes[0].props.heading='Updated heading';visual.scenes[0].props.nodes.reverse();
  assert.equal(speechIdentity('workspace','project',visual,segment),identity);
  for(const change of [(p:typeof plan)=>{p.narration[0].text+='\nMore words.';},(p:typeof plan)=>{p.settingsSnapshot.speech.settings.speed=.9;},(p:typeof plan)=>{p.settingsSnapshot.speech.voiceId='other';},(p:typeof plan)=>{p.settingsSnapshot.speech.adapterVersion='other';},(p:typeof plan)=>{p.settingsSnapshot.policyVersion='other';},(p:typeof plan)=>{p.language='te';}]){
    const edited=structuredClone(plan);change(edited);assert.notEqual(speechIdentity('workspace','project',edited,segment),identity);
  }
  assert.notEqual(speechIdentity('other','project',plan,segment),identity);assert.notEqual(speechIdentity('workspace','other',plan,segment),identity);
  const accent=structuredClone(plan);accent.settingsSnapshot.accentId='different';assert.notEqual(speechIdentity('workspace','project',accent,segment),identity);
});
