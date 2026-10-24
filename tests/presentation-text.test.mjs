import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {originalI18n as i18n} from './helpers/localization-model.mjs';
import {presentationText,rememberPresentationText,renderPresentationText} from '../src/system/presentation-text.mjs';

test('early catalog translations retain source hashes, exact English guards and the bundled source license',()=>{
 const read=path=>JSON.parse(fs.readFileSync(new URL('../'+path,import.meta.url),'utf8'));
 const manifest=read('docs/early-catalog-translation-sources.json'),en=read('locales/en/early-catalog.json'),zh=read('locales/zh-Hans/early-catalog.json');
 const digest=s=>createHash('sha256').update(s).digest('hex'),normalize=s=>s.replace(/[‘’]/g,"'").replace(/\s+/g,' ').trim();
 assert.equal(manifest.commit,'2bf639e5572812a67d2b94903fdcb9d095f5aeb2');
 assert.equal(manifest.entries.length,961);assert.equal(manifest.entries.filter(e=>e.versionGroup).length,848);
 const seen=new Set();
 for(const entry of manifest.entries){
  const key=entry.enumName.toLowerCase().replace(/_([a-z0-9])/g,(_,c)=>c.toUpperCase()),id=`${entry.namespace}:${entry.id}`;
  assert.equal(seen.has(id),false,id);seen.add(id);
  assert.equal(digest(normalize(en[entry.namespace][key][entry.field])),entry.englishSha256,id);
  assert.equal(digest(zh[entry.namespace][key][entry.field]),entry.chineseSha256,id);
 }
 const license=fs.readFileSync(new URL('../'+manifest.license,import.meta.url));
 assert.equal(digest(license),manifest.files.find(f=>f.file==='LICENSE.md').sha256);
});

test('original translation provenance carries nested catalog names across languages without matching English sentences',async()=>{
 await i18n.changeLanguage('en');
 const pokemonName=i18n.t('pokemon:bulbasaur');
 const text=i18n.t('battle:levelUp',{pokemonName,level:7});
 const wire=structuredClone(presentationText(text));assert.ok(wire);assert.equal(wire.key,'battle:levelUp');
 assert.equal(wire.values.pokemonName.key,'pokemon:bulbasaur');
 await i18n.changeLanguage('zh-Hans');
 assert.equal(renderPresentationText(wire,i18n.t.bind(i18n),()=>undefined),i18n.t('battle:levelUp',{pokemonName:'妙蛙种子',level:7}));
 await i18n.changeLanguage('en');
 assert.equal(renderPresentationText(wire,i18n.t.bind(i18n),()=>undefined),text);
});

test('joined personal Pokemon text resolves a stable Pokemon identity and translated original status content',async()=>{
 await i18n.changeLanguage('en');
 const effect=i18n.t('statusEffect:burn.activation',{pokemonNameWithAffix:''});
 const wire={kind:'joined',parts:[{kind:'pokemon-name',pokemonId:42,affix:'wildPokemonWithAffix',fallback:'Old name'},presentationText(effect)]};
 await i18n.changeLanguage('zh-Hans');
 const text=renderPresentationText(wire,i18n.t.bind(i18n),id=>id===42?'小火龙':undefined);
 assert.match(text,/小火龙/);assert.match(text,/灼伤/);assert.doesNotMatch(text,/Old name|hurt|burn/);
});

test('ambiguous same-spelled source text is never assigned an unrelated translation key',()=>{
 const value='ambiguous source text for provenance test';
 rememberPresentationText(value,{kind:'translation',key:'a:first',values:{}});
 rememberPresentationText(value,{kind:'translation',key:'b:second',values:{}});
 assert.equal(presentationText(value),null);
});

test('presentation metadata is detached from caller objects and rejects unbounded nested input',()=>{
 const value='detached source text for provenance test',data={kind:'translation',key:'test:detached',values:{count:1}};
 rememberPresentationText(value,data);data.values.count=99;
 assert.equal(presentationText(value).values.count,1);
 let nested='text';for(let i=0;i<10;i++)nested={kind:'joined',parts:[nested]};
 assert.throws(()=>renderPresentationText(nested,()=>'',()=>''),/PRESENTATION_TEXT_DEPTH/);
});
