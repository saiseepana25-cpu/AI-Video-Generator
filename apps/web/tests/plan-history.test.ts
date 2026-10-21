import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {historyCursor, historyQuery, readHistoryCursor} from '../src/server/planning/history-cursor';
import {parseRestoreInput, recoverRestore} from '../src/lib/plan-restore';

test('plan history only accepts bounded unambiguous supported queries', () => {
  assert.deepEqual(historyQuery(new URLSearchParams('kind=plan')), {limit: 10, cursor: null});
  for (const query of ['', 'kind=video', 'kind=plan&kind=plan', 'kind=plan&limit=0', 'kind=plan&limit=51', 'kind=plan&limit=1.5', 'kind=plan&cursor=', 'kind=plan&sort=asc']) assert.throws(() => historyQuery(new URLSearchParams(query)));
});
test('history cursor binds workspace, project, kind, limit and expiry and rejects tampering', () => {
  const workspace = randomUUID(), project = randomUUID(), secret = 'history-test-secret', now = Date.now();
  const token = historyCursor(workspace, project, 10, 4, secret, now);
  assert.equal(readHistoryCursor(token, workspace, project, 10, secret, now), 4);
  for (const args of [[token, randomUUID(), project, 10, secret, now], [token, workspace, randomUUID(), 10, secret, now], [token, workspace, project, 5, secret, now], [token, workspace, project, 10, 'wrong', now], [token, workspace, project, 10, secret, now + 3600000], [token + 'a', workspace, project, 10, secret, now]] as const) assert.throws(() => readHistoryCursor(args[0], args[1], args[2], args[3], args[4], args[5]));
});
test('restore recovery preserves the exact reviewed command and refuses malformed commands', () => {
  const command = {key: randomUUID(), sourceId: randomUUID(), body: {expectedProjectRevision: 2, expectedCurrentPlanVersionId: randomUUID()}};
  assert.deepEqual(recoverRestore(JSON.stringify(command)), command);
  for (const body of [{}, {...command.body, expectedProjectRevision: 0}, {...command.body, expectedProjectRevision: 1.5}, {...command.body, expectedCurrentPlanVersionId: 'bad'}, {...command.body, extra: true}, null]) assert.equal(parseRestoreInput(body), null);
  assert.equal(recoverRestore('invalid'), null); assert.equal(recoverRestore('x'.repeat(2001)), null);
  assert.equal(recoverRestore(JSON.stringify({...command, key: 'invalid'})), null);
  assert.equal(parseRestoreInput({...command.body, expectedCurrentPlanVersionId: [command.body.expectedCurrentPlanVersionId]}), null);
  assert.equal(recoverRestore(JSON.stringify({...command, key: [command.key]})), null);
});
