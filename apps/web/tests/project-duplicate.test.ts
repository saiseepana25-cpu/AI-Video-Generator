import {test} from 'node:test';
import assert from 'node:assert/strict';
import {defaultDuplicateTitle,graphemes,parseDuplicateInput} from '../src/server/projects/validation';
import {recoverDuplicateCommand} from '../src/lib/duplicate-command';
test('duplicate input is strict, revision checked, normalized and does not accept inherited operations',()=>{
  assert.deepEqual(parseDuplicateInput({expectedProjectRevision:2}),{expectedProjectRevision:2});
  assert.deepEqual(parseDuplicateInput({expectedProjectRevision:2,displayTitle:'  నీటి ప్రయాణం  '}),{expectedProjectRevision:2,displayTitle:'నీటి ప్రయాణం'});
  for(const input of [{},{expectedProjectRevision:0},{expectedProjectRevision:1.5},{expectedProjectRevision:'2'},{expectedProjectRevision:1,displayTitle:''},{expectedProjectRevision:1,displayTitle:'<b>bad</b>'},{expectedProjectRevision:1,copyApprovals:true},{expectedProjectRevision:1,settings:{}}])assert.throws(()=>parseDuplicateInput(input));
});
test('default copy titles fit grapheme bounds and tolerate legacy multiline titles',()=>{
  assert.equal(defaultDuplicateTitle('Rain'),'Copy of Rain');
  assert.equal(graphemes(defaultDuplicateTitle('🌧️'.repeat(120))).length,120);
  assert.equal(defaultDuplicateTitle('Old\nTitle <test>'),'Copy of Old Title test');
});
test('duplicate recovery preserves exact key/body and refuses malformed or unrelated commands',()=>{
  const command={key:'20000000-0000-4000-8000-000000000001',body:{expectedProjectRevision:4,displayTitle:'Copy of Rain'}};
  assert.deepEqual(recoverDuplicateCommand(JSON.stringify(command)),command);
  assert.deepEqual(recoverDuplicateCommand(JSON.stringify({...command,body:{expectedProjectRevision:4}})),{...command,body:{expectedProjectRevision:4}});
  for(const value of [{...command,extra:true},{...command,key:'bad'},{...command,body:{expectedProjectRevision:0}},{...command,body:{expectedProjectRevision:4,patch:{displayTitle:'Other'}}}])assert.equal(recoverDuplicateCommand(JSON.stringify(value)),null);
  assert.equal(recoverDuplicateCommand('{bad'),null);assert.equal(recoverDuplicateCommand('x'.repeat(16001)),null);
});
