import {Long, type Db} from 'mongodb';
import {providerConfig} from '../providers/config';
import type {Env} from '../providers/contracts';
import type {Row} from './service';

// Operator observation, never inferred from an API key or model metadata.
export async function attestBudget(db: Db, env: Env, remaining: number, expectedRevision: number, now = new Date()) {
  const config = providerConfig('gemini', env);
  if (!config.key || !config.reviewed || !config.confirmedFree || !Number.isInteger(remaining) || remaining < 0 || remaining > 500 || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new Error('INVALID_FREE_BUDGET');
  // Expire no later than the next Pacific daily quota reset (DST-aware).
  const day = (d: Date) => new Intl.DateTimeFormat('en-CA', {timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit'}).format(d);
  let expiry = new Date(now.getTime() + 3600000);
  if (day(expiry) !== day(now)) {
    let low = now.getTime(), high = expiry.getTime();
    while (high - low > 1000) {const mid = Math.floor((low + high) / 2); if (day(new Date(mid)) === day(now)) low = mid; else high = mid;}
    expiry = new Date(low);
  }
  const existing = await db.collection<Row>('planning_budget').findOne({_id: 'gemini'});
  if (existing?.uncertain) throw new Error('UNCERTAIN_USAGE_REQUIRES_RECONCILIATION');
  // Cannot refresh while a reserved/submitted request is in flight.
  if (await db.collection('jobs').findOne({submission: {$in: ['submitted', 'uncertain']}})) throw new Error('UNRESOLVED_PLANNING_REQUEST');
  const row = {_id: 'gemini', configHash: config.configHash, revision: Long.fromNumber(expectedRevision + 1), observedAt: now, expiresAt: expiry,
    remaining, nextRequestAt: existing?.nextRequestAt ?? now, paused: false, uncertain: false};
  if (!existing && expectedRevision === 0) await db.collection<Row>('planning_budget').insertOne(row);
  else {
    const result = await db.collection<Row>('planning_budget').replaceOne({_id: 'gemini', revision: Long.fromNumber(expectedRevision), uncertain: false}, row);
    if (!result.matchedCount) throw new Error('BUDGET_REVISION_CHANGED');
  }
  return {remaining, revision: row.revision.toNumber(), expiresAt: expiry.toISOString()};
}
