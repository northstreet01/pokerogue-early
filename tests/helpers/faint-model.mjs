import fs from 'node:fs';
import {codec} from './decision-model.mjs';
import {originalPokemon,moves,pokemon,parse,evaluate} from './original-model.mjs';
import {originalPhases,installPhaseTestDependencies} from './phase-model.mjs';
import {bindAction,compileReference} from './move-execution-model.mjs';
import {damageRules} from './move-effect-model.mjs';
import {roundContext} from './round-loop-model.mjs';
import {cycleDriver,advanceCycle,chooseCycleInputs} from './command-cycle-model.mjs';
import {nextPostPhase,BattleSpec} from './post-damage-model.mjs';
import {bindCoopFaint} from '../../src/battle-core/faint-queue.mjs';
import {createForcedSwitchDecision} from '../../src/battle-core/switch-command.mjs';
import {advanceQueuedRulePhase} from '../../src/battle-core/rule-phase-runner.mjs';
import {selectNextPhase,populatePhaseQueue} from '../../src/battle-core/phase-queue.mjs';
import {createRuleTaskTracker} from '../../src/battle-core/rule-task-tracker.mjs';
import {requireContract as check} from '../../src/battle-core/coop-contract.mjs';

const enumOf=(file,name)=>evaluate(parse(file).statements.filter(n=>n.name?.text===name).map(n=>n.getText()).join('\n'))[name];
const Mode=enumOf('ui/ui.ts','Mode'),PartyUiMode=enumOf('ui/party-ui-handler.ts','PartyUiMode');
installPhaseTestDependencies({'./ui/party-ui-handler':{PartyUiMode,default:{FilterNonFainted:()=>true}}});
const frozen=JSON.parse(fs.readFileSync(new URL('../fixtures/early-faint-reference.json',import.meta.url),'utf8'));
const reference=Object.fromEntries(Object.entries(frozen.methods).map(([name,methods])=>[name,
  Object.fromEntries(Object.entries(methods).map(([method,body])=>[method,compileReference(body.replaceAll('super.end()','this.scene.shiftPhase()'),
    '',{...damageRules,...originalPhases,BattleSpec,Mode,PartyUiMode,PartyUiHandler:{FilterNonFainted:()=>true}})]))]));
const is=(p,name)=>p?.constructor===originalPhases[name];

// Fixtures begin either at an already applied player death or at the real
// TurnStart whose enemy action causes that death. No synthetic HP subtraction.
export function faintContext({seat=0,reserves=1,both=false,lethalRound=false}={}){
  const c=roundContext({seed:'faint-policy'});
  const outgoing=c.roster.entries[seat].pokemon;
  for(let index=1;index<=reserves;index++){
    const p=originalPokemon(110+seat*10+index);p.hp=p.stats[0]=200;p.status=null;
    p.fusionSpecies=null;p.summonData.speciesForm=null;p.summonData.fusionSpeciesForm=null;
    p.summonData.moveset=null;p.summonData.tags=[];p.summonData.moveQueue=[];p.summonData.disabledMove=0;
    p.moveset=[new pokemon.PokemonMove(moves.Moves.TACKLE,0,0,false)];
    c.roster.entries.push({owner:seat,group:'party',index,pokemon:p});
  }
  if(lethalRound){outgoing.hp=1;c.roster.entries[2].pokemon.stats[5]=100;
    c.battle.turnCommands[2].move.targets=[seat];return c;}
  outgoing.hp=0;if(both)c.roster.entries[1-seat].pokemon.hp=0;
  const enemy=c.roster.entries[2].pokemon,targets=[seat];
  c.battle.turnCommands[2].move.targets=targets;
  const phases=[new originalPhases.FaintPhase({},seat,false)];
  if(both)phases.push(new originalPhases.FaintPhase({},1-seat,false));
  phases.push(new originalPhases.MovePhase({},enemy,targets,enemy.moveset[0]),new originalPhases.TurnEndPhase({}));
  c.continuation.phaseQueue=phases.map((phase,phaseId)=>({kind:'original-phase',phaseId,phase,remaining:'start'}));
  c.decision.id='faint-0';return codec.restore(codec.capture(c));
}

function finishBoundary(c,_p,id){
  const alive=owner=>c.roster.entries.some(e=>e.owner===owner&&e.group==='party'&&!e.pokemon.isFainted());
  if(!alive(0)&&!alive(1)&&is(_p,'TurnEndPhase')){
    check(c.battle.enemyParty.some(p=>!p.isFainted()),'UNCONFIRMED_SIMULTANEOUS_WIPE');
    return {id,kind:'ended',requiredSeats:[],victory:false,reason:'defeat'};
  }
  if(!nextPostPhase(c)){
    populatePhaseQueue(c.continuation,()=>({kind:'original-phase',phaseId:Math.max(-1,...c.continuation.nextCommandPhaseQueue.map(d=>d.phaseId))+1,
      phase:new originalPhases.TurnInitPhase({}),remaining:'start'}));
  }
  return {id,kind:'continuing',requiredSeats:[],reason:'effects'};
}

