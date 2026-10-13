// Original BattleScene queue order. Works with live Phases or data descriptors.
export function pushPhase(state, phase, defer = false) {
  (defer ? state.nextCommandPhaseQueue : state.phaseQueue).push(phase);
}
export function prependPhase(state, phase) {
  if (state.phaseQueuePrependSpliceIndex === -1) state.phaseQueuePrepend.push(phase);
  else state.phaseQueuePrepend.splice(state.phaseQueuePrependSpliceIndex, 0, phase);
}
export function populatePhaseQueue(state, createTurnInit) {
  state.phaseQueue.push(...state.nextCommandPhaseQueue);
  state.nextCommandPhaseQueue.splice(0, state.nextCommandPhaseQueue.length);
  state.phaseQueue.push(createTurnInit());
}
export function selectNextPhase(state, populate) {
  if (state.standbyPhase) {
    state.currentPhase = state.standbyPhase;
    state.standbyPhase = null;
    return { phase: state.currentPhase, start: false };
  }
  if (state.phaseQueuePrependSpliceIndex > -1) state.phaseQueuePrependSpliceIndex = -1;
  while (state.phaseQueuePrepend.length) state.phaseQueue.unshift(state.phaseQueuePrepend.pop());
  if (!state.phaseQueue.length) populate();
  state.currentPhase = state.phaseQueue.shift();
  return { phase: state.currentPhase, start: true };
}
