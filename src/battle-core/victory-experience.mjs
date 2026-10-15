// Original VictoryPhase experience segment, extracted from 5c9f3e34.
// The trusted coop adapter shares participant IDs/base EXP and scopes the scene
// to each personal party and its modifiers; the formulas below stay original.
export function queueVictoryExperience(phase,rules,baseExp){
  const {ExpShareModifier, ExpBalanceModifier, MultipleParticipantExpBonusModifier, PokemonFriendshipBoosterModifier, PokemonExpBoosterModifier, BattleType, Utils, achvs, ExpPhase, ShowPartyExpBarPhase, applyPostVictoryAbAttrs, PostVictoryAbAttr, Phaser}=rules;
  return (function(){
    const participantIds = this.scene.currentBattle.playerParticipantIds;
    const party = this.scene.getParty();
    const expShareModifier = this.scene.findModifier(m => m instanceof ExpShareModifier);
    const expBalanceModifier = this.scene.findModifier(m => m instanceof ExpBalanceModifier);
    const multipleParticipantExpBonusModifier = this.scene.findModifier(m => m instanceof MultipleParticipantExpBonusModifier);
    const expPartyMembers = party.filter(p => p.hp && p.level < this.scene.getMaxExpLevel());
    const partyMemberExp = [];

    if (participantIds.size) {
      let expValue = baseExp === undefined ? this.getPokemon().getExpValue() : baseExp;
      if (this.scene.currentBattle.battleType === BattleType.TRAINER)
        expValue = Math.floor(expValue * 1.5);
      for (let partyMember of expPartyMembers) {
        const pId = partyMember.id;
        const participated = participantIds.has(pId);
        if (participated) {
          const friendshipIncrease = new Utils.IntegerHolder(2);
          this.scene.applyModifier(PokemonFriendshipBoosterModifier, true, partyMember, friendshipIncrease);
          partyMember.friendship = Math.min(partyMember.friendship + friendshipIncrease.value, 255);
          if (partyMember.friendship === 255)
            this.scene.validateAchv(achvs.MAX_FRIENDSHIP);
        }
        else if (!expShareModifier) {
          partyMemberExp.push(0);
          continue;
        }
        let expMultiplier = 0;
        if (participated) {
          expMultiplier += (1 / participantIds.size);
          if (participantIds.size > 1 && multipleParticipantExpBonusModifier)
            expMultiplier += multipleParticipantExpBonusModifier.getStackCount() * 0.2;
        } else if (expShareModifier)
          expMultiplier += (expShareModifier.getStackCount() * 0.2) / participantIds.size;
        if (partyMember.pokerus)
          expMultiplier *= 1.5;
        const pokemonExp = new Utils.NumberHolder(expValue * expMultiplier);
        this.scene.applyModifiers(PokemonExpBoosterModifier, true, partyMember, pokemonExp);
        partyMemberExp.push(Math.floor(pokemonExp.value));
      }

      if (expBalanceModifier) {
        let totalLevel = 0;
        let totalExp = 0;
        expPartyMembers.forEach((expPartyMember, epm) => {
          totalExp += partyMemberExp[epm];
          totalLevel += expPartyMember.level;
        });

        const medianLevel = Math.floor(totalLevel / expPartyMembers.length);

        const recipientExpPartyMemberIndexes = [];
        expPartyMembers.forEach((expPartyMember, epm) => {
          if (expPartyMember.level <= medianLevel)
            recipientExpPartyMemberIndexes.push(epm);
        });

        const splitExp = Math.floor(totalExp / recipientExpPartyMemberIndexes.length);

        expPartyMembers.forEach((_partyMember, pm) => {
          partyMemberExp[pm] = Phaser.Math.Linear(partyMemberExp[pm], recipientExpPartyMemberIndexes.indexOf(pm) > -1 ? splitExp : 0, 0.2 * expBalanceModifier.getStackCount());
        });
      }

      for (let pm = 0; pm < expPartyMembers.length; pm++) {
        const exp = partyMemberExp[pm];

        if (exp) {
          const partyMemberIndex = party.indexOf(expPartyMembers[pm]);
          this.scene.unshiftPhase(expPartyMembers[pm].isOnField() ? new ExpPhase(this.scene, partyMemberIndex, exp) : new ShowPartyExpBarPhase(this.scene, partyMemberIndex, exp));
          if (expPartyMembers[pm].isOnField())
            applyPostVictoryAbAttrs(PostVictoryAbAttr, expPartyMembers[pm]);
        }
      }
    }
  }).call(phase);
}
