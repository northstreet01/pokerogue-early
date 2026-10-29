import test,{before} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'vite';
import {createRequire,isBuiltin} from 'node:module';
import {resolve} from 'node:path';
import fs from 'node:fs';
import {evolutionDisplayFixture} from './helpers/evolution-display-fixture.mjs';
let api;
before(async()=>{
 await build({configFile:false,publicDir:false,logLevel:'error',resolve:{alias:[
  {find:/^phaser$/,replacement:resolve('server/headless-presentation.mjs')},
  {find:/^phaser3-rex-plugins\/plugins\/soundfade$/,replacement:resolve('tests/fixtures/evolution-sound-port.mjs')},
  {find:/^phaser3-rex-plugins\/.*$/,replacement:resolve('server/headless-rex.mjs')}]},ssr:{noExternal:true},
  build:{ssr:resolve('tests/fixtures/coop-play-ui-entry.mjs'),outDir:resolve('build/coop-growth-presentation-test'),emptyOutDir:true,minify:false,
  rollupOptions:{external:isBuiltin,output:{format:'cjs',entryFileNames:'entry.cjs'}}}});
 api=createRequire(import.meta.url)('../build/coop-growth-presentation-test/entry.cjs');api.describeOriginalCatalogs();
});

test('the original evolution scene runs its sprite cycles, particles, messages and music using committed copies only',async()=>{
 const f=evolutionDisplayFixture(api),controller=new AbortController();
 let settled=false;const task=api.presentOriginalEvolution(f.scene,f.before,f.after,controller.signal).finally(()=>{settled=true;});
 task.catch(()=>{});
 for(let count=0;count<12000&&!settled;count++)await f.advance();
 assert.equal(settled,true,'original evolution must finish within its bounded original timeline');await task;
 assert.equal(f.before.species.speciesId,11);assert.ok(f.calls.some(c=>Array.isArray(c)&&c[0]==='text'&&c[1].includes('进化')));
 for(const key of ['evolution','charge','beam','sparkle','shine','evolution_fanfare'])assert.ok(f.sounds.some(s=>s.key===key),key);
 assert.ok(f.tweenConfigs.some(c=>c.repeat===64));assert.ok(f.tweenConfigs.some(c=>c.repeat===96));
 assert.ok(f.tweenConfigs.some(c=>c.yoyo===true));
 assert.deepEqual(f.calls.filter(c=>Array.isArray(c)&&c[0]==='mode').map(c=>c[1]),[api.Mode.EVOLUTION_SCENE,api.Mode.MESSAGE]);
 assert.ok(f.sounds.every(s=>s.stopped));assert.equal(f.handler.scene,f.scene);
});

test('canceling original evolution during particles stops every old timer/tween/sound and never reopens a mode',async()=>{
 const f=evolutionDisplayFixture(api),controller=new AbortController();
 let settled=false;const task=api.presentOriginalEvolution(f.scene,f.before,f.after,controller.signal).finally(()=>{settled=true;});
 task.catch(()=>{});
 for(let count=0;count<1000&&!f.tweenConfigs.some(c=>c.repeat===64);count++)await f.advance();
 assert.ok(f.tweenConfigs.some(c=>c.repeat===64));controller.abort();await task;assert.equal(settled,true);
 const count=f.calls.length;
 for(const callback of f.callbacks)callback?.({getValue:()=>1});
 for(let index=0;index<1000&&f.queue.length;index++)await f.advance();
 assert.equal(f.calls.length,count);assert.equal(f.before.species.speciesId,10);
 assert.ok(f.sounds.every(s=>s.stopped));assert.equal(f.handler.canCancel,false);
});

test('the original level stat panel renders increase and total pages from committed values',async()=>{
 const handler=Object.create(api.BattleMessageUiHandler.prototype),values=[];
 handler.scene={showLevelUpStats:true};handler.levelUpStatsValuesContent={set text(value){values.push(value);}};
 handler.levelUpStatsIncrContent={setVisible(){}};const shown=[];handler.levelUpStatsContainer={setVisible:v=>shown.push(v)};
 const previous=[19,10,11,12,13,14],stats=[21,11,13,15,17,19];
 const task=handler.promptLevelUpStatsValues(stats,previous,false);
 assert.equal(values[0],'2\n1\n2\n3\n4\n5\n');handler.onActionInput();
 assert.equal(values[1],stats.join('\n')+'\n');handler.onActionInput();await task;
 assert.equal(shown.at(-1),false);assert.deepEqual(stats,[21,11,13,15,17,19]);
});

