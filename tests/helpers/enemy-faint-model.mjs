import fs from 'node:fs';
import {codec} from './decision-model.mjs';
import {parse,pokemon,evaluate} from './original-model.mjs';
import {originalPhases} from './phase-model.mjs';
import {compileReference} from './move-execution-model.mjs';
import {modifiers,types} from './modifier-model.mjs';
import {roundContext} from './round-loop-model.mjs';
import {replacementDriver} from './replacement-model.mjs';
import {nextPostPhase,BattleSpec} from './post-damage-model.mjs';
import {addFaintedEnemyScore} from '../../src/battle-core/faint-score.mjs';
import {getMaxExpLevel as calculateMaxExpLevel} from '../../src/battle-core/levels.mjs';
import {advanceQueuedRulePhase} from '../../src/battle-core/rule-phase-runner.mjs';
import {selectNextPhase} from '../../src/battle-core/phase-queue.mjs';
import {requireContract as check} from '../../src/battle-core/coop-contract.mjs';

const frozen=JSON.parse(fs.readFileSync(new URL('../fixtures/early-enemy-faint-reference.json',import.meta.url),'utf8'));
const referenceScore=compileReference(frozen.methods.addFaintedEnemyScore,'enemy',modifiers);
const referenceCap=compileReference(frozen.methods.getMaxExpLevel,'ignoreLevelCap',{calculateMaxExpLevel});
const liveCap=compileReference(parse('battle-scene.ts').statements.find(n=>n.name?.text==='BattleScene').members
  .find(n=>n.name?.getText()==='getMaxExpLevel').getText(),'ignoreLevelCap',{calculateMaxExpLevel});
const modeAst=parse('game-mode.ts'),GameModes=evaluate(modeAst.statements.find(n=>n.name?.text==='GameModes').getText()).GameModes;
const waveForDifficulty=compileReference(modeAst.statements.find(n=>n.name?.text==='GameMode').members
  .find(n=>n.name?.getText()==='getWaveForDifficulty').getText(),'waveIndex,ignoreCurveChanges',{GameModes});
const is=(p,name)=>p?.constructor===originalPhases[name];

export function enemyFaintContext({slot=2,held=false,lethalRound=false,bothWiped=false}={}){
  const c=roundContext({seed:'enemy-faint'});
  if(slot===3){
    const enemy=pokemon.restorePokemonState(pokemon.capturePokemonState(c.roster.entries[2].pokemon));enemy.id=103;
    c.roster.entries.push({owner:null,group:'enemy',index:1,pokemon:enemy});c.roster.field[3]=103;
    c.battle.enemyParty.push(enemy);c.battle.enemyLevels.push(enemy.level);
  }
  const enemy=c.roster.entries.find(e=>e.pokemon.id===c.roster.field[slot]).pokemon;
  enemy.hp=lethalRound?1:0;
  if(bothWiped)for(const e of c.roster.entries.filter(e=>e.owner!==null))e.pokemon.hp=0;
  if(held){
    const type=new types.AttackTypeBoosterModifierType(0,20);type.id='ATTACK_TYPE_BOOSTER';
    c.enemyModifiers.push(new modifiers.AttackTypeBoosterModifier(type,enemy.id,0,20,1));
  }
  const targets=[slot];c.battle.turnCommands[0].move.targets=targets;c.battle.turnCommands[1].move.targets=[slot];
  if(!lethalRound){const p=c.roster.entries[0].pokemon,phases=[new originalPhases.FaintPhase({},slot,false),
    new originalPhases.MovePhase({},p,targets,p.moveset[0]),new originalPhases.TurnEndPhase({})];
    c.continuation.phaseQueue=phases.map((phase,phaseId)=>({kind:'original-phase',phaseId,phase,remaining:'start'}));}
  c.decision.id='enemy-faint-0';return codec.restore(codec.capture(c));
}

export function enemyFaintDriver(options={}){
  const driver=replacementDriver({...options,allowEnemy:true,onEnemyBind(c,p,b,tasks,callbacks){
    b.scene.gameMode=Object.create(c.scene.gameMode);b.scene.gameMode.getWaveForDifficulty=waveForDifficulty;
    b.scene.findModifiers=(predicate,player)=>{check(player===false,'UNSUPPORTED_PLAYER_MODIFIERS');return c.enemyModifiers.filter(predicate);};
    b.scene.getMaxExpLevel=(options.reference?referenceCap:liveCap).bind(b.scene);
    b.scene.addFaintedEnemyScore=enemy=>options.reference?referenceScore.call(b.scene,enemy):addFaintedEnemyScore(b.scene,enemy,modifiers);
    options.onEnemyBind?.(c,p,b,tasks,callbacks);
  }});
  return {...driver,supports(c,p){
    if(is(p,'FaintPhase')&&!p.player)return c.battle.battleSpec===BattleSpec.DEFAULT&&c.battle.battleType===0
      &&c.players.every(s=>s.modifiers.length===0)&&c.enemyModifiers.every(m=>m instanceof modifiers.AttackTypeBoosterModifier
        ||m instanceof modifiers.PokemonBaseStatModifier);
    return driver.supports(c,p);
  }};
}
const nextId=c=>`enemy-faint-${Number(c.decision.id.split('-').at(-1))+1}`;
export const atVictoryBoundary=c=>c.continuation.currentPhase===null&&is(nextPostPhase(c),'VictoryPhase');
export const advanceEnemyFaint=(c,options={})=>advanceQueuedRulePhase(c,codec,enemyFaintDriver(options),{decisionId:nextId(c)});
export async function referenceEnemyFaint(c){
  const id=nextId(c),driver=enemyFaintDriver({reference:true}),resuming=!!c.continuation.currentPhase,
    d=c.continuation.currentPhase||selectNextPhase(c.continuation,()=>check(false,'EMPTY_ENEMY_FAINT_QUEUE')).phase;
  check(driver.supports(c,d.phase),'UNSUPPORTED_RULE_PHASE');
  const result=await (resuming?driver.resume(c,d.phase,d.remaining):driver.execute(c,d.phase));
  check(result.completed&&result.pendingTasks===0,'INCOMPLETE_ENEMY_FAINT');
  c.continuation.currentPhase=null;c.decision=driver.finishBoundary(c,d.phase,id);codec.capture(c);
  return {context:c,events:result.events,grants:result.grants};
}
export {referenceScore,referenceCap,liveCap,waveForDifficulty};
