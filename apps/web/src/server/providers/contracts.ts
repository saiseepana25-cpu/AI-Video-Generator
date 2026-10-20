import type {Long} from 'mongodb';
export type Language = 'en' | 'te';
export type Provider = 'elevenlabs' | 'gemini';
export type Env = Record<string, string | undefined>;
export const voiceIds = ['alice-evaluation', 'madhavi', 'bharadwaj'] as const;
export type VoiceId = typeof voiceIds[number];
export type Reservation = {id: string; units: number; state: 'reserved' | 'settled' | 'uncertain'; createdAt: Date};
export type ProviderControl = {
  _id: Provider; schemaVersion: 1; configHash: string; revision: Long; model: string;
  state: 'enabled' | 'paused' | 'disabled'; reasonCode: string | null;
  operatorDisabled?: boolean; // Optional only for pre-005 rows; legacy disabled state is fail-closed.
  checkedAt: Date; expiresAt: Date; languages: Language[];
  allowance: {unit: 'credits' | 'requests'; observedRemaining: number | null; periodId: string | null};
  tests: {language: Language; testedAt: Date}[]; reservations: Reservation[];
};
export const isOperatorDisabled = (row: ProviderControl | null | undefined) => row?.operatorDisabled === true || row?.state === 'disabled';
export type VoiceItem = {id: VoiceId; name: string; provider: 'elevenlabs'; model: string; supportedAccentIds: string[];
  testedForLanguage: boolean; nativeAccentVerified: false; usagePolicy: 'evaluation_only'; available: boolean; reasonCode: string | null; sampleAssetId: null};
export type ProviderSummary = {provider: Provider; model: string; state: 'enabled' | 'paused' | 'disabled'; reasonCode: string | null;
  checkedAt: string | null; expiresAt: string | null; allowance: {unit: 'credits' | 'requests'; remaining: number | null}; usagePolicy: 'evaluation_only'};
export type VoiceCatalog = {language: Language; items: VoiceItem[]; checkedAt: string | null; providers: ProviderSummary[]};
export type VoiceQuery = {language: Language; accentId: string | null; intendedUse: 'evaluation' | 'publication'; includeUnavailable: boolean};
