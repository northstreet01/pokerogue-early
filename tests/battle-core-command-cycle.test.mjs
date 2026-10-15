import test from 'node:test';
import assert from 'node:assert/strict';
import {codec} from './helpers/decision-model.mjs';
import {moves,pokemon,battler} from './helpers/original-model.mjs';
import {originalPhases} from './helpers/phase-model.mjs';
import {cycleContext,advanceCycle,runCycleReference,chooseCycleInputs,collectedCommandDriver,cycleDriver} from './helpers/command-cycle-model.mjs';
import {nextPostPhase} from './helpers/post-damage-model.mjs';
import {resolveRoundFight} from './helpers/round-loop-model.mjs';
import {advanceCollectedFightCommands} from '../src/battle-core/fight-command.mjs';
import {copy} from '../src/battle-core/coop-contract.mjs';
import {BattleSpec} from './helpers/post-damage-model.mjs';

for(const seat of [0,1])for(const move of [moves.Moves.TACKLE,moves.Moves.GROWL,moves.Moves.DOUBLE_SLAP])
test(`original command/target/enemy phases run three consecutive rounds, owner=${seat}, move=${move}`,async()=>{
  const initial=await cycleContext({seat,move,seed:`cycle-${seat}-${move}`}),before=codec.capture(initial);
  let actual=initial,reference=codec.restore(before);
  for(let round=0;round<3;round++){
    const inputs=chooseCycleInputs(actual),oldPP=actual.roster.entries.map(e=>e.pokemon.moveset.reduce((n,m)=>n+m.ppUsed,0));
    const commands=Object.fromEntries(actual.decision.requiredSeats.map(owner=>[owner,resolveRoundFight(actual,owner,inputs[owner])]));
    let step=0;
    do{
      assert.ok(++step<50);
      const data=actual.decision.kind==='wait-actions'?inputs:{};
      const expected=await runCycleReference(reference,data);reference=expected.context;
      const result=await advanceCycle(codec.restore(JSON.parse(JSON.stringify(codec.capture(actual)))),data);actual=result.context;
      assert.deepEqual(result.events,expected.events);assert.deepEqual(codec.capture(actual),codec.capture(reference));
      if(step===1){assert.equal(nextPostPhase(actual).constructor,originalPhases.EnemyCommandPhase);
        for(const owner of [0,1])assert.deepEqual(copy(actual.battle.turnCommands[owner]),commands[owner]);
        assert.deepEqual(actual.roster.entries.map(e=>e.pokemon.moveset.reduce((n,m)=>n+m.ppUsed,0)),oldPP);}
    }while(actual.decision.kind==='continuing');
    assert.equal(actual.battle.turn,initial.battle.turn+round+1);
    assert.deepEqual(actual.roster.entries.map(e=>e.pokemon.moveset.reduce((n,m)=>n+m.ppUsed,0)),oldPP.map(n=>n+1));
    assert.ok(actual.roster.entries.every(e=>e.pokemon.hp>0));
  }
  assert.deepEqual(codec.capture(initial),before);
});

test('collected command boundary rejects missing, extra, forged and wrong-owner inputs atomically',async()=>{
  const c=await cycleContext(),before=codec.capture(c),actions=chooseCycleInputs(c);
  for(const inputs of [{0:actions[0]},{...actions,2:actions[0]},{...actions,0:actions[1]},
    {...actions,0:{...actions[0],target:3}},{...actions,0:{...actions[0],ignorePP:true}}]){
    await assert.rejects(advanceCycle(c,inputs));assert.deepEqual(codec.capture(c),before);
  }
  for(const kind of ['validator','incomplete','late','throw']){
    const driver=collectedCommandDriver();
    if(kind==='validator')driver.validateInput=candidate=>candidate.battle.randSeedInt(100);
    else{const execute=driver.executeCollected;driver.executeCollected=async(candidate,inputs)=>{
      const result=await execute(candidate,inputs);
      if(kind==='incomplete')return {...result,pendingTasks:1};
      if(kind==='late')candidate.roster.entries[0].pokemon.hp=-1;
      if(kind==='throw')throw Error('command task failed');return result;
    };}
    await assert.rejects(advanceCollectedFightCommands(c,actions,codec,driver,{decisionId:'cycle-next'}));
    assert.deepEqual(codec.capture(c),before);
  }
  await assert.rejects(advanceCollectedFightCommands(c,actions,codec,{...collectedCommandDriver(),async validateInput(){}},
    {decisionId:'cycle-next'}),{code:'COMMAND_DRIVER_UNAVAILABLE'});
  assert.deepEqual(codec.capture(c),before);
});

