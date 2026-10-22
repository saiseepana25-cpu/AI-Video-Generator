import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {initialBrand,parseBrandPut,contrast,brandTextColor} from '../src/server/brand/validation';
import {editableBrandPalette,recoverBrandCommand} from '../src/lib/brand-command';
import type {BrandView} from '../src/server/brand/service';
import {composerBody,composerBrandValid,defaultComposerSettings} from '../src/lib/composer-settings';

test('new composers capture a brand revision while old recovered pending bodies retain null branding',()=>{
  const id=randomUUID(),defaults={language:'en' as const,targetSeconds:60 as const,preferredVoiceCatalogId:null,preferredAccentId:null,themeId:initialBrand.themeId,captionStyleId:'readable-default-v1'};
  assert.equal(defaultComposerSettings(defaults,'te',id).brandKitRevisionId,id);
  const legacy={idea:'Water',language:'en' as const,seconds:60 as const};
  const oldBody=JSON.stringify({idea:'Water',settings:{language:'en',targetSeconds:60,accentId:null,voiceCatalogId:null,brandKitRevisionId:null,themeId:'clean-educational-v1',captionStyleId:'readable-default-v1'}});
  assert.equal(composerBody(legacy),oldBody);assert.ok(composerBrandValid(legacy));assert.ok(composerBrandValid({...legacy,brandKitRevisionId:id}));assert.equal(composerBrandValid({...legacy,brandKitRevisionId:'invalid'}),false);
  assert.equal(JSON.parse(composerBody({...legacy,brandKitRevisionId:id})).settings.brandKitRevisionId,id);
  assert.equal(JSON.parse(composerBody({...legacy,brandKitRevisionId:null})).settings.brandKitRevisionId,null);
});

test('loaded and confirmed brand revisions can be edited and saved without response metadata',()=>{
  const loaded:BrandView={revision:1,brandKit:{...initialBrand,id:randomUUID(),revision:1,createdAt:'2026-10-22T00:00:00.000Z',createdBy:{id:'0123456789abcdef01234567'}}};
  assert.throws(()=>parseBrandPut({expectedRevision:loaded.revision,brandKit:{...loaded.brandKit,primaryColor:'#FFFFFF'}}),/unsupported brand fields/);
  const draft=editableBrandPalette(loaded.brandKit);
  const save=parseBrandPut({expectedRevision:loaded.revision,brandKit:{...draft,primaryColor:'#FFFFFF'}});
  assert.deepEqual(save,{expectedRevision:1,brandKit:{...initialBrand,primaryColor:'#FFFFFF'}});
  assert.deepEqual(Object.keys(draft).sort(),Object.keys(initialBrand).sort());
  assert.equal(loaded.brandKit!.primaryColor,initialBrand.primaryColor);
  const confirmed:BrandView={revision:2,brandKit:{...save.brandKit,id:randomUUID(),revision:2,createdAt:'2026-10-22T00:01:00.000Z',createdBy:loaded.brandKit!.createdBy}};
  const nextSave=parseBrandPut({expectedRevision:confirmed.revision,brandKit:{...editableBrandPalette(confirmed.brandKit),secondaryColor:'#FFFFFF'}});
  assert.deepEqual(nextSave,{expectedRevision:2,brandKit:{...initialBrand,primaryColor:'#FFFFFF',secondaryColor:'#FFFFFF'}});
  assert.deepEqual(recoverBrandCommand(JSON.stringify({key:randomUUID(),body:nextSave}))?.body,nextSave);
  const first=editableBrandPalette(null);first.primaryColor='#FFFFFF';assert.equal(initialBrand.primaryColor,'#B7A4FF');
});
test('brand colors normalize and complete curated palettes accept revision zero',()=>{
  assert.deepEqual(parseBrandPut({expectedRevision:0,brandKit:{...initialBrand,primaryColor:'#b7a4ff'}}),{expectedRevision:0,brandKit:initialBrand});
  assert.doesNotThrow(()=>parseBrandPut({expectedRevision:12,brandKit:{...initialBrand,primaryColor:'#3660D9',secondaryColor:'#173342',backgroundColor:'#F5F3EB'}}));
});
test('brand rejects incomplete objects, markup, unsupported assets/fonts/themes and unsafe revisions',()=>{
  for(const raw of [{brandKit:initialBrand},{expectedRevision:-1,brandKit:initialBrand},{expectedRevision:'0',brandKit:initialBrand},{expectedRevision:Number.MAX_SAFE_INTEGER+1,brandKit:initialBrand},{expectedRevision:0,brandKit:{}},{expectedRevision:0,brandKit:{...initialBrand,primaryColor:'red'}},{expectedRevision:0,brandKit:{...initialBrand,logoAssetId:randomUUID()}},{expectedRevision:0,brandKit:{...initialBrand,englishFontId:'https://font'}},{expectedRevision:0,brandKit:{...initialBrand,themeId:'custom'}},{expectedRevision:0,brandKit:{...initialBrand,css:'<style>'}},{expectedRevision:0,brandKit:{...initialBrand,teluguFontId:null}}])assert.throws(()=>parseBrandPut(raw));
});
test('diagram colors must contrast with background and normal text selects readable black or white',()=>{
  for(const key of ['primaryColor','secondaryColor'])assert.throws(()=>parseBrandPut({expectedRevision:0,brandKit:{...initialBrand,[key]:initialBrand.backgroundColor}}),/3:1/);
  assert.equal(contrast('#FFFFFF','#000000'),21);assert.equal(contrast('#000000','#FFFFFF'),21);
  for(let n=0;n<=255;n++){const bg=`#${n.toString(16).padStart(2,'0').repeat(3)}`;assert.ok(contrast(brandTextColor(bg),bg)>=4.5);}
});
test('brand command recovery preserves original normalized body and key, rejects corrupt commands',()=>{
  const command={key:randomUUID(),body:{expectedRevision:4,brandKit:initialBrand}};
  assert.deepEqual(recoverBrandCommand(JSON.stringify(command)),command);
  for(const raw of ['invalid','x'.repeat(16001),JSON.stringify({...command,key:'bad'}),JSON.stringify({...command,body:{...command.body,brandKit:{...initialBrand,primaryColor:''}}}),JSON.stringify({...command,extra:true})])assert.equal(recoverBrandCommand(raw),null);
});
