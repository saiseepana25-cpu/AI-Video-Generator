import type {ClientSession, Db} from 'mongodb';
import type {RenderPlan} from '../rendering/contract';
import {canonicalJson} from '../rendering/contract';
import {brandLogoCapability,brandPaletteCapability,requiredCapabilities, type GenerationWorker} from './contracts';
export const workerUnavailable = {code: 'GENERATION_WORKER_UNAVAILABLE', message: 'Video generation needs a compatible running worker before this plan can be approved.'};
export function compatibleWorker(worker: GenerationWorker | null, plan: RenderPlan, now = new Date()) {
  const fonts = {heading: plan.settingsSnapshot.brand.fonts[0].sha256, body: plan.settingsSnapshot.brand.fonts[1].sha256, telugu: plan.settingsSnapshot.brand.fonts[2].sha256};
  return !!worker && worker.state === 'healthy' && worker.expiresAt > now && worker.heartbeatAt > new Date(now.getTime() - 30000)
    && worker.heartbeatAt <= new Date(now.getTime() + 5000)
    && worker.contract === plan.contract && worker.compilerVersion === plan.settingsSnapshot.compilerVersion
    && requiredCapabilities.every(c => worker.capabilities.includes(c)) && (!plan.settingsSnapshot.brand.revisionId||worker.capabilities.includes(brandPaletteCapability)) && (!plan.settingsSnapshot.brand.logoAsset||worker.capabilities.includes(brandLogoCapability)) && canonicalJson(fonts) === canonicalJson(worker.fonts);
}
export async function readGenerationWorker(db: Db, session?: ClientSession) {
  return db.collection<GenerationWorker>('generation_workers').findOne({_id: 'generation:local'}, {session});
}
