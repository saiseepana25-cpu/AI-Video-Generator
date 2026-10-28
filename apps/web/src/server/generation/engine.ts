import type {LogoObject} from '../logos/contracts';
import type {RenderPlan, FontPins} from '../rendering/contract';
import type {Observation} from '../providers/gateway';
import type {LocalArtifact} from './contracts';
export type MeasuredSpeech = {samples: Float32Array; sampleRate: number};
export type SpeechClip = {segmentId: string; text: string; audio: MeasuredSpeech; source: {provider: 'elevenlabs'; model: string; voiceId: string}};
export class GenerationFault extends Error {constructor(public readonly code: string, public readonly unknown = false) {super(code);}}
export interface GenerationEngine {
  capabilities: string[];
  inspect(): Promise<{rendererBuildHash: string; fonts: FontPins}>;
  preflight(plan: RenderPlan, hash: string, signal: AbortSignal): Promise<{rendererBuildHash: string}>;
  observe(): Promise<Observation>;
  speech(plan: RenderPlan, segmentId: string, signal: AbortSignal): Promise<MeasuredSpeech>;
  persistSpeech(runId: string, attemptId: string, audio: MeasuredSpeech): Promise<{audioHash: string; byteLength: number}>;
  readSpeech?(source: {runId:string;attemptId:string;audioHash:string;byteLength:number;sampleRate:number}, signal: AbortSignal): Promise<MeasuredSpeech>;
  logo?(object:LogoObject,signal:AbortSignal):Promise<Buffer>;
  render(runId: string, plan: RenderPlan, hash: string, clips: SpeechClip[], signal: AbortSignal, logo?:Buffer): Promise<Pick<LocalArtifact, '_id' | 'manifestHash' | 'media' | 'rendererBuildHash'>>;
}
