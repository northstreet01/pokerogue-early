// Extracted from original MoveEffectPhase.hitCheck at 20cd4a3a.
// Trusted providers retain original rule/scene behavior; no substitute formulas.
export function checkMoveHit(phase, target, rules) {
    const { ArenaTagType, BattleStat, BattleStatMultiplierAbAttr, BattlerTagType, HiddenTag, HitsTagAttr, IgnoreOpponentStatChangesAbAttr, MoveTarget, OneHitKOAttr, TempBattleStat, TempBattleStatBoosterModifier, Utils, VariableAccuracyAttr, applyAbAttrs, applyBattleStatMultiplierAbAttrs, applyMoveAttrs } = rules;
    if (phase.move.getMove().moveTarget === MoveTarget.USER)
        return true;
    // Hit check only calculated on first hit for multi-hit moves
    if (phase.getUserPokemon().turnData.hitsLeft < phase.getUserPokemon().turnData.hitCount)
        return true;
    const hiddenTag = target.getTag(HiddenTag);
    if (hiddenTag && !phase.move.getMove().getAttrs(HitsTagAttr).filter(hta => hta.tagType === hiddenTag.tagType).length)
        return false;
    if (phase.getUserPokemon().getTag(BattlerTagType.IGNORE_ACCURACY) && (phase.getUserPokemon().getLastXMoves().find(() => true)?.targets || []).indexOf(target.getBattlerIndex()) > -1)
        return true;
    const moveAccuracy = new Utils.NumberHolder(phase.move.getMove().accuracy);
    applyMoveAttrs(VariableAccuracyAttr, phase.getUserPokemon(), target, phase.move.getMove(), moveAccuracy);
    if (moveAccuracy.value === -1)
        return true;
    if (!phase.move.getMove().getAttrs(OneHitKOAttr).length && phase.scene.arena.getTag(ArenaTagType.GRAVITY))
        moveAccuracy.value = Math.floor(moveAccuracy.value * 1.67);
    const userAccuracyLevel = new Utils.IntegerHolder(phase.getUserPokemon().summonData.battleStats[BattleStat.ACC]);
    const targetEvasionLevel = new Utils.IntegerHolder(target.summonData.battleStats[BattleStat.EVA]);
    applyAbAttrs(IgnoreOpponentStatChangesAbAttr, target, null, userAccuracyLevel);
    applyAbAttrs(IgnoreOpponentStatChangesAbAttr, phase.getUserPokemon(), null, targetEvasionLevel);
    phase.scene.applyModifiers(TempBattleStatBoosterModifier, phase.player, TempBattleStat.ACC, userAccuracyLevel);
    const rand = phase.getUserPokemon().randSeedInt(100, 1);
    const accuracyMultiplier = new Utils.NumberHolder(1);
    if (userAccuracyLevel.value !== targetEvasionLevel.value) {
        accuracyMultiplier.value = userAccuracyLevel.value > targetEvasionLevel.value
            ? (3 + Math.min(userAccuracyLevel.value - targetEvasionLevel.value, 6)) / 3
            : 3 / (3 + Math.min(targetEvasionLevel.value - userAccuracyLevel.value, 6));
    }
    applyBattleStatMultiplierAbAttrs(BattleStatMultiplierAbAttr, phase.getUserPokemon(), BattleStat.ACC, accuracyMultiplier);
    const evasionMultiplier = new Utils.NumberHolder(1);
    applyBattleStatMultiplierAbAttrs(BattleStatMultiplierAbAttr, phase.getTarget(), BattleStat.EVA, evasionMultiplier);
    accuracyMultiplier.value /= evasionMultiplier.value;
    return rand <= moveAccuracy.value * accuracyMultiplier.value;
}
