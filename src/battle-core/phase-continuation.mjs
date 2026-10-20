import { copy, canonical, requireContract as check } from './coop-contract.mjs';
import { selectNextPhase } from './phase-queue.mjs';

const lists = ['phaseQueue', 'phaseQueuePrepend', 'nextCommandPhaseQueue'];
const fields = [...lists, 'phaseQueuePrependSpliceIndex', 'currentPhase', 'standbyPhase'];
const exact = (value, keys) => check(value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).sort().join(',') === [...keys].sort().join(','), 'INVALID_CONTINUATION');

export function emptyContinuation() {
  return { phaseQueue: [], phaseQueuePrepend: [], nextCommandPhaseQueue: [],
    phaseQueuePrependSpliceIndex: -1, currentPhase: null, standbyPhase: null };
}

// Explicitly supported data only. Phase type IDs use the trusted registry;
// executable callbacks/UI/constructors never come from the checkpoint.
export function restoreContinuation(input, roster, validateOriginalPhase) {
  const state = copy(input); exact(state, fields);
  const byId = new Map(roster.entries.map(e => [e.pokemon.id, e]));
  const finishes = new Set();
  const identities=new Map();
  const phase = p => {
    check(p && typeof p === 'object', 'INVALID_CONTINUATION');
    if (p.kind === 'original-phase') {
      exact(p,['kind','phaseId','phase','remaining']);
      check(Number.isSafeInteger(p.phaseId)&&p.phaseId>=0&&p.phaseId<100000,'INVALID_CONTINUATION');
      check(['start','switch-return','switch-swap','summon-initialize','summon-finish','switch-finish','post-summon','evolution-apply',
        'evolution-pause','learn-apply','form-change','reward-select','map-select','starter-ready','wait-actions','wait-target','wait-switch','switch-confirm','switch-select','capture-select','victory-aftermath','hatch-commit','ended'].includes(p.remaining),'INVALID_CONTINUATION');
      const owners={
        'switch-return':['SwitchSummonPhase','ReturnPhase'],'switch-swap':['SwitchSummonPhase'],
        'summon-initialize':['SummonPhase','SwitchSummonPhase','SummonMissingPhase'],'summon-finish':['SummonPhase','SwitchSummonPhase','SummonMissingPhase'],
        'switch-finish':['SwitchSummonPhase'],'post-summon':['PostSummonPhase'],
        'evolution-apply':['EvolutionPhase'],'evolution-pause':['EvolutionPhase'],'learn-apply':['LearnMovePhase'],
        'form-change':['FormChangePhase','QuietFormChangePhase'],'reward-select':['SelectModifierPhase'],
        'map-select':['SelectBiomePhase'],'starter-ready':['SelectStarterPhase'],
        'wait-actions':['TurnInitPhase','CommandPhase'],'wait-target':['CommandPhase','SelectTargetPhase'],'wait-switch':['SwitchPhase'],
        'switch-confirm':['CheckSwitchPhase'],'switch-select':['SwitchPhase'],
        'capture-select':['AttemptCapturePhase'],
        'victory-aftermath':['VictoryPhase'],'hatch-commit':['EggHatchPhase'],'ended':['GameOverPhase']};
      check(p.remaining==='start'||owners[p.remaining]?.includes(p.phase?.type),'INVALID_PHASE_BOUNDARY');
      if(p.phase?.type==='EggHatchPhase')check((p.phase.fields.pokemon?.presence==='value')===(p.remaining==='hatch-commit'),'INVALID_HATCH_BOUNDARY');
      const content=canonical(p.phase);
      check(!identities.has(p.phaseId)||identities.get(p.phaseId)===content,'CONFLICTING_PHASE_ID');identities.set(p.phaseId,content);
      check(typeof validateOriginalPhase==='function','ORIGINAL_PHASE_CODEC_UNAVAILABLE');validateOriginalPhase(p.phase);return;
    }
    if (p.kind === 'turn-init') { exact(p, ['kind']); return; }
    check(['switch-finish', 'post-summon'].includes(p.kind), 'UNSUPPORTED_CONTINUATION');
    exact(p, p.kind === 'switch-finish' ? ['kind','fieldIndex','pokemonId','outgoingId','batonPass'] : ['kind','fieldIndex','pokemonId']);
    check(Number.isInteger(p.fieldIndex) && p.fieldIndex >= 0 && p.fieldIndex <= 3, 'INVALID_CONTINUATION');
    const entry = byId.get(p.pokemonId);
    check(entry && (p.fieldIndex < 2 ? entry.owner === p.fieldIndex && entry.group === 'party' : entry.owner === null), 'INVALID_CONTINUATION_OWNER');
    if (p.kind === 'switch-finish') {
      const outgoing = byId.get(p.outgoingId);
      check(typeof p.batonPass === 'boolean' && outgoing && outgoing !== entry
        && outgoing.owner === entry.owner && outgoing.group === entry.group, 'INVALID_CONTINUATION_OWNER');
      check(roster.field[p.fieldIndex] === p.pokemonId && !roster.field.includes(p.outgoingId), 'STALE_SWITCH_CONTINUATION');
      check(!finishes.has(p.pokemonId), 'DUPLICATE_SWITCH_CONTINUATION'); finishes.add(p.pokemonId);
    }
  };
  for (const key of lists) {
    check(Array.isArray(state[key]) && state[key].length <= 1000, 'INVALID_CONTINUATION');
    state[key].forEach(phase);
  }
  check(Number.isInteger(state.phaseQueuePrependSpliceIndex) && state.phaseQueuePrependSpliceIndex >= -1
    && state.phaseQueuePrependSpliceIndex <= state.phaseQueuePrepend.length, 'INVALID_CONTINUATION');
  for (const key of ['currentPhase','standbyPhase']) if (state[key] !== null) {
    phase(state[key]);check(state[key].kind!=='original-phase'||state[key].remaining!=='start','UNSAFE_PHASE_BOUNDARY');
  }
  check(state.standbyPhase === null || state.currentPhase !== null, 'INVALID_CONTINUATION');
  return state;
}

/** One atomic continuation step. Trusted handlers must act only on the supplied
 * candidate. A running/current Phase requires an explicit resume handler; it
 * must never be restarted. Missing handlers and late validation failures leave
 * the caller's context intact. External effects belong after durable commit. */
export function advanceContinuation(context, codec, handlers, populate) {
  const candidate = codec.restore(codec.capture(context)), state = candidate.continuation;
  const selected = state.currentPhase ? {phase: state.currentPhase, start: false}
    : selectNextPhase(state, () => {
      check(typeof populate === 'function', 'CONTINUATION_POPULATOR_UNAVAILABLE');
      populate(candidate);
    });
  // Validate descriptors produced by a populator before invoking a handler.
  codec.capture(candidate);
  const method = selected.start ? 'start' : 'resume';
  const handler = handlers?.[selected.phase?.kind]?.[method];
  check(typeof handler === 'function' && handler.constructor.name !== 'AsyncFunction', 'CONTINUATION_HANDLER_UNAVAILABLE');
  const events = handler(candidate, selected.phase);
  check(Array.isArray(events), 'INVALID_CONTINUATION_RESULT');
  // A handler completes this descriptor. If a modal phase had suspended another
  // descriptor, selectNextPhase will resume that standby on the following step.
  state.currentPhase = null;
  if (state.standbyPhase) {
    state.currentPhase = state.standbyPhase;
    state.standbyPhase = null;
  }
  codec.capture(candidate);
  return { context: candidate, events: copy(events) };
}
