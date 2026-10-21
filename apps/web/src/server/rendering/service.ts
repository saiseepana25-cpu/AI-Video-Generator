import {isDeepStrictEqual} from 'node:util';
import type {MongoClient} from 'mongodb';
import {databaseTransaction} from '../db/transactions';
import type {PlanVersion} from '../planning/contracts';
import {ProjectError, requireProjectId, type ProjectContext} from '../projects/contracts';
import type {ProjectRecord} from '../projects/service';
import {providerConfig, digest} from '../providers/config';
import {voiceCatalog} from '../providers/catalog';
import type {Env, ProviderControl} from '../providers/contracts';
import {buildRenderPlan, generationHash, RenderInputError, type FontPins} from './contract';
import {loadFontPins} from './assets';

export class RenderInputService {
  constructor(private client: MongoClient, private name: string, private context: ProjectContext, private env: Env, private assets: () => Promise<FontPins> = loadFontPins) {}
  /** Read-only preparation, never approval or dispatch. F09 must rerun these
   * checks and atomically pin the result against its expected revision/hash.
   */
  async prepare(id: string) {
    requireProjectId(id);
    const snapshot = await databaseTransaction(this.client, this.name, async (db, session) => {
      if (!await db.collection('memberships').findOne({workspaceId: this.context.workspaceId, userId: this.context.userId, status: 'active'}, {session})) throw new ProjectError('TEAM_ACCESS_DENIED', 403, 'This account does not have team access.');
      const version = await db.collection<PlanVersion>('plan_versions').findOne({_id: id, workspaceId: this.context.workspaceId}, {session});
      const project = version && await db.collection<ProjectRecord>('projects').findOne({_id: version.projectId, workspaceId: this.context.workspaceId, deletedAt: null}, {session});
      if (!version || !project) throw new ProjectError('RESOURCE_NOT_FOUND', 404, 'This plan could not be found.');
      if (project.currentPlanVersionId !== id || !project.briefRevision.equals(version.sourceBriefRevision) || project.planningRequestId !== version.sourcePlanningRequestId || !isDeepStrictEqual(project.settings, version.settingsSnapshot)) throw new ProjectError('PLAN_OUTDATED', 409, 'Review the current plan for the saved brief and settings.');
      if (project.activePlanningJobId || project.latestRunId) throw new ProjectError('PLAN_CHECK_UNAVAILABLE', 409, 'Finish active work before checking a new video input.');
      if (digest(JSON.stringify({brief: project.brief, settings: version.settingsSnapshot})) !== version.inputHash) throw new ProjectError('PLAN_SOURCE_MISMATCH', 409, 'The saved source does not match this plan. Prepare a new plan before generation.');
      const provider = await db.collection<ProviderControl>('provider_controls').findOne({_id: 'elevenlabs'}, {session});
      return {version, project, provider};
    });
    const {version, project, provider} = snapshot;
    let pins;
    try {pins = await this.assets();}
    catch {throw new ProjectError('RENDER_ASSETS_UNAVAILABLE', 503, 'The local video fonts could not be verified. Restore the installed assets and check again.');}
    let plan;
    try {plan = buildRenderPlan(version.plan, project.brief, version.settingsSnapshot, pins);}
    catch (error) {
      const issue = error instanceof RenderInputError ? {code: error.code, message: error.message} : {code: 'INVALID_RENDER_INPUT', message: 'The saved plan has unsupported content. Review or prepare a new plan.'};
      return {version, projectRevision: project.revision.toNumber(), plan: null, generationInputHash: null, issues: [issue], executionBlocks: []};
    }
    const catalog = voiceCatalog({language: version.plan.language, accentId: version.settingsSnapshot.accentId, intendedUse: 'evaluation', includeUnavailable: true}, provider ? [provider] : [], this.env);
    const voice = catalog.items.find(v => v.id === version.settingsSnapshot.voiceCatalogId);
    const characters = plan.narration.reduce((n, s) => n + s.text.length, 0), requiredUnits = characters * 2 + plan.narration.length * 100;
    // observedRemaining is already net of reservations in ProviderStore.
    const blocks = provider?.reservations.some(r => r.state === 'uncertain') ? [{code: 'UNCERTAIN_PROVIDER_USAGE', message: 'Resolve the earlier uncertain speech request before generation.'}] : !voice?.available ? [{code: voice?.reasonCode ?? 'VOICE_UNAVAILABLE', message: 'The selected voice needs a current successful free-account/language check before generation.'}] : (provider?.allowance.observedRemaining ?? 0) < requiredUnits ? [{code: 'FREE_ALLOWANCE_INSUFFICIENT', message: 'The observed free speech allowance does not cover this plan. No speech request was made.'}] : [];
    // No key/config hash is part of the content hash or public projection.
    if (!providerConfig('elevenlabs', this.env).key && !blocks.length) blocks.push({code: 'INTEGRATION_NOT_CONFIGURED', message: 'Configure the speech provider before generation.'});
    return {version, projectRevision: project.revision.toNumber(), plan, generationInputHash: generationHash(plan), issues: [], executionBlocks: blocks};
  }
  async check(id: string) {
    const result = await this.prepare(id), plan = result.plan;
    return {planVersionId: result.version._id, projectId: result.version.projectId, versionNumber: result.version.versionNumber.toNumber(), projectRevision: result.projectRevision,
      status: plan ? 'compiled' : 'needs_changes', generationInputHash: result.generationInputHash, canGenerate: false,
      issues: result.issues, executionBlocks: [...result.executionBlocks, {code: 'GENERATION_NOT_IMPLEMENTED', message: 'Approval, the generation queue and the selected-language renderer are the next steps.'}],
      summary: plan ? {language: plan.language, captionLanguage: plan.settingsSnapshot.captionLanguage, targetSeconds: plan.targetSeconds,
        sceneCount: plan.scenes.length, segmentCount: plan.narration.length, templates: [...new Set(plan.scenes.map(s => s.templateId))],
        voice: {catalogId: plan.settingsSnapshot.voiceCatalogId, accentId: plan.settingsSnapshot.accentId, model: plan.settingsSnapshot.speech.model},
        output: plan.settingsSnapshot.output, usagePolicy: plan.settingsSnapshot.usagePolicy, contract: plan.contract, fonts: plan.settingsSnapshot.brand.fonts,
        timing: 'Measured speech is required before final subtitle and animation timing.'} : null};
  }
}
export type RenderCheck = Awaited<ReturnType<RenderInputService['check']>>;
