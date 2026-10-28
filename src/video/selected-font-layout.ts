import {staticFile} from 'remotion';
import type {RenderPlan} from '../pipeline/render-contract.js';
import type {SelectedLayout, SelectedVideoProps, TextLayout} from '../pipeline/selected-types.js';
import {computeSelectedLayout, computeSpatialLayout, TextLayoutError, textLayoutRefusal} from './selected-layout';

export const selectedFamily = (language: string, role: 'heading' | 'body') => language === 'te' ? `"VC-telugu", "VC-${role}"` : `"VC-${role}"`;
export async function loadSelectedFonts() {
  for (const role of ['heading', 'body', 'telugu'] as const) {
    const font = new FontFace(`VC-${role}`, `url("${staticFile(`fonts/${role}.woff2`)}")`, {weight: '400', style: 'normal'});
    document.fonts.add(await font.load());
  }
  await document.fonts.ready;
}
async function measuredLayout(plan: RenderPlan, props?: SelectedVideoProps): Promise<SelectedLayout> {
  await loadSelectedFonts();
  const context = document.createElement('canvas').getContext('2d');
  if (!context) throw new Error('Text measurement is unavailable.');
  const measure = (role: 'heading' | 'body', text: string, size: number) => {
    context.font = `400 ${size}px ${selectedFamily(plan.language, role)}`;
    return context.measureText(text).width;
  };
  try {
    const layout = props ? computeSelectedLayout(props, measure) : computeSpatialLayout(plan, measure);
    const checkHeight = (block: TextLayout, role: 'heading' | 'body') => {
      context.font = `400 ${block.fontSize}px ${selectedFamily(plan.language, role)}`;
      if (block.lines.some(line => {const metrics = context.measureText(line); return metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent > block.lineHeight;})) throw new TextLayoutError('Glyph height exceeds the readable text area.');
    };
    checkHeight(layout.title, 'heading');
    for (const scene of layout.scenes) {checkHeight(scene.heading, 'heading'); checkHeight(scene.caption, 'body'); scene.labels.forEach(label => checkHeight(label, 'body'));}
    return layout;
  } catch (error) {
    if (error instanceof TextLayoutError) throw new Error(textLayoutRefusal);
    throw error;
  }
}
export const resolveSpatialLayout = (plan: RenderPlan) => measuredLayout(plan);
export async function resolveSelectedProps(props: SelectedVideoProps): Promise<SelectedVideoProps> {
  return {...props, layout: await measuredLayout(props.plan, props)};
}
