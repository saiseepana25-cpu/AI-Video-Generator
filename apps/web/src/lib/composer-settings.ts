import type {ProjectSettings} from '../server/projects/contracts';
import type {WorkspaceDefaults} from '../server/settings/validation';
export type ComposerDraft={idea:string;language:'en'|'te';seconds:30|60|90;voiceCatalogId?:string|null;accentId?:string|null;brandKitRevisionId?:string|null};
export function defaultComposerSettings(defaults:WorkspaceDefaults,language:'en'|'te',brandKitRevisionId:string|null=null):ProjectSettings{
  return {language,targetSeconds:defaults.targetSeconds,voiceCatalogId:language===defaults.language?defaults.preferredVoiceCatalogId:null,accentId:language===defaults.language&&defaults.preferredVoiceCatalogId?defaults.preferredAccentId:null,brandKitRevisionId,themeId:defaults.themeId,captionStyleId:defaults.captionStyleId};
}
export function composerBody(value:ComposerDraft){return JSON.stringify({idea:value.idea,settings:{language:value.language,targetSeconds:value.seconds,accentId:value.accentId??null,voiceCatalogId:value.voiceCatalogId??null,brandKitRevisionId:value.brandKitRevisionId??null,themeId:'clean-educational-v1',captionStyleId:'readable-default-v1'}});}
export function composerBrandValid(value:ComposerDraft){return value.brandKitRevisionId==null||(typeof value.brandKitRevisionId==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value.brandKitRevisionId));}
export function composerVoiceValid(value:ComposerDraft){
  const voice=value.voiceCatalogId??null,accent=value.accentId??null;
  return (voice===null&&accent===null)||(typeof voice==='string'&&['alice-evaluation','madhavi','bharadwaj'].includes(voice)&&typeof accent==='string'&&['source-voice','en-IN','te-IN'].includes(accent));
}
