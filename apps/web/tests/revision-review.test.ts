import {test} from 'node:test';
import assert from 'node:assert/strict';
import {compareRevision} from '../src/server/planning/revision-review';
import {renderFixture} from './fixtures/rendering';
test('revision comparison separates diagram edits from exact narration and matching subtitle changes',()=>{
  const f=renderFixture();assert.equal(compareRevision(f.proposal,f.settings,f.plan).hasChanges,false);
  const edited=structuredClone(f.proposal);edited.scenes[0].labels=['Ocean','River'];
  let result=compareRevision(edited,f.settings,f.plan);assert.deepEqual(result.scenes,[{sceneId:'scene_1',added:false,removed:false,narrationChanged:false,headingChanged:false,diagramChanged:true}]);
  edited.scenes[1].narration+='\nClouds form.';result=compareRevision(edited,f.settings,f.plan);
  assert.equal(result.scenes[1].narrationChanged,true);assert.equal(result.scenes[1].diagramChanged,false);
  assert.equal(result.hasChanges,true);
});
test('revision comparison detects settings, title, sequence and added/removed scenes without exposing voice IDs',()=>{
  const f=renderFixture('te'),edited=structuredClone(f.proposal);edited.scenes.reverse();edited.title+=' కొత్త';
  const result=compareRevision(edited,{...f.settings,accentId:'indian',voiceCatalogId:'other'},f.plan);
  assert.deepEqual(result.settingsChanged,['voiceCatalogId','accentId']);assert.equal(result.sceneOrderChanged,true);assert.equal(result.titleChanged,true);assert.equal(result.scenes.length,0);
  edited.scenes[0].sceneId='scene_4';const changes=compareRevision(edited,f.settings,f.plan).scenes;
  assert.equal(changes.find(s=>s.sceneId==='scene_3')!.removed,true);assert.equal(changes.find(s=>s.sceneId==='scene_4')!.added,true);
  assert.equal(JSON.stringify(result).includes(f.plan.settingsSnapshot.speech.voiceId),false);
});
