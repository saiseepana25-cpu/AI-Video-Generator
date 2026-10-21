// React-free contract bridge. The existing bilingual diagnostic renderer stays v1.
// The F10 selected-language adapter must validate this contract, not cast it to v1.
export {buildRenderPlan, validateRenderPlan, generationHash, canonicalJson, RENDER_CONTRACT, type RenderPlan, type FontPins} from '../../apps/web/src/server/rendering/contract';
