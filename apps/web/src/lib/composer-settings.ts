import type {ProjectSettings} from '../server/projects/contracts';
import type {WorkspaceDefaults} from '../server/settings/validation';
export type ComposerDraft={idea:string;language:'en'|'te';seconds:30|60|90;voiceCatalogId?:string|null;accentId?:string|null};
export function defaultComposerSettings(defaults:WorkspaceDefaults,language:'en'|'te'):ProjectSettings{
  return {language,targetSeconds:defaults.targetSeconds,voiceCatalogId:language===defaults.language?defaults.preferredVoiceCatalogId:null,accentId:language===defaults.language&&defaults.preferredVoiceCatalogId?defaults.preferredAccentId:null,brandKitRevisionId:null,themeId:defaults.themeId,captionStyleId:defaults.captionStyleId};
}
export function composerBody(value:ComposerDraft){return JSON.stringify({idea:value.idea,settings:{language:value.language,targetSeconds:value.seconds,accentId:value.accentId??null,voiceCatalogId:value.voiceCatalogId??null,brandKitRevisionId:null,themeId:'clean-educational-v1',captionStyleId:'readable-default-v1'}});}
export function composerVoiceValid(value:ComposerDraft){
  const voice=value.voiceCatalogId??null,accent=value.accentId??null;
  return (voice===null&&accent===null)||(typeof voice==='string'&&['alice-evaluation','madhavi','bharadwaj'].includes(voice)&&typeof accent==='string'&&['source-voice','en-IN','te-IN'].includes(accent));
}
