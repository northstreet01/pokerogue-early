// Original Pokemon.apply at 20cd4a3a; formulas/order are unchanged.
// Rule objects and scene services are trusted original providers.
export function applyPokemonMove(target, source, battlerMove, rules) {
    const { AttackTypeBoosterModifier, BattlerTagType, BlockCritAbAttr, BypassBurnDamageReductionAbAttr, CritOnlyAttr, DamageAchv, DamageMoneyRewardModifier, EnemyDamageBoosterModifier, EnemyDamageReducerModifier, FieldVariableMovePowerAbAttr, FixedDamageAttr, HelpingHandTag, HighCritAttr, HitResult, HitsTagAttr, ModifiedDamageAttr, MoveCategory, MoveImmunityAbAttr, MoveTarget, MultiHitAttr, OneHitKOAttr, PreDefendEndureAbAttr, ReceivedMoveDamageMultiplierAbAttr, StabBoostAbAttr, Stat, StatusEffect, StatusMoveTypeImmunityAttr, TempBattleStat, TempBattleStatBoosterModifier, TerrainType, Type, TypeBoostTag, TypeImmunityAbAttr, TypelessAttr, Utils, VariableAtkAttr, VariableDefAttr, VariableMovePowerAbAttr, VariablePowerAttr, WeakenMoveTypeTag, applyAbAttrs, applyMoveAttrs, applyPreAttackAbAttrs, applyPreDefendAbAttrs, console, getTypeDamageMultiplier, i18next } = rules;
    let result;
    const move = battlerMove.getMove();
    const moveCategory = move.category;
    let damage = new Utils.NumberHolder(0);
    const cancelled = new Utils.BooleanHolder(false);
    const typeless = !!move.getAttrs(TypelessAttr).length;
    const types = target.getTypes(true, true);
    const typeMultiplier = new Utils.NumberHolder(!typeless && (moveCategory !== MoveCategory.STATUS || move.getAttrs(StatusMoveTypeImmunityAttr).find(attr => attr.immuneType === move.type))
        ? getTypeDamageMultiplier(move.type, types[0]) * (types.length > 1 ? getTypeDamageMultiplier(move.type, types[1]) : 1)
        : 1);
    if (typeless)
        typeMultiplier.value = 1;
    if (target.getTypes(true, true).find(t => move.isTypeImmune(t)))
        typeMultiplier.value = 0;
    switch (moveCategory) {
        case MoveCategory.PHYSICAL:
        case MoveCategory.SPECIAL:
            const isPhysical = moveCategory === MoveCategory.PHYSICAL;
            const power = new Utils.NumberHolder(move.power);
            const sourceTeraType = source.getTeraType();
            if (sourceTeraType !== Type.UNKNOWN && sourceTeraType === move.type && power.value < 60 && move.priority <= 0 && !move.getAttrs(MultiHitAttr).length)
                power.value = 60;
            applyPreAttackAbAttrs(VariableMovePowerAbAttr, source, target, battlerMove, power);
            target.scene.getField(true).map(p => applyPreAttackAbAttrs(FieldVariableMovePowerAbAttr, target, source, battlerMove, power));
            applyPreDefendAbAttrs(ReceivedMoveDamageMultiplierAbAttr, target, source, battlerMove, cancelled, power);
            if (!typeless)
                applyPreDefendAbAttrs(TypeImmunityAbAttr, target, source, battlerMove, cancelled, typeMultiplier);
            if (!cancelled.value)
                applyPreDefendAbAttrs(MoveImmunityAbAttr, target, source, battlerMove, cancelled, typeMultiplier);
            if (cancelled.value)
                result = HitResult.NO_EFFECT;
            else {
                if (source.findTag(t => t instanceof TypeBoostTag && t.boostedType === move.type))
                    power.value *= 1.5;
                const arenaAttackTypeMultiplier = target.scene.arena.getAttackTypeMultiplier(move.type, target.isGrounded());
                if (target.scene.arena.terrain?.terrainType === TerrainType.GRASSY && target.isGrounded() && move.type === Type.GROUND && move.moveTarget === MoveTarget.ALL_NEAR_OTHERS)
                    power.value /= 2;
                applyMoveAttrs(VariablePowerAttr, source, target, move, power);
                if (!typeless) {
                    target.scene.arena.applyTags(WeakenMoveTypeTag, move.type, power);
                    source.scene.applyModifiers(AttackTypeBoosterModifier, source.isPlayer(), source, power);
                }
                if (source.getTag(HelpingHandTag))
                    power.value *= 1.5;
                let isCritical;
                const critOnly = new Utils.BooleanHolder(false);
                applyMoveAttrs(CritOnlyAttr, source, target, move, critOnly);
                if (critOnly.value)
                    isCritical = true;
                else {
                    const critLevel = new Utils.IntegerHolder(0);
                    applyMoveAttrs(HighCritAttr, source, target, move, critLevel);
                    source.scene.applyModifiers(TempBattleStatBoosterModifier, source.isPlayer(), TempBattleStat.CRIT, critLevel);
                    if (source.getTag(BattlerTagType.CRIT_BOOST))
                        critLevel.value += 2;
                    const critChance = Math.ceil(16 / Math.pow(2, critLevel.value));
                    isCritical = !source.getTag(BattlerTagType.NO_CRIT) && (critChance === 1 || !target.scene.currentBattle.randSeedInt(critChance));
                    if (isCritical) {
                        const blockCrit = new Utils.BooleanHolder(false);
                        applyAbAttrs(BlockCritAbAttr, target, null, blockCrit);
                        if (blockCrit.value)
                            isCritical = false;
                    }
                }
                const sourceAtk = new Utils.IntegerHolder(source.getBattleStat(isPhysical ? Stat.ATK : Stat.SPATK, target));
                const targetDef = new Utils.IntegerHolder(target.getBattleStat(isPhysical ? Stat.DEF : Stat.SPDEF, source));
                const criticalMultiplier = isCritical ? 2 : 1;
                const isTypeImmune = (typeMultiplier.value * arenaAttackTypeMultiplier) === 0;
                const sourceTypes = source.getTypes();
                const matchesSourceType = sourceTypes[0] === move.type || (sourceTypes.length > 1 && sourceTypes[1] === move.type);
                let stabMultiplier = new Utils.NumberHolder(1);
                if (sourceTeraType === Type.UNKNOWN && matchesSourceType)
                    stabMultiplier.value += 0.5;
                else if (sourceTeraType !== Type.UNKNOWN && sourceTeraType === move.type)
                    stabMultiplier.value += 0.5;
                applyAbAttrs(StabBoostAbAttr, source, null, stabMultiplier);
                if (sourceTeraType !== Type.UNKNOWN && matchesSourceType)
                    stabMultiplier.value = Math.min(stabMultiplier.value + 0.5, 2.25);
                applyMoveAttrs(VariableAtkAttr, source, target, move, sourceAtk);
                applyMoveAttrs(VariableDefAttr, source, target, move, targetDef);
                if (!isTypeImmune) {
                    damage.value = Math.ceil(((((2 * source.level / 5 + 2) * power.value * sourceAtk.value / targetDef.value) / 50) + 2) * stabMultiplier.value * typeMultiplier.value * arenaAttackTypeMultiplier * ((target.scene.currentBattle.randSeedInt(15) + 85) / 100)) * criticalMultiplier;
                    if (isPhysical && source.status && source.status.effect === StatusEffect.BURN) {
                        const burnDamageReductionCancelled = new Utils.BooleanHolder(false);
                        applyAbAttrs(BypassBurnDamageReductionAbAttr, target, burnDamageReductionCancelled);
                        if (!burnDamageReductionCancelled.value)
                            damage.value = Math.floor(damage.value / 2);
                    }
                    move.getAttrs(HitsTagAttr).map(hta => hta).filter(hta => hta.doubleDamage).forEach(hta => {
                        if (target.getTag(hta.tagType))
                            damage.value *= 2;
                    });
                }
                if (target.scene.arena.terrain?.terrainType === TerrainType.MISTY && target.isGrounded() && move.type === Type.DRAGON)
                    damage.value = Math.floor(damage.value / 2);
                applyMoveAttrs(ModifiedDamageAttr, source, target, move, damage);
                const fixedDamage = new Utils.IntegerHolder(0);
                applyMoveAttrs(FixedDamageAttr, source, target, move, fixedDamage);
                if (!isTypeImmune && fixedDamage.value) {
                    damage.value = fixedDamage.value;
                    isCritical = false;
                    result = HitResult.EFFECTIVE;
                }
                console.log('damage', damage.value, move.name, power.value, sourceAtk, targetDef);
                if (!result) {
                    if (!typeMultiplier.value)
                        result = HitResult.NO_EFFECT;
                    else {
                        const oneHitKo = new Utils.BooleanHolder(false);
                        applyMoveAttrs(OneHitKOAttr, source, target, move, oneHitKo);
                        if (oneHitKo.value) {
                            result = HitResult.ONE_HIT_KO;
                            isCritical = false;
                            damage.value = target.hp;
                        }
                        else if (typeMultiplier.value >= 2)
                            result = HitResult.SUPER_EFFECTIVE;
                        else if (typeMultiplier.value >= 1)
                            result = HitResult.EFFECTIVE;
                        else
                            result = HitResult.NOT_VERY_EFFECTIVE;
                    }
                }
                if (!fixedDamage.value) {
                    if (!source.isPlayer())
                        target.scene.applyModifiers(EnemyDamageBoosterModifier, false, damage);
                    if (!target.isPlayer())
                        target.scene.applyModifiers(EnemyDamageReducerModifier, false, damage);
                }
                if (damage.value) {
                    applyPreDefendAbAttrs(PreDefendEndureAbAttr, target, source, battlerMove, cancelled, damage);
                    const oneHitKo = result === HitResult.ONE_HIT_KO;
                    damage.value = target.damageAndUpdate(damage.value, result, isCritical, oneHitKo, oneHitKo);
                    if (isCritical)
                        target.scene.queueMessage(i18next.t('battle:hitResultCriticalHit'));
                    target.scene.setPhaseQueueSplice();
                    if (source.isPlayer()) {
                        target.scene.validateAchvs(DamageAchv, damage);
                        if (damage.value > target.scene.gameData.gameStats.highestDamage)
                            target.scene.gameData.gameStats.highestDamage = damage.value;
                    }
                    source.turnData.damageDealt += damage.value;
                    target.battleData.hitCount++;
                    const attackResult = { move: move.id, result: result, damage: damage.value, critical: isCritical, sourceId: source.id };
                    target.turnData.attacksReceived.unshift(attackResult);
                    if (source.isPlayer() && !target.isPlayer())
                        source.scene.applyModifiers(DamageMoneyRewardModifier, true, source, damage);
                }
                if (source.turnData.hitsLeft === 1) {
                    switch (result) {
                        case HitResult.SUPER_EFFECTIVE:
                            target.scene.queueMessage(i18next.t('battle:hitResultSuperEffective'));
                            break;
                        case HitResult.NOT_VERY_EFFECTIVE:
                            target.scene.queueMessage(i18next.t('battle:hitResultNotVeryEffective'));
                            break;
                        case HitResult.NO_EFFECT:
                            target.scene.queueMessage(i18next.t('battle:hitResultNoEffect', { pokemonName: target.name }));
                            break;
                        case HitResult.ONE_HIT_KO:
                            target.scene.queueMessage(i18next.t('battle:hitResultOneHitKo'));
                            break;
                    }
                }
                if (damage)
                    target.scene.clearPhaseQueueSplice();
            }
            break;
        case MoveCategory.STATUS:
            if (!typeless)
                applyPreDefendAbAttrs(TypeImmunityAbAttr, target, source, battlerMove, cancelled, typeMultiplier);
            if (!cancelled.value)
                applyPreDefendAbAttrs(MoveImmunityAbAttr, target, source, battlerMove, cancelled, typeMultiplier);
            if (!typeMultiplier.value)
                target.scene.queueMessage(`It doesn\'t affect ${target.name}!`);
            result = cancelled.value || !typeMultiplier.value ? HitResult.NO_EFFECT : HitResult.STATUS;
            break;
    }
    return result;
}
