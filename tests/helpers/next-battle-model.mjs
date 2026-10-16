import fs from 'node:fs';
import ts from 'typescript';
import {codec,Battle,installBattleTestUtils} from './decision-model.mjs';
import {parse,evaluate,pokemon,originalPokemon,species,arena} from './original-model.mjs';
import {originalPhases,installPhaseTestDependencies} from './phase-model.mjs';
import {preparationContext,openMenus,choosePreparation} from './preparation-model.mjs';
import {bindAction,compileReference,utils,actionRules,abilityRules} from './move-execution-model.mjs';
import {roundDriver,finishRoundBoundary} from './round-loop-model.mjs';
import {advanceCycle,validateCycleInput} from './command-cycle-model.mjs';
import {nextPostPhase} from './post-damage-model.mjs';
import {types,modifiers} from './modifier-model.mjs';
import {queueOwnedPhase} from './native-switch-model.mjs';
import {getWildLevel,gaussianLevelOffset,getMaxExpLevel} from '../../src/battle-core/levels.mjs';
import {nextBattleRandomInt,readBattleRandomCheckpoint} from '../../src/battle-core/random.mjs';
import {ruleSeedOffset} from '../../src/battle-core/random-context.mjs';
import {withOriginalRules} from '../../server/original-random-context.mjs';
import {createRuleTaskTracker,observeRulePromise} from '../../src/battle-core/rule-task-tracker.mjs';
import {advanceNextBattle} from '../../src/battle-core/next-battle-runner.mjs';
import {advanceQueuedRulePhase} from '../../src/battle-core/rule-phase-runner.mjs';
import {selectNextPhase} from '../../src/battle-core/phase-queue.mjs';
import {copy,requireContract as check} from '../../src/battle-core/coop-contract.mjs';

const enums=file=>evaluate(parse(file).statements.filter(ts.isEnumDeclaration).map(n=>n.getText()).join('\n'));
const battleEnums=enums('battle.ts'),BattleSpec=enums('enums/battle-spec.ts').BattleSpec;
const frozen=JSON.parse(fs.readFileSync(new URL('../fixtures/early-next-battle-reference.json',import.meta.url),'utf8'));
const sceneClass=parse('battle-scene.ts').statements.find(n=>n.name?.text==='BattleScene');
const arenaClass=parse('field/arena.ts').statements.find(n=>n.name?.text==='Arena');
const utilNames=['randomString','getEnumValues'];
const realUtils=evaluate(`import {randSeedInt} from 'utils'; ${parse('utils.ts').statements.filter(n=>ts.isFunctionDeclaration(n)&&utilNames.includes(n.name?.text)).map(n=>n.getText()).join('\n')}`,{utils});
const allUtils={...utils,...realUtils};
installBattleTestUtils(allUtils);
const rules={...actionRules,...battleEnums,BattleSpec,Utils:allUtils,getWildLevel,gaussianLevelOffset,getMaxExpLevel,nextBattleRandomInt,readBattleRandomCheckpoint};
// Read the original fixed-wave keys without constructing unsupported trainers.
// Only hasOwnProperty is used in this ordinary-wave fixture.
const fixedDeclaration=parse('battle.ts').statements.filter(ts.isVariableStatement).flatMap(n=>[...n.declarationList.declarations]).find(n=>n.name.getText()==='fixedBattles');
const fixedBattles=Object.fromEntries(fixedDeclaration.initializer.properties.map(p=>[p.name.expression.text,{unsupported:true}]));
const modeRules={...rules,fixedBattles};
const modeSource=parse('game-mode.ts').statements.filter(n=>ts.isClassDeclaration(n)||ts.isEnumDeclaration(n)||ts.isVariableStatement(n)).map(n=>n.getText()).join('\n');
const {gameModes}=evaluate(`const {${Object.keys(modeRules).filter(k=>/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(k)&&k!=='default').join(',')}}=require('rules'); ${modeSource}`,{rules:modeRules});
const sceneRules={...rules,...types,...modifiers,Battle,fixedBattles,startingWave:1,calculateMaxExpLevel:getMaxExpLevel,
  getEnemyModifierTypesForWave:(wave,count,...args)=>{check(count===0,'UNSUPPORTED_ENEMY_ITEM_ROLL');return types.getEnemyModifierTypesForWave(wave,count,...args);}};
const encounterRules={...sceneRules,...types,...arena,...enums('field/pokemon.ts'),TrainerSlot:{NONE:0},
  ...enums('data/enums/species.ts'),...enums('ui/ui.ts'),
  handleTutorial:()=>Promise.resolve(),Tutorial:{Access_Menu:0}};
