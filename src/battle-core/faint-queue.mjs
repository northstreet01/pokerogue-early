import {requireContract as check} from './coop-contract.mjs';

// A trusted room adapter opts this specific live Phase into the approved coop
// queue policy. Bindings are transient; they never enter a checkpoint or solo scene.
const cooperativeContexts=new WeakMap();
export function bindCoopFaint(phase,context){
  check(phase&&context&&phase.scene?.currentBattle===context.battle&&!cooperativeContexts.has(phase),'INVALID_COOP_FAINT_BINDING');
  cooperativeContexts.set(phase,context);
  return ()=>cooperativeContexts.delete(phase);
}

// Original FaintPhase.doFaint scheduling, extracted from 5c9f3e34. The status,
// tags, friendship, participant removal and presentation remain in the Phase.
export function queueFaintContinuation(phase,rules){
  const {GameOverPhase,SwitchPhase,ToggleDoublePositionPhase,VictoryPhase,SwitchSummonPhase,MovePhase,BattleType}=rules;
  const pokemon=phase.getPokemon(),context=cooperativeContexts.get(phase);
  if(context){
    check(context.battle===phase.scene.currentBattle,'INVALID_COOP_FAINT');
    if(!phase.player){
      check((phase.battlerIndex===2||phase.battlerIndex===3)&&phase.fieldIndex===phase.battlerIndex-2
        &&context.roster.field[phase.battlerIndex]===pokemon.id
        &&pokemon.isFainted()&&context.roster.entries.some(e=>e.owner===null&&e.pokemon===pokemon),
        'UNSUPPORTED_COOP_ENEMY_FAINT');
      check(context.battle.battleType===BattleType.WILD||context.battle.battleType===BattleType.TRAINER,
        'UNSUPPORTED_COOP_ENEMY_FAINT');
      // Keep the original per-enemy Victory queued, unstarted. No automatic
      // retargeting; experience and aftermath require their own trusted driver.
      phase.scene.unshiftPhase(new VictoryPhase(phase.scene,phase.battlerIndex));
      if(context.battle.battleType===BattleType.TRAINER){
        check(context.battle.trainer,'INVALID_COOP_TRAINER_FAINT');
        const hasReservePartyMember=context.battle.enemyParty.some(p=>p.isActive()&&!p.isOnField()
          &&p.trainerSlot===pokemon.trainerSlot);
        if(hasReservePartyMember)
          phase.scene.pushPhase(new SwitchSummonPhase(phase.scene,phase.fieldIndex,-1,false,false,false));
      }
      return;
    }
    check(phase.fieldIndex===phase.battlerIndex,'UNSUPPORTED_COOP_FAINT');
    const seat=phase.fieldIndex;
    check((seat===0||seat===1)&&context.roster.field[seat]===pokemon.id&&pokemon.isFainted()
      &&context.roster.entries.some(e=>e.owner===seat&&e.group==='party'&&e.pokemon===pokemon),'INVALID_COOP_FAINT');
    const replacements=context.roster.entries.filter(e=>e.owner===seat&&e.group==='party'
      &&!e.pokemon.isFainted()&&!context.roster.field.includes(e.pokemon.id));
    if(replacements.length)phase.scene.pushPhase(new SwitchPhase(phase.scene,seat,true,false));
    // PLAY-07/08/09: reserve each seat, append replacement after this turn,
    // leave target positions intact, and defer outcome until the turn settles.
    return;
  }
    if (phase.player) {
      const nonFaintedPartyMembers = phase.scene.getParty().filter(p => !p.isFainted());
      const nonFaintedPartyMemberCount = nonFaintedPartyMembers.length;
      if (!nonFaintedPartyMemberCount)
        phase.scene.unshiftPhase(new GameOverPhase(phase.scene));
      else if (nonFaintedPartyMemberCount >= phase.scene.currentBattle.getBattlerCount() || (phase.scene.currentBattle.double && !nonFaintedPartyMembers[0].isActive(true)))
        phase.scene.pushPhase(new SwitchPhase(phase.scene, phase.fieldIndex, true, false));
      if (nonFaintedPartyMemberCount === 1 && phase.scene.currentBattle.double)
        phase.scene.unshiftPhase(new ToggleDoublePositionPhase(phase.scene, true));
    } else {
      phase.scene.unshiftPhase(new VictoryPhase(phase.scene, phase.battlerIndex));
      if (phase.scene.currentBattle.battleType === BattleType.TRAINER) {
        const hasReservePartyMember = !!phase.scene.getEnemyParty().filter(p => p.isActive() && !p.isOnField() && p.trainerSlot === pokemon.trainerSlot).length;
        if (hasReservePartyMember)
          phase.scene.pushPhase(new SwitchSummonPhase(phase.scene, phase.fieldIndex, -1, false, false, false));
      }
    }

    if (phase.scene.currentBattle.double) {
      const allyPokemon = pokemon.getAlly();
      if (allyPokemon?.isActive(true)) {
        let targetingMovePhase;
        do {
          targetingMovePhase = phase.scene.findPhase(mp => mp instanceof MovePhase && mp.targets.length === 1 && mp.targets[0] === pokemon.getBattlerIndex());
          if (targetingMovePhase && targetingMovePhase.targets[0] !== allyPokemon.getBattlerIndex())
            targetingMovePhase.targets[0] = allyPokemon.getBattlerIndex();
        } while (targetingMovePhase);
      }
    }
}
