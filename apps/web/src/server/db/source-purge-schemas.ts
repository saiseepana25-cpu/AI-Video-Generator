import type {CollectionContract} from './schemas';
import {sourceCollections} from '../cleanup/source-contracts';
const uuid = {bsonType: 'string', pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'};
const hash = {bsonType: 'string', pattern: '^[a-f0-9]{64}$'}, date = {bsonType: 'date'};
const record = {bsonType: 'object', additionalProperties: false, required: ['collection', 'id', 'mode', 'beforeHash', 'afterHash'], properties: {
  collection: {enum: [...sourceCollections]}, id: uuid, mode: {enum: ['removed', 'redacted']}, beforeHash: hash, afterHash: {oneOf: [hash, {bsonType: 'null'}]},
}};
export const sourcePurgeCollections: CollectionContract[] = [{name: 'source_purge_receipts', validator: {
  $jsonSchema: {bsonType: 'object', additionalProperties: false, required: ['_id', 'workspaceId', 'projectId', 'deletedAt', 'completedAt', 'policy', 'guardRevision', 'projectPayloadHash', 'records'], properties: {
    _id: uuid, workspaceId: uuid, projectId: uuid, deletedAt: date, completedAt: date, policy: {enum: ['deleted-project-source-v1']},
    guardRevision: {bsonType: 'long', minimum: 1, maximum: Number.MAX_SAFE_INTEGER}, projectPayloadHash: hash,
    records: {bsonType: 'array', minItems: 1, maxItems: 601, items: record},
  }}, $expr: {$and: [{$eq: ['$_id', '$projectId']},
    {$allElementsTrue: [{$map: {input: '$records', as: 'record', in: {$cond: [{$eq: ['$$record.mode', 'removed']}, {$eq: ['$$record.afterHash', null]}, {$ne: ['$$record.afterHash', null]}]}}}]},
    {$eq: [{$size: '$records'}, {$size: {$setUnion: [{$map: {input: '$records', as: 'record', in: {$concat: ['$$record.collection', ':', '$$record.id']}}}, []]}}]},
  ]},
}, indexes: [{key: {workspaceId: 1, projectId: 1}, name: 'source_purge_scope_v1', unique: true}]}];
