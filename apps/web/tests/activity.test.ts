import {test} from 'node:test';
import assert from 'node:assert/strict';
import {activityQuery,activityCursor,readActivityCursor,readThroughBody} from '../src/server/activity/query';
import {recoveryMessage} from '../src/server/activity/operations';
const ws='10000000-0000-4000-8000-000000000001',user='0123456789abcdef01234567',secret='activity-test-secret';
test('activity query rejects unknown, duplicate, oversized and unsupported filters',()=>{
  assert.equal(activityQuery(new URLSearchParams()).limit,20);
  for(const query of ['limit=0','limit=51','limit=1&limit=2','offset=10','types=unknown','types=project_created,project_created','types=','projectId=bad','cursor='])assert.throws(()=>activityQuery(new URLSearchParams(query)));
  assert.deepEqual(activityQuery(new URLSearchParams('types=project_updated,project_created')).types,['project_created','project_updated']);
});
test('activity cursors bind scope, member, filters, size, expiry and snapshot high water',()=>{
  const q=activityQuery(new URLSearchParams('limit=2')),now=100000,token=activityCursor(q,ws,user,3,5,secret,now);
  assert.deepEqual(readActivityCursor(token,q,ws,user,secret,now),{before:3,upper:5});
  for(const run of [()=>readActivityCursor(token,q,ws,'other',secret,now),()=>readActivityCursor(token,q,'other',user,secret,now),()=>readActivityCursor(token,{...q,limit:3},ws,user,secret,now),()=>readActivityCursor(token,{...q,types:['project_created']},ws,user,secret,now),()=>readActivityCursor(token,q,ws,user,secret,now+3600000),()=>readActivityCursor(token,q,ws,user,'other',now),()=>readActivityCursor(token+'x',q,ws,user,secret,now)])assert.throws(run);
});
test('read acknowledgement is a bounded explicit sequence, not arbitrary member data',()=>{
  assert.equal(readThroughBody({throughSequence:0}),0);assert.equal(readThroughBody({throughSequence:42}),42);
  for(const value of [null,[],{}, {throughSequence:-1},{throughSequence:'2'},{throughSequence:1.5},{throughSequence:Number.MAX_SAFE_INTEGER+1},{throughSequence:2,preferences:{}}])assert.throws(()=>readThroughBody(value));
});
test('recovery messages never echo unknown provider diagnostics or offer blind retries',()=>{
  assert.match(recoveryMessage('generation','NARRATION_DURATION_EXCEEDED'),/new plan version/);
  assert.match(recoveryMessage('generation','TEXT_LAYOUT_EXCEEDED'),/Shorten narration/);
  assert.match(recoveryMessage('generation','LAYOUT_CHECK_UNAVAILABLE'),/No speech was requested/);
  assert.match(recoveryMessage('generation','SPEECH_OUTCOME_UNKNOWN'),/do not repeat/i);
  assert.match(recoveryMessage('generation',null,true),/confirm that it has stopped/);
  assert.match(recoveryMessage('storage','raw secret'),/must not regenerate/);
  assert.ok(!recoveryMessage('planning','raw secret').includes('raw secret'));
});
