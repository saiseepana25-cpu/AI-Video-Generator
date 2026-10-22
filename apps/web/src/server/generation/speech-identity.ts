import {canonicalJson, type RenderPlan} from '../rendering/contract';
import {digest} from '../providers/config';
/** Phrase gateway v1 sends no neighbouring context. Changing that adapter must
 * change this identity before it can reuse old speech. No credentials enter it. */
export function speechIdentity(workspaceId: string, projectId: string, plan: RenderPlan, segmentId: string) {
  const text=plan.narration.find(n=>n.segmentId===segmentId)?.text;
  if (!text) throw new Error('SPEECH_IDENTITY_INVALID');
  return digest(canonicalJson({v:1,workspaceId,projectId,text,language:plan.language,speech:plan.settingsSnapshot.speech,voiceCatalogId:plan.settingsSnapshot.voiceCatalogId,accentId:plan.settingsSnapshot.accentId,
    normalizationVersion:plan.settingsSnapshot.normalizationVersion,usagePolicy:plan.settingsSnapshot.usagePolicy,
    policyVersion:plan.settingsSnapshot.policyVersion,context:'independent-phrase-no-neighbours-v1'}));
}
