import BattleScene from "./battle-scene";
import { EnemyPokemon, PlayerPokemon, QueuedMove } from "./field/pokemon";
import { Command } from "./ui/command-ui-handler";
import * as Utils from "./utils";
import Trainer, { TrainerVariant } from "./field/trainer";
import { Species } from "./data/enums/species";
import { Moves } from "./data/enums/moves";
import { TrainerType } from "./data/enums/trainer-type";
import { GameMode } from "./game-mode";
import { BattleSpec } from "./enums/battle-spec";
import { PlayerGender } from "./system/game-data";
import { PokemonHeldItemModifier } from "./modifier/modifier";
import { nextBattleRandomInt, readBattleRandomCheckpoint } from './battle-core/random.mjs';
import { getWildLevel, gaussianLevelOffset } from './battle-core/levels.mjs';

export enum BattleType {
    WILD,
    TRAINER,
    CLEAR
}

export enum BattlerIndex {
    ATTACKER = -1,
    PLAYER,
    PLAYER_2,
    ENEMY,
    ENEMY_2
}

export interface TurnCommand {
    command: Command;
    cursor?: integer;
    move?: QueuedMove;
    targets?: BattlerIndex[];
    skip?: boolean;
    args?: any[];
};

interface TurnCommands {
    [key: integer]: TurnCommand
}

export default class Battle {
    protected gameMode: GameMode;
    public waveIndex: integer;
    public battleType: BattleType;
    public battleSpec: BattleSpec;
    public trainer: Trainer;
    public enemyLevels: integer[];
    public enemyParty: EnemyPokemon[];
    public seenEnemyPartyMemberIds: Set<integer>;
    public double: boolean;
    public started: boolean;
    public turn: integer;
    public turnCommands: TurnCommands;
    public playerParticipantIds: Set<integer>;
    public battleScore: integer;
    public postBattleLoot: PokemonHeldItemModifier[];
    public escapeAttempts: integer;
    public lastMove: Moves;
    public battleSeed: string;
    private battleSeedState: string;

    constructor(gameMode: GameMode, waveIndex: integer, battleType: BattleType, trainer: Trainer, double: boolean) {
        this.gameMode = gameMode;
        this.waveIndex = waveIndex;
        this.battleType = battleType;
        this.trainer = trainer;
        this.initBattleSpec();
        this.enemyLevels = battleType !== BattleType.TRAINER
            ? new Array(double ? 2 : 1).fill(null).map(() => this.getLevelForWave())
            : trainer.getPartyLevels(this.waveIndex);
        this.enemyParty = [];
        this.seenEnemyPartyMemberIds = new Set<integer>();
        this.double = double;
        this.turn = 0;
        this.playerParticipantIds = new Set<integer>();
        this.battleScore = 0;
        this.postBattleLoot = [];
        this.escapeAttempts = 0;
        this.started = false;
        this.battleSeed = Utils.randomString(16, true);
        this.battleSeedState = null;
    }

    private initBattleSpec(): void {
        let spec = BattleSpec.DEFAULT;
        if (this.gameMode.isClassic) {
            if (this.waveIndex === 200)
                spec = BattleSpec.FINAL_BOSS;
        }
        this.battleSpec = spec;
    }

    private getLevelForWave(): integer {
        return getWildLevel(this.waveIndex, this.gameMode.getWaveForDifficulty(this.waveIndex),
            this.battleSpec === BattleSpec.FINAL_BOSS, () => this.gameMode.isWaveFinal(this.waveIndex), Phaser.Math.RND);
    }

    randSeedGaussForLevel(value: number): number { 
        return gaussianLevelOffset(value, Phaser.Math.RND);
    }

    getBattlerCount(): integer {
        return this.double ? 2 : 1;
    }

    incrementTurn(scene: BattleScene): void {
        this.turn++;
        this.turnCommands = Object.fromEntries(Utils.getEnumValues(BattlerIndex).map(bt => [ bt, null ]));
        this.battleSeedState = null;
    }

    addParticipant(playerPokemon: PlayerPokemon): void {
        this.playerParticipantIds.add(playerPokemon.id);
    }

    removeFaintedParticipant(playerPokemon: PlayerPokemon): void {
        this.playerParticipantIds.delete(playerPokemon.id);
    }

    addPostBattleLoot(enemyPokemon: EnemyPokemon): void {
        this.postBattleLoot.push(...enemyPokemon.scene.findModifiers(m => m instanceof PokemonHeldItemModifier && m.pokemonId === enemyPokemon.id && m.getTransferrable(false), false).map(i => {
            const ret = i as PokemonHeldItemModifier;
            ret.pokemonId = null;
            return ret;
        }));
    }

