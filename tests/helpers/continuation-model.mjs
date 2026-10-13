import { initialDecision, codec } from './decision-model.mjs';
import { originalPokemon } from './original-model.mjs';
import { finishSwitchSummon } from '../../src/battle-core/switch-finish.mjs';
import { prependPhase } from '../../src/battle-core/phase-queue.mjs';
import { advanceContinuation } from '../../src/battle-core/phase-continuation.mjs';
import { requireContract as check } from '../../src/battle-core/coop-contract.mjs';

// Boundary fixture: incoming Pokemon is already placed and initialized by the
// summon, SummonPhase.onEnd has run, SwitchSummonPhase's tail is still pending.
// No UI, entry hazards, held-item transfer or ability implementation is faked.
export function switchFinishContext(batonPass = true) {
  const c = initialDecision();
  for (const seat of [0,1]) {
    const incoming = c.roster.entries[seat].pokemon, outgoing = originalPokemon(110 + seat);
    incoming.summonData.speciesForm = null;
    incoming.resetSummonData(); incoming.resetTurnData();
    outgoing.summonData.speciesForm = null;
    c.roster.entries.push({owner:seat,group:'party',index:1,pokemon:outgoing});
    c.continuation.phaseQueue.push({kind:'switch-finish',fieldIndex:seat,pokemonId:incoming.id,outgoingId:outgoing.id,batonPass});
  }
  c.players.forEach(p => { p.money = 0; p.modifiers = []; Object.keys(p.pokeballCounts).forEach(k => { p.pokeballCounts[k] = 0; }); });
  return c;
}

export function finishHandler(c, descriptor) {
  const {fieldIndex,pokemonId,outgoingId,batonPass} = descriptor;
  check(c.roster.field[fieldIndex] === pokemonId && !c.roster.field.includes(outgoingId), 'STALE_SWITCH_CONTINUATION');
  const incoming = c.roster.entries.find(e => e.pokemon.id === pokemonId).pokemon;
  const outgoing = c.roster.entries.find(e => e.pokemon.id === outgoingId).pokemon;
  const events = [];
  // Original Pokemon methods run; only external scene hooks are recorded.
  const scene = { triggerPokemonFormChange: p => events.push({kind:'post-move-form-hook',pokemonId:p.id}),
    validateAchv: id => events.push({kind:'achievement-hook',id}) };
  incoming.scene = outgoing.scene = scene;
  try {
    finishSwitchSummon(incoming,outgoing,batonPass,c.battle.turnCommands[fieldIndex]?.command === 2,
      p => events.push({kind:'active-form-hook',pokemonId:p.id}));
  } finally { delete incoming.scene; delete outgoing.scene; }
  return events;
}

export function continueSwitchFinishes(context) {
  // PostSummonPhase was queued by super.onEnd before the saved tail; keep it
  // deferred here as a separate test fixture, never run a no-op ability handler.
  let current = context;
  const events = [];
  for (let count = 0; count < 2; count++) {
    const next = advanceContinuation(current,codec,{'switch-finish':{start:finishHandler}});
    current = next.context; events.push(...next.events);
  }
  prependPhase(current.continuation,{kind:'post-summon',fieldIndex:0,pokemonId:100});
  current.decision.id += '-finished';
  return {context:current,events,grants:[]};
}
