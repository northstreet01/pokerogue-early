import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import {parse,pokemon,originalPokemon} from './helpers/original-model.mjs';
import {initialDecision,codec} from './helpers/decision-model.mjs';
import {phaseConstructors,phaseCodec,evolutionCodec,formCodec,evolutionModule,formModule,evolutionRule,formRule} from './helpers/phase-model.mjs';
import {phaseStateFields,excludedPhaseTypes} from '../src/battle-core/phase-fields.mjs';
import {createOriginalQueueStateCodec} from '../src/battle-core/original-queue-state.mjs';
import {copy} from '../src/battle-core/coop-contract.mjs';
import {checkpointRuleProjection} from '../src/battle-core/rule-projection.mjs';
import {eggs} from './helpers/egg-model.mjs';

function schema(type){const spec=phaseStateFields[type];return {...(phaseStateFields[spec.base]?schema(spec.base):{}),...spec.fields};}
function make(type,c){
  if(type==='EggHatchPhase')c.eggState={players:[[new eggs.Egg(123,0,0,0)],[]]};
  const phase=Object.create(phaseConstructors[type].prototype);
  for(const [key,rule]of Object.entries(schema(type)))phase[key]=rule==='bool'?true:rule==='number'?1.5:rule==='int'?0:rule==='ints'?[2]
    :rule==='egg'?c.eggState.players[0][0]:rule==='pokemon'?c.roster.entries[0].pokemon:rule==='move'?c.roster.entries[0].pokemon.moveset[0]:rule==='weather'?c.arena.weather
      :rule==='modifierType'?c.players[0].modifiers[0].type:rule==='evolution'?evolutionRule:rule==='formChange'?formRule:'';
  if(Object.hasOwn(phase,'moveId'))phase.moveId=33;
  if(type==='EggHatchPhase'){phase.pokemon=originalPokemon(900);phase.eggMoveIndex=0;}
  phase.scene={unexpected:'renderer excluded'};return phase;
}

