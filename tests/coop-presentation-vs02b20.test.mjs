import {presentationFixture} from './helpers/coop-presentation-fixture.mjs';
import test,{before} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire,isBuiltin} from 'node:module';
import {resolve} from 'node:path';
import {build} from 'vite';
let api;
before(async()=>{
  await build({configFile:false,publicDir:false,logLevel:'error',resolve:{alias:[
    {find:/^phaser$/,replacement:resolve('server/headless-presentation.mjs')},
    {find:/^phaser3-rex-plugins\/.*$/,replacement:resolve('server/headless-rex.mjs')} ]},ssr:{noExternal:true},
    build:{ssr:resolve('tests/fixtures/coop-play-ui-entry.mjs'),outDir:resolve('build/coop-presentation-test'),emptyOutDir:true,minify:false,
      rollupOptions:{external:isBuiltin,output:{format:'cjs',entryFileNames:'entry.cjs'}}}});
  api=createRequire(import.meta.url)('../build/coop-presentation-test/entry.cjs');api.describeOriginalCatalogs();
});
const fixture=()=>presentationFixture(api);

test('confirmed first lobby start retains entrance batch, while a direct reconnect restores only its final frame',async()=>{
 for(const entrance of [true,false]){
  const f=fixture();await f.p.apply(f.snapshot,f.applied,{replay:true,entrance});
  assert.equal(!!f.p.pending,entrance);
  if(entrance){assert.equal(f.p.pending.replay,true);await f.p.playEvents([]);assert.equal(f.p.pending,null);}
 }
});

test('one final Boss uses the original center position while both player fronts retain left/right positions',async()=>{
 const f=fixture(),positions=[],make=f.p.container.bind(f.p);
 f.p.container=(...args)=>{const p=make(...args);p.setFieldPosition=position=>positions.push([p.id,position]);return p;};
 const player=f.snapshot.shared.pokemon[0],partner={...player,id:player.id+1,owner:1,fieldIndex:1};
 const boss={...player,id:player.id+2,owner:null,fieldIndex:2,speciesId:890,bossSegments:4,bossSegmentIndex:3};
 f.snapshot.shared={...f.snapshot.shared,waveIndex:200,battleSpec:1,double:true,field:[player.id,partner.id,boss.id,null],pokemon:[player,partner,boss]};
 await f.p.apply(f.snapshot,f.applied);
 assert.equal(f.scene.party[0].id,player.id);assert.equal(f.scene.party[1].id,partner.id);
 // FieldPosition.CENTER=0, LEFT=1, RIGHT=2 are the original enum values.
 assert.ok(positions.some(([id,p])=>id===boss.id&&p===0));
 assert.ok(positions.some(([id,p])=>id===player.id&&p===1));
 assert.ok(positions.some(([id,p])=>id===partner.id&&p===2));
 f.p.clear();
});

test('same field revisions reuse original display objects and assets',async()=>{
  const {p,scene,counts,snapshot,applied}=fixture();await p.apply(snapshot,applied);const first=scene.party[0];
  await p.apply({...snapshot,revision:1},applied);
  assert.equal(scene.party[0],first);assert.deepEqual(counts,{created:1,loaded:1,destroyed:0});
});

test('departing original display survives final field replacement until damage, cry and original faint tween finish',async()=>{
  const {p,scene,snapshot,model,applied,calls,counts}=fixture();await p.apply(snapshot,applied);const old=scene.party[0],hp=old.hp;
  const next={...snapshot,revision:1,shared:{...snapshot.shared,field:[null,null,null,null],pokemon:[]},events:[
    {kind:'battle-animation',eventId:'hit',sourceId:old.id,targetId:old.id,moveId:33},
    {kind:'damage-display',eventId:'zero',pokemonId:old.id,remainingHp:0},
    {kind:'faint-cry',eventId:'cry',pokemonId:old.id},
    {kind:'pokemon-exit',eventId:'faint',pokemonId:old.id,animation:'faint'}]};
  model.hp=0;await p.apply(next,applied,{replay:true});assert.equal(counts.destroyed,0);
  p.playAnimation=async()=>{assert.equal(p.displayedById.get(old.id),old);assert.equal(old.hp,hp);calls.push(['animation']);};
  await p.playEvents(next.events);
  assert.equal(counts.destroyed,1);assert.equal(scene.party[0],null);assert.equal(model.hp,0);
  assert.ok(calls.findIndex(c=>c[0]==='animation')<calls.findIndex(c=>c[0]==='cry'));
  assert.ok(calls.some(c=>c[0]==='tween'&&c[1]===500));assert.ok(calls.some(c=>c[0]==='hp'&&c[1]===0&&c[2]===false));
});

