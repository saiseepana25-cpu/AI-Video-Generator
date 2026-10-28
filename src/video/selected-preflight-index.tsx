import React from 'react';
import {Composition, getInputProps, registerRoot} from 'remotion';
import type {RenderPlan} from '../pipeline/render-contract';
import type {SelectedLayout} from '../pipeline/selected-types';
import {resolveSpatialLayout} from './selected-font-layout';
type Props = {plan: RenderPlan; layout: SelectedLayout | null};
const Empty: React.FC<Props> = () => null;
const Root: React.FC = () => <Composition id="SelectedLayoutPreflight" component={Empty} width={1080} height={1920} fps={30} durationInFrames={1}
  defaultProps={getInputProps<Props>()} calculateMetadata={async ({props}: {props: Props}) => ({props: {...props, layout: await resolveSpatialLayout(props.plan)}})}/>;
registerRoot(Root);
