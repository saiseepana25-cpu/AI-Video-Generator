import type {SelectedLayout, SelectedVideoProps, TextLayout} from '../pipeline/selected-types.js';
export type MeasureText = (text: string, fontSize: number) => number;
const graphemes = (text: string) => [...new Intl.Segmenter(undefined, {granularity: 'grapheme'}).segment(text)].map(s => s.segment);

/** Greedy word wrapping with grapheme-safe fallback for unbroken labels. */
export function wrapMeasured(text: string, width: number, size: number, measure: MeasureText): string[] {
  const lines: string[] = [];
  for (const paragraph of text.replace(/\r\n?/g, '\n').split('\n')) {
    let line = '';
    for (const word of paragraph.trim().split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (measure(candidate, size) <= width) {line = candidate; continue;}
      if (line) {lines.push(line); line = '';}
      if (measure(word, size) <= width) {line = word; continue;}
      for (const part of graphemes(word)) {
        if (measure(part, size) > width) throw new Error('A grapheme cannot fit in the supported text area.');
        if (line && measure(line + part, size) > width) {lines.push(line); line = part;} else line += part;
      }
    }
    // Preserve explicit newlines, including blank lines; never hide overflowing content.
    lines.push(line);
  }
  return lines;
}
export function fitMeasured(text: string, box: {width: number; height: number; max: number; min: number; maxLines: number; leading: number}, measure: MeasureText): TextLayout {
  for (let size = box.max; size >= box.min; size -= 2) {
    const lines = wrapMeasured(text, box.width, size, measure), lineHeight = size * box.leading;
    if (lines.length <= box.maxLines && lineHeight * lines.length <= box.height) return {lines, fontSize: size, lineHeight};
  }
  throw new Error('Approved text does not fit at a readable size. Shorten the narration, heading or diagram labels and review a new plan.');
}
export function computeSelectedLayout(props: SelectedVideoProps, measure: (family: 'heading' | 'body', text: string, size: number) => number): SelectedLayout {
  const leading = props.plan.language === 'te' ? 1.65 : 1.4;
  const fit = (text: string, family: 'heading' | 'body', width: number, height: number, max: number, min: number, maxLines: number) => fitMeasured(text, {width, height, max, min, maxLines, leading}, (s, z) => measure(family, s, z));
  return {title: fit(props.plan.title, 'heading', props.plan.settingsSnapshot.brand.logoAsset?720:936, 180, 48, 36, 3), scenes: props.plan.scenes.map(scene => {
    const cue = props.cues.find(c => c.sceneId === scene.sceneId);
    if (!cue) throw new Error('Missing measured scene cue.');
    const caption = fit(cue.text, 'body', 880, 160, 44, 36, 2);
    const cps = graphemes(cue.text).length / ((cue.endFrame - cue.startFrame) / 30);
    if (cps > (props.plan.language === 'te' ? 18 : 24)) throw new Error('Captions are too fast for the measured phrase. Shorten the approved narration.');
    const cycle = scene.templateId === 'diagram.cycle', comparison = scene.templateId === 'diagram.comparison';
    // The earliest diagram card starts at y=612; heading starts at y=374.
    // Reserve a gap instead of allowing a long heading into the diagram.
    return {heading: fit(scene.props.heading, 'heading', 936, 220, 58, 38, 4), caption,
      labels: scene.props.nodes.map(n => fit(n.label, 'body', cycle ? 244 : comparison ? 374 : 700, cycle ? 118 : comparison ? 154 : 110, 36, 28, cycle ? 2 : 3))};
  })};
}