export function faintDriver({reference:useReference=false,onFaintBind,cooperative=true,allowEnemy=false,onEnemyBind,...options}={}){
  const cycle=cycleDriver({...options,reference:useReference,allowSuspend:true});return {
    supports:(c,p)=>c.battle.battleSpec===BattleSpec.DEFAULT&&
      ((is(p,'FaintPhase')&&(!!options.bindModifiers||c.players.every(s=>s.modifiers.length===0))
        &&(p.player===true&&(!!options.bindModifiers||c.enemyModifiers.length===0)||allowEnemy&&p.player===false&&c.battle.battleType===0))
        ||is(p,'SwitchPhase')||cycle.supports(c,p)),
    async execute(c,p){
      if(!is(p,'FaintPhase')&&!is(p,'SwitchPhase'))return cycle.execute(c,p);
      const b=bindAction(c,p),tasks=createRuleTaskTracker(b.scene),temporary=[],callbacks=[];
      const define=(o,k,value)=>{temporary.push([o,k,Object.getOwnPropertyDescriptor(o,k)]);Object.defineProperty(o,k,{value,writable:true,configurable:true});};
      let unbind=()=>{},waiting=false;
      let modifierBinding;
      try{
        const seat=p.fieldIndex,party=c.roster.entries.filter(e=>e.owner===seat&&e.group==='party').sort((a,b)=>a.index-b.index).map(e=>e.pokemon);
        b.scene.getParty=()=>party;
        b.scene.findPhase=predicate=>[...c.continuation.phaseQueuePrepend,...c.continuation.phaseQueue,
          ...c.continuation.nextCommandPhaseQueue].map(d=>d.phase).find(predicate);
        b.scene.playSound=sound=>b.events.push({kind:'sound',sound});
        // Container removal is presentation. Keep the dead position's instance
        // available to already queued PokemonPhase objects; isActive filters it.
        b.scene.field.remove=pk=>b.events.push({kind:'faint-display-remove',pokemonId:pk.id});
        b.scene.tweens={add:config=>callbacks.push(config.onComplete)};
        b.scene.ui={setMode(mode){check(mode===Mode.PARTY,'UNSUPPORTED_FAINT_UI');waiting=true;return Promise.resolve();}};
        const rendered=new Set([...party,...(is(p,'FaintPhase')?[p.getPokemon()]:[])]);
        for(const pk of rendered){define(pk,'faintCry',done=>callbacks.push(done));define(pk,'hideInfo',()=>{});
          define(pk,'setVisible',()=>{});define(pk,'y',0);}
        if(useReference){
          for(const [name,fn]of Object.entries(reference[p.constructor.name]))define(p,name,fn);
          // Independent original rule baseline with the approved coop differences:
          // scoped party, no single-player compaction/GameOver, no auto-retarget.
          if(cooperative){const unshift=b.scene.unshiftPhase;
            b.scene.unshiftPhase=phase=>{if(!is(phase,'GameOverPhase')&&!is(phase,'ToggleDoublePositionPhase'))unshift(phase);};
            b.scene.findPhase=()=>null;}
        }else if(is(p,'FaintPhase')&&cooperative)unbind=bindCoopFaint(p,c);
        if(is(p,'FaintPhase')&&!p.player)onEnemyBind?.(c,p,b,tasks,callbacks);
        modifierBinding=options.bindModifiers?.(c,p,b,tasks);
        onFaintBind?.(c,p,b,tasks,callbacks);
        p.start();let count=0;
        while(callbacks.length){check(++count<20,'FAINT_CALLBACK_LIMIT');callbacks.shift()();}
        await (modifierBinding?.drain()??tasks.drain());await Promise.resolve();
        return {completed:b.ended,suspended:waiting,pendingTasks:tasks.pendingTasks,events:b.events,grants:[]};
      }finally{modifierBinding?.dispose();unbind();for(const [o,k,d]of temporary.reverse()){if(d)Object.defineProperty(o,k,d);else delete o[k];}tasks.close();b.dispose();}
    },
    finishBoundary,
    suspendBoundary(c,p,id){if(!is(p,'SwitchPhase'))return cycle.suspendBoundary(c,p,id);
      check(p.isModal===true&&p.doReturn===false,'UNSUPPORTED_SWITCH_BOUNDARY');
      return {remaining:'wait-switch',decision:createForcedSwitchDecision(id,c,[p.fieldIndex])};}
  };
}
const nextId=c=>`faint-${Number(c.decision.id.split('-').at(-1))+1}`;
export const advanceFaint=(c,inputs={},options={})=>['wait-actions','wait-target'].includes(c.decision.kind)
  ?advanceCycle(c,inputs,{...options,allowSuspend:true})
  :advanceQueuedRulePhase(c,codec,faintDriver(options),{decisionId:nextId(c)});
export const chooseFaintInputs=c=>c.decision.kind==='continuing'?{}:chooseCycleInputs(c);
export async function referenceFaint(c){
  const id=nextId(c),driver=faintDriver({reference:true}),d=selectNextPhase(c.continuation,()=>check(false,'EMPTY_FAINT_QUEUE')).phase;
  check(driver.supports(c,d.phase),'UNSUPPORTED_RULE_PHASE');const result=await driver.execute(c,d.phase);
  check((result.completed||result.suspended)&&result.pendingTasks===0,'INCOMPLETE_RULE_PHASE');
  if(result.suspended){const stop=driver.suspendBoundary(c,d.phase,id);d.remaining=stop.remaining;c.decision=stop.decision;}
  else{c.continuation.currentPhase=null;c.decision=driver.finishBoundary(c,d.phase,id);}
  codec.capture(c);return {context:c,events:result.events,grants:result.grants};
}
