import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {parseDeleteInput,deleteQuery} from '../src/server/projects/deletion';
import {recoverDeleteCommand} from '../src/lib/delete-command';
test('deletion requires one canonical positive safe revision and no undocumented acknowledgement bypass',()=>{
  assert.deepEqual(parseDeleteInput(new URLSearchParams('expectedProjectRevision=12')),{expectedProjectRevision:12});
  for(const q of ['expectedProjectRevision=0','expectedProjectRevision=-1','expectedProjectRevision=01','expectedProjectRevision=1.1','expectedProjectRevision=9007199254740992','expectedProjectRevision=1&expectedProjectRevision=2','expectedProjectRevision=1&acknowledgeActiveWork=true'])assert.throws(()=>parseDeleteInput(new URLSearchParams(q)));
  assert.throws(()=>parseDeleteInput(new URLSearchParams()),{status:428});
});
test('queued cancellation requires a complete reviewed acknowledgement and round trips canonically',()=>{
  const input={expectedProjectRevision:3,acknowledgeActiveWork:true as const,expectedWorkRevision:0};assert.deepEqual(parseDeleteInput(deleteQuery(input)),input);
  for(const query of ['expectedProjectRevision=1&expectedWorkRevision=0','expectedProjectRevision=1&acknowledgeActiveWork=false&expectedWorkRevision=0','expectedProjectRevision=1&acknowledgeActiveWork=true&expectedWorkRevision=-1','expectedProjectRevision=1&acknowledgeActiveWork=true&expectedWorkRevision=00','expectedProjectRevision=1&acknowledgeActiveWork=true&expectedWorkRevision=9007199254740992'])assert.throws(()=>parseDeleteInput(new URLSearchParams(query)));
  const command={key:randomUUID(),input};assert.deepEqual(recoverDeleteCommand(JSON.stringify(command)),command);
  for(const bad of [{expectedProjectRevision:1,expectedWorkRevision:0},{expectedProjectRevision:1,acknowledgeActiveWork:false},{...input,expectedWorkRevision:'0'},{...input,expectedWorkRevision:-1}])assert.equal(recoverDeleteCommand(JSON.stringify({...command,input:bad})),null);
});
test('deletion recovery preserves only a complete exact command',()=>{
  const command={key:randomUUID(),input:{expectedProjectRevision:3}};assert.deepEqual(recoverDeleteCommand(JSON.stringify(command)),command);
  for(const value of [{...command,extra:true},{...command,key:'bad'},{...command,input:{expectedProjectRevision:'3'}},{...command,input:{expectedProjectRevision:3,confirmed:true}},{...command,input:null}])assert.equal(recoverDeleteCommand(JSON.stringify(value)),null);
  assert.equal(recoverDeleteCommand('bad'),null);assert.equal(recoverDeleteCommand(' '.repeat(501)),null);
});