test('original BattleInfo animates HP numbers and experience across a level without calculating rules',async()=>{
 const runtime=api.createOriginalRuntime('original-bars',{trainerId:1,secretId:2});
 const pokemon=api.constructOriginalPokemon(runtime,1,6),previous=api.constructOriginalPokemon(runtime,1,5);
 pokemon.hp-=3;const saved=api.capturePokemonState(pokemon),tweens=[],sounds=[],numbers=[],levels=[];
 const bar=()=>({scaleX:1,setFrame(){},setScale(value){this.scaleX=value;}});
 const scene={getMaxExpLevel:()=>10,modifiers:[],enemyModifiers:[],findModifier:api.BattleScene.prototype.findModifier,
  playSound:key=>sounds.push(key),sound:{stopByKey:key=>sounds.push('stop:'+key)},time:{delayedCall:(_delay,done)=>done()},
  tweens:{add(config){tweens.push(config);config.targets.scaleX=config.scaleX;config.onUpdate?.();config.onComplete?.();}}};
 pokemon.scene=scene;
 const info=Object.assign(Object.create(api.BattleInfo.prototype),{scene,player:true,visible:true,
  lastName:pokemon.name,lastTeraType:pokemon.getTeraType(),lastStatus:0,lastHp:previous.hp,lastMaxHp:previous.getMaxHp(),
  lastExp:previous.exp,lastLevelExp:previous.levelExp,lastLevel:5,lastLevelCapped:false,
  hpBar:bar(),expBar:bar(),shinyIcon:{setVisible(){}},setHpNumbers:(hp,max)=>numbers.push([hp,max]),setLevel:level=>levels.push(level)});
 await info.updateInfo(pokemon,false);
 assert.ok(tweens.some(t=>t.targets===info.hpBar&&t.duration>=250));
 assert.ok(tweens.some(t=>t.targets===info.expBar&&t.duration>0));
 assert.ok(levels.includes(6));assert.ok(sounds.includes('exp'));assert.ok(sounds.includes('level_up'));
 assert.deepEqual(numbers.at(-1),[pokemon.hp,pokemon.getMaxHp()]);
 assert.deepEqual(api.capturePokemonState(pokemon),saved);
});

test('canceling the actual original UI transition fences a late evolution scene open',async()=>{
 const controller=new AbortController(),pending=[],shown=[];
 const ui={mode:api.Mode.MESSAGE,modeChain:[],scene:{time:{delayedCall:(_delay,done)=>pending.push(done)}},
  fadeOut:()=>Promise.resolve(),fadeIn:()=>assert.fail('cancelled transition faded in'),cancelFade(){},
  getHandler(){return {clear(){},show:()=>shown.push(true)};},setModeInternal:api.UI.prototype.setModeInternal};
 const task=api.UI.prototype.setModeCancellable.call(ui,api.Mode.EVOLUTION_SCENE,controller.signal);
 await Promise.resolve();controller.abort();for(const callback of pending)callback();await task;
 assert.equal(ui.mode,api.Mode.MESSAGE);assert.deepEqual(shown,[]);
});

test('instant experience reconciliation jumps directly to the committed level without timers or sounds',async()=>{
 const runtime=api.createOriginalRuntime('instant-exp',{trainerId:1,secretId:2}),pokemon=api.constructOriginalPokemon(runtime,1,25);
 let level,ratio;
 const info=Object.assign(Object.create(api.BattleInfo.prototype),{lastLevel:1,scene:{getMaxExpLevel:()=>100,
   tweens:{add(){assert.fail('instant EXP must not schedule a tween');}},time:{delayedCall(){assert.fail('instant EXP must not wait between levels');}}},
   expBar:{setScale(value){ratio=value;}},setLevel(value){level=value;}});
 await info.updatePokemonExp(pokemon,true);
 assert.equal(level,25);assert.equal(info.lastExp,pokemon.exp);assert.equal(info.lastLevelExp,pokemon.levelExp);
 assert.ok(ratio>=0&&ratio<=1);
});