test('original delayed MoveEffect retains a known departed source, while unknown and nonvirtual phase users are rejected',()=>{
 const c=initialDecision(),phase=make('MoveEffectPhase',c);c.roster.retiredIds.push(9876);
 phase.battlerIndex=9876;phase.player=false;phase.fieldIndex=0;
 const originalMove=c.roster.entries[0].pokemon.moveset[0];
 phase.move=Object.assign(Object.create(Object.getPrototypeOf(originalMove)),originalMove,{virtual:true});
 const saved=phaseCodec.capture(phase,c,null),restored=phaseCodec.restore(copy(saved),c,()=>({}));
 assert.equal(restored.battlerIndex,9876);assert.equal(restored.move.virtual,true);
 phase.battlerIndex=9877;assert.throws(()=>phaseCodec.capture(phase,c,null),/UNKNOWN_PHASE_POKEMON/);
 phase.battlerIndex=9876;phase.move.virtual=false;assert.throws(()=>phaseCodec.capture(phase,c,null),/UNKNOWN_PHASE_POKEMON/);
});
test('explicit manifest covers every original Phase declaration, inherited fields and exclusions',()=>{
  const names=[];
  for(const file of ['phases.ts','evolution-phase.ts','form-change-phase.ts','egg-hatch-phase.ts'])for(const c of parse(file).statements.filter(ts.isClassDeclaration)){
    const name=c.name.text;if(excludedPhaseTypes.includes(name))continue;names.push(name);
    const spec=phaseStateFields[name];assert.ok(spec,name);
    assert.equal(spec.base,c.heritageClauses[0].types[0].expression.getText());
    assert.deepEqual([...Object.keys(spec.fields),...spec.display].sort(),c.members.filter(ts.isPropertyDeclaration).map(n=>n.name.getText()).sort(),name);
  }
  assert.deepEqual(names.sort(),Object.keys(phaseStateFields).sort());
});
test('every concrete original rule Phase restores original prototype without constructors, RNG or callbacks',()=>{
  const c=initialDecision();let count=0;
  for(const [type,spec]of Object.entries(phaseStateFields))if(!spec.abstract){
    const phase=make(type,c),saved=phaseCodec.capture(phase,c,0),restored=phaseCodec.restore(copy(saved),c,()=>({bound:true}));
    assert.equal(Object.getPrototypeOf(restored),phaseConstructors[type].prototype,type);
    assert.deepEqual(phaseCodec.capture(restored,c,0),saved,type);assert.equal(restored.scene.bound,true);count++;
  }
  assert.ok(count>=50);
});
test('entire original evolution and form catalogs recover trusted condition/trigger references without executing them',()=>{
  let evolutions=0,forms=0;
  for(const entries of Object.values(evolutionModule.pokemonEvolutions))for(const rule of entries){assert.equal(evolutionCodec.restore(copy(evolutionCodec.capture(rule))),rule);evolutions++;}
  for(const entries of Object.values(formModule.pokemonFormChanges))for(const rule of entries){assert.equal(formCodec.restore(copy(formCodec.capture(rule))),rule);forms++;}
  assert.ok(evolutions>400);assert.ok(forms>100);
  assert.throws(()=>evolutionCodec.restore({id:1,index:999}),/UNKNOWN_CATALOG_REFERENCE/);
});
test('original queue retains Phase identity, scopes, Pokemon/move/weather references and safe remaining stages',()=>{
  const c=initialDecision(),move=make('MovePhase',c),weather=make('WeatherEffectPhase',c),learn=make('LearnMovePhase',c);
  const live={phaseQueue:[move,weather],phaseQueuePrepend:[learn],nextCommandPhaseQueue:[move],phaseQueuePrependSpliceIndex:1,currentPhase:learn,standbyPhase:null};
  const queues=createOriginalQueueStateCodec(phaseCodec),saved=queues.capture(live,c,{scopeForPhase:()=>0,remainingForPhase:()=> 'learn-apply'});
  c.continuation=saved;c.pendingEffects=[{id:'after-learning',phase:phaseCodec.capture(make('QuietFormChangePhase',c),c,0),remaining:'form-change'}];
  const restored=codec.restore(codec.capture(c));
  const bound=queues.restore(restored.continuation,restored,seat=>({getParty:()=>restored.roster.entries.filter(e=>e.owner===seat&&e.group==='party').map(e=>e.pokemon)})).state;
  assert.equal(bound.phaseQueue[0],bound.nextCommandPhaseQueue[0]);
  assert.equal(bound.currentPhase,bound.phaseQueuePrepend[0]);
  assert.equal(bound.phaseQueue[0].pokemon,restored.roster.entries[0].pokemon);
  assert.equal(bound.phaseQueue[0].move,restored.roster.entries[0].pokemon.moveset[0]);
  assert.equal(bound.phaseQueue[1].weather,restored.arena.weather);
  assert.equal(bound.currentPhase.getPokemon(),restored.roster.entries[0].pokemon);
  bound.currentPhase.getPokemon().setMove(0,0); // Original forget branch creates a null slot.
  assert.equal(bound.currentPhase.getPokemon().moveset[0],null);
  assert.doesNotThrow(()=>codec.restore(codec.capture(restored)));
});
test('phase checkpoint rejects bad prototypes, references, duplicate identity conflicts and unsafe boundary with no mutation',()=>{
  const c=initialDecision(),phase=make('MovePhase',c),saved=phaseCodec.capture(phase,c,0),before=codec.capture(c);
  for(const change of [s=>{s.type='EvalPhase';},s=>{s.fields.pokemon.value=999;},s=>{s.fields.targets.value=[9];},s=>{s.fields.cancelled={presence:'null'};},s=>{s.fields.callback={presence:'value',value:'execute'};},s=>{delete s.fields.move;}]){
    const bad=copy(saved);change(bad);const input=copy(bad);assert.throws(()=>phaseCodec.restore(bad,c));assert.deepEqual(bad,input);assert.deepEqual(codec.capture(c),before);
  }
  phase.futureRuleField=1;assert.throws(()=>phaseCodec.capture(phase,c,0),/INVALID_PHASE_FIELD/);
  const queue={phaseQueue:[],phaseQueuePrepend:[],nextCommandPhaseQueue:[],phaseQueuePrependSpliceIndex:-1,currentPhase:{kind:'original-phase',phaseId:0,phase:saved,remaining:'evolution-apply'},standbyPhase:null};
  assert.throws(()=>codec.capture({...c,continuation:queue}),/INVALID_PHASE_BOUNDARY/);
});

test('queued phases preserve a shared detached move after learning replaces its slot',()=>{
  const c=initialDecision(),a=make('MovePhase',c),b=make('MoveEffectPhase',c);
  b.move=a.move;b.targets=a.targets;
  const queues=createOriginalQueueStateCodec(phaseCodec);
  c.continuation=queues.capture({phaseQueue:[a,b],phaseQueuePrepend:[],nextCommandPhaseQueue:[],phaseQueuePrependSpliceIndex:-1,currentPhase:null,standbyPhase:null},c,
    {scopeForPhase:()=>0,remainingForPhase:()=>null});
  const restored=codec.restore(codec.capture(c));restored.roster.entries[0].pokemon.setMove(0,0);
  const again=codec.restore(codec.capture(restored)),[pa,pb]=again.continuation.phaseQueue.map(p=>p.phase);
  assert.equal(pa.move,pb.move);assert.equal(pa.targets,pb.targets);assert.equal(again.roster.entries[0].pokemon.moveset[0],null);
  pa.move.ppUsed++;assert.equal(pb.move.ppUsed,3);
});

