import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {parseSettingsPatch,effectiveDefaults,type WorkspaceDefaults} from '../src/server/settings/validation';
import {recoverSettingsCommand} from '../src/lib/settings-command';
import {composerBody,defaultComposerSettings,composerVoiceValid} from '../src/lib/composer-settings';
import {canCorrectSaveFailure} from '../src/lib/save-outcome';
const defaults:WorkspaceDefaults={language:'en',targetSeconds:60,preferredVoiceCatalogId:null,preferredAccentId:null,themeId:'clean-educational-v1',captionStyleId:'readable-default-v1'};
test('settings accepts complete defaults and valid zones but refuses unsupported privileges and invalid values',()=>{
  assert.deepEqual(parseSettingsPatch({expectedRevision:1,patch:{timezone:'Asia/Kolkata',defaults}}),{expectedRevision:1,patch:{timezone:'Asia/Kolkata',defaults}});
  for(const raw of [{patch:{timezone:'UTC'}},{expectedRevision:'1',patch:{timezone:'UTC'}},{expectedRevision:0,patch:{timezone:'UTC'}},{expectedRevision:1,patch:{}},{expectedRevision:1,patch:{timezone:'Wrong/Place'}},{expectedRevision:1,patch:{timezone:' Asia/Kolkata'}},{expectedRevision:1,patch:{token:'secret'}},{expectedRevision:1,patch:{defaults:{...defaults,targetSeconds:'60'}}},{expectedRevision:1,patch:{defaults:{...defaults,preferredAccentId:'source-voice'}}},{expectedRevision:1,patch:{defaults:{...defaults,language:'hi'}}},{expectedRevision:1,patch:{defaults:{...defaults,themeId:'arbitrary'}}},{expectedRevision:1,patch:{defaults:{...defaults,preferredVoiceCatalogId:[]}}}])assert.throws(()=>parseSettingsPatch(raw));
});
test('legacy unresolved accent is normalized only in the read projection',()=>{
  const legacy={...defaults,preferredAccentId:'indian'};assert.equal(effectiveDefaults(legacy).preferredAccentId,null);assert.equal(legacy.preferredAccentId,'indian');
});
test('settings command recovery preserves exact revision/key/defaults and rejects malformed commands',()=>{
  const command={key:randomUUID(),body:{expectedRevision:4,patch:{timezone:'Asia/Kolkata',defaults}}};assert.deepEqual(recoverSettingsCommand(JSON.stringify(command)),command);
  for(const raw of ['invalid','x'.repeat(16001),JSON.stringify({...command,key:'invalid'}),JSON.stringify({...command,body:{expectedRevision:4,patch:{timezone:'UTC'}}}),JSON.stringify({...command,body:{...command.body,extra:true}})])assert.equal(recoverSettingsCommand(raw),null);
});
test('new composer settings inherit a matching-language voice and do not carry it across language override',()=>{
  const selected={...defaults,language:'te' as const,preferredVoiceCatalogId:'alice-evaluation',preferredAccentId:'source-voice'};
  assert.equal(defaultComposerSettings(selected,'te').voiceCatalogId,'alice-evaluation');assert.equal(defaultComposerSettings(selected,'en').voiceCatalogId,null);assert.equal(defaultComposerSettings(selected,'en').accentId,null);
});
test('legacy pending create bodies stay unchanged and captured voices survive future defaults changes',()=>{
  const legacy={idea:'Water',language:'en' as const,seconds:60 as const};
  const oldBody=JSON.stringify({idea:'Water',settings:{language:'en',targetSeconds:60,accentId:null,voiceCatalogId:null,brandKitRevisionId:null,themeId:'clean-educational-v1',captionStyleId:'readable-default-v1'}});
  assert.equal(composerBody(legacy),oldBody);assert.equal(composerVoiceValid(legacy),true);
  const pinned={...legacy,voiceCatalogId:'alice-evaluation',accentId:'source-voice'},before=composerBody(pinned);defaultComposerSettings({...defaults,language:'te'},'te');assert.equal(composerBody(pinned),before);
  assert.equal(composerVoiceValid({...legacy,voiceCatalogId:'alice-evaluation'}),false);assert.equal(composerVoiceValid({...legacy,voiceCatalogId:'other',accentId:'source-voice'}),false);
});
test('explicit pre-write voice refusal can be corrected while ambiguous saves retain their original command',()=>{
  assert.equal(canCorrectSaveFailure(503,'VOICE_UNAVAILABLE'),true);assert.equal(canCorrectSaveFailure(409,'STALE_REVISION'),true);
  for(const [status,code]of [[503,'CONNECTION_UNAVAILABLE'],[500,'INTERNAL_ERROR'],[401,'AUTHENTICATION_REQUIRED'],[500,'VOICE_UNAVAILABLE']] as const)assert.equal(canCorrectSaveFailure(status,code),false);
});