test('canceling the level panel stops its fanfare and cannot resume music from a later screen',async()=>{
 const callbacks=[],controller=new AbortController();let stopped=0,resumed=0,visible=true;
 const sound={totalDuration:2,stop(){stopped++;}},handler={promptLevelUpStatsValues:()=>new Promise(()=>{}),levelUpStatsContainer:{setVisible:v=>visible=v}};
 const scene={ui:{getMessageHandler:()=>handler},showLevelUpStats:true,bgmCache:new Set(),pauseBgm:()=>true,
  resumeBgm:()=>resumed++,playSound(){},sound:{get:()=>sound},playSoundWithoutBgm:api.BattleScene.prototype.playSoundWithoutBgm,
  time:{delayedCall:(_delay,callback)=>{callbacks.push(callback);return {destroy(){}};}}};
 const presentation=new api.CoopBattlePresentation(scene);
 const task=presentation.playLevelStats({stats:[1,2,3,4,5,6],previous:[1,2,3,4,5,6]},controller.signal);
 controller.abort();await assert.rejects(task,/PRESENTATION_CANCELLED/);
 callbacks.forEach(callback=>callback());
 assert.equal(stopped,1);assert.equal(resumed,0);assert.equal(visible,false);assert.equal(handler.onActionInput,null);
});