test('original action phases keep mutable target references into the saved Battle command',()=>{
  const c=initialDecision(),targets=[2];c.battle.turnCommands[0]={command:0,move:{move:33,targets}};
  c.decision.requiredSeats=[1];delete c.decision.options[0];
  const phase=make('MovePhase',c);phase.targets=targets;
  c.continuation.phaseQueue=[{kind:'original-phase',phaseId:0,phase:phaseCodec.capture(phase,c,0),remaining:'start'}];
  const saved=codec.capture(c),r=codec.restore(saved);
  assert.equal(r.continuation.phaseQueue[0].phase.targets,r.battle.turnCommands[0].move.targets);
  r.continuation.phaseQueue[0].phase.targets[0]=1;assert.equal(r.battle.turnCommands[0].move.targets[0],1);
  const bad=copy(saved);bad.continuation.phaseQueue[0].phase.fields.targets.value.reference.slot=3;
  assert.throws(()=>codec.restore(bad),/UNKNOWN_PHASE_COMMAND_ARRAY/);assert.deepEqual(codec.capture(c),saved);
});

test('old captured Enemy instance stays distinct from the Player with the same id and cannot act',()=>{
  const c=initialDecision(),enemy=c.roster.entries[2].pokemon,captured=originalPokemon(enemy.id);
  captured.moveset=enemy.moveset;captured.ivs=enemy.ivs;captured.stats=enemy.stats;
  c.roster.entries[2]={owner:0,group:'party',index:1,pokemon:captured};c.roster.field[2]=null;
  c.battle.enemyParty=[];c.battle.enemyLevels=[];
  const phase=Object.assign(Object.create(phaseConstructors.MovePhase.prototype),{pokemon:enemy,move:enemy.moveset[0],targets:[0],followUp:false,ignorePp:false,cancelled:false});
  const queues=createOriginalQueueStateCodec(phaseCodec);
  c.continuation=queues.capture({phaseQueue:[phase],phaseQueuePrepend:[],nextCommandPhaseQueue:[],phaseQueuePrependSpliceIndex:-1,currentPhase:null,standbyPhase:null},c,
    {scopeForPhase:()=>null,remainingForPhase:()=>null});
  const saved=codec.capture(c),restored=codec.restore(saved),old=restored.continuation.phaseQueue[0].phase.pokemon;
  const player=restored.roster.entries[2].pokemon;
  assert.notEqual(old,player);assert.equal(old.id,player.id);assert.equal(old.isPlayer(),false);assert.equal(player.isPlayer(),true);
  assert.equal(old.moveset,player.moveset);assert.equal(old.ivs,player.ivs);assert.equal(old.stats,player.stats);
  const scene={getField:()=>restored.roster.field.map(id=>restored.roster.entries.find(e=>e.pokemon.id===id)?.pokemon),field:{getIndex:p=>restored.roster.field.map(id=>restored.roster.entries.find(e=>e.pokemon.id===id)?.pokemon).indexOf(p)}};
  old.scene=scene;assert.equal(restored.continuation.phaseQueue[0].phase.canMove(),false);delete old.scene;
  assert.deepEqual(codec.capture(restored),saved);
});

test('queued original text is restored for presentation but language cannot change the rule projection',()=>{
  const c=initialDecision(),phase=new phaseConstructors.MessagePhase({},'你好',5,true,10);
  phase.textPresentation=JSON.stringify({kind:'translation',key:'battle:attackFailed',values:{}});
  const queues=createOriginalQueueStateCodec(phaseCodec);
  c.continuation=queues.capture({phaseQueue:[phase],phaseQueuePrepend:[],nextCommandPhaseQueue:[],phaseQueuePrependSpliceIndex:-1,currentPhase:null,standbyPhase:null},c,
    {scopeForPhase:()=>null,remainingForPhase:()=>null});
  const saved=codec.capture(c),restored=codec.restore(saved);assert.equal(restored.continuation.phaseQueue[0].phase.text,'你好');
  assert.equal(restored.continuation.phaseQueue[0].phase.textPresentation,phase.textPresentation);
  restored.continuation.phaseQueue[0].phase.text='Hello';
  restored.continuation.phaseQueue[0].phase.textPresentation=JSON.stringify({kind:'translation',key:'battle:attackMissed',values:{}});
  assert.deepEqual(checkpointRuleProjection(codec.capture(restored)),checkpointRuleProjection(saved));
});
