import type {RenderPlan} from './render-contract.js';
import type {Audio} from './wav.js';
export type SelectedClip = {segmentId: string; text: string; audio: Audio; source: {provider: 'offline-diagnostic' | 'elevenlabs'; model: string; voiceId: string}};
export type SelectedCue = {segmentId: string; sceneId: string; text: string; startFrame: number; speechEndFrame: number; endFrame: number; sampleStart: number; sampleEnd: number};
export type TextLayout = {lines: string[]; fontSize: number; lineHeight: number};
export type SelectedLayout = {title: TextLayout; scenes: {heading: TextLayout; labels: TextLayout[]; caption: TextLayout}[]};
export type SelectedVideoProps = {plan: RenderPlan; cues: SelectedCue[]; audioFile: string; durationInFrames: number; mode: 'offline-diagnostic' | 'elevenlabs-evaluation'; layout: SelectedLayout | null};