test('every static original item has Chinese display text without changing original names, codec or randomness',async()=>{
 const runtime=api.createOriginalRuntime('item-translation',{trainerId:1,secretId:2});runtime.scene.currentBattle={waveIndex:1};
 const random=structuredClone(runtime.context.sceneRandom.capture()),missing=[];
 await api.i18next.changeLanguage('zh-Hans');
 for(const [id,factory]of Object.entries(api.modifierTypes)){
  const type=factory().withIdFromFunc(factory);if(typeof type.generateType==='function')continue;
  const saved=api.captureModifierTypeState(type),originalName=type.name;
  const name=type.getDisplayName(),description=type.getDescription(runtime.scene);
  if(!/[\u3400-\u9fff]/u.test(name)||!/[\u3400-\u9fff]/u.test(description))missing.push({id,name,description});
  assert.doesNotMatch(name+description,/\{\{|undefined|modifierType:/u,id);
  await api.i18next.changeLanguage('en');
  const english=api.restoreModifierTypeState(saved);
  assert.ok(english.getDisplayName());assert.ok(english.getDescription(runtime.scene));
  assert.deepEqual(api.captureModifierTypeState(english),saved,id);assert.equal(type.name,originalName);
  await api.i18next.changeLanguage('zh-Hans');assert.deepEqual(api.captureModifierTypeState(type),saved,id);
 }
 assert.deepEqual(missing,[]);assert.deepEqual(runtime.context.sceneRandom.capture(),random);
});

test('generated original item variants translate through their actual enum arguments and preserve codec fields',async()=>{
 const runtime=api.createOriginalRuntime('generated-item-translation',{trainerId:1,secretId:2});runtime.scene.currentBattle={waveIndex:1};
 const rows=[['TEMP_STAT_BOOSTER',[0,1,2,3,4,5,6]],['BASE_STAT_BOOSTER',[0,1,2,3,4,5]],
  ['ATTACK_TYPE_BOOSTER',Array.from({length:18},(_,i)=>i)],['BERRY',Array.from({length:11},(_,i)=>i)],
  ['TM_COMMON',[api.Moves.PROTECT]],['EVOLUTION_ITEM',[api.EvolutionItem.FIRE_STONE]],['FORM_CHANGE_ITEM',[api.FormChangeItem.VENUSAURITE]],['TERA_SHARD',[9]]];
 const missing=[];
 for(const [id,args]of rows)for(const value of args){
  const factory=api.modifierTypes[id],type=id==='TM_COMMON'?new api.TmModifierType(value).withIdFromFunc(factory)
   :factory().withIdFromFunc(factory).generateType([], [value]);
  const saved=api.captureModifierTypeState(type),raw=type.name;
  for(const language of ['zh-Hans','en']){
   await api.i18next.changeLanguage(language);
   const name=type.getDisplayName(),description=type.getDescription(runtime.scene);
   assert.doesNotMatch(name+description,/\{\{|undefined|modifierType:|earlyModifier:/u,`${id}:${value}:${language}`);
   if(language==='zh-Hans'&&(!/[\u3400-\u9fff]/u.test(name)||!/[\u3400-\u9fff]/u.test(description)))missing.push({id,value,name,description});
   assert.deepEqual(api.captureModifierTypeState(type),saved);assert.equal(type.name,raw);
   assert.deepEqual(api.captureModifierTypeState(api.restoreModifierTypeState(saved)),saved);
  }
 }
 await api.i18next.changeLanguage('zh-Hans');assert.deepEqual(missing,[]);
});

test('all supported nonboss trainer titles and original dialogue choices are Chinese without changing catalog arrays',async()=>{
 await api.i18next.changeLanguage('zh-Hans');const missing=[];
 for(const [id,config]of Object.entries(api.trainerConfigs)){
  if(config.isBoss)continue;
  const original=JSON.stringify([config.encounterMessages,config.femaleEncounterMessages,config.victoryMessages,config.femaleVictoryMessages]);
  for(const variant of [api.TrainerVariant.DEFAULT,...(config.hasGenders?[api.TrainerVariant.FEMALE]:[]),...(config.hasDouble?[api.TrainerVariant.DOUBLE]:[])]){
   const title=config.getTitle(api.TrainerSlot.NONE,variant);
   if(!/[\u3400-\u9fff]/u.test(title))missing.push({id:api.TrainerType[id],variant,title});
   const trainer=Object.assign(Object.create(api.Trainer.prototype),{config,variant});
   for(const stage of ['Encounter','Victory','Defeat']){
    const messages=trainer[`get${stage}Messages`]();
    if(!messages)continue;
    for(const text of messages){
     assert.match(text,/[\u3400-\u9fff]/u,`${api.TrainerType[id]}:${stage}`);
     assert.ok(api.presentationText(text));
     const en=api.renderPresentationText(api.presentationText(text),(key,values)=>api.i18next.t(key,{...values,lng:'en'}),()=>undefined);
     assert.doesNotMatch(en,/earlyDialogue:/);
    }
   }
  }
  assert.equal(JSON.stringify([config.encounterMessages,config.femaleEncounterMessages,config.victoryMessages,config.femaleVictoryMessages]),original);
 }
 assert.deepEqual(missing,[]);
 for(const [type,rows]of Object.entries(api.trainerTypeDialogue)){
  const variants=Array.isArray(rows)?rows:[rows];
  for(const [variant,row]of variants.entries())for(const [stage,messages]of Object.entries(row)){
   if(!messages)continue;
   const list=Array.isArray(messages)?messages:[messages];
   list.forEach((text,index)=>assert.equal(api.i18next.t(`earlyDialogue:${api.TrainerType[type]}.${variant}.${stage}.${index}`,{lng:'en'}),text));
  }
 }
});

test('original weather, terrain and arena messages render in Chinese with no leftover keys',async()=>{
 await api.i18next.changeLanguage('zh-Hans');const w=api.weatherRules;
 for(const type of Object.values(w.WeatherType).filter(v=>typeof v==='number'&&v>0))
  for(const method of ['getWeatherStartMessage','getWeatherLapseMessage','getWeatherClearMessage'])assert.match(w[method](type),/[\u3400-\u9fff]/u);
 for(const type of [1,2,3,4])for(const method of ['getTerrainStartMessage','getTerrainClearMessage'])assert.match(w[method](type),/[\u3400-\u9fff]/u);
 const events=[],arena={scene:{queueMessage:text=>events.push(text)}},a=api.arenaRules;
 for(const type of ['MUD_SPORT','WATER_SPORT','GRAVITY']){const tag=a.getArenaTag(api.ArenaTagType[type],5,0,0);tag.onAdd(arena);tag.onRemove(arena);}
 for(const text of events){assert.match(text,/[\u3400-\u9fff]/u);assert.doesNotMatch(text,/arenaTag:|earlyBattle:/);}
 await api.i18next.changeLanguage('en');assert.equal(w.getWeatherStartMessage(w.WeatherType.RAIN),'A downpour started!');
 await api.i18next.changeLanguage('zh-Hans');
});

test('original read-only statistics and the complete title splash catalog display Chinese without modifying save facts',async()=>{
 await api.i18next.changeLanguage('zh-Hans');
 const runtime=api.createOriginalRuntime('statistics-display',{trainerId:1,secretId:2});
 const data=api.withStarterRandomContext(runtime.context,()=>new api.GameData(runtime.scene,{readOnly:true}));
 // Explicit UI fixture: make hidden count labels visible; never a game save.
 for(const key of Object.keys(data.gameStats))if(typeof data.gameStats[key]==='number')data.gameStats[key]=1;
 const facts=()=>JSON.stringify({stats:data.gameStats,dex:data.dexData},(_key,value)=>typeof value==='bigint'?value.toString():value),before=facts(),shown=new Set();
 const handler=Object.assign(Object.create(api.GameStatsUiHandler.prototype),{scene:{gameData:data},
  statLabels:Array.from({length:18},()=>({setText:value=>shown.add(value)})),statValues:Array.from({length:18},()=>({setText(){}}))});
 for(let cursor=0;cursor<18;cursor++){handler.cursor=cursor;handler.updateStats();}
 const labels=JSON.parse(fs.readFileSync('locales/zh-Hans/early-stats.json','utf8'));
 const {title,...statLabels}=labels;assert.equal(Object.keys(statLabels).length,35);
 for(const label of Object.values(statLabels))assert.ok(shown.has(label),label);
 assert.equal(facts(),before);
 const raw=JSON.stringify(api.splashMessages);assert.equal(api.splashMessages.length,30);
 for(const [index,text]of api.splashMessages.entries()){
  assert.equal(api.i18next.t(`earlySplash:${index}`,{lng:'en'}),text);
  assert.match(api.i18next.t(`earlySplash:${index}`,{lng:'zh-Hans'}),/[\u3400-\u9fff]/u);
 }
 assert.equal(JSON.stringify(api.splashMessages),raw);
});

test('the complete original move and ability catalogs have guarded Chinese descriptions and preserve original English',async()=>{
 await api.i18next.changeLanguage('zh-Hans');const missing={names:[],descriptions:[]};
 const originals=JSON.stringify([...api.allMoves.filter(Boolean),...api.allAbilities.filter(Boolean)]);
 for(const [namespace,items,field]of [['move',api.allMoves,'effect'],['ability',api.allAbilities,'description']])for(const item of items.filter(Boolean)){
  if(item.id&& !/[\u3400-\u9fff]/u.test(item.name))missing.names.push({namespace,id:item.id,name:item.name});
  if(item[field]&&!/[\u3400-\u9fff]/u.test(item[field]))missing.descriptions.push({namespace,id:item.id,text:item[field]});
  assert.doesNotMatch(item[field]??'',/earlyCatalog:|\{\{/u);
 }
 fs.mkdirSync('build/vs02b21-22',{recursive:true});
 fs.writeFileSync('build/vs02b21-22/catalog-remaining-after.json',JSON.stringify(missing,null,2));
 assert.deepEqual(missing.descriptions,[]);
 assert.deepEqual(missing.names,[]);
 await api.i18next.changeLanguage('en');
 // The catalog guard accepts typographic apostrophes and line wrapping only.
 const normalize=value=>value.replace(/[‘’]/g,"'").replace(/\s+/g,' ').trim();
 for(const item of api.allMoves.filter(Boolean))if(item.originalEffect)assert.equal(normalize(item.effect),normalize(item.originalEffect));
 for(const item of api.allAbilities.filter(Boolean))if(item.originalDescription)assert.equal(normalize(item.description),normalize(item.originalDescription));
 assert.equal(JSON.stringify([...api.allMoves.filter(Boolean),...api.allAbilities.filter(Boolean)]),originals);
 await api.i18next.changeLanguage('zh-Hans');
});
