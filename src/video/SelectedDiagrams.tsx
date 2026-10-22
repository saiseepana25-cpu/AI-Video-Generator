import React, {useEffect, useState} from 'react';
import {AbsoluteFill, Audio, cancelRender, continueRender, delayRender, interpolate, staticFile, useCurrentFrame} from 'remotion';
import type {SelectedVideoProps, TextLayout} from '../pipeline/selected-types.js';
import {computeSelectedLayout} from './selected-layout';

// All assets are supplied by the trusted adapter after checking their SHA256.
export async function loadSelectedFonts() {
  for (const role of ['heading', 'body', 'telugu'] as const) {
    const font = new FontFace(`VC-${role}`, `url("${staticFile(`fonts/${role}.woff2`)}")`, {weight: '400', style: 'normal'});
    document.fonts.add(await font.load());
  }
  await document.fonts.ready;
}
const family = (language: string, role: 'heading' | 'body') => language === 'te' ? `"VC-telugu", "VC-${role}"` : `"VC-${role}"`;
const Block: React.FC<{layout: TextLayout; language: string; role?: 'heading' | 'body'; centered?: boolean}> = ({layout, language, role = 'body', centered = false}) => <div style={{fontFamily: family(language, role), fontWeight: 400, fontSize: layout.fontSize, lineHeight: `${layout.lineHeight}px`, textAlign: centered ? 'center' : 'left', whiteSpace: 'pre'}}>{layout.lines.map((line, i) => <div key={i}>{line || '\u00a0'}</div>)}</div>;

export async function resolveSelectedProps(props: SelectedVideoProps): Promise<SelectedVideoProps> {
  await loadSelectedFonts();
  const context = document.createElement('canvas').getContext('2d');
  if (!context) throw new Error('Text measurement is unavailable.');
  const layout = computeSelectedLayout(props, (role, text, size) => {
    context.font = `400 ${size}px ${family(props.plan.language, role)}`;
    return context.measureText(text).width;
  });
  const checkHeight = (block: TextLayout, role: 'heading' | 'body') => {
    context.font = `400 ${block.fontSize}px ${family(props.plan.language, role)}`;
    if (block.lines.some(line => {const metrics = context.measureText(line); return metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent > block.lineHeight;})) throw new Error('Glyph height exceeds the readable text area. Review shorter text.');
  };
  checkHeight(layout.title, 'heading');
  for (const scene of layout.scenes) {checkHeight(scene.heading, 'heading'); checkHeight(scene.caption, 'body'); scene.labels.forEach(label => checkHeight(label, 'body'));}
  return {...props, layout};
}

