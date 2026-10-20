import React, {useEffect, useState} from 'react';
import {AbsoluteFill, Audio, cancelRender, continueRender, delayRender, interpolate, staticFile, useCurrentFrame} from 'remotion';
import type {VideoProps} from '../pipeline/schema.js';
import '@fontsource/noto-sans/latin-400.css';
import '@fontsource/noto-sans/latin-600.css';
import '@fontsource/noto-sans-telugu/telugu-400.css';
import '@fontsource/noto-sans-telugu/telugu-600.css';

const ink = '#173342', blue = '#3660d9', muted = '#667a7f';
const phases = ['overview', 'evaporation', 'condensation', 'rain', 'collection'];
const labels = {
  en: ['The water cycle', 'Evaporation', 'Condensation', 'Precipitation', 'Collection'],
  te: ['నీటి చక్రం', 'ఆవిరి కావడం', 'బిందువులుగా మారడం', 'వర్షం కురవడం', 'నీరు చేరడం'],
};
const font = (language: string) => language === 'te' ? '"Noto Sans Telugu", sans-serif' : '"Noto Sans", sans-serif';
const fitSize = (text: string, family: string, width: number, height: number, maximum: number, minimum: number, lineHeight = 1.6) => {
  const context = document.createElement('canvas').getContext('2d')!;
  for (let size = maximum; size >= minimum; size -= 2) {
    context.font = `${size}px ${family}`;
    let lines = 1, line = '';
    for (const word of text.split(/\s+/)) {
      if (context.measureText(word).width > width) {lines += Math.ceil(context.measureText(word).width / width) - 1;}
      const candidate = line ? `${line} ${word}` : word;
      if (context.measureText(candidate).width > width && line) {lines++; line = word;} else line = candidate;
    }
    if (lines * size * lineHeight <= height) return size;
  }
  return minimum;
};

const ConceptDiagram: React.FC<{props: VideoProps; active: number; frame: number}> = ({props, active, frame}) => {
  const scenes = props.scenes || [];
  const step = 730 / Math.max(1, scenes.length);
  return <svg viewBox="0 0 1000 850" width="100%" height="100%" aria-label="Labeled process diagram">
    <defs><marker id="flow-arrow" markerWidth="8" markerHeight="8" refX="5" refY="3" orient="auto"><path d="M0 0L6 3L0 6" fill={blue}/></marker></defs>
    {scenes.map((scene, i) => <g key={scene.id} transform={`translate(170,${55 + i * step})`} opacity={i > active ? .4 : 1}>
      {i < scenes.length - 1 && <path d={`M330 94V${step - 10}`} stroke={i < active ? blue : '#a6b9b1'} strokeWidth="4" strokeDasharray="7 8" strokeDashoffset={i === active ? -frame : 0} markerEnd="url(#flow-arrow)"/>}
      <rect width="660" height="94" rx="24" fill={i === active ? '#e0e8ff' : '#f8faf4'} stroke={i === active ? blue : '#c9d6ce'} strokeWidth={i === active ? 4 : 2}/>
      <circle cx="50" cy="47" r="25" fill={i <= active ? blue : '#a4b6ac'}/>
      <text x="50" y="57" textAnchor="middle" fontSize="27" fill="white" fontFamily={font('en')}>{i + 1}</text>
      <foreignObject x="100" y="8" width="530" height="78"><div style={{height: 78, display: 'flex', alignItems: 'center', color: ink, fontSize: fitSize(scene.label[props.spokenLanguage], font(props.spokenLanguage), 530, 76, 31, 23, 1.3), lineHeight: 1.3, overflowWrap: 'anywhere', fontFamily: font(props.spokenLanguage)}}>{scene.label[props.spokenLanguage]}</div></foreignObject>
    </g>)}
  </svg>;
};

