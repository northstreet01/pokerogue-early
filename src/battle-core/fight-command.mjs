import { copy, canonical, requireContract as check } from './coop-contract.mjs';
import { selectEncoreFight } from './forced-command.mjs';

// Original CommandPhase FIGHT selection. Trusted internal args retain early's
// positional override semantics; never pass unvalidated network args here.
export function selectFightCommand(pokemon, fieldIndex, cursor, args, rules) {
  let useStruggle = false;
  if (!(cursor === -1 || pokemon.trySelectMove(cursor, args[0])
    || (useStruggle = cursor > -1 && !pokemon.getMoveset().filter(m => m.isUsable(pokemon)).length))) return null;
  const moveId = !useStruggle ? cursor > -1 ? pokemon.getMoveset()[cursor].moveId : rules.noneMove : rules.struggleMove;
  const command = { command: rules.fightCommand, cursor, move: { move: moveId, targets: [], ignorePP: args[0] }, args };
  const targets = args.length < 3 ? rules.getMoveTargets(pokemon, moveId) : args[2];
  if (!moveId) command.targets = [fieldIndex];
  const needsTarget = targets.targets.length > 1 && !targets.multiple;
  if (!needsTarget) command.move.targets = targets.targets;
  return { command, targets, needsTarget };
}

// Network intent is deliberately narrower than trusted Phase arguments. Queue
// continuation/Encore handling belongs to the authoritative runner, not input.
export function resolveFightIntent(pokemon, fieldIndex, input, rules) {
  const intent = copy(input);
  check(intent && Object.keys(intent).sort().join(',') === 'cursor,kind,pokemonId,target'
    && intent.kind === 'fight' && intent.pokemonId === pokemon.id
    && Number.isInteger(fieldIndex) && fieldIndex >= 0 && fieldIndex <= 1, 'INVALID_FIGHT_INTENT');
  check(Number.isInteger(intent.cursor) && intent.cursor >= 0 && intent.cursor < pokemon.getMoveset().length, 'INVALID_MOVE_CURSOR');
  check(pokemon.hp > 0 && pokemon.getMoveQueue().length === 0, 'UNSUPPORTED_FORCED_COMMAND');
  check(typeof rules.getEncoreTag === 'function', 'FORCED_RULES_UNAVAILABLE');
  const forced = selectEncoreFight(pokemon, rules.getEncoreTag);
  check(!forced || forced.cursor === intent.cursor, 'FORCED_MOVE_REQUIRED');
  const selected = selectFightCommand(pokemon, fieldIndex, intent.cursor, [false], rules);
  check(selected, 'MOVE_UNUSABLE');
  if (selected.needsTarget) {
    check(Number.isInteger(intent.target) && selected.targets.targets.includes(intent.target), 'INVALID_MOVE_TARGET');
    selected.command.targets = [intent.target];
  } else check(intent.target === null, 'UNEXPECTED_MOVE_TARGET');
  return copy(selected.command);
}

// Collect the required seats before the trusted adapter starts or resumes the
// original Command/SelectTarget phases. Queue order and command rules stay there;
// this boundary only isolates, validates and commits a model.
export async function advanceCollectedFightCommands(context,inputs,codec,driver,{decisionId,allowSwitch=false}={}) {
  check(typeof decisionId==='string'&&decisionId.length>0&&decisionId.length<=128
    &&decisionId!==context.decision.id,'INVALID_COMMAND_DECISION_ID');
  check(driver&&typeof driver.validateInput==='function'&&driver.validateInput.constructor.name!=='AsyncFunction'
    &&typeof driver.executeCollected==='function','COMMAND_DRIVER_UNAVAILABLE');
  const candidate=codec.restore(codec.capture(context)),state=candidate.continuation;
  const inputKind=candidate.decision.kind;
  check(['wait-actions','wait-target'].includes(inputKind)&&state.standbyPhase===null
    &&(state.currentPhase===null&&inputKind==='wait-actions'||state.currentPhase?.kind==='original-phase'
      &&state.currentPhase.remaining===inputKind),'UNSAFE_COMMAND_BOUNDARY');
  const actions=copy(inputs),seats=candidate.decision.requiredSeats;
  check(actions&&typeof actions==='object'&&!Array.isArray(actions)
    &&canonical(Object.keys(actions).sort())===canonical(seats.map(String).sort()),'INCOMPLETE_COMMAND_INPUTS');
  const before=canonical(codec.capture(candidate));
  for(const seat of seats){
    const kind=actions[seat]?.kind;
    check(inputKind==='wait-target'?kind==='target':allowSwitch?['fight','switch'].includes(kind):kind==='fight',
      'UNSUPPORTED_COMMAND_INPUT');
    codec.validateAction(candidate,seat,actions[seat]);
    const validation=driver.validateInput(candidate,seat,copy(actions[seat]));
    check(!validation?.then,'ASYNC_COMMAND_VALIDATOR');
  }
  check(canonical(codec.capture(candidate))===before,'VALIDATOR_MUTATED_STATE');
  const decision={id:decisionId,kind:'continuing',requiredSeats:[],reason:'effects'};
  candidate.decision=copy(decision);
  const result=await driver.executeCollected(candidate,copy(actions));
  check(result?.completed===true&&result.pendingTasks===0&&Array.isArray(result.events)&&Array.isArray(result.grants),'INCOMPLETE_COMMAND_PHASES');
  check(candidate.continuation===state&&state.standbyPhase===null,'INVALID_COMMAND_RESULT');
  if(result.suspended===true){
    check(state.currentPhase?.kind==='original-phase'&&state.currentPhase.remaining===candidate.decision.kind
      &&['wait-actions','wait-target'].includes(candidate.decision.kind)&&candidate.decision.id===decisionId,'INVALID_COMMAND_RESULT');
  }else{
    check(state.currentPhase===null&&canonical(candidate.decision)===canonical(decision),'INVALID_COMMAND_RESULT');
  }
  codec.capture(candidate);
  return {context:candidate,events:copy(result.events),grants:copy(result.grants)};
}
