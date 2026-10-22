import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {emptyPreferences,parsePreferencesPatch,validatePreferencePair} from '../src/server/preferences/validation';
import {recoverPreferencesCommand} from '../src/lib/preferences-command';
import {defaultComposerSettings,composerBody} from '../src/lib/composer-settings';
const body={expectedRevision:1,patch:{...emptyPreferences,language:'te' as const,timezone:'Asia/Kolkata'}};
test('personal preferences allow explicit inheritance and reject hidden fields, unsafe revisions and invalid timezones',()=>{
  assert.deepEqual(parsePreferencesPatch(body),body);assert.deepEqual(parsePreferencesPatch({expectedRevision:2,patch:{timezone:null}}),{expectedRevision:2,patch:{timezone:null}});
  for(const v of [{patch:{}},{...body,expectedRevision:0},{...body,expectedRevision:Number.MAX_SAFE_INTEGER+1},{...body,workspaceId:randomUUID()},{expectedRevision:1,patch:{}},{expectedRevision:1,patch:{language:'hi'}},{expectedRevision:1,patch:{timezone:'not/a/zone'}},{expectedRevision:1,patch:{timezone:' UTC '}},{expectedRevision:1,patch:{userId:'other'}},{expectedRevision:1,patch:{accentId:'indian'}}])assert.throws(()=>parsePreferencesPatch(v));
  assert.throws(()=>validatePreferencePair({...emptyPreferences,language:'en',voiceCatalogId:'alice-evaluation'}));assert.throws(()=>validatePreferencePair({...emptyPreferences,voiceCatalogId:'alice-evaluation',accentId:'source-voice'}));
});
test('exact personal command recovery preserves null clearing and refuses partial/corrupt recovery',()=>{
  const command={key:randomUUID(),body};assert.deepEqual(recoverPreferencesCommand(JSON.stringify(command)),command);
  for(const raw of ['null','bad',JSON.stringify({...command,extra:1}),JSON.stringify({...command,key:'bad'}),JSON.stringify({...command,body:{expectedRevision:1,patch:{timezone:null}}}),JSON.stringify({...command,body:{...body,patch:{...body.patch,timezone:''}}})])assert.equal(recoverPreferencesCommand(raw),null);
});
test('new composers prefer the personal voice/language but retain workspace duration and exact old create bodies',()=>{
  const defaults={language:'en' as const,targetSeconds:60 as const,preferredVoiceCatalogId:'alice-evaluation',preferredAccentId:'source-voice',themeId:'clean-educational-v1',captionStyleId:'readable-default-v1'},personal={...emptyPreferences,language:'te' as const,voiceCatalogId:'alice-evaluation',accentId:'source-voice'};
  const own=defaultComposerSettings(defaults,'te',null,personal);assert.equal(own.voiceCatalogId,'alice-evaluation');assert.equal(own.accentId,'source-voice');assert.equal(own.targetSeconds,60);
  const cleared=defaultComposerSettings(defaults,'te',null,{...personal,voiceCatalogId:null,accentId:null});assert.equal(cleared.voiceCatalogId,null);
  const inherited=defaultComposerSettings(defaults,'en',null,emptyPreferences);assert.equal(inherited.voiceCatalogId,'alice-evaluation');
  assert.equal(defaultComposerSettings(defaults,'en',null,personal).language,'en');
  const recovered={idea:'Water',language:'en' as const,seconds:30 as const};const original=composerBody(recovered);defaultComposerSettings(defaults,'te',null,personal);assert.equal(composerBody(recovered),original);assert.equal(JSON.parse(original).settings.voiceCatalogId,null);
});
