import {Long, type ClientSession, type Db} from 'mongodb';
import type {ProviderControl} from '../providers/contracts';
import type {GenerationRun} from './contracts';
export async function closeGenerationReservation(db: Db, session: ClientSession, run: GenerationRun, outcome: 'unused' | 'settled' | 'uncertain') {
  const row = await db.collection<ProviderControl>('provider_controls').findOne({_id: 'elevenlabs'}, {session});
  const held = row?.reservations.find(r => r.id === run.reservationId); if (!row || !held) return;
  if (outcome === 'unused') {
    if (held.state !== 'reserved' || (run.submissionCount ?? 0) > 0) return;
    const remaining = row.allowance.observedRemaining;
    const refund = row.configHash === run.providerConfigHash && row.allowance.periodId === run.reservationPeriodId && remaining !== null && Number.isSafeInteger(remaining + held.units) && remaining + held.units <= Number.MAX_SAFE_INTEGER;
    await db.collection<ProviderControl>('provider_controls').updateOne({_id: row._id, revision: row.revision}, {$pull: {reservations: {id: held.id, state: 'reserved'}}, $inc: {revision: Long.ONE, ...(refund ? {'allowance.observedRemaining': held.units} : {})}}, {session});
  } else if (held.state !== 'uncertain' || outcome === 'uncertain') {
    await db.collection<ProviderControl>('provider_controls').updateOne({_id: row._id, revision: row.revision, 'reservations.id': held.id}, {$set: {'reservations.$.state': outcome,
      ...(outcome === 'uncertain' ? {reasonCode: 'UNCERTAIN_PROVIDER_USAGE', ...(row.state === 'disabled' ? {} : {state: 'paused' as const})} : {})}, $inc: {revision: Long.ONE}}, {session});
  }
}
