import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {initialBrand,parseBrandPut,contrast,brandTextColor} from '../src/server/brand/validation';
import {recoverBrandCommand} from '../src/lib/brand-command';
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
