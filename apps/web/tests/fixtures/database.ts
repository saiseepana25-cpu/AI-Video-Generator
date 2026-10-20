import {randomUUID} from 'node:crypto';
import {Long, type Document} from 'mongodb';

export type Row = Document & {_id: string};
export const testWorkspaceId = '10000000-0000-4000-8000-000000000001';
export const testUserId = '0123456789abcdef01234567';
const actor = {kind: 'system', service: 'database-test'};

export function workspaceFixture(): Row {
  const now = new Date();
  return {_id: testWorkspaceId, schemaVersion: 1, name: 'Test workspace', timezone: 'Asia/Kolkata',
    defaults: {language: 'en', targetSeconds: 60, preferredAccentId: 'indian', preferredVoiceCatalogId: null,
      themeId: 'clean-educational-v1', captionStyleId: 'readable-default-v1'},
    settingsRevision: Long.ONE, brandKitRevisionId: null, brandRevision: Long.ZERO, nextActivitySequence: Long.ZERO,
    createdAt: now, updatedAt: now, updatedBy: actor};
}

export function membershipFixture(): Row {
  const now = new Date();
  return {_id: randomUUID(), schemaVersion: 1, workspaceId: testWorkspaceId, userId: testUserId,
    normalizedEmail: 'member@example.com', status: 'active', joinedAt: now, disabledAt: null, disabledBy: null,
    preferences: {language: null, voiceCatalogId: null, timezone: null}, preferencesRevision: Long.ONE,
    activityReadThroughSequence: Long.ZERO, createdAt: now, updatedAt: now};
}

export function projectFixture(): Row {
  const now = new Date();
  return {_id: randomUUID(), schemaVersion: 1, workspaceId: testWorkspaceId,
    displayTitle: 'నీటి చక్రం', searchTitle: 'నీటి చక్రం', brief: {idea: 'నీటి చక్రం గురించి వివరించండి.', audience: 'Beginners', references: []},
    settings: {language: 'te', targetSeconds: 30, accentId: 'source-voice', voiceCatalogId: 'alice-evaluation',
      brandKitRevisionId: null, themeId: 'clean-educational-v1', captionStyleId: 'readable-default-v1'},
    revision: Long.ONE, briefRevision: Long.ONE, guardRevision: Long.ZERO,
    currentPlanVersionId: null, latestReadyVideoId: null, latestRunId: null,
    activePlanningJobId: null, planningRequestId: null,
    nextPlanVersionNumber: Long.ZERO, nextVideoVersionNumber: Long.ZERO, nextMessageSequence: Long.ZERO,
    createdBy: actor, updatedBy: actor, createdAt: now, updatedAt: now,
    deletedAt: null, deletedBy: null, cleanupJobId: null, deletionReceipt: null, sourceProjectId: null};
}
