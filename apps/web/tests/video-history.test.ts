import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {videoHistoryQuery, videoHistoryCursor, readVideoHistoryCursor} from '../src/server/videos/history-cursor';
import {historyCursor} from '../src/server/planning/history-cursor';
test('video history rejects ambiguous, unbounded and unsupported queries', () => {
  assert.deepEqual(videoHistoryQuery(new URLSearchParams('kind=video')), {limit:10,cursor:null});
  for (const query of ['', 'kind=plan','kind=video&kind=video','kind=video&limit=0','kind=video&limit=51','kind=video&limit=1.5','kind=video&cursor=','kind=video&sort=asc','kind=video&limit=1&limit=2']) assert.throws(() => videoHistoryQuery(new URLSearchParams(query)));
});
test('video cursors bind scope, kind, limit, secret and one-hour expiry', () => {
  const workspace = randomUUID(), project = randomUUID(), secret = 'history-test-secret', now = Date.now();
  const token = videoHistoryCursor(workspace,project,10,4,secret,now);
  assert.equal(readVideoHistoryCursor(token,workspace,project,10,secret,now),4);
  for (const args of [[token,randomUUID(),project,10,secret,now],[token,workspace,randomUUID(),10,secret,now],[token,workspace,project,5,secret,now],[token,workspace,project,10,'wrong',now],[token,workspace,project,10,secret,now+3600000],[token+'a',workspace,project,10,secret,now],[historyCursor(workspace,project,10,4,secret,now),workspace,project,10,secret,now]] as const) assert.throws(() => readVideoHistoryCursor(args[0],args[1],args[2],args[3],args[4],args[5]));
});
