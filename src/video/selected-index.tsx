import React from 'react';
import {Composition, getInputProps, registerRoot} from 'remotion';
import type {SelectedVideoProps} from '../pipeline/selected-types.js';
import {SelectedDiagrams, resolveSelectedProps} from './SelectedDiagrams';
const Root: React.FC = () => <Composition id="SelectedDiagrams" component={SelectedDiagrams} width={1080} height={1920} fps={30} durationInFrames={900}
  defaultProps={getInputProps<SelectedVideoProps>()}
  calculateMetadata={async ({props}: {props: SelectedVideoProps}) => ({durationInFrames: props.durationInFrames, props: await resolveSelectedProps(props)})}/>;
registerRoot(Root);