export const SelectedDiagrams: React.FC<SelectedVideoProps> = props => {
  const frame = useCurrentFrame(), {plan, cues} = props;
  const [handle] = useState(() => delayRender('Load verified local fonts and measured layouts'));
  useEffect(() => {loadSelectedFonts().then(() => continueRender(handle)).catch(() => cancelRender(new Error('Verified local video fonts could not load.')));}, [handle]);
  if (!props.layout) return null;
  const found = cues.findIndex(c => frame < c.endFrame), activeIndex = found < 0 ? cues.length - 1 : found, cue = cues[activeIndex];
  const sceneIndex = plan.scenes.findIndex(s => s.sceneId === cue.sceneId), scene = plan.scenes[sceneIndex], layout = props.layout.scenes[sceneIndex];
  const colors = plan.settingsSnapshot.brand.colors, n = scene.props.nodes.length;
  const cycle = scene.templateId === 'diagram.cycle', comparison = scene.templateId === 'diagram.comparison';
  const points = scene.props.nodes.map((_, i) => cycle ? {x: 540 + Math.sin(i * 2 * Math.PI / n) * 300, y: 980 - Math.cos(i * 2 * Math.PI / n) * 270, w: 280, h: 158}
    : comparison ? {x: i % 2 === 0 ? 314 : 766, y: 720 + Math.floor(i / 2) * 234, w: 410, h: 196}
      : {x: 540, y: 672 + i * 150, w: 760, h: 120});
  const reveal = interpolate(frame - cue.startFrame, [0, 16], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const progress = Math.max(0, Math.min(1, frame / props.durationInFrames));
  return <AbsoluteFill style={{background: colors.canvas, color: colors.text, fontFamily: family(plan.language, 'body')}}>
    <Audio src={staticFile(props.audioFile)}/>
    <div style={{position: 'absolute', left: 72, right: 72, top: 160, color: plan.settingsSnapshot.brand.revisionId?colors.text:colors.accent}}><Block layout={props.layout.title} language={plan.language} role="heading"/></div>
    <div style={{position: 'absolute', top: 374, left: 72, right: 72}}><Block layout={layout.heading} language={plan.language} role="heading"/></div>
    <svg width="1080" height="1920" viewBox="0 0 1080 1920" style={{position: 'absolute', inset: 0}} aria-label={scene.templateId}>
      <defs><marker id="vc-arrow" markerWidth="9" markerHeight="9" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8" fill={colors.secondary}/></marker></defs>
      {!comparison && points.map((p, i) => {
        if (!cycle && i === points.length - 1) return null;
        const q = points[(i + 1) % n], dx = q.x - p.x, dy = q.y - p.y, distance = Math.hypot(dx, dy), ux = dx / distance, uy = dy / distance;
        // Intersect center-to-center direction with each rectangular card boundary.
        const margin = (v: typeof p) => Math.min((v.w / 2 + 12) / (Math.abs(ux) || .00001), (v.h / 2 + 12) / (Math.abs(uy) || .00001));
        const start = margin(p), end = margin(q), x1 = p.x + ux * start, y1 = p.y + uy * start, x2 = q.x - ux * end, y2 = q.y - uy * end;
        const path = cycle ? `M${x1},${y1} Q${(x1 + x2) / 2 - uy * 38},${(y1 + y2) / 2 + ux * 38} ${x2},${y2}` : `M${x1},${y1} L${x2},${y2}`;
        return <path key={i} d={path} fill="none" stroke={colors.secondary} strokeWidth="4" markerEnd="url(#vc-arrow)" opacity={reveal} strokeDasharray="10 6" strokeDashoffset={-Math.min(frame - cue.startFrame, cue.speechEndFrame - cue.startFrame) / 2}/>;
      })}
    </svg>
    {points.map((p, i) => <div key={scene.props.nodes[i].nodeId} style={{position: 'absolute', left: p.x - p.w / 2, top: p.y - p.h / 2, width: p.w, height: p.h,
      borderRadius: 26, border: `2px solid ${colors.accent}`, background: colors.surface, display: 'flex', alignItems: 'center', justifyContent: 'center',
      opacity: reveal, transform: `translateY(${(1 - reveal) * 14}px)`}}><Block layout={layout.labels[i]} language={plan.language} centered/></div>)}
    {frame >= cue.startFrame && frame < cue.endFrame && <div style={{position: 'absolute', left: 72, right: 72, top: 1480, height: 194, padding: '16px 28px', borderRadius: 24,
      boxSizing: 'border-box', border: `1px solid ${colors.accent}`, background: colors.surface, display: 'flex', justifyContent: 'center', alignItems: 'center'}}><Block layout={layout.caption} language={plan.language} centered/></div>}
    {props.mode === 'offline-diagnostic' && <div style={{position: 'absolute', left: 72, top: 344, fontSize: 20, color: plan.settingsSnapshot.brand.revisionId?colors.text:colors.secondary}}>eSpeak · {plan.language === 'te' ? 'ఆఫ్‌లైన్ పరీక్ష' : 'OFFLINE DIAGNOSTIC'}</div>}
    <div style={{position: 'absolute', left: 72, right: 72, top: 1440, height: 4, background: colors.surface}}><div style={{height: 4, width: `${progress * 100}%`, background: colors.secondary}}/></div>
  </AbsoluteFill>;
};