test('original Command.end and returned tasks finish before collected inputs can commit',async()=>{
  const c=await cycleContext(),before=codec.capture(c);let release,notify,done=false,bound=false;
  const gate=new Promise(resolve=>{release=resolve;}),ready=new Promise(resolve=>{notify=resolve;});
  const run=advanceCycle(c,chooseCycleInputs(c),{onBind:(_c,p,_b,tasks)=>{
    if(!bound&&p.constructor===originalPhases.CommandPhase){bound=true;tasks.add(gate);notify();}
  }}).then(result=>{done=true;return result;});
  await ready;assert.equal(done,false);assert.deepEqual(codec.capture(c),before);release();
  const result=await run;assert.equal(result.context.battle.turnCommands[0].command,0);
  assert.deepEqual(codec.capture(c),before);
});

test('original forced queue head and Encore execute before opening partner input',async()=>{
  for(const mode of ['queued','encore']){
    const c=await cycleContext(),p=c.roster.entries[0].pokemon;
    p.moveset=[new pokemon.PokemonMove(moves.Moves.GROWL,0,0,false)];
    if(mode==='queued')p.summonData.moveQueue=[{move:moves.Moves.SURF,targets:[2],ignorePP:false},{move:moves.Moves.GROWL,targets:[2],ignorePP:false}];
    else{const tag=battler.getBattlerTag('ENCORE',3,moves.Moves.ENCORE,p.id);tag.moveId=moves.Moves.GROWL;p.summonData.tags.push(tag);}
    c.decision={id:'cycle-forced-0',kind:'continuing',requiredSeats:[],reason:'effects'};
    const before=codec.capture(c),expected=await runCycleReference(codec.restore(before)),actual=await advanceCycle(c);
    assert.deepEqual(codec.capture(actual.context),codec.capture(expected.context));assert.deepEqual(actual.events,expected.events);
    assert.deepEqual(actual.context.decision.requiredSeats,[1]);assert.equal(actual.context.decision.kind,'wait-actions');
    assert.equal(actual.context.battle.turnCommands[0].move.move,moves.Moves.GROWL);
    if(mode==='queued')assert.deepEqual(actual.context.roster.entries[0].pokemon.summonData.moveQueue.map(q=>q.move),[moves.Moves.GROWL]);
    const next=await advanceCycle(actual.context,chooseCycleInputs(actual.context));
    assert.equal(nextPostPhase(next.context).constructor,originalPhases.EnemyCommandPhase);
    assert.deepEqual(codec.capture(c),before);
  }
});

test('batched-only driver refuses mixed forced order and final boss atomically',async()=>{
  for(const mode of ['mixed','boss']){
    const c=await cycleContext();c.decision={id:'cycle-0',kind:'continuing',requiredSeats:[],reason:'effects'};
    c.continuation.phaseQueue=[{kind:'original-phase',phaseId:0,phase:new originalPhases.TurnInitPhase({}),remaining:'start'}];
    if(mode==='mixed'){
      const p=c.roster.entries[1].pokemon;p.moveset=[new pokemon.PokemonMove(moves.Moves.GROWL,0,0,false)];
      p.summonData.moveQueue=[{move:moves.Moves.GROWL,targets:[2],ignorePP:false}];
    }else c.battle.battleSpec=BattleSpec.FINAL_BOSS;
    const before=codec.capture(c);
    await assert.rejects(advanceCycle(c),{code:mode==='mixed'?'UNSUPPORTED_MIXED_FORCED_ORDER':'UNSUPPORTED_RULE_PHASE'});
    assert.deepEqual(codec.capture(c),before);
  }
});

test('native enemy getNextMove/targets use room RNG across random and scored choices',async()=>{
  for(const aiType of [pokemon.AiType.RANDOM,pokemon.AiType.SMART,pokemon.AiType.SMART_RANDOM]){
    let c=await cycleContext({seed:`ai-${aiType}`});c=(await advanceCycle(c,chooseCycleInputs(c))).context;
    const enemy=c.roster.entries[2].pokemon;enemy.aiType=aiType;
    enemy.moveset=[new pokemon.PokemonMove(moves.Moves.TACKLE,0,0,false),new pokemon.PokemonMove(moves.Moves.GROWL,0,0,false)];
    const before=codec.capture(c),expected=await runCycleReference(codec.restore(before)),actual=await advanceCycle(c);
    assert.deepEqual(actual.events,expected.events);assert.deepEqual(codec.capture(actual.context),codec.capture(expected.context));
    assert.ok([moves.Moves.TACKLE,moves.Moves.GROWL].includes(actual.context.battle.turnCommands[2].move.move));
    assert.notEqual(actual.context.battle.battleSeedState,c.battle.battleSeedState);assert.deepEqual(codec.capture(c),before);
  }
});