test('metadata-only personal snapshots preserve temporary original Party binding and every field object',async()=>{
  const {p,scene,snapshot,applied,counts}=fixture();await p.apply(snapshot,applied);const actual=scene.party[0],party=['temporary own Party'];
  scene.party=party;const battle=scene.currentBattle;
  await p.apply({...snapshot,revision:1},applied,{replay:true,preserveFieldBinding:true});await p.playEvents([]);
  assert.equal(scene.party,party);assert.equal(scene.currentBattle,battle);assert.equal(p.field[0],actual);
  assert.deepEqual(counts,{created:1,loaded:1,destroyed:0});
});

test('original summon ball flight and release run for a new field identity without destroying its companion',async()=>{
  const {p,scene,snapshot,applied,counts,calls}=fixture();await p.apply(snapshot,applied);const companion=scene.party[0];
  const newcomer={...snapshot.shared.pokemon[0],id:companion.id+1,owner:null,index:0,fieldIndex:2};
  const next={...snapshot,revision:1,shared:{...snapshot.shared,field:[companion.id,null,newcomer.id,null],pokemon:[snapshot.shared.pokemon[0],newcomer]},
    events:[{kind:'pokemon-enter',eventId:'enter',pokemonId:newcomer.id,view:newcomer}]};
  await p.apply(next,applied,{replay:true});await p.playEvents(next.events);
  assert.equal(scene.party[0],companion);assert.equal(scene.currentBattle.enemyParty[0].id,newcomer.id);
  assert.deepEqual(counts,{created:2,loaded:2,destroyed:0});
  for(const duration of [650,150,500,250])assert.ok(calls.some(c=>c[0]==='tween'&&c[1]===duration));
  assert.ok(calls.some(c=>c[0]==='sound'&&c[1]==='pb_rel'));
});

test('next encounter and changed biome reuse the original scroll and background timings, same-wave refresh does neither',async()=>{
  for(const changedBiome of [false,true]){
    const {p,scene,snapshot,applied,calls}=fixture();await p.apply(snapshot,applied);const oldTexture=scene.arenaBg.texture;calls.splice(0);
    const next={...snapshot,revision:1,shared:{...snapshot.shared,waveIndex:2,biome:changedBiome?1:0},events:[
      ...(changedBiome?[{kind:'phase-start',phase:'SwitchBiomePhase',eventId:'biome'}]:[]),
      {kind:'phase-start',phase:'NextEncounterPhase',eventId:'next'}]};
    await p.apply(next,applied,{replay:true});assert.equal(scene.arenaBg.texture,oldTexture);
    await p.playEvents(next.events);assert.ok(calls.some(c=>c[0]==='tween'&&c[1]===2000));
    if(changedBiome)assert.ok(calls.some(c=>c[0]==='tween'&&c[1]===1000));
    calls.splice(0);await p.apply({...next,revision:2,events:[]},applied,{replay:true});await p.playEvents([]);
    assert.equal(calls.some(c=>c[0]==='tween'),false);
  }
});

test('canceling the actual shared original exit/encounter helpers fences late callbacks',()=>{
  for(const kind of ['faint','return','encounter']){
    const callbacks=[],stopped=[],signal=new AbortController();let completed=0;
    const scene={playSound(){},tweens:{killTweensOf(){},add(c){callbacks.push(c.onComplete);return {stop(){stopped.push(true);}}}}};
    const pokemon={scene,y:84,battleInfo:{},pokeball:0,hideInfo(){},tint(){},setVisible(){assert.fail('cancelled exit became visible');}};
    if(kind==='encounter')api.animateEncounterScroll(scene,[],()=>completed++,signal.signal);
    else api.animatePokemonExit(pokemon,kind,()=>completed++,signal.signal);
    signal.abort();for(const done of callbacks)done();assert.equal(completed,0);assert.equal(stopped.length,1);
  }
});

