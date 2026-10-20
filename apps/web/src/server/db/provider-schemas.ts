import type {Document} from 'mongodb';
import type {CollectionContract} from './schemas';
const object = (properties: Record<string, Document>) => ({bsonType: 'object', additionalProperties: false, required: Object.keys(properties), properties});
const text = (maxLength: number) => ({bsonType: 'string', minLength: 1, maxLength});
const nullable = (value: Document) => ({oneOf: [{bsonType: 'null'}, value]});
const date = {bsonType: 'date'}, units = {bsonType: ['int', 'long', 'double'], minimum: 0, maximum: Number.MAX_SAFE_INTEGER};
export const providerCollections: CollectionContract[] = [{name: 'provider_controls', indexes: [], validator: {$jsonSchema: object({
  _id: {enum: ['elevenlabs', 'gemini']}, schemaVersion: {bsonType: 'int', enum: [1]}, configHash: {bsonType: 'string', pattern: '^[a-f0-9]{64}$'},
  revision: {bsonType: 'long', minimum: 1}, model: text(120), state: {enum: ['enabled', 'paused', 'disabled']}, reasonCode: nullable(text(80)),
  checkedAt: date, expiresAt: date, languages: {bsonType: 'array', maxItems: 2, uniqueItems: true, items: {enum: ['en', 'te']}},
  allowance: object({unit: {enum: ['credits', 'requests']}, observedRemaining: nullable(units), periodId: nullable(text(80))}),
  tests: {bsonType: 'array', maxItems: 2, items: object({language: {enum: ['en', 'te']}, testedAt: date})},
  reservations: {bsonType: 'array', maxItems: 100, items: object({id: {bsonType: 'string', pattern: '^[0-9a-f-]{36}$'}, units, state: {enum: ['reserved', 'settled', 'uncertain']}, createdAt: date})},
})}}];
