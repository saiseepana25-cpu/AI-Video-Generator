import type {ClientSession, Db} from 'mongodb';
import {ProjectError, type ProjectSettings} from '../projects/contracts';
import {providerConfig} from './config';
import type {Env, Provider, ProviderControl, ProviderSummary, VoiceCatalog, VoiceQuery} from './contracts';

export function parseVoiceQuery(params: URLSearchParams): VoiceQuery {
  for (const key of params.keys()) if (!['language', 'accentId', 'intendedUse', 'includeUnavailable'].includes(key) || params.getAll(key).length !== 1) throw new ProjectError('INVALID_QUERY', 400, 'Use supported catalog fields once each.');
  const language = params.get('language'), accentId = params.get('accentId'), intendedUse = params.get('intendedUse') ?? 'evaluation', all = params.get('includeUnavailable') ?? 'false';
  if (!['en', 'te'].includes(language ?? '') || (accentId !== null && !['source-voice', 'en-IN', 'te-IN'].includes(accentId)) || !['evaluation', 'publication'].includes(intendedUse) || !['true', 'false'].includes(all)) throw new ProjectError('INVALID_QUERY', 400, 'Choose a supported language, accent and intended use.');
  return {language: language as 'en' | 'te', accentId, intendedUse: intendedUse as 'evaluation' | 'publication', includeUnavailable: all === 'true'};
}
export function providerSummary(provider: Provider, row: ProviderControl | null, env: Env, now = new Date()): ProviderSummary {
  const config = providerConfig(provider, env);
  let reason = !config.key ? 'INTEGRATION_NOT_CONFIGURED' : !config.confirmedFree ? 'FREE_TIER_UNCONFIRMED' : !config.reviewed ? 'MODEL_UNREVIEWED' : !row || row.configHash !== config.configHash ? 'CAPABILITY_UNVERIFIED' : row.expiresAt <= now ? 'CAPABILITY_STALE' : row.reasonCode ?? (row.state !== 'enabled' ? 'PROVIDER_PAUSED' : null);
  if (!reason && provider === 'gemini' && row?.allowance.observedRemaining === null) reason = 'FREE_ALLOWANCE_UNVERIFIED';
  if (!reason && provider === 'elevenlabs' && (row?.allowance.observedRemaining ?? 0) <= 0) reason = 'FREE_ALLOWANCE_EXHAUSTED';
  return {provider, model: config.model, state: reason ? 'paused' : 'enabled', reasonCode: reason,
    checkedAt: row?.configHash === config.configHash ? row.checkedAt.toISOString() : null, expiresAt: row?.configHash === config.configHash ? row.expiresAt.toISOString() : null,
    allowance: {unit: provider === 'elevenlabs' ? 'credits' : 'requests', remaining: !reason && row ? row.allowance.observedRemaining : null}, usagePolicy: 'evaluation_only'};
}
export function voiceCatalog(query: VoiceQuery, rows: ProviderControl[], env: Env, now = new Date()): VoiceCatalog {
  const providers = (['elevenlabs', 'gemini'] as const).map(p => providerSummary(p, rows.find(r => r._id === p) ?? null, env, now));
  const speech = providers[0], row = rows.find(r => r._id === 'elevenlabs');
  const tested = row?.configHash === providerConfig('elevenlabs', env).configHash && !!row.tests.some(t => t.language === query.language);
  const reason = query.intendedUse === 'publication' ? 'MEDIA_USAGE_RESTRICTED' : query.accentId && query.accentId !== 'source-voice' ? 'ACCENT_UNVERIFIED' : speech.reasonCode ?? (!row?.languages.includes(query.language) ? 'LANGUAGE_UNSUPPORTED' : !tested ? 'VOICE_UNTESTED' : null);
  const items: VoiceCatalog['items'] = [{id: 'alice-evaluation', name: 'Alice — evaluation voice', provider: 'elevenlabs', model: 'eleven_v3', supportedAccentIds: ['source-voice'], testedForLanguage: tested, nativeAccentVerified: false, usagePolicy: 'evaluation_only', available: !reason, reasonCode: reason, sampleAssetId: null},
    ...(['madhavi', 'bharadwaj'] as const).map(id => ({id, name: id === 'madhavi' ? 'Madhavi' : 'Bharadwaj', provider: 'elevenlabs' as const, model: 'eleven_v3', supportedAccentIds: ['te-IN'], testedForLanguage: false, nativeAccentVerified: false as const, usagePolicy: 'evaluation_only' as const, available: false, reasonCode: 'PAID_VOICE_UNAVAILABLE', sampleAssetId: null}))];
  return {language: query.language, items: items.filter(i => query.includeUnavailable || i.available), checkedAt: speech.checkedAt, providers};
}
export async function assertVoiceSelection(db: Db, settings: ProjectSettings, env: Env, session?: ClientSession) {
  if (!settings.voiceCatalogId && !settings.accentId) return;
  if (!settings.voiceCatalogId) throw new ProjectError('VALIDATION_FAILED', 422, 'Choose a voice before choosing its accent.');
  const row = await db.collection<ProviderControl>('provider_controls').findOne({_id: 'elevenlabs'}, {session});
  const catalog = voiceCatalog({language: settings.language, accentId: settings.accentId, intendedUse: 'evaluation', includeUnavailable: true}, row ? [row] : [], env);
  if (!catalog.items.some(i => i.id === settings.voiceCatalogId && i.available)) throw new ProjectError('VOICE_UNAVAILABLE', 503, 'This voice is unavailable for the selected language or accent. Refresh availability or leave the voice unselected.');
}