export const WaterCycle: React.FC<VideoProps> = (props) => {
  const frame = useCurrentFrame();
  const [fontHandle] = useState(() => delayRender('Loading locally bundled English and Telugu fonts'));
  useEffect(() => {
    Promise.all([document.fonts.load('600 80px "Noto Sans Telugu"', 'నీటి చక్రం'), document.fonts.load('600 80px "Noto Sans"', 'Water')])
      .then(() => continueRender(fontHandle)).catch((error) => cancelRender(error));
  }, [fontHandle]);
  const cue = props.cues.find((item) => frame >= item.startFrame && frame < item.endFrame);
  const prior = [...props.cues].reverse().find((item) => frame >= item.startFrame);
  const phase = cue?.phase || prior?.phase || 'overview';
  const isConcept = props.template === 'concept-flow';
  const sceneId = cue?.sceneId || prior?.sceneId || props.scenes?.[0]?.id;
  const index = isConcept ? Math.max(0, props.scenes?.findIndex((scene) => scene.id === sceneId) ?? 0) : phases.indexOf(phase);
  const firstFrame = props.cues.find((item) => isConcept ? item.sceneId === sceneId : item.phase === phase)?.startFrame || 0;
  const reveal = interpolate(frame - firstFrame, [0, 18], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const activeCue = cue || prior;
  const showEvap = phase === 'overview' || (phase === 'evaporation' && activeCue?.id === 'evap-b');
  const showCloud = phase === 'overview' || phase === 'condensation';
  const showRain = phase === 'overview' || (phase === 'rain' && activeCue?.id === 'rain-b');
  const text = cue?.text[props.captionLanguage] || '';
  const phaseTitle = cue?.label?.[props.spokenLanguage] || prior?.label?.[props.spokenLanguage] || labels[props.spokenLanguage][index];

  return <AbsoluteFill style={{background: '#f5f3eb', color: ink, fontFamily: font(props.spokenLanguage)}}>
    {props.audioFile ? <Audio src={staticFile(props.audioFile)}/> : null}
    <div style={{position: 'absolute', left: 76, top: 72, display: 'flex', alignItems: 'center', gap: 18}}>
      <div style={{width: 45, height: 45, background: blue, borderRadius: 13, display: 'flex', justifyContent: 'center', alignItems: 'center'}}>
        <svg width="24" height="24" viewBox="0 0 24 24"><path d="M7 4L20 12L7 20Z" fill="white"/></svg>
      </div>
      <span style={{fontFamily: font('en'), fontWeight: 600, fontSize: 34, letterSpacing: -1}}>VideoCraft</span>
    </div>
    <div style={{position: 'absolute', right: 76, top: 82, fontFamily: font('en'), fontSize: 22, color: muted, letterSpacing: 2}}>SCIENCE / 001</div>
    <div style={{position: 'absolute', left: 76, right: 76, top: 175}}>
      <div style={{fontSize: fitSize(props.title[props.spokenLanguage], font(props.spokenLanguage), 928, 175, props.spokenLanguage === 'te' ? 96 : 104, 60, 1.24), fontWeight: 600, letterSpacing: props.spokenLanguage === 'te' ? 0 : -3, lineHeight: 1.24, overflowWrap: 'anywhere'}}>{props.title[props.spokenLanguage]}</div>
      <div style={{marginTop: 25, fontSize: 30, lineHeight: 1.6, color: muted}}>{isConcept ? (props.spokenLanguage === 'te' ? 'ప్రతి దశను సులభంగా తెలుసుకుందాం.' : 'A simple idea, explained step by step.') : (props.spokenLanguage === 'te' ? 'భూమి నుంచి ఆకాశానికి. మళ్లీ భూమికి.' : 'From earth to sky. And back again.')}</div>
    </div>

    <div style={{position: 'absolute', left: 60, right: 60, top: 440, height: 820, background: '#e9eee6', border: '2px solid #d9e2d9', borderRadius: 40, overflow: 'hidden'}}>
      {isConcept ? <ConceptDiagram props={props} active={index} frame={frame}/> : <svg viewBox="0 0 1000 850" width="100%" height="100%" aria-label="Animated water-cycle diagram">
        <defs>
          <linearGradient id="sky" x2="0" y2="1"><stop stopColor="#e1edf0"/><stop offset="1" stopColor="#f5f5e9"/></linearGradient>
          <linearGradient id="water" x2="0" y2="1"><stop stopColor="#83d0df"/><stop offset="1" stopColor="#419eb9"/></linearGradient>
          <marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto"><path d="M0 0L8 4L0 8" fill="none" stroke={blue} strokeWidth="2"/></marker>
        </defs>
        <rect width="1000" height="850" fill="url(#sky)"/>
        <circle cx="175" cy="175" r="100" fill="#f5cf6d" opacity=".15"/>
        <g transform={`rotate(${frame * 0.12},175,175)`}>{Array.from({length: 12}, (_, i) => <line key={i} x1="175" y1="92" x2="175" y2="77" stroke="#e8ae32" strokeWidth="5" strokeLinecap="round" transform={`rotate(${i * 30},175,175)`}/>)}</g>
        <circle cx="175" cy="175" r="59" fill="#f4be48"/>
        <path d="M0 540L180 337L337 495L535 315L745 540L1000 420V850H0Z" fill="#c0d1bf"/>
        <path d="M358 501L535 315L700 496L590 445L531 470L465 426Z" fill="#f5f5ec"/>
        <path d="M0 624Q210 514 410 609T1000 563V850H0Z" fill="#adc49a"/>
        <path d="M0 696Q215 608 465 689Q670 758 1000 665V850H0Z" fill="url(#water)"/>
        {[0, 1, 2].map((line) => <path key={line} d={`M-80 ${745 + line * 35}Q80 ${725 + line * 35} 240 ${745 + line * 35}T560 ${745 + line * 35}T880 ${745 + line * 35}T1200 ${745 + line * 35}`} stroke="#c8edf0" fill="none" strokeWidth="3" opacity=".55" transform={`translate(${Math.sin(frame / 35 + line) * 22},0)`}/>)}
        <path d="M624 497Q582 537 672 578T685 670" stroke="#d0ece4" strokeWidth="20" fill="none"/>
        {[100, 164, 861, 922].map((x, i) => <g key={x} transform={`translate(${x},${600 + i % 2 * 20})`}><rect x="-5" width="10" height="45" fill="#7d8061"/><path d="M-28 7L0-48L28 7Z" fill="#5e8b6a"/><path d="M-23-15L0-66L23-15Z" fill="#729d78"/></g>)}

        <g opacity={showEvap ? (phase === 'overview' ? .45 : reveal) : .12}>
          {[0, 1, 2].map((i) => <g key={i}>
            <path d={`M${265 + i * 62} 635C${225 + i * 62} 535 ${330 + i * 50} 425 ${410 + i * 40} 344`} stroke={blue} strokeWidth="5" fill="none" strokeDasharray="10 13" strokeDashoffset={-frame * 1.8} markerEnd="url(#arrow)"/>
            <circle cx={285 + i * 60} cy={615 - (frame * 2 + i * 83) % 210} r="7" fill="#6d94dc" opacity=".65"/>
          </g>)}
        </g>
        <g transform={`translate(${phase === 'condensation' ? Math.sin(frame / 30) * 5 : 0},0)`}>
          <g fill={showCloud ? '#fcfdf6' : '#e5ece5'} stroke="#cad8d4" strokeWidth="3">
            <path d="M510 300C468 290 470 232 514 226C503 164 591 139 622 185C664 133 739 163 741 211C802 208 825 277 779 302Z"/>
          </g>
          {showCloud && Array.from({length: 12}, (_, i) => <circle key={i} cx={520 + i % 6 * 45} cy={230 + Math.floor(i / 6) * 33 + Math.sin(frame / 18 + i) * 5} r="4" fill="#a5c4cf" opacity={phase === 'condensation' ? reveal : .35}/>)}
        </g>
        <g opacity={showRain ? (phase === 'overview' ? .4 : reveal) : 0}>
          {Array.from({length: 15}, (_, i) => {
            const x = 540 + i % 5 * 48, y = 330 + (frame * 4 + Math.floor(i / 5) * 70) % 250;
            return <path key={i} d={`M${x} ${y}l-9 22`} stroke="#397fae" strokeWidth="5" strokeLinecap="round"/>;
          })}
        </g>
        {phase === 'collection' && [0, 1, 2].map((i) => <ellipse key={i} cx="720" cy="735" rx={30 + (frame + i * 20) % 85} ry={7 + (frame + i * 20) % 23} stroke="#e3f6ed" fill="none" strokeWidth="3" opacity={.8 - ((frame + i * 20) % 85) / 130}/>)}
        <g transform="translate(46,40)">
          <rect width="90" height="40" rx="20" fill="#f8faf3" opacity=".95"/>
          <text x="45" y="27" textAnchor="middle" fill={ink} style={{fontFamily: font('en'), fontSize: 18, fontWeight: 600}}>CYCLE</text>
        </g>
      </svg>}
    </div>

    <div style={{position: 'absolute', top: 1310, left: 80, right: 80}}>
      <div style={{display: 'flex', alignItems: 'center', gap: 20}}>
        <div style={{background: blue, color: 'white', fontFamily: font('en'), borderRadius: '50%', width: 60, height: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28}}>{String(index + 1).padStart(2, '0')}</div>
        <div style={{fontSize: fitSize(phaseTitle || '', font(props.spokenLanguage), 790, 100, 46, 30, 1.5), fontWeight: 600, lineHeight: 1.5}}>{phaseTitle}</div>
      </div>
      <div style={{display: 'flex', gap: 12, marginTop: 25}}>{(isConcept ? props.scenes?.map((scene) => scene.id) || [] : phases).map((item, i) => <div key={item} style={{height: 5, flex: 1, borderRadius: 8, background: i <= index ? blue : '#d7dfd8'}}/>)}</div>
    </div>

    <div style={{position: 'absolute', top: 1470, left: 76, right: 76, height: 235, borderTop: '1px solid #d4dcd5', display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
      <div style={{fontFamily: font(props.captionLanguage), textAlign: 'center', fontSize: fitSize(text, font(props.captionLanguage), 928, 220, 46, 30), lineHeight: 1.6, color: ink, fontWeight: 400, overflowWrap: 'anywhere'}}>{text}</div>
    </div>
    <div style={{position: 'absolute', bottom: 95, left: 76, right: 76, display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontFamily: font('en'), color: muted, fontSize: 19}}>
      <span>{props.mode === 'offline-diagnostic' ? 'OFFLINE TEST · ROBOTIC VOICE · SAMPLE SCRIPT' : props.mode === 'elevenlabs' ? `ELEVENLABS · ${activeCue?.voiceName || 'Madhavi'} · VOICE TEST` : 'AI NARRATION · REVIEW BEFORE SHARING'}</span>
      <span>{props.spokenLanguage.toUpperCase()} → {props.captionLanguage.toUpperCase()}</span>
    </div>
    <div style={{position: 'absolute', height: 6, bottom: 0, left: 0, background: blue, width: `${frame / Math.max(1, props.durationInFrames - 1) * 100}%`}}/>
  </AbsoluteFill>;
};
