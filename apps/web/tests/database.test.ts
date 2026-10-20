import {test} from 'node:test';
import assert from 'node:assert/strict';
import {inspectDatabaseSettings} from '../src/server/db/connection';
import {indexMatches} from '../src/server/db/migrations';

test('database tooling refuses missing configuration, system databases and disabled TLS', () => {
  assert.equal(inspectDatabaseSettings({}), null);
  const env = {MONGODB_URI: 'mongodb://127.0.0.1:27017', MONGODB_DB: 'videocraft_dev'};
  assert.ok(inspectDatabaseSettings(env));
  for (const MONGODB_DB of ['admin', 'LOCAL', 'config', 'a.b', '', 'a'.repeat(64)]) {
    assert.equal(inspectDatabaseSettings({...env, MONGODB_DB}), null);
  }
  for (const MONGODB_URI of ['not-a-uri', 'mongodb://host/?tls=false', 'mongodb://host/?SSL=false']) {
    assert.equal(inspectDatabaseSettings({...env, MONGODB_URI}), null);
  }
});

test('index verification detects reordered compound keys and weakened constraints', () => {
  const expected = {key: {workspaceId: 1 as const, userId: 1 as const}, name: 'member', unique: true};
  assert.equal(indexMatches({...expected, v: 2}, expected), true);
  assert.equal(indexMatches({...expected, key: {userId: 1, workspaceId: 1}}, expected), false);
  assert.equal(indexMatches({...expected, unique: false}, expected), false);
  assert.equal(indexMatches({...expected, sparse: true}, expected), false);
  assert.equal(indexMatches({...expected, hidden: true}, expected), false);
  assert.equal(indexMatches({...expected, partialFilterExpression: {status: 'active'}}, expected), false);
  assert.equal(indexMatches({...expected, collation: {locale: 'en'}}, expected), false);
});
