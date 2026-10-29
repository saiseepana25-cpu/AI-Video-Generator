import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ExecutorStopUnconfirmed, requireBrowserStopped} from '../src/pipeline/executor-stop';

test('shutdown acknowledgement waits for the owned close operation', async () => {
  let finish!: () => void, complete = false;
  const closing = new Promise<void>(resolve => {finish = resolve;});
  const stopped = requireBrowserStopped(() => closing).then(() => {complete = true;});
  await Promise.resolve(); assert.equal(complete, false);
  finish(); await stopped; assert.equal(complete, true);
});

test('shutdown failure preserves uncertainty without exposing child error details', async () => {
  await assert.rejects(requireBrowserStopped(async () => {throw new Error('private process details');}), error => {
    assert(error instanceof ExecutorStopUnconfirmed);
    assert.equal(error.message, 'EXECUTOR_STOP_UNCONFIRMED');
    assert.equal(error.cause, undefined); return true;
  });
});
