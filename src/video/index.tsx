import React from 'react';
import {Composition, registerRoot} from 'remotion';
import {WaterCycle} from './WaterCycle';
import type {VideoProps} from '../pipeline/schema.js';

const defaults: VideoProps = {
  title: {en: 'The water cycle', te: 'నీటి చక్రం'}, cues: [], spokenLanguage: 'en', captionLanguage: 'en', audioFile: '', durationInFrames: 900, mode: 'offline-diagnostic',
};
const Root: React.FC = () => <Composition id="WaterCycle" component={WaterCycle} width={1080} height={1920} fps={30} durationInFrames={900} defaultProps={defaults} calculateMetadata={({props}) => ({durationInFrames: props.durationInFrames})}/>;
registerRoot(Root);
