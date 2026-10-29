import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Long} from 'mongodb';
import {sourceRecordHash, projectPayload} from '../src/server/cleanup/source-contracts';
test('source fingerprints preserve nested BSON/date/type evidence independent of property order', () => {
  const value = {a: {counter: Long.ONE, time: new Date('2026-10-29T00:00:00Z')}, b: ['text', 1]};
  assert.equal(sourceRecordHash(value), sourceRecordHash({b: ['text', 1], a: {time: new Date('2026-10-29T00:00:00Z'), counter: Long.ONE}}));
  assert.notEqual(sourceRecordHash(value), sourceRecordHash({...value, a: {...value.a, counter: Long.fromNumber(2)}}));
  assert.notEqual(sourceRecordHash(value), sourceRecordHash({...value, a: {...value.a, time: new Date('2026-10-30T00:00:00Z')}}));
  assert.notEqual(sourceRecordHash(Long.ONE), sourceRecordHash('1')); assert.notEqual(sourceRecordHash([1]), sourceRecordHash({'0': 1}));
  assert.throws(() => sourceRecordHash({unsupported: undefined}));
});
test('project payload fingerprint covers retained source/pointers but permits later metadata counters', () => {
  const project = {_id: 'project', workspaceId: 'workspace', deletedAt: new Date(), displayTitle: 'Deleted project', searchTitle: 'deleted project', brief: {idea: 'Source removed'}, guardRevision: Long.ONE};
  assert.equal(sourceRecordHash(projectPayload(project)), sourceRecordHash(projectPayload({...project, guardRevision: Long.fromNumber(2)})));
  assert.notEqual(sourceRecordHash(projectPayload(project)), sourceRecordHash(projectPayload({...project, brief: {idea: 'Resurrected private source'}})));
});