test('cooperative music uses original selection and preserves a playing track across purchases and refreshes',()=>{
  const runtime=api.createOriginalRuntime('music',{trainerId:1,secretId:2}),calls=[];
  const scene={gameMode:runtime.scene.gameMode,playBgm:(...args)=>calls.push(args),fadeOutBgm:()=>calls.push(['stop'])};
  const audio=new api.CoopBattleAudio(scene),shared={battleType:0,battleSpec:0,waveIndex:1,double:true,field:[null,null,null,null],pokemon:[],biome:0};
  audio.apply({shared,personal:{decision:{kind:'wait-actions'}}});audio.apply({shared,personal:{decision:{kind:'preparation'}}});
  assert.equal(calls.length,1);assert.equal(calls[0][0],'battle_wild');const originalSignal=calls[0][2];
  audio.play('victory_trainer');assert.equal(originalSignal.aborted,true);const latest=calls.at(-1)[2];
  audio.stop();assert.equal(latest.aborted,true);assert.deepEqual(calls.at(-1),['stop']);
});

test('original playBgm retains its loop/volume and an aborted late load cannot restart music',()=>{
  const scene=Object.create(api.BattleScene.prototype),callbacks=[],sounds=[],plays=[],loops=[];
  Object.assign(scene,{masterVolume:0.5,bgmVolume:0.4,bgm:null,bgmCache:new Set(),cache:{audio:{exists:()=>false}},
    arena:{bgm:'town',getBgmLoopPoint:()=>7.288},load:{audio(){},once:(_event,cb)=>callbacks.push(cb),isLoading:()=>false,start(){}},
    sound:{add:key=>{sounds.push(key);return {key,isPlaying:true,play:c=>plays.push(c),on:(_event,cb)=>loops.push(cb)};}}});
  const abandoned=new AbortController();scene.playBgm('town',false,abandoned.signal);abandoned.abort();callbacks.shift()();
  assert.deepEqual(sounds,[]);scene.playBgm('town');callbacks.shift()();
  assert.deepEqual(sounds,['town']);assert.equal(plays[0].volume,0.2);loops[0]();assert.equal(plays.at(-1).seek,7.288);
  scene.playBgm('town');assert.equal(sounds.length,1);
});
test('new final HP stays off the display until original ordered damage playback; verified model never changes',async()=>{
  const {p,scene,snapshot,model,applied,calls}=fixture();await p.apply(snapshot,applied);const initial=model.hp;
  model.hp=0;const next={...snapshot,revision:1,shared:{...snapshot.shared,pokemon:[{...snapshot.shared.pokemon[0],hp:0}]},events:[
    {kind:'battle-animation',eventId:'anim',sourceId:model.id,targetId:model.id,moveId:33},
    {kind:'damage-display',eventId:'damage',pokemonId:model.id,remainingHp:0}]};
  await p.apply(next,applied,{replay:true});assert.equal(scene.party[0].hp,initial);assert.equal(scene.party[0].visible,true);
  p.playAnimation=async()=>{calls.push(['animation',scene.party[0].hp]);assert.equal(model.hp,0);};
  await p.playEvents(next.events);assert.ok(calls.some(c=>c[0]==='animation'&&c[1]===initial));assert.equal(scene.party[0].hp,0);
  assert.equal(scene.party[0].visible,false);assert.equal(model.hp,0);
});

test('an active original reward menu updates price/state without rebuilding options or moving its cursor',()=>{
  const calls=[],callback=()=>false;
  const menu=Object.assign(Object.create(api.ModifierSelectUiHandler.prototype),{
    active:true,rowCursor:2,cursor:3,options:[{setAlpha:value=>calls.push(['alpha',value])}],
    completeButtonText:{setText:value=>calls.push(['text',value])},rerollButtonContainer:{setVisible:value=>calls.push(['reroll',value])},
    updateCostText(){calls.push(['cost',this.rerollCost]);},
  });
  assert.equal(menu.show([true,[],callback,120,{preparation:{rewardResolved:true,ready:false},allowReroll:false}]),false);
  assert.equal(menu.onActionInput,callback);assert.equal(menu.rowCursor,2);assert.equal(menu.cursor,3);
  assert.ok(calls.some(c=>c[0]==='alpha'&&c[1]===0.35));assert.ok(calls.some(c=>c[0]==='cost'&&c[1]===120));
});