    addBattleScore(scene: BattleScene): void {
        let partyMemberTurnMultiplier = scene.getEnemyParty().length / 2 + 0.5;
        if (this.double)
            partyMemberTurnMultiplier /= 1.5;
        for (let p of scene.getEnemyParty()) {
            if (p.isBoss())
                partyMemberTurnMultiplier *= (p.bossSegments / 1.5) / scene.getEnemyParty().length;
        }
        const turnMultiplier = Phaser.Tweens.Builders.GetEaseFunction('Sine.easeIn')(1 - Math.min(this.turn - 2, 10 * partyMemberTurnMultiplier) / (10 * partyMemberTurnMultiplier));
        const finalBattleScore = Math.ceil(this.battleScore * turnMultiplier);
        scene.score += finalBattleScore;
        console.log(`Battle Score: ${finalBattleScore} (${this.turn - 1} Turns x${Math.floor(turnMultiplier * 100) / 100})`);
        console.log(`Total Score: ${scene.score}`);
        scene.updateScoreText();
    }

    getBgmOverride(scene: BattleScene): string {
        const battlers = this.enemyParty.slice(0, this.getBattlerCount());
        if (this.battleType === BattleType.TRAINER) {
            if (!this.started && this.trainer.config.encounterBgm && this.trainer.getEncounterMessages()?.length)
                return `encounter_${this.trainer.getEncounterBgm()}`;
            return this.trainer.getBattleBgm();
        } else if (this.gameMode.isClassic && this.waveIndex > 195 && this.battleSpec !== BattleSpec.FINAL_BOSS)
            return 'end_summit';
        for (let pokemon of battlers) {
            if (this.battleSpec === BattleSpec.FINAL_BOSS) {
                if (pokemon.formIndex)
                    return 'battle_final';
                return 'battle_final_encounter';
            }
            if (pokemon.species.legendary || pokemon.species.pseudoLegendary || pokemon.species.mythical) {
                if (pokemon.species.speciesId === Species.KYUREM)
                    return 'battle_legendary_k';
                if (pokemon.species.legendary)
                    return 'battle_legendary_rz';
                return 'battle_legendary';
            }
        }

        if (scene.gameMode.isClassic && this.waveIndex <= 4)
            return 'battle_wild';

        return null;
    }

    randSeedInt(range: integer, min: integer = 0): integer {
        const result = nextBattleRandomInt(this.battleSeed, this.turn, this.battleSeedState, range, min);
        this.battleSeedState = result.state;
        return result.value;
    }

    // Only the battle stream is covered here. A full decision checkpoint must
    // also restore the room's other streams, combatants, arena and pending work.
    captureRandomState() {
        return readBattleRandomCheckpoint({ version: 1, seed: this.battleSeed, turn: this.turn, state: this.battleSeedState });
    }

    restoreRandomState(checkpoint: unknown): void {
        const restored = readBattleRandomCheckpoint(checkpoint);
        if (restored.seed !== this.battleSeed || restored.turn !== this.turn)
            throw new Error('Battle random checkpoint belongs to another seed or turn');
        this.battleSeedState = restored.state;
    }
}

export class FixedBattle extends Battle {
    constructor(scene: BattleScene, waveIndex: integer, config: FixedBattleConfig) {
        super(scene.gameMode, waveIndex, config.battleType, config.battleType === BattleType.TRAINER ? config.getTrainer(scene) : null, config.double);
        if (config.getEnemyParty)
            this.enemyParty = config.getEnemyParty(scene);
    }
}

type GetTrainerFunc = (scene: BattleScene) => Trainer;
type GetEnemyPartyFunc = (scene: BattleScene) => EnemyPokemon[];

export class FixedBattleConfig {
    public battleType: BattleType;
    public double: boolean;
    public getTrainer: GetTrainerFunc;
    public getEnemyParty: GetEnemyPartyFunc;
    public seedOffsetWaveIndex: integer;

    setBattleType(battleType: BattleType): FixedBattleConfig {
        this.battleType = battleType;
        return this;
    }

    setDouble(double: boolean): FixedBattleConfig {
        this.double = double;
        return this;
    }

    setGetTrainerFunc(getTrainerFunc: GetTrainerFunc): FixedBattleConfig {
        this.getTrainer = getTrainerFunc;
        return this;
    }

    setGetEnemyPartyFunc(getEnemyPartyFunc: GetEnemyPartyFunc): FixedBattleConfig {
        this.getEnemyParty = getEnemyPartyFunc;
        return this;
    }

    setSeedOffsetWave(seedOffsetWaveIndex: integer): FixedBattleConfig {
        this.seedOffsetWaveIndex = seedOffsetWaveIndex;
        return this;
    }
}

function getRandomTrainerFunc(trainerPool: (TrainerType | TrainerType[])[]): GetTrainerFunc {
    return (scene: BattleScene) => {
        const rand = Utils.randSeedInt(trainerPool.length);
        const trainerTypes: TrainerType[] = [];
        for (let trainerPoolEntry of trainerPool) {
            const trainerType = Array.isArray(trainerPoolEntry)
                ? Utils.randSeedItem(trainerPoolEntry)
                : trainerPoolEntry;
            trainerTypes.push(trainerType);
        }
        return new Trainer(scene, trainerTypes[rand], TrainerVariant.DEFAULT);
    };
}

