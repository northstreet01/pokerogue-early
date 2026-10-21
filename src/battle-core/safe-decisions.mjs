import { copy, canonical, requireContract as check } from './coop-contract.mjs';
import {createLearnDecision,resolveLearnIntent} from './learn-command.mjs';

const exact=(v,keys)=>check(v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')===[...keys].sort().join(','),'INVALID_SAFE_DECISION');
const uint=v=>Number.isSafeInteger(v)&&v>=0;
const seats=[0,1];
const owned=(c,seat,id)=>c.roster.entries.find(e=>e.owner===seat&&e.group==='party'&&e.pokemon.id===id);
const idValid=id=>typeof id==='string'&&id.length>0&&id.length<=128;
export const safeDecisionKinds=Object.freeze(['starter-ready','evolution','map','preparation','continuing','ended']);

// State at original interaction boundaries. The snapshot retains already-drawn
// options and catalog references; recovery never regenerates rewards/biomes.
export function createSafeDecisionCodec({evolution,modifierType,hasBiome,hasMove}) {
  function validate(d,c) {
    if(d?.kind==='learn-move'){
      check(d.requiredSeats?.length===1,'INVALID_LEARN_DECISION');
      check(canonical(createLearnDecision(d.id,c,d.requiredSeats[0],d.learn.pokemonId,d.learn.moveId,hasMove))===canonical(d),'INVALID_LEARN_DECISION');return d;
    }
    check(d&&safeDecisionKinds.includes(d.kind)&&idValid(d.id),'INVALID_SAFE_DECISION');
    const kind=d.kind;
    check(Array.isArray(d.requiredSeats)&&new Set(d.requiredSeats).size===d.requiredSeats.length&&d.requiredSeats.every(s=>seats.includes(s)),'INVALID_SAFE_DECISION');
    if(kind==='continuing') {
      exact(d,['id','kind','requiredSeats','reason']);check(d.requiredSeats.length===0&&['switch','effects','evolution','learning','next-battle'].includes(d.reason),'INVALID_CONTINUING_DECISION');
    } else if(kind==='starter-ready') {
      exact(d,['id','kind','requiredSeats','starters','ready']);
      check(Array.isArray(d.starters)&&d.starters.length===2&&Array.isArray(d.ready)&&d.ready.length===2&&d.ready.every(v=>typeof v==='boolean'),'INVALID_STARTER_DECISION');
      seats.forEach(seat=>{
        check(Array.isArray(d.starters[seat])&&d.starters[seat].length===3&&new Set(d.starters[seat]).size===3
          &&d.starters[seat].every(id=>owned(c,seat,id)),'INVALID_STARTER_DECISION');
      });
      check(canonical(d.requiredSeats)===canonical(seats),'INVALID_SAFE_DECISION');
    } else if(kind==='evolution') {
      exact(d,['id','kind','requiredSeats','pokemonId','reference','lastLevel','stage']);
      check(d.requiredSeats.length===1&&owned(c,d.requiredSeats[0],d.pokemonId)&&uint(d.lastLevel)
        &&d.lastLevel<=owned(c,d.requiredSeats[0],d.pokemonId).pokemon.level
        &&['evolve-or-cancel','pause-confirm'].includes(d.stage),'INVALID_EVOLUTION_DECISION');
      check(evolution?.restore,'EVOLUTION_CATALOG_UNAVAILABLE');evolution.restore(d.reference);
      check(d.reference.id===owned(c,d.requiredSeats[0],d.pokemonId).pokemon.species.speciesId,'INVALID_EVOLUTION_REFERENCE');
    } else if(kind==='map') {
      exact(d,['id','kind','requiredSeats','sourceBiome','biomes','choices']);
      check(canonical(d.requiredSeats)===canonical(seats)&&hasBiome?.(d.sourceBiome)&&Array.isArray(d.biomes)&&d.biomes.length>0&&d.biomes.length<=100
        &&new Set(d.biomes).size===d.biomes.length&&d.biomes.every(hasBiome)&&Array.isArray(d.choices)&&d.choices.length===2
        &&d.choices.every(v=>v===null||d.biomes.includes(v)),'INVALID_MAP_DECISION');
      check(d.sourceBiome===c.arena.biomeType,'STALE_MAP_DECISION');
    } else if(kind==='preparation') {
      exact(d,['id','kind','requiredSeats','players']);check(canonical(d.requiredSeats)===canonical(seats)&&Array.isArray(d.players)&&d.players.length===2,'INVALID_PREPARATION');
      for(const p of d.players){
        exact(p,['ready','rewardResolved','rerollCount','rerollCost','rewards','shop','selection','subdecision']);
        check(typeof p.ready==='boolean'&&typeof p.rewardResolved==='boolean'&&uint(p.rerollCount)&&uint(p.rerollCost)
          &&(!p.ready||p.rewardResolved&&p.subdecision===null&&p.selection===null),'INVALID_PREPARATION');
        if(p.subdecision!==null){
          check(['evolution','learn-move'].includes(p.subdecision.kind)&&canonical(p.subdecision.requiredSeats)===canonical([d.players.indexOf(p)]),'INVALID_PREPARATION_SUBDECISION');
          validate(p.subdecision,c);
        }
        for(const key of ['rewards','shop']){
          check(Array.isArray(p[key])&&p[key].length<=1000,'INVALID_PREPARATION');
          const ids=new Set();
          for(const option of p[key]){
            exact(option,['id','type','cost']);check(idValid(option.id)&&!ids.has(option.id)&&uint(option.cost)&&(key!=='rewards'||option.cost===0),'INVALID_PREPARATION');ids.add(option.id);
            check(modifierType?.restore,'MODIFIER_TYPE_UNAVAILABLE');modifierType.restore(option.type);
          }
        }
        if(p.selection!==null){exact(p.selection,['optionId','pokemonId','moveIndex','fusionId']);check(idValid(p.selection.optionId)
          &&[...p.rewards,...p.shop].some(o=>o.id===p.selection.optionId),'INVALID_PREPARATION');
          const seat=d.players.indexOf(p);
          for(const key of ['pokemonId','fusionId'])check(p.selection[key]===null||owned(c,seat,p.selection[key]),'INVALID_PREPARATION_OWNER');
          check(p.selection.moveIndex===null||Number.isInteger(p.selection.moveIndex)&&p.selection.moveIndex>=0&&p.selection.moveIndex<4,'INVALID_PREPARATION');
        }
      }
    } else {
      exact(d,['id','kind','requiredSeats','victory','reason']);check(d.requiredSeats.length===0&&typeof d.victory==='boolean'
        &&['victory','defeat','abandoned'].includes(d.reason)&&d.victory===(d.reason==='victory'),'INVALID_END_DECISION');
    }
    return d;
  }
  function validateAction(c,seat,a) {
    const d=validate(c.decision,c);check(d.requiredSeats.includes(seat),'INVALID_ACTION_OWNER');
    if(d.kind==='learn-move'){resolveLearnIntent(c,seat,a,hasMove);return;}
    if(d.kind==='starter-ready') {exact(a,['kind','ready']);check(a.kind==='starter-ready'&&typeof a.ready==='boolean','INVALID_ACTION');}
    else if(d.kind==='evolution') {exact(a,['kind','pokemonId','choice']);check(a.kind==='evolution'&&a.pokemonId===d.pokemonId
      &&(d.stage==='evolve-or-cancel'?['evolve','cancel']:['pause','continue']).includes(a.choice),'INVALID_ACTION');}
    else if(d.kind==='map') {exact(a,['kind','biome']);check(a.kind==='map'&&d.biomes.includes(a.biome),'INVALID_ACTION');}
    else if(d.kind==='preparation') {
      const p=d.players[seat];
      if(p.subdecision!==null){validateAction({...c,decision:p.subdecision},seat,a);return;}
      check(a.kind==='preparation','INVALID_ACTION');
      if(['ready','unready','skip-reward','reroll'].includes(a.operation)){
        exact(a,['kind','operation']);
        if(a.operation==='ready')check(p.rewardResolved&&p.selection===null&&p.subdecision===null,'UNRESOLVED_PREPARATION');
        if(a.operation==='skip-reward')check(!p.rewardResolved,'REWARD_ALREADY_RESOLVED');
        if(a.operation==='reroll')check(!p.rewardResolved&&c.players[seat].money>=p.rerollCost,'INVALID_REROLL');
      } else if(['reward','buy'].includes(a.operation)) {
        exact(a,['kind','operation','optionId','pokemonId','moveIndex','fusionId']);
        const option=(a.operation==='reward'?p.rewards:p.shop).find(o=>o.id===a.optionId);
        check(option&&(a.operation!=='reward'||!p.rewardResolved)&&c.players[seat].money>=option.cost,'INVALID_PREPARATION_OPTION');
        for(const key of ['pokemonId','fusionId'])check(a[key]===null||owned(c,seat,a[key]),'INVALID_PREPARATION_OWNER');
        check(a.moveIndex===null||Number.isInteger(a.moveIndex)&&a.moveIndex>=0&&a.moveIndex<4,'INVALID_ACTION');
        check(a.fusionId===null||a.pokemonId!==a.fusionId,'INVALID_ACTION');
      } else if(a.operation==='reserve-swap') {
        exact(a,['kind','operation','partyId','reserveId']);check(owned(c,seat,a.partyId)
          &&c.roster.entries.some(e=>e.owner===seat&&e.group==='reserve'&&e.pokemon.id===a.reserveId),'INVALID_PREPARATION_OWNER');
      } else if(a.operation==='transfer') {
        exact(a,['kind','operation','modifierIndex','fromId','toId']);check(uint(a.modifierIndex)&&a.modifierIndex<c.players[seat].modifiers.length
          &&owned(c,seat,a.fromId)&&owned(c,seat,a.toId)&&a.fromId!==a.toId
          &&c.players[seat].modifiers[a.modifierIndex].pokemonId===a.fromId,'INVALID_PREPARATION_OWNER');
      } else check(false,'INVALID_ACTION');
    } else check(false,'INVALID_ACTION');
  }
  return Object.freeze({validate,validateAction,collection:d=>d.kind==='continuing'?'auto':['map','preparation','starter-ready'].includes(d.kind)?'incremental':'all'});
}

// Advances coordination flags only. Original game effects are explicit trusted
// hooks; missing hooks fail before mutating a candidate. Returning new state is
// atomic, and publish/receipt/grant commit remains the formal service's job.
export function nextSafeDecisionId(id) {
  const match=/^(.*?)(?:~(\d+))?$/.exec(id),step=Number(match[2]??0)+1;
  check(Number.isSafeInteger(step)&&`${match[1]}~${step}`.length<=128,'DECISION_SEQUENCE_EXHAUSTED');
  return `${match[1]}~${step}`;
}

export async function applySafeDecisionAction(context,seat,action,codec,safe,hooks) {
  safe.validateAction(context,seat,action);
  let candidate=codec.restore(codec.capture(context));const d=candidate.decision,events=[],grants=[];
  const invoke=async(name,...args)=>{
    check(typeof hooks?.[name]==='function','SAFE_DECISION_HANDLER_UNAVAILABLE');
    const result=await hooks[name](candidate,...args);check(result&&Array.isArray(result.events)&&Array.isArray(result.grants),'INVALID_SAFE_DECISION_RESULT');
    events.push(...result.events);grants.push(...result.grants);
  };
  if(d.kind==='learn-move') {
    await invoke('learnMove',seat,action,d.learn);
  } else if(d.kind==='starter-ready') {
    d.ready[seat]=action.ready;
    if(d.ready.every(Boolean))await invoke('startAdventure',d.starters);
  } else if(d.kind==='map') {
    d.choices[seat]=action.biome;
    if(d.choices[0]!==null&&d.choices[0]===d.choices[1])await invoke('chooseBiome',d.choices[0]);
  } else if(d.kind==='evolution') {
    if(action.choice==='cancel')d.stage='pause-confirm';
    else if(d.stage==='pause-confirm') {
      candidate.roster.entries.find(e=>e.pokemon.id===d.pokemonId).pokemon.pauseEvolutions=action.choice==='pause';
      await invoke('endEvolution',d.pokemonId);
    } else await invoke('evolve',d.pokemonId,d.reference,d.lastLevel);
  } else if(d.kind==='preparation') {
    const p=d.players[seat],operation=action.operation;
    if(p.subdecision!==null){
      const sub=await applySafeDecisionAction({...candidate,decision:p.subdecision},seat,action,codec,safe,hooks);
      candidate=sub.context;events.push(...sub.events);grants.push(...sub.grants);
      p.subdecision=['evolution','learn-move'].includes(candidate.decision.kind)?candidate.decision:null;
      candidate.decision=d;
    } else if(operation==='ready')p.ready=true;
    else if(operation==='unready')p.ready=false;
    else {
      p.ready=false;
      if(operation==='skip-reward') {p.rewardResolved=true;p.selection=null;}
      else if(operation==='reserve-swap') {
        const party=candidate.roster.entries.find(e=>e.pokemon.id===action.partyId),reserve=candidate.roster.entries.find(e=>e.pokemon.id===action.reserveId);
        [party.group,reserve.group]=[reserve.group,party.group];[party.index,reserve.index]=[reserve.index,party.index];
        candidate.roster.field=candidate.roster.field.map(id=>id===party.pokemon.id?reserve.pokemon.id:id);
      } else if(operation==='reroll') {
        candidate.players[seat].money-=p.rerollCost;p.rerollCount++;
        await invoke('reroll',seat);
      } else if(operation==='transfer')await invoke('transfer',seat,action);
      else {
        const option=(operation==='reward'?p.rewards:p.shop).find(o=>o.id===action.optionId);
        await invoke('applyModifier',seat,option.type,action);
        if(candidate.decision!==d){
          check(['evolution','learn-move'].includes(candidate.decision.kind),'INVALID_PREPARATION_SUBDECISION');
          p.subdecision=candidate.decision;candidate.decision=d;
        }
        candidate.players[seat].money-=option.cost;
        if(operation==='reward')p.rewardResolved=true;
        p.selection=null;
      }
    }
    if(d.players.every(p=>p.ready))await invoke('nextBattle');
  }
  // Each reopened choice gets a distinct ID, even if it remains in the same
  // map/preparation stage. Preserve M1's old-decision/old-ACK rejection rule.
  if(candidate.decision.id===context.decision.id){
    candidate.decision.id=nextSafeDecisionId(candidate.decision.id);
  }
  codec.capture(candidate);return {context:candidate,events:copy(events),grants:copy(grants)};
}
