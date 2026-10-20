import {projectCollections} from './project-schemas';

// Migration 003 widens only command/event contracts. Never mutate an applied manifest.
export const editCollections = structuredClone(projectCollections.filter(c => c.name !== 'projects'));
const receipt = editCollections.find(c => c.name === 'idempotency_records')!.validator.$jsonSchema.properties;
receipt.routeScope = {oneOf: [{enum: ['POST /api/v1/projects']}, {bsonType: 'string', pattern: '^PATCH /api/v1/projects/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'}]};
receipt.committedHttpStatus = {enum: [200, 201]};
receipt.safeResponseSnapshot.properties.allowedActions = {bsonType: 'array', maxItems: 1, uniqueItems: true, items: {enum: ['edit']}};
editCollections.find(c => c.name === 'activity_events')!.validator.$jsonSchema.properties.type = {enum: ['project_created', 'project_updated']};