const sceneMethod=(name,args,reference,enemyItems=false)=>compileReference(reference?frozen.scene[name]:sceneClass.members.find(n=>n.name?.getText()===name).getText(),args,
  enemyItems?{...sceneRules,getEnemyModifierTypesForWave:types.getEnemyModifierTypesForWave}:sceneRules);
const poolRules={...rules,BiomePoolTier:{COMMON:0,UNCOMMON:1,RARE:2,SUPER_RARE:3,ULTRA_RARE:4,BOSS:5},
  Biome:enums('data/enums/biome.ts').Biome,getPokemonSpecies:id=>species.get(id)};
const randomSpecies=reference=>compileReference(reference?frozen.arenaRandomSpecies:arenaClass.members.find(n=>n.name?.getText()==='randomSpecies').getText(),'waveIndex,level,attempt',poolRules);
// The tiny species catalogue is a construction fixture, never a product limit.
for(const sp of species.values()){sp.baseTotal=300;sp.getWildSpeciesForLevel=()=>sp.speciesId;}
installPhaseTestDependencies({'./data/ability':abilityRules,'./tutorial':{handleTutorial:()=>Promise.resolve(),Tutorial:{Access_Menu:0}},
  './battle-core/rule-task-tracker.mjs':{observeRulePromise},
  './field/pokemon':{...pokemon,...enums('field/pokemon.ts')},'./data/enums/species':enums('data/enums/species.ts'),
  './data/trainer-config':{TrainerSlot:{NONE:0}},'./battle-scene':{startingWave:1}});
const owned=(c,seat)=>c.roster.entries.filter(e=>e.owner===seat&&e.group==='party').sort((a,b)=>a.index-b.index).map(e=>e.pokemon);
export async function nextBattleContext({wave=1,ready=true}={}){
  let c=await preparationContext();c=(await openMenus(c)).context;
  for(const seat of [0,1])for(const operation of ['skip-reward','ready']){
    if(!ready&&seat===1&&operation==='ready')continue;
    c=(await choosePreparation(c,seat,{kind:'preparation',operation})).context;
  }
  c.battle.waveIndex=wave;
  for(const e of c.roster.entries){const p=e.pokemon;p.pokerus=false;p.summonData.tags=[];p.summonData.moveQueue=[];p.summonData.moveset=null;
    p.moveset=[new pokemon.PokemonMove(33)];if(e.owner!==null){p.hp=e.index===0?100:0;p.stats[0]=100;}}
  c.arena.tags=[];c.arena.weather=null;c.arena.terrain=null;
  return codec.restore(copy(codec.capture(c)));
}

