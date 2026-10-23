import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseDisplayTitle,parseProjectPatch} from '../src/server/projects/validation';
import {recoverRenameCommand} from '../src/lib/rename-command';
test('rename validates graphemes, NFC, single-line plain text and strict patch shape',()=>{
  assert.equal(parseDisplayTitle('  నీటి ప్రయాణం 🌧️  '),'నీటి ప్రయాణం 🌧️');
  assert.equal(parseDisplayTitle('Cafe\u0301'),'Café');
  assert.equal(parseDisplayTitle('🌧️'.repeat(120)),'🌧️'.repeat(120));
  for(const title of [null,12,'','   ','x'.repeat(121),'🌧️'.repeat(121),'Two\nlines','Tab\tname','Two\u2028lines','<b>Title</b>','Bad\u0000','Bad\ud800'])assert.throws(()=>parseDisplayTitle(title));
  assert.deepEqual(parseProjectPatch({expectedProjectRevision:2,patch:{displayTitle:'  New title  '}}),{expectedProjectRevision:2,patch:{displayTitle:'New title'}});
  assert.throws(()=>parseProjectPatch({expectedProjectRevision:2,patch:{displayTitle:'Valid',searchTitle:'injected'}}));
});
test('rename recovery retains exact command identity and rejects unrelated mutations',()=>{
  const command={key:'20000000-0000-4000-8000-000000000001',body:{expectedProjectRevision:3,patch:{displayTitle:'Rain in Telugu'}}};
  assert.deepEqual(recoverRenameCommand(JSON.stringify(command)),command);
  for(const value of [{...command,extra:true},{...command,key:'bad'},{...command,body:{...command.body,patch:{displayTitle:''}}},{...command,body:{...command.body,patch:{displayTitle:'Title',brief:{idea:'Other'}}}},{...command,body:{...command.body,expectedProjectRevision:0}}])assert.equal(recoverRenameCommand(JSON.stringify(value)),null);
  assert.equal(recoverRenameCommand('{bad'),null);assert.equal(recoverRenameCommand('x'.repeat(16001)),null);
});
