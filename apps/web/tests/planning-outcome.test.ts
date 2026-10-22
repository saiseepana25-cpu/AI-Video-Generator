import {test} from 'node:test';
import assert from 'node:assert/strict';
import {canCorrectPlanningFailure} from '../src/lib/planning-outcome';
test('a refused planning admission unlocks correction, while unknown acceptance retains the original command',()=>{
  for(const code of ['WORKER_UNAVAILABLE','FREE_ALLOWANCE_UNAVAILABLE'])assert.equal(canCorrectPlanningFailure(503,code),true);
  for(const [status,code] of [[401,'AUTHENTICATION_REQUIRED'],[500,'INTERNAL_ERROR'],[503,'DATABASE_UNAVAILABLE'],[504,'WORKER_UNAVAILABLE'],[0,undefined],[503,undefined]] as const)assert.equal(canCorrectPlanningFailure(status,code),false);
  assert.equal(canCorrectPlanningFailure(409,'STALE_REVISION'),true);
});