interface FixedBattleConfigs {
    [key: integer]: FixedBattleConfig
}

export const fixedBattles: FixedBattleConfigs = {
    [5]: new FixedBattleConfig().setBattleType(BattleType.TRAINER)
        .setGetTrainerFunc(scene => new Trainer(scene, TrainerType.YOUNGSTER, Utils.randSeedInt(2) ? TrainerVariant.FEMALE : TrainerVariant.DEFAULT)),
    [8]: new FixedBattleConfig().setBattleType(BattleType.TRAINER)
        .setGetTrainerFunc(scene => new Trainer(scene, TrainerType.RIVAL, scene.gameData.gender === PlayerGender.MALE ? TrainerVariant.FEMALE : TrainerVariant.DEFAULT)),
    [25]: new FixedBattleConfig().setBattleType(BattleType.TRAINER)
        .setGetTrainerFunc(scene => new Trainer(scene, TrainerType.RIVAL_2, scene.gameData.gender === PlayerGender.MALE ? TrainerVariant.FEMALE : TrainerVariant.DEFAULT)),
    [55]: new FixedBattleConfig().setBattleType(BattleType.TRAINER)
        .setGetTrainerFunc(scene => new Trainer(scene, TrainerType.RIVAL_3, scene.gameData.gender === PlayerGender.MALE ? TrainerVariant.FEMALE : TrainerVariant.DEFAULT)),
    [95]: new FixedBattleConfig().setBattleType(BattleType.TRAINER)
        .setGetTrainerFunc(scene => new Trainer(scene, TrainerType.RIVAL_4, scene.gameData.gender === PlayerGender.MALE ? TrainerVariant.FEMALE : TrainerVariant.DEFAULT)),
    [145]: new FixedBattleConfig().setBattleType(BattleType.TRAINER)
        .setGetTrainerFunc(scene => new Trainer(scene, TrainerType.RIVAL_5, scene.gameData.gender === PlayerGender.MALE ? TrainerVariant.FEMALE : TrainerVariant.DEFAULT)),
    [182]: new FixedBattleConfig().setBattleType(BattleType.TRAINER)
        .setGetTrainerFunc(getRandomTrainerFunc([ TrainerType.LORELEI, TrainerType.WILL, TrainerType.SIDNEY, TrainerType.AARON, TrainerType.SHAUNTAL, TrainerType.MALVA, [ TrainerType.HALA, TrainerType.MOLAYNE ], TrainerType.RIKA, TrainerType.CRISPIN ])),
    [184]: new FixedBattleConfig().setBattleType(BattleType.TRAINER).setSeedOffsetWave(182)
        .setGetTrainerFunc(getRandomTrainerFunc([ TrainerType.BRUNO, TrainerType.KOGA, TrainerType.PHOEBE, TrainerType.BERTHA, TrainerType.MARSHAL, TrainerType.SIEBOLD, TrainerType.OLIVIA, TrainerType.POPPY, TrainerType.AMARYS ])),
    [186]: new FixedBattleConfig().setBattleType(BattleType.TRAINER).setSeedOffsetWave(182)
        .setGetTrainerFunc(getRandomTrainerFunc([ TrainerType.AGATHA, TrainerType.BRUNO, TrainerType.GLACIA, TrainerType.FLINT, TrainerType.GRIMSLEY, TrainerType.WIKSTROM, TrainerType.ACEROLA, TrainerType.LARRY_ELITE, TrainerType.LACEY ])),
    [188]: new FixedBattleConfig().setBattleType(BattleType.TRAINER).setSeedOffsetWave(182)
        .setGetTrainerFunc(getRandomTrainerFunc([ TrainerType.LANCE, TrainerType.KAREN, TrainerType.DRAKE, TrainerType.LUCIAN, TrainerType.CAITLIN, TrainerType.DRASNA, TrainerType.KAHILI, TrainerType.HASSEL, TrainerType.DRAYTON ])),
    [190]: new FixedBattleConfig().setBattleType(BattleType.TRAINER).setSeedOffsetWave(182)
        .setGetTrainerFunc(getRandomTrainerFunc([ TrainerType.BLUE, [ TrainerType.RED, TrainerType.LANCE_CHAMPION ], [ TrainerType.STEVEN, TrainerType.WALLACE ], TrainerType.CYNTHIA, [ TrainerType.ALDER, TrainerType.IRIS ], TrainerType.DIANTHA, TrainerType.HAU, [ TrainerType.GEETA, TrainerType.NEMONA ], TrainerType.KIERAN, TrainerType.LEON ])),
    [195]: new FixedBattleConfig().setBattleType(BattleType.TRAINER)
        .setGetTrainerFunc(scene => new Trainer(scene, TrainerType.RIVAL_6, scene.gameData.gender === PlayerGender.MALE ? TrainerVariant.FEMALE : TrainerVariant.DEFAULT))
};
