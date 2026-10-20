import {createHash} from 'node:crypto';
import {z} from 'zod';

export const Language = z.enum(['en', 'te']);
export type Language = z.infer<typeof Language>;
export const Phase = z.enum(['overview', 'evaporation', 'condensation', 'rain', 'collection', 'concept']);
const localized = (en: number, te: number) => z.object({en: z.string().trim().min(1).max(en).regex(/[a-z]/i), te: z.string().trim().min(1).max(te).regex(/[\u0C00-\u0C7F]/u, 'Expected Telugu-script text')}).strict();
const Text = localized(140, 200);
export const PlanSchema = z.object({
  schemaVersion: z.literal(1),
  template: z.enum(['water-cycle', 'concept-flow']),
  title: localized(38, 45),
  objective: Text,
  targetSeconds: z.union([z.literal(30), z.literal(60), z.literal(90)]),
  scenes: z.array(z.object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    phase: Phase,
    label: localized(36, 44),
    phrases: z.array(z.object({id: z.string().regex(/^[a-z0-9-]+$/), text: Text}).strict()).min(2).max(6),
  }).strict()).min(3).max(6),
}).strict().superRefine((plan, context) => {
  const phases = ['overview', 'evaporation', 'condensation', 'rain', 'collection'];
  const ids = new Set<string>();
  if (plan.template === 'water-cycle' && plan.scenes.length !== 5) context.addIssue({code: 'custom', message: 'Water cycle requires five scenes'});
  plan.scenes.forEach((scene, index) => {
    if (scene.phase !== (plan.template === 'water-cycle' ? phases[index] : 'concept')) context.addIssue({code: 'custom', path: ['scenes', index, 'phase'], message: 'Unsupported scene order'});
    for (const id of [scene.id, ...scene.phrases.map((phrase) => phrase.id)]) {
      if (ids.has(id)) context.addIssue({code: 'custom', message: `Duplicate scene/phrase ID: ${id}`});
      ids.add(id);
    }
  });
});
export type Plan = z.infer<typeof PlanSchema>;
export function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export type Cue = {
  id: string; sceneId: string; phase: z.infer<typeof Phase>;
  text: {en: string; te: string};
  label?: {en: string; te: string};
  voiceName?: string;
  startFrame: number; speechEndFrame: number; endFrame: number;
};
export type VideoProps = {
  template?: Plan['template'];
  scenes?: {id: string; label: {en: string; te: string}}[];
  title: {en: string; te: string};
  cues: Cue[];
  spokenLanguage: Language;
  captionLanguage: Language;
  audioFile: string;
  durationInFrames: number;
  mode: 'offline-diagnostic' | 'gemini' | 'elevenlabs';
};
