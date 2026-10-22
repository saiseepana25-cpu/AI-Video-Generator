import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import sharp from 'sharp';
import {initialBrand} from '../src/server/brand/palette';
import {buildRenderPlan,validateRenderPlan,generationHash} from '../src/server/rendering/contract';
import {parseBrandPut} from '../src/server/brand/validation';
import {editableBrandPalette,recoverBrandCommand} from '../src/lib/brand-command';
import {verifiedLogoBytes} from '../src/server/logos/bytes';
import {logoHash} from '../src/server/logos/image';
import {speechIdentity} from '../src/server/generation/speech-identity';
import {pins,renderFixture} from './fixtures/rendering';
test('logo identity is pinned for both languages, changes video hash but preserves speech reuse identity',()=>{
  const assetId=randomUUID(),revisionId=randomUUID(),logoAsset={assetId,sha256:'d'.repeat(64),size:123,width:200,height:100,contentType:'image/png' as const};
  for(const language of ['en','te'] as const){const f=renderFixture(language),selection={...f.settings,brandKitRevisionId:revisionId},brand={...initialBrand,revisionId};
    const plain=buildRenderPlan(f.proposal,f.brief,selection,pins,brand),logo=buildRenderPlan(f.proposal,f.brief,selection,pins,{...brand,logoAssetId:assetId,logoAsset});
    assert.deepEqual(validateRenderPlan(logo),logo);assert.deepEqual(logo.settingsSnapshot.brand.logoAsset,logoAsset);assert.notEqual(generationHash(plain),generationHash(logo));assert.equal(speechIdentity('workspace','project',plain,plain.narration[0].segmentId),speechIdentity('workspace','project',logo,logo.narration[0].segmentId));
    for(const patch of [{width:1025},{size:0},{sha256:'bad'},{contentType:'image/svg+xml'},{url:'https://example.com/logo'}]){const bad=structuredClone(logo);Object.assign(bad.settingsSnapshot.brand.logoAsset!,patch);assert.throws(()=>validateRenderPlan(bad));}
    assert.throws(()=>buildRenderPlan(f.proposal,f.brief,selection,pins,{...brand,logoAssetId:assetId}));
    assert.throws(()=>buildRenderPlan(f.proposal,f.brief,selection,pins,{...brand,logoAssetId:randomUUID(),logoAsset}));
  }
});
test('load -> logo edit -> save/recovery strips metadata and preserves exact selected asset',()=>{
  const id=randomUUID(),kit={...initialBrand,logoAssetId:id,id:randomUUID(),revision:3,createdAt:new Date().toISOString(),createdBy:{id:'a'.repeat(24)}};
  const body=parseBrandPut({expectedRevision:3,brandKit:{...editableBrandPalette(kit),primaryColor:'#FFFFFF'}}),command={key:randomUUID(),body};
  assert.equal(body.brandKit.logoAssetId,id);assert.deepEqual(recoverBrandCommand(JSON.stringify(command)),command);assert.equal(parseBrandPut({expectedRevision:4,brandKit:{...editableBrandPalette(kit),logoAssetId:null}}).brandKit.logoAssetId,null);
});
test('renderer refuses missing, replaced, misdimensioned and unexpected logo bytes',async()=>{
  const bytes=await sharp({create:{width:200,height:80,channels:4,background:{r:0,g:0,b:0,alpha:0}}}).png().toBuffer();
  const logo={assetId:randomUUID(),sha256:logoHash(bytes),size:bytes.length,width:200,height:80,contentType:'image/png' as const};
  assert.deepEqual(verifiedLogoBytes(logo,bytes),bytes);assert.equal(verifiedLogoBytes(null),null);
  assert.throws(()=>verifiedLogoBytes(logo));assert.throws(()=>verifiedLogoBytes(null,bytes));assert.throws(()=>verifiedLogoBytes({...logo,width:201},bytes));const corrupt=Buffer.from(bytes);corrupt[40]^=1;assert.throws(()=>verifiedLogoBytes(logo,corrupt));
});
