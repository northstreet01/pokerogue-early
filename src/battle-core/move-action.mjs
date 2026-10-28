// Extracted from original MovePhase.start at 20cd4a3a.
// Trusted providers retain original rule/scene behavior; no substitute formulas.
export function executeMoveAction(phase, rules) {
    const { Abilities, BattlerIndex, BattlerTagLapseType, BattlerTagType, BypassSleepAttr, CommonAnim, CommonAnimPhase, CopyMoveAttr, HealStatusEffectAttr, HiddenTag, HitsTagAttr, MoveAbilityBypassAbAttr, MoveResult, Moves, RedirectMoveAbAttr, SpeciesFormChangePreMoveTrigger, StatusEffect, Utils, allMoves, applyAbAttrs, applyMoveAttrs, getPokemonMessage, getStatusEffectActivationText, getStatusEffectHealText, getTerrainBlockMessage, i18next } = rules;
    if (!phase.canMove()) {
        if (phase.move.moveId && phase.pokemon.summonData.disabledMove === phase.move.moveId)
            phase.scene.queueMessage(i18next.t("battle:moveDisabled", { moveName: (phase.move.getName()) }));
        return phase.end();
    }
    if (!phase.followUp) {
        const abilityEffectsIgnored = new Utils.BooleanHolder(false);
        phase.scene.getField(true).map(p => applyAbAttrs(MoveAbilityBypassAbAttr, p, abilityEffectsIgnored));
        if (abilityEffectsIgnored.value)
            phase.scene.arena.setIgnoreAbilities(true);
    }
    // Move redirection abilities (ie. Storm Drain) only support single target moves
    const moveTarget = phase.targets.length === 1
        ? new Utils.IntegerHolder(phase.targets[0])
        : null;
    if (moveTarget) {
        phase.scene.getField(true).filter(p => p !== phase.pokemon).forEach(p => applyAbAttrs(RedirectMoveAbAttr, p, null, phase.move.moveId, moveTarget));
        phase.targets[0] = moveTarget.value;
    }
    if (phase.targets.length === 1 && phase.targets[0] === BattlerIndex.ATTACKER) {
        if (phase.pokemon.turnData.attacksReceived.length) {
            const attacker = phase.pokemon.turnData.attacksReceived.length ? phase.pokemon.scene.getPokemonById(phase.pokemon.turnData.attacksReceived[0].sourceId) : null;
            if (attacker?.isActive(true))
                phase.targets[0] = attacker.getBattlerIndex();
        }
        if (phase.targets[0] === BattlerIndex.ATTACKER) {
            phase.cancel();
            phase.showMoveText();
            phase.showFailedText();
        }
    }
    const targets = phase.scene.getField(true).filter(p => {
        if (phase.targets.indexOf(p.getBattlerIndex()) > -1) {
            const hiddenTag = p.getTag(HiddenTag);
            if (hiddenTag && !phase.move.getMove().getAttrs(HitsTagAttr).filter(hta => hta.tagType === hiddenTag.tagType).length)
                return false;
            return true;
        }
        return false;
    });
    const doMove = () => {
        if (!phase.followUp && phase.canMove()) {
            phase.pokemon.lapseTags(BattlerTagLapseType.MOVE);
            if (phase.cancelled) {
                phase.pokemon.pushMoveHistory({ move: Moves.NONE, result: MoveResult.FAIL });
                return phase.end();
            }
        }
        const moveQueue = phase.pokemon.getMoveQueue();
        phase.scene.triggerPokemonFormChange(phase.pokemon, SpeciesFormChangePreMoveTrigger);
        if (phase.move.moveId)
            phase.showMoveText();
        if ((moveQueue.length && moveQueue[0].move === Moves.NONE) || !targets.length) {
            // Co-op must explain a vacated/untargetable choice without changing
            // the original cancellation, PP, RNG or retargeting behavior.
            if (!targets.length && !(moveQueue.length && moveQueue[0].move === Moves.NONE)
                && phase.scene.nativeIndependentCommands && phase.pokemon.isPlayer())
                phase.showFailedText(i18next.t('battle:attackNoTarget', { pokemonName: phase.pokemon.name }));
            moveQueue.shift();
            phase.cancel();
        }
        if (phase.cancelled) {
            phase.pokemon.pushMoveHistory({ move: Moves.NONE, result: MoveResult.FAIL });
            return phase.end();
        }
        if (!moveQueue.length || !moveQueue.shift().ignorePP) {
            phase.move.ppUsed++;
            for (let opponent of phase.pokemon.getOpponents()) {
                if (phase.move.ppUsed === phase.move.getMove().pp)
                    break;
                if (opponent.getAbility().id === Abilities.PRESSURE)
                    phase.move.ppUsed = Math.min(phase.move.ppUsed + 1, phase.move.getMovePp());
            }
        }
        if (!allMoves[phase.move.moveId].getAttrs(CopyMoveAttr).length)
            phase.scene.currentBattle.lastMove = phase.move.moveId;
        // Assume conditions affecting targets only apply to moves with a single target
        let success = phase.move.getMove().applyConditions(phase.pokemon, targets[0], phase.move.getMove());
        let failedText = null;
        if (success && phase.scene.arena.isMoveWeatherCancelled(phase.move.getMove()))
            success = false;
        else if (success && phase.scene.arena.isMoveTerrainCancelled(phase.pokemon, phase.move.getMove())) {
            success = false;
            failedText = getTerrainBlockMessage(targets[0], phase.scene.arena.terrain.terrainType);
        }
        if (success)
            phase.scene.unshiftPhase(phase.getEffectPhase());
        else {
            phase.pokemon.pushMoveHistory({ move: phase.move.moveId, targets: phase.targets, result: MoveResult.FAIL, virtual: phase.move.virtual });
            phase.showFailedText(failedText);
        }
        phase.end();
    };
    if (!phase.followUp && phase.pokemon.status && !phase.pokemon.status.isPostTurn()) {
        phase.pokemon.status.incrementTurn();
        let activated = false;
        let healed = false;
        switch (phase.pokemon.status.effect) {
            case StatusEffect.PARALYSIS:
                if (!phase.pokemon.randSeedInt(4)) {
                    activated = true;
                    phase.cancelled = true;
                }
                break;
            case StatusEffect.SLEEP:
                applyMoveAttrs(BypassSleepAttr, phase.pokemon, null, phase.move.getMove());
                healed = phase.pokemon.status.turnCount === phase.pokemon.status.cureTurn;
                activated = !healed && !phase.pokemon.getTag(BattlerTagType.BYPASS_SLEEP);
                phase.cancelled = activated;
                break;
            case StatusEffect.FREEZE:
                healed = !!phase.move.getMove().findAttr(attr => attr instanceof HealStatusEffectAttr && attr.selfTarget && attr.isOfEffect(StatusEffect.FREEZE)) || !phase.pokemon.randSeedInt(5);
                activated = !healed;
                phase.cancelled = activated;
                break;
        }
        if (activated) {
            phase.scene.queueMessage(getPokemonMessage(phase.pokemon, getStatusEffectActivationText(phase.pokemon.status.effect)));
            phase.scene.unshiftPhase(new CommonAnimPhase(phase.scene, phase.pokemon.getBattlerIndex(), undefined, CommonAnim.POISON + (phase.pokemon.status.effect - 1)));
            doMove();
        }
        else {
            if (healed) {
                phase.scene.queueMessage(getPokemonMessage(phase.pokemon, getStatusEffectHealText(phase.pokemon.status.effect)));
                phase.pokemon.resetStatus();
                phase.pokemon.updateInfo();
            }
            doMove();
        }
    }
    else
        doMove();
}
