import {randomUUID} from 'node:crypto';
import {Long, type Db} from 'mongodb';
import {providerConfig} from './config';
import {ProviderFault, ProviderGateway, testPhrase, type Observation} from './gateway';
import {voiceCatalog} from './catalog';
import type {Env, Language, Provider, ProviderControl, VoiceQuery} from './contracts';
import {isOperatorDisabled} from './contracts';

export class ProviderStore {
  private readonly gateway: ProviderGateway;
  constructor(private readonly db: Db, private readonly env: Env, request?: typeof fetch) {this.gateway = new ProviderGateway(env, request);}
  async refresh(provider: Provider, force = false): Promise<void> {
    const collection = this.db.collection<ProviderControl>('provider_controls'), config = providerConfig(provider, this.env);
    const before = await collection.findOne({_id: provider});
    const now = new Date();
    if (!force && before?.configHash === config.configHash && before.expiresAt > now) return;
    let observed: Observation;
    try {observed = await this.gateway.observe(provider);} catch (error) {observed = {state: 'paused' as const, reasonCode: error instanceof ProviderFault ? error.code : 'PROVIDER_UNAVAILABLE', languages: [] as Language[], remaining: null, periodId: null};}
    // A refresh cannot overwrite a reservation/another refresh committed while
    // metadata was in flight. Retry on a later read, never inside a transaction.
    const reservations = before?.reservations ?? [];
    if (reservations.some(r => r.state === 'uncertain')) observed = {...observed, state: 'paused', reasonCode: 'UNCERTAIN_PROVIDER_USAGE'};
    const held = reservations.reduce((total, r) => total + r.units, 0);
    const next: ProviderControl = {_id: provider, schemaVersion: 1, configHash: config.configHash, revision: before ? before.revision.add(Long.ONE) : Long.ONE,
      model: config.model, state: observed.state, operatorDisabled: isOperatorDisabled(before), reasonCode: observed.reasonCode, checkedAt: now,
      expiresAt: new Date(now.getTime() + (observed.reasonCode ? 60000 : 5 * 60000)), languages: observed.languages,
      allowance: {unit: provider === 'elevenlabs' ? 'credits' : 'requests', observedRemaining: observed.remaining === null ? null : Math.max(0, observed.remaining - held), periodId: observed.periodId},
      tests: before?.configHash === config.configHash ? before.tests : [], reservations};
    if (before) await collection.replaceOne({_id: provider, revision: before.revision, state: before.state, operatorDisabled: before.operatorDisabled ?? {$exists: false}}, next);
    else {try {await collection.insertOne(next);} catch (error) {if (!(error && typeof error === 'object' && 'code' in error && error.code === 11000)) throw error;}}
  }
  /** Operator CLI only. Enabling expires observations, so it cannot bypass fresh
   * account/access/allowance checks or clear unresolved consumption evidence. */
  async setOperatorEnabled(provider: Provider, enabled: boolean, expectedRevision: number) {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) throw new ProviderFault('INVALID_REVISION');
    const result = await this.db.collection<ProviderControl>('provider_controls').updateOne({_id: provider, revision: Long.fromNumber(expectedRevision)}, {
      $set: enabled ? {operatorDisabled: false, state: 'paused', reasonCode: 'CAPABILITY_UNVERIFIED', expiresAt: new Date(0)} : {operatorDisabled: true},
      $inc: {revision: Long.ONE},
    });
    if (result.modifiedCount !== 1) throw new ProviderFault('PROVIDER_STATE_CHANGED');
  }
  async catalog(query: VoiceQuery) {
    await Promise.all([this.refresh('elevenlabs'), this.refresh('gemini')]);
    const rows = await this.db.collection<ProviderControl>('provider_controls').find({}).limit(2).toArray();
    return voiceCatalog(query, rows, this.env);
  }
  async reserve(provider: Provider, units: number, probeLanguage?: Language) {
    if (!Number.isSafeInteger(units) || units <= 0 || units > 100000) throw new ProviderFault('INVALID_RESERVATION');
    const config = providerConfig(provider, this.env), now = new Date(), id = randomUUID();
    const result = await this.db.collection<ProviderControl>('provider_controls').findOneAndUpdate({_id: provider, configHash: config.configHash, state: 'enabled', operatorDisabled: {$ne: true}, reasonCode: null, expiresAt: {$gt: now}, 'allowance.observedRemaining': {$gte: units}, 'reservations.99': {$exists: false},
      ...(probeLanguage ? {'tests.language': {$ne: probeLanguage}, reservations: {$not: {$elemMatch: {state: {$in: ['reserved', 'uncertain']}}}}} : {})},
      {$inc: {'allowance.observedRemaining': -units, revision: Long.ONE}, $push: {reservations: {id, units, state: 'reserved', createdAt: now}}}, {returnDocument: 'after'});
    if (!result) throw new ProviderFault('FREE_ALLOWANCE_UNAVAILABLE');
    return id;
  }
  async probe(language: Language) {
    await this.refresh('elevenlabs', true);
    const collection = this.db.collection<ProviderControl>('provider_controls'), config = providerConfig('elevenlabs', this.env);
    const row = await collection.findOne({_id: 'elevenlabs'});
    if (isOperatorDisabled(row)) throw new ProviderFault('PROVIDER_DISABLED');
    if (!row || row.configHash !== config.configHash || row.reasonCode || !row.languages.includes(language)) throw new ProviderFault(row?.reasonCode ?? 'LANGUAGE_UNSUPPORTED');
    if (row.tests.some(t => t.language === language)) return {tested: false, reason: 'ALREADY_TESTED'};
    if (row.reservations.some(r => r.state !== 'settled')) throw new ProviderFault('UNCERTAIN_PROVIDER_USAGE');
    // Single active probe slot. A lost acknowledgement never starts a second probe.
    const id = await this.reserve('elevenlabs', testPhrase(language).length * 2 + 100, language);
    try {
      const pcm = await this.gateway.testSpeech(language);
      const result = await collection.updateOne({_id: 'elevenlabs', configHash: config.configHash, reservations: {$elemMatch: {id, state: 'reserved'}}},
        {$set: {'reservations.$.state': 'settled'}, $push: {tests: {language, testedAt: new Date()}}, $inc: {revision: Long.ONE}});
      if (result.modifiedCount !== 1) throw new ProviderFault('PROVIDER_STATE_CHANGED');
      return {tested: true, language, bytes: pcm.length, pcm};
    } catch (error) {
      const failed = await collection.updateOne({_id: 'elevenlabs', state: {$ne: 'disabled'}, 'reservations.id': id}, {$set: {'reservations.$.state': 'uncertain', state: 'paused', reasonCode: error instanceof ProviderFault ? error.code : 'VOICE_TEST_FAILED'}, $inc: {revision: Long.ONE}});
      // A legacy operator kill switch may have been written during the request.
      // Record uncertain usage without replacing that disabled state.
      if (!failed.matchedCount) await collection.updateOne({_id: 'elevenlabs', 'reservations.id': id}, {$set: {'reservations.$.state': 'uncertain'}, $inc: {revision: Long.ONE}});
      throw new ProviderFault(error instanceof ProviderFault ? error.code : 'VOICE_TEST_FAILED');
    }
  }
}