test('a late original Pokemon asset completion cannot animate a display after cancellation',async()=>{
  const {model}=fixture(),signal=new AbortController(),callbacks=[];let animations=0;
  const display=Object.assign(Object.create(Object.getPrototypeOf(model)),model,{
    scene:{load:{once:(_event,callback)=>callbacks.push(callback),isLoading:()=>false,start(){}}},
    getMoveset:()=>[],getGender:()=>0,getSpeciesForm:()=>({loadAssets(){}}),getFusionSpeciesForm:()=>null,
    isPlayer:()=>false,playAnim(){animations++;},updateFusionPalette(){animations++;},
  });
  const pending=display.loadAssets(true,signal.signal);
  await Promise.resolve();await Promise.resolve();assert.equal(callbacks.length,1);
  signal.abort();callbacks[0]();await pending;assert.equal(animations,0);
});

test('several original move/HP effects have a bounded batch budget without the old twenty second truncation',async()=>{
  const {p,snapshot,applied}=fixture();await p.apply(snapshot,applied);
  const clock=Date.now;let elapsed=0,played=0;
  p.playAnimation=async()=>{elapsed+=3000;played++;};
  Date.now=()=>elapsed;
  try {
    await p.playEvents(Array.from({length:10},(_,eventIndex)=>({kind:'battle-animation',eventIndex,eventId:`long-${eventIndex}`})));
    assert.equal(played,10);
  } finally {Date.now=clock;}
});

test('an incoming original display starts with its entry HP before a same-turn attack, then converges to the verified final model',async()=>{
  for(const slot of [0,2]){
    const {p,snapshot,applied,model,scene}=fixture();await p.apply(snapshot,applied);
    const initial=model.hp, incoming={...snapshot.shared.pokemon[0],id:model.id+1,owner:slot===0?0:null,index:0,fieldIndex:slot,hp:initial-5};
    const field=[...snapshot.shared.field];field[slot]=incoming.id;
    const next={...snapshot,revision:1,shared:{...snapshot.shared,field,pokemon:[...snapshot.shared.pokemon.filter(v=>field.includes(v.id)),incoming]},events:[
      {kind:'pokemon-enter',eventId:`incoming-${slot}`,pokemonId:incoming.id,view:{...incoming,hp:initial}},
      {kind:'battle-animation',eventId:`incoming-hit-${slot}`,sourceId:incoming.id,targetId:incoming.id,moveId:33},
      {kind:'damage-display',eventId:`incoming-damage-${slot}`,pokemonId:incoming.id,remainingHp:incoming.hp},
    ]};
    p.playAnimation=async()=>assert.equal(p.displayedById.get(incoming.id).hp,initial,'incoming HP must precede the same-turn hit');
    await p.apply(next,applied,{replay:true});await p.playEvents(next.events);
    assert.equal(scene.getField()[slot].hp,incoming.hp);assert.equal(model.hp,initial);
  }
});


test('remote first encounter loads all battlers together and reveals none until all assets are ready',async()=>{
 const f=presentationFixture(api),gates=[],displays=[],make=f.p.container.bind(f.p);
 f.p.container=(...args)=>{const p=make(...args);p.loadAssets=()=>new Promise(resolve=>gates.push(resolve));displays.push(p);return p;};
 const second={...f.snapshot.shared.pokemon[0],id:f.model.id+1,owner:1};f.snapshot.shared.field[1]=second.id;f.snapshot.shared.pokemon.push(second);
 const loading=f.p.apply(f.snapshot,f.applied);await Promise.resolve();assert.equal(gates.length,2,'both loads start before either completes');
 assert.ok(displays.every(p=>p.visible===false));gates[0]();await Promise.resolve();assert.ok(displays.every(p=>p.visible===false));
 gates[1]();await loading;assert.ok(displays.every(p=>p.visible===true));f.p.clear();
});
