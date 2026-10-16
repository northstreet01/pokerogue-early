import { canonical, requireContract as check } from './coop-contract.mjs';

/** Original SwitchPhase callback's rule branch; UI transition remains in Phase. */
export function selectSwitchSummon(fieldIndex, slotIndex, battlerCount, doReturn, option, batonOption) {
  return slotIndex >= battlerCount && slotIndex < 6
    ? {fieldIndex,slotIndex,doReturn,batonPass:option===batonOption} : null;
}

/** Co-op ownership resolves to stable IDs. Single-player field compaction must
 * not move a surviving partner into the other player's reserved field slot. */
export function createForcedSwitchDecision(id, context, seats) {
  check(Array.isArray(seats) && seats.length > 0 && new Set(seats).size === seats.length, 'INVALID_SWITCH_DECISION');
  const options = {}, outgoing = {};
  for (const seat of seats) {
    check(seat === 0 || seat === 1, 'INVALID_SWITCH_OWNER');
    const currentId = context.roster.field[seat];
    const current = context.roster.entries.find(e=>e.pokemon.id===currentId);
    check(currentId === null || current?.owner === seat && current.pokemon.isFainted(), 'INVALID_SWITCH_DECISION');
    const replacements = context.roster.entries.filter(e=>e.owner===seat && e.group==='party'
      && !e.pokemon.isFainted() && !context.roster.field.includes(e.pokemon.id)).sort((a,b)=>a.index-b.index);
    check(replacements.length > 0, 'NO_SWITCH_AVAILABLE');
    outgoing[seat] = currentId;
    options[seat] = replacements.map(e=>({kind:'forced-switch',pokemonId:e.pokemon.id}));
  }
  return {id,kind:'wait-switch',requiredSeats:[...seats],options,switch:{outgoing}};
}
export function resolveForcedSwitchIntent(context, seat, action) {
  check(context.decision.kind === 'wait-switch', 'INVALID_SWITCH_DECISION');
  const expected = createForcedSwitchDecision(context.decision.id,context,context.decision.requiredSeats);
  check(canonical(expected)===canonical(context.decision), 'INVALID_SWITCH_DECISION');
  check(expected.options[seat]?.some(option=>canonical(option)===canonical(action)), 'INVALID_SWITCH_ACTION');
  const entry=context.roster.entries.find(e=>e.pokemon.id===action.pokemonId);
  return {fieldIndex:seat,pokemonId:entry.pokemon.id,partyIndex:entry.index,doReturn:false,batonPass:false};
}

// Voluntary pre-battle choices are distinct from a forced faint replacement.
// Each personal party has one active slot; wire intents retain stable IDs.
export function createPreBattleSwitchDecision(id,context,seat,kind){
  check(typeof id==='string'&&id.length>0&&id.length<=128&&[0,1].includes(seat)
    &&['switch-confirm','switch-select'].includes(kind),'INVALID_PRE_BATTLE_SWITCH');
  const active=context.roster.entries.find(e=>e.pokemon.id===context.roster.field[seat]);
  check(active?.owner===seat&&active.group==='party'&&active.index===0&&!active.pokemon.isFainted(),'INVALID_PRE_BATTLE_SWITCH');
  const reserves=context.roster.entries.filter(e=>e.owner===seat&&e.group==='party'&&e.index>0
    &&!e.pokemon.isFainted()&&!context.roster.field.includes(e.pokemon.id)).sort((a,b)=>a.index-b.index);
  check(reserves.length>0,'NO_SWITCH_AVAILABLE');
  const options=kind==='switch-confirm'?[true,false].map(accept=>({kind,pokemonId:active.pokemon.id,accept}))
    :[...reserves.map(e=>({kind,pokemonId:e.pokemon.id})),{kind,pokemonId:null}];
  return {id,kind,requiredSeats:[seat],options:{[seat]:options},switch:{outgoing:{[seat]:active.pokemon.id}}};
}
