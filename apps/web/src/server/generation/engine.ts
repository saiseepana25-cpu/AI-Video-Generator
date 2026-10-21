import type {RenderPlan, FontPins} from '../rendering/contract';
import type {Observation} from '../providers/gateway';
import type {LocalArtifact} from './contracts';
export type MeasuredSpeech = {samples: Float32Array; sampleRate: number};
export type SpeechClip = {segmentId: string; text: string; audio: MeasuredSpeech; source: {provider: 'elevenlabs'; model: string; voiceId: string}};
export class GenerationFault extends Error {constructor(public readonly code: string, public readonly unknown = false) {super(code);}}
export interface GenerationEngine {
  capabilities: string[];
  inspect(): Promise<{rendererBuildHash: string; fonts: FontPins}>;
  observe(): Promise<Observation>;
  speech(plan: RenderPlan, segmentId: string, signal: AbortSignal): Promise<MeasuredSpeech>;
  persistSpeech(runId: string, attemptId: string, audio: MeasuredSpeech): Promise<{audioHash: string; byteLength: number}>;
  render(runId: string, plan: RenderPlan, hash: string, clips: SpeechClip[], signal: AbortSignal): Promise<Pick<LocalArtifact, '_id' | 'manifestHash' | 'media' | 'rendererBuildHash'>>;
}
