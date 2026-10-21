import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseRange} from '../src/server/videos/service';
test('playback ranges support full, bounded, open-ended and suffix requests', () => {
  assert.deepEqual(parseRange(null,100),{start:0,end:99}); assert.deepEqual(parseRange('bytes=0-0',100),{start:0,end:0});
  assert.deepEqual(parseRange('bytes=90-',100),{start:90,end:99}); assert.deepEqual(parseRange('bytes=-10',100),{start:90,end:99});
  assert.deepEqual(parseRange('bytes=90-999',100),{start:90,end:99}); assert.deepEqual(parseRange('bytes=-999',100),{start:0,end:99});
});
test('invalid/multipart/oversized numeric ranges are rejected before remote media I/O', () => {
  for (const range of ['bytes=','bytes=-','bytes=-0','bytes=100-','bytes=9-2','bytes=0-1,3-4','items=0-1','bytes=9007199254740993-','bytes=1.5-2'])
    assert.throws(()=>parseRange(range,100),(e:unknown)=>!!e&&typeof e==='object'&&'status' in e&&e.status===416);
});