export function nextBattleDriver(options={}){
  const reference=!!options.reference;
  return {
    phaseKind:p=>p.constructor.name,
    validateBranch(c){
      check(c.battle.battleType===0&&c.battle.battleSpec===0&&c.battle.double&&c.battle.waveIndex%10!==0
        &&c.battle.waveIndex%10!==4&&c.battle.waveIndex+1<5,'UNSUPPORTED_NEXT_BATTLE_BRANCH');
      check([0,1].every(seat=>(options.preBattleSwitch||owned(c,seat).filter(p=>!p.isFainted()).length===1)
        &&owned(c,seat)[0].id===c.roster.field[seat]&&!owned(c,seat)[0].isFainted()),'UNSUPPORTED_PRE_BATTLE_SWITCH');
      check(c.enemyModifiers.length===0&&(options.encounterModifiers||c.players.every(p=>p.modifiers.length===0)),'UNSUPPORTED_ENCOUNTER_MODIFIERS');
      check(c.roster.entries.filter(e=>e.owner!==null).every(e=>!e.pokemon.pokerus),'UNSUPPORTED_NEXT_BATTLE_POKERUS');
    },
    async execute(c,p){
      const b=bindAction(c,p),s=b.scene,tasks=createRuleTaskTracker(s),patched=[];let modifierBinding;
      const oldEnemies=c.roster.entries.filter(e=>e.owner===null),oldParty=owned(c,0).concat(owned(c,1));
      const define=(o,k,value)=>{patched.push([o,k,Object.getOwnPropertyDescriptor(o,k)]);Object.defineProperty(o,k,{value,configurable:true,writable:true});};
      const field=()=>c.roster.field.map(id=>c.roster.entries.find(e=>e.pokemon.id===id)?.pokemon);
      try{
        Object.defineProperty(s,'currentBattle',{get:()=>c.battle,set:v=>c.battle=v,configurable:true});
        const playerParty=[...field().slice(0,2),...oldParty.filter(pk=>!c.roster.field.slice(0,2).includes(pk.id))];
        s.getParty=()=>p.constructor===originalPhases.CheckSwitchPhase?owned(c,p.fieldIndex):playerParty;
        s.getEnemyParty=()=>c.battle.enemyParty;
        s.getPlayerPokemon=()=>field()[0];
        s.findModifiers=(filter,player=true)=>(player?c.players.flatMap(p=>p.modifiers):c.enemyModifiers).filter(filter);
        // This fixture exercises ordinary classic waves 1->2->3->4. Fixed,
        // trainer, biome and form branches are rejected above. Optional switch
        // and modifier providers are enabled explicitly by composed test drivers.
        s.gameMode=Object.create(gameModes[c.scene.gameMode.modeId]);
        define(c.arena,'getTrainerChance',compileReference(arenaClass.members.find(n=>n.name?.getText()==='getTrainerChance').getText(),'',
          {Biome:enums('data/enums/biome.ts').Biome}));
        s.enemyModifiers=c.enemyModifiers;
        s.seed=c.scene.seed;Object.defineProperty(s,'waveSeed',{get:()=>c.scene.waveSeed,set:v=>c.scene.waveSeed=v});
        s.resetSeed=sceneMethod('resetSeed','waveIndex',reference).bind(s);
        s.getMaxExpLevel=sceneMethod('getMaxExpLevel','ignoreLevelCap',false).bind(s);
        s.newBattle=()=>sceneMethod('newBattle','waveIndex,battleType,trainerData,double',reference).call(s,undefined,undefined,undefined,true);
        s.executeWithSeedOffset=(fn,offset)=>ruleSeedOffset(()=>{throw Error('no room');},s.seed,offset,fn);
        s.trySpreadPokerus=sceneMethod('trySpreadPokerus','',reference).bind(s);
        s.pushPhase=q=>queueOwnedPhase(c,q,q.constructor===originalPhases.CheckSwitchPhase?q.fieldIndex:null);
        s.unshiftPhase=q=>queueOwnedPhase(c,q,null,true);
        s.initSession=()=>b.events.push({kind:'session-hook'});
        s.getEncounterBossSegments=()=>0;
        s.randomSpecies=(wave,level,fromPool)=>{check(fromPool,'UNSUPPORTED_SPECIES_SOURCE');return randomSpecies(reference).call(c.arena,wave,level);};
        define(c.arena,'pokemonPool',{0:[1,7],1:[1],2:[7],3:[1],4:[7],5:[]});
        s.addEnemyPokemon=(sp,level)=>{
          const id=Math.max(...c.roster.entries.map(e=>e.pokemon.id),...c.roster.retiredIds)+1,pk=originalPokemon(id,true);
          pk.species=sp;pk.level=level;pk.hp=pk.stats[0]=100;pk.status=null;pk.shiny=false;pk.fusionSpecies=null;
          pk.bossSegments=0;pk.bossSegmentIndex=0;pk.moveset=[new pokemon.PokemonMove(33)];pk.scene=s;
          c.roster.entries.push({owner:null,group:'enemy',index:c.battle.enemyParty.length,pokemon:pk});
          render(pk);pk.resetSummonData();b.events.push({kind:'enemy-created',id,species:sp.speciesId,level});return pk;
        };
        const render=pk=>{
          pk.scene=s;
          for(const name of ['setX','tint','untint','cry','showInfo','destroy','updateFusionPalette'])define(pk,name,()=>{});
          define(pk,'loadAssets',()=>tasks.add(Promise.resolve()));
          define(pk,'setFieldPosition',position=>{pk.fieldPosition=position;return Promise.resolve();});
        };
        for(const e of c.roster.entries)render(e.pokemon);
        s.field.getAll=()=>field().filter(Boolean);
        s.field.add=pk=>{const i=c.battle.enemyParty.indexOf(pk);check(i>=0&&i<2,'INVALID_ENCOUNTER_FIELD');c.roster.field[2+i]=pk.id;};s.field.moveBelow=()=>{};
        s.arenaNextEnemy=s.arenaEnemy={x:0,setVisible(){},setX(){},setAlpha(){}};
        s.playBgm=()=>{};s.updateFieldScale=()=>Promise.resolve();s.updateModifiers=()=>tasks.add(Promise.resolve());
        s.tweens={add:o=>o.onComplete?.()};
        s.ui={setMode:()=>Promise.resolve(),showText:(text,_delay,done)=>{b.events.push({kind:'encounter-message',text});done?.();}};
        s.gameData={setPokemonSeen:pk=>b.events.push({kind:'seen-hook',id:pk.id}),saveSystem:()=>Promise.resolve(true),saveSession:()=>Promise.resolve()};
        // The original zero-item fixture keeps its guard. Composed encounter
        // tests explicitly supply original item factories and modifier updates.
        s.generateEnemyModifiers=()=>tasks.add(sceneMethod('generateEnemyModifiers','',reference,options.encounterModifiers).call(s));
        modifierBinding=options.bindEncounterModifiers?.(c,p,b,tasks);
        options.onBind?.(c,p,b,tasks);
        if(reference){
          for(const [klass,methods]of Object.entries(frozen.phases))if(p instanceof originalPhases[klass])
            for(const [name,body]of Object.entries(methods))define(p,name,compileReference(body.replaceAll('super.end()','this.scene.shiftPhase()'),
              name==='doEncounterCommon'?'showEncounterMessage=true':'',encounterRules));
        }
        await withOriginalRules(c,async()=>{
          p.start();await tasks.drain();
          // Encounter completion includes the original chained presentation and
          // save hooks. The rule task tracker drains their nested microtasks.
          for(let i=0;i<12&&!b.ended;i++)await tasks.drain();
          await modifierBinding?.drain();
        });
        if(p.constructor===originalPhases.NewBattlePhase){
          for(const e of oldEnemies){c.roster.retiredIds.push(e.pokemon.id);}
          c.roster.entries=c.roster.entries.filter(e=>e.owner!==null);c.roster.field[2]=c.roster.field[3]=null;
        }
        c.modifierPools=JSON.parse(JSON.stringify(c.modifierPools));
        return {completed:b.ended,pendingTasks:tasks.pendingTasks,events:b.events,grants:[]};
      }finally{
        modifierBinding?.dispose();
        for(const [o,k,d]of patched.reverse()){if(d)Object.defineProperty(o,k,d);else delete o[k];}
        for(const e of c.roster.entries)delete e.pokemon.scene;
        tasks.close();b.dispose();
      }
    }
  };
}
export const createNextBattle=(c,options={})=>advanceNextBattle(c,codec,nextBattleDriver(options),{decisionId:`next-${c.battle.waveIndex+1}-0`});
export function entryDriver(options={}){
  const creation=nextBattleDriver(options),round=roundDriver(options);
  return {supports:(_c,p)=>['PostSummonPhase','ToggleDoublePositionPhase','CheckSwitchPhase','TurnInitPhase'].includes(p.constructor.name),
    execute:(c,p)=>p.constructor===originalPhases.TurnInitPhase?round.execute(c,p):creation.execute(c,p),finishBoundary:finishRoundBoundary};
}
const entryId=c=>`entry-${c.battle.waveIndex}-${Number(c.decision.id.split('-').at(-1))+1}`;
export const advanceEntry=(c,options={})=>advanceQueuedRulePhase(c,codec,entryDriver(options),{decisionId:entryId(c)});
export async function referenceNextBattle(c){
  const driver=nextBattleDriver({reference:true});driver.validateBranch(c);const events=[];
  for(let i=0;i<2;i++){
    const d=selectNextPhase(c.continuation,()=>check(false,'NEXT_BATTLE_QUEUE_EMPTY')).phase;
    const r=await driver.execute(c,d.phase);check(r.completed&&r.pendingTasks===0,'INCOMPLETE_RULE_PHASE');
    c.continuation.currentPhase=null;events.push(...r.events);
  }
  c.decision={id:`next-${c.battle.waveIndex}-0`,kind:'continuing',requiredSeats:[],reason:'effects'};
  codec.capture(c);return {context:c,events,grants:[]};
}
export async function referenceEntry(c){
  const driver=entryDriver({reference:true}),id=entryId(c);
  const d=selectNextPhase(c.continuation,()=>check(false,'ENTRY_QUEUE_EMPTY')).phase;
  const r=await driver.execute(c,d.phase);check(r.completed&&r.pendingTasks===0,'INCOMPLETE_RULE_PHASE');
  c.continuation.currentPhase=null;c.decision=driver.finishBoundary(c,d.phase,id);codec.capture(c);return {context:c,events:r.events,grants:[]};
}
export {advanceCycle,validateCycleInput,nextPostPhase};
