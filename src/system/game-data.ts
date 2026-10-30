import {deviceStorage} from '../platform/preferences.mjs';
import BattleScene, { PokeballCounts, bypassLogin } from "../battle-scene";
import i18next from '../i18n';
import Pokemon, { EnemyPokemon, PlayerPokemon, restorePokemonState, capturePokemonState } from "../field/pokemon";
import { pokemonPrevolutions } from "../data/pokemon-evolutions";
import PokemonSpecies, { allSpecies, getPokemonSpecies, speciesStarters } from "../data/pokemon-species";
import { Species } from "../data/enums/species";
import * as Utils from "../utils";
import PokemonData from "./pokemon-data";
import PersistentModifierData from "./modifier-data";
import ArenaData from "./arena-data";
import { Unlockables } from "./unlockables";
import { GameModes, gameModes } from "../game-mode";
import { BattleType } from "../battle";
import TrainerData from "./trainer-data";
import { trainerConfigs } from "../data/trainer-config";
import { Setting, setSetting, settingDefaults } from "./settings";
import { achvs } from "./achv";
import EggData from "./egg-data";
import { Egg, GachaType, drawGachaEggs } from "../data/egg";
import { EggHatchPhase } from '../egg-hatch-phase';
import {canonical} from '../battle-core/coop-contract.mjs';
import { VoucherType, vouchers } from "./voucher";
import { AES, enc } from "crypto-js";
import { Mode } from "../ui/ui";
import { loggedInUser, updateUserInfo } from "../account";
import { Nature } from "../data/nature";
import { GameStats } from "./game-stats";
import { Tutorial } from "../tutorial";
import { Moves } from "../data/enums/moves";
import { speciesEggMoves } from "../data/egg-moves";
import { allMoves } from "../data/move";
import { TrainerVariant } from "../field/trainer";
import { readLocalSave, writeLocalSave, deleteLocalSave, sessionSaveKey } from "./local-save-store";

const saveKey = 'x0i2O7WRiANTqPmZ'; // Temporary; secure encryption is not yet necessary

export enum GameDataType {
  SYSTEM,
  SESSION,
  SETTINGS,
  TUTORIALS
}

export enum PlayerGender {
  UNSET,
  MALE,
  FEMALE
}

export function getDataTypeKey(dataType: GameDataType, slotId: integer = 0): string {
  switch (dataType) {
    case GameDataType.SYSTEM:
      return 'data';
    case GameDataType.SESSION:
      let ret = 'sessionData';
      if (slotId)
        ret += slotId;
      return ret;
    case GameDataType.SETTINGS:
      return 'settings';
    case GameDataType.TUTORIALS:
      return 'tutorials';
  }
}

interface SystemSaveData {
  trainerId: integer;
  secretId: integer;
  gender: PlayerGender;
  dexData: DexData;
  starterMoveData: StarterMoveData;
  starterEggMoveData: StarterEggMoveData;
  gameStats: GameStats;
  unlocks: Unlocks;
  achvUnlocks: AchvUnlocks;
  voucherUnlocks: VoucherUnlocks;
  voucherCounts: VoucherCounts;
  eggs: EggData[];
  gameVersion: string;
  timestamp: integer;
}

export interface SessionSaveData {
  seed: string;
  playTime: integer;
  gameMode: GameModes;
  party: PokemonData[];
  enemyParty: PokemonData[];
  modifiers: PersistentModifierData[];
  enemyModifiers: PersistentModifierData[];
  arena: ArenaData;
  pokeballCounts: PokeballCounts;
  money: integer;
  score: integer;
  waveIndex: integer;
  battleType: BattleType;
  trainer: TrainerData;
  gameVersion: string;
  timestamp: integer;
}

interface Unlocks {
  [key: integer]: boolean;
}

interface AchvUnlocks {
  [key: string]: integer
}

interface VoucherUnlocks {
  [key: string]: integer
}

export interface VoucherCounts {
	[type: string]: integer;
}

export interface DexData {
  [key: integer]: DexEntry
}

export interface DexEntry {
  seenAttr: bigint;
  caughtAttr: bigint;
  natureAttr: integer,
  seenCount: integer;
  caughtCount: integer;
  hatchedCount: integer;
  ivs: integer[];
}

export const DexAttr = {
  NON_SHINY: 1n,
  SHINY: 2n,
  MALE: 4n,
  FEMALE: 8n,
  ABILITY_1: 16n,
  ABILITY_2: 32n,
  ABILITY_HIDDEN: 64n,
  DEFAULT_FORM: 128n
}

export interface DexAttrProps {
  shiny: boolean;
  female: boolean;
  abilityIndex: integer;
  formIndex: integer;
}

export type StarterMoveset = [ Moves ] | [ Moves, Moves ] | [ Moves, Moves, Moves ] | [ Moves, Moves, Moves, Moves ];

export interface StarterMoveData {
  [key: integer]: StarterMoveset | StarterFormMoveData
}

export interface StarterFormMoveData {
  [key: integer]: StarterMoveset
}

export interface StarterEggMoveData {
  [key: integer]: integer
}

export interface TutorialFlags {
  [key: string]: boolean
}

const systemShortKeys = {
  seenAttr: '$sa',
  caughtAttr: '$ca',
  natureAttr: '$na',
  seenCount: '$s' ,
  caughtCount: '$c',
  ivs: '$i'
};

export class GameData {
  private scene: BattleScene;
  private localSystemSnapshot: string | null = null;
  private localSystemSaveQueue: Promise<void> = Promise.resolve();
  private pendingEggOperation:any;
  private eggOperationBusy=false;

  private detachedSystem(system:any):{scene:any,data:GameData}{
    const scene:any=Object.create(this.scene),data:GameData=Object.create(GameData.prototype);
    Object.assign(data,this.parseSystemData(JSON.stringify(system)));
    data.scene=scene;data.eggs=data.eggs.map((egg:any)=>egg.toEgg());scene.gameData=data;
    scene.ui={showText:(_text,_delay,callback)=>callback?.(),achvBar:{showAchv(){}}};
    scene.playSoundWithoutBgm=()=>{};
    scene.unlockAchv=BattleScene.prototype.unlockAchv;
    scene.validateVoucher=BattleScene.prototype.validateVoucher;
    scene.validateAchv=BattleScene.prototype.validateAchv;
    return {scene,data};
  }

  /** Stage original RNG once. Failed storage retries the same eggs, before any
   * animation or live counters change. The profile lease excludes other writers. */
  public async purchaseEggs(choice:number,gacha:GachaType):Promise<Egg[]>{
    if(!this.profileIO||this.readonlyView||this.profileClosing||this.eggOperationBusy)throw new Error('LOCAL_EGG_WRITER_REQUIRED');
    this.eggOperationBusy=true;
    try{
      await this.localSystemSaveQueue.catch(()=>{});
      if(!this.pendingEggOperation){
        const offers=[[0,1,1],[0,10,10],[1,1,5],[2,1,10],[3,1,25]];
        const offer=offers[choice];
        if(!offer||![0,1,2].includes(gacha))throw new Error('INVALID_GACHA_SELECTION');
        const expected=await this.profileIO.read('data'),{data}=this.detachedSystem(JSON.parse(expected));
        const [voucher,cost,count]=offer;
        if(data.voucherCounts[voucher]<cost)throw new Error('GACHA_VOUCHERS_REQUIRED');
        if(data.eggs.length+count>=100)throw new Error('GACHA_INVENTORY_FULL');
        data.voucherCounts[voucher]-=cost;
        const eggs=drawGachaEggs(data,gacha,count,Math.random);
        this.pendingEggOperation={id:crypto.randomUUID(),type:'gacha',expected,next:data.captureSystemData(),eggs,choice,gacha};
      }
      const op=this.pendingEggOperation;
      if(op.type!=='gacha'||op.choice!==choice||op.gacha!==gacha)throw new Error('GACHA_RETRY_PENDING');
      await this.commitStagedEggOperation(op);
      return op.eggs;
    }finally{this.eggOperationBusy=false;}
  }

  private async commitStagedEggOperation(op:any):Promise<void>{
    const write=this.profileIO.commitEggOperation(op.id,op.expected,op.next,op.options);
    this.localSystemSaveQueue=write.then(()=>{});
    void this.localSystemSaveQueue.catch(()=>{});
    this.localSystemSnapshot=await write;
    this.resultsGeneration++;
    if(!await this.loadSystem({readOnly:true}))throw new Error('LOCAL_EGG_REFRESH_FAILED');
    this.pendingEggOperation=null;
  }

  public get pendingHatchResults():any[]{return this.profileIO?.profile.hatchResults??[];}
  public get hasReservedCoopEggs():boolean{const p=this.profileIO?.profile;return !!(p?.eggRun?.eggs.length||p?.deferredHatches.some(h=>h.state==='waiting-terminal'));}
  public deferredEggState(eggId:number):string|null{return this.profileIO?.profile.deferredHatches.find(h=>h.eggId===eggId)?.state??null;}

  /** Commit the fixed original result and rewards first. The retained v2
   * presentation receipt is removed only after the original animation finishes. */
  public async prepareDeferredHatch():Promise<any|null>{
    if(!this.profileIO||this.profileClosing||this.eggOperationBusy)throw new Error('LOCAL_EGG_WRITER_REQUIRED');
    this.eggOperationBusy=true;
    try{
      await this.localSystemSaveQueue.catch(()=>{});
      if(this.pendingHatchResults.length)return this.pendingHatchResults[0];
      if(!this.pendingEggOperation){
        const profile=this.profileIO.profile,reservation=profile.deferredHatches.find(h=>h.state==='released');
        if(!reservation)return null;
        if(profile.schemaVersion!==2)throw new Error('LOCAL_LEGACY_EGGS_RECOVERY_REQUIRED');
        const expected=await this.profileIO.read('data'),{scene,data}=this.detachedSystem(JSON.parse(expected));
        // Staging must not attach sprites/HUD to the live scene. This is the
        // original Pokemon constructor; init() belongs to playback after commit.
        scene.addPlayerPokemon=(species,level,abilityIndex,formIndex,gender,shiny,ivs,nature)=>
          new PlayerPokemon(scene,species,level,abilityIndex,formIndex,gender,shiny,ivs,nature,undefined);
        const egg=data.eggs.find(e=>e.id===reservation.eggId&&e.timestamp===reservation.eggTimestamp);
        if(!egg||egg.hatchWaves>0)throw new Error('DEFERRED_EGG_MISMATCH');
        const phase=new EggHatchPhase(scene,egg),pokemon=phase.generatePokemon();
        try{
          if(pokemon.fusionSpecies)pokemon.clearFusionSpecies();
          if(pokemon.species.mythical)scene.validateAchv(achvs.HATCH_MYTHICAL);
          if(pokemon.species.legendary)scene.validateAchv(achvs.HATCH_LEGENDARY);
          if(pokemon.isShiny())scene.validateAchv(achvs.HATCH_SHINY);
          data.updateSpeciesDexIvs(pokemon.species.speciesId,pokemon.ivs);
          await data.setPokemonCaught(pokemon,true,true);
          const eggMoveIndex=phase.getEggMoveIndex();await data.setEggMoveUnlocked(pokemon.species,eggMoveIndex);
          data.eggs=data.eggs.filter(e=>e!==egg);
          const result={id:crypto.randomUUID(),egg:{...new EggData(egg)},pokemon:capturePokemonState(pokemon),eggMoveIndex};
          this.pendingEggOperation={id:result.id,type:'hatch',expected,next:data.captureSystemData(),result,options:{kind:'hatch',
            deferredHatches:profile.deferredHatches.filter(h=>h!==reservation),hatchResults:[result]}};
        }finally{pokemon.destroy?.();}
      }
      const op=this.pendingEggOperation;if(op.type!=='hatch')throw new Error('GACHA_RETRY_PENDING');
      await this.commitStagedEggOperation(op);return op.result;
    }finally{this.eggOperationBusy=false;}
  }

  public async acknowledgeHatch(resultId:string):Promise<void>{
    const write=this.profileIO.acknowledgeHatch(resultId);this.localSystemSaveQueue=write.then(()=>{});
    void this.localSystemSaveQueue.catch(()=>{});await write;
  }
  private profileIO: any = null;
  private profileClosing = false;
  private resultsGeneration = 0;
  private pendingSaves = new Set<Promise<boolean>>();

  public trainerId: integer;
  public secretId: integer;

  public gender: PlayerGender;
  
  public dexData: DexData;
  private defaultDexData: DexData;

  public starterMoveData: StarterMoveData;

  public starterEggMoveData: StarterEggMoveData;

  public gameStats: GameStats;

  public unlocks: Unlocks;

  public achvUnlocks: AchvUnlocks;

  public voucherUnlocks: VoucherUnlocks;
  public voucherCounts: VoucherCounts;
  public eggs: Egg[];

  private readonlyView: boolean;

  constructor(scene: BattleScene, options: { readOnly?: boolean; skipSettings?: boolean } = {}) {
    this.scene = scene;
    this.readonlyView = !!options.readOnly;
    if (!this.readonlyView && !options.skipSettings) this.loadSettings();
    this.trainerId = this.readonlyView ? 0 : Utils.randSeedInt(65536);
    this.secretId = this.readonlyView ? 0 : Utils.randSeedInt(65536);
    this.starterMoveData = {};
    this.starterEggMoveData = {};
    this.gameStats = new GameStats();
    this.unlocks = {
      [Unlockables.ENDLESS_MODE]: false,
      [Unlockables.MINI_BLACK_HOLE]: false,
      [Unlockables.SPLICED_ENDLESS_MODE]: false
    };
    this.achvUnlocks = {};
    this.voucherUnlocks = {};
    this.voucherCounts = {
      [VoucherType.REGULAR]: 0,
      [VoucherType.PLUS]: 0,
      [VoucherType.PREMIUM]: 0,
      [VoucherType.GOLDEN]: 0
    };
    this.eggs = [];
    this.initDexData();
    this.initEggMoveData();
  }

  public get localProfileId(): string | null { return this.profileIO?.profileId ?? null; }
  public get localProfileName(): string { return this.profileIO?.displayName ?? '本地训练家'; }
  public invalidateProfile(): void { this.profileClosing = true; this.profileIO?.invalidate(); }
  public bindProfileIO(io: any): void {
    if (this.profileIO) throw new Error('LOCAL_PROFILE_ALREADY_BOUND');
    this.profileIO = io;
  }
  public async closeProfile(): Promise<void> {
    this.profileClosing = true;
    try {
      // Include legacy saves still reading/validating their source, before
      // they have reached the actual write queue. A new Scene must not race it.
      if((await Promise.all([...this.pendingSaves])).some(saved=>!saved))throw new Error('LOCAL_SAVE_FAILED');
      // GameData queues serialization before the repository sees the write.
      // Drain that queue before closing the immutable profile binding.
      await this.localSystemSaveQueue;
      await this.profileIO?.close();
    } catch (error) { this.profileClosing = false; throw error; }
  }
  public readLocalData(key: string): Promise<string | null> { return this.profileIO ? this.profileIO.read(key) : readLocalSave(key); }
  public refreshUserInfo(): Promise<boolean> { return updateUserInfo(key => this.readLocalData(key), this.profileIO?.displayName ?? 'Local'); }

  /** Only authenticated, durably bound personal seats may call this port.
   * Original methods run on a detached System copy; no animation, RNG, eggs or
   * shared selection view may write the live collection before the commit. */
  public applyCoopResults(grants: any[], binding: any): Promise<void> {
    if(!grants.length)return Promise.resolve();
    if(this.profileClosing||!this.profileIO||this.profileIO.mode!=='coop')return Promise.reject(new Error('LOCAL_COOP_PROFILE_REQUIRED'));
    const current=binding.isCurrent;
    const work=this.localSystemSaveQueue.catch(()=>{}).then(async()=>{
      const system=await this.profileIO.applyCoopGrants(grants,{...binding,isCurrent:()=>!this.profileClosing&&current()},
        (system,pending,profile)=>this.reduceCoopResults(system,pending,profile,binding));
      this.resultsGeneration++;
      this.localSystemSnapshot=JSON.stringify(system);
      if(!await this.loadSystem({readOnly:true}))throw new Error('LOCAL_COOP_REFRESH_FAILED');
    });
    this.localSystemSaveQueue=work;
    return work;
  }

  private async reduceCoopResults(system: any, grants: any[], profile?:any, binding?:any): Promise<any> {
    const deferredHatches=structuredClone(profile?.deferredHatches??[]);
    let eggRun=structuredClone(profile?.eggRun??null);
    let eggFacts=false;
    const {scene,data}=this.detachedSystem(system);
    const {modifierTypes}=await import('../modifier/modifier-type');
    for(const grant of grants){
      const payload=grant.payload;
      if(![1,2].includes(payload?.version)||!Array.isArray(payload.facts)||!payload.facts.length||payload.facts.length>1000)
        throw new Error('UNSUPPORTED_COOP_RESULTS');
      const completions=payload.facts.filter(f=>f.kind==='completion-pending');
      for(const fact of payload.facts){
        if(fact.owner!==undefined&&fact.owner!==null&&fact.owner!==grant.seat)throw new Error('COOP_RESULT_OWNER_MISMATCH');
        switch(fact.kind){
          case 'seen': case 'capture-pending': case 'evolution-pending': {
            const pokemon=restorePokemonState(fact.pokemon);pokemon.scene=scene;
            if(pokemon.species.speciesId!==fact.speciesId||pokemon.getDexAttr().toString()!==fact.dexAttr)throw new Error('COOP_POKEMON_FACT_MISMATCH');
            if(fact.kind==='seen')data.setPokemonSeen(pokemon,fact.incrementCount);
            else await data.setPokemonCaught(pokemon,fact.kind==='capture-pending');
            break;
          }
          case 'dex-ivs':
            if(!data.dexData[fact.speciesId]||!Array.isArray(fact.ivs)||fact.ivs.length!==6||!fact.ivs.every(v=>Number.isInteger(v)&&v>=0&&v<=31))throw new Error('INVALID_COOP_IVS');
            data.updateSpeciesDexIvs(fact.speciesId,fact.ivs);break;
          case 'achievement-approved':
            if(fact.approved!==true||!Object.prototype.hasOwnProperty.call(achvs,fact.id)||fact.id==='CLASSIC_VICTORY')throw new Error('INVALID_COOP_ACHIEVEMENT');
            scene.unlockAchv(achvs[fact.id]);break;
          case 'voucher-pending': {
            if(fact.id==='CLASSIC_VICTORY'){
              if(!completions.length)throw new Error('COOP_COMPLETION_REQUIRED');
              break; // The completion owns first-clear/repeat handling together.
            }
            if(!Object.prototype.hasOwnProperty.call(vouchers,fact.id)||vouchers[fact.id].voucherType!==fact.voucherType)throw new Error('INVALID_COOP_VOUCHER');
            if(!scene.validateVoucher(vouchers[fact.id])&&fact.repeat===true)modifierTypes.VOUCHER().newModifier().apply([scene]);
            break;
          }
          case 'voucher-item': {
            if(payload.version!==2||!['VOUCHER','VOUCHER_PLUS','VOUCHER_PREMIUM'].includes(fact.catalogId))throw new Error('INVALID_VOUCHER_ITEM');
            modifierTypes[fact.catalogId]().newModifier().apply([scene]);break;
          }
          case 'completion-pending':
            if(fact.achievementId!=='CLASSIC_VICTORY'||fact.sessionsWon!==1||!Array.isArray(fact.unlockCandidates)
              ||!fact.unlockCandidates.every(v=>Object.prototype.hasOwnProperty.call(data.unlocks,v)))throw new Error('INVALID_COOP_COMPLETION');
            if(!scene.unlockAchv(achvs.CLASSIC_VICTORY))modifierTypes.VOUCHER_PREMIUM().newModifier().apply([scene]);
            data.gameStats.sessionsWon++;
            for(const unlock of fact.unlockCandidates)data.unlocks[unlock]=true;
            break;
          case 'session-start':
            if(payload.version===2){
              if(!binding||!Array.isArray(fact.eggs)||canonical(fact.eggs)!==canonical(system.eggs)
                ||eggRun?.eggs.length&&eggRun.sourceRunId!==binding.runId)throw new Error('COOP_EGG_INVENTORY_CONFLICT');
              eggFacts=true;eggRun={sourceRunId:binding.runId,eggs:fact.eggs.map(e=>({id:e.id,timestamp:e.timestamp}))};
            }
            data.gameStats.classicSessionsPlayed++;
            // Remember only preferences independently legal in this profile.
            // A room-borrowed form or egg move never becomes a permanent unlock.
            for(const starter of fact.starters??[]){
              const entry=data.dexData[starter.speciesId],attr=BigInt(starter.dexAttr);
              if(!entry?.caughtAttr||(entry.caughtAttr&attr)!==attr||starter.moveset===null)continue;
              const species=getPokemonSpecies(starter.speciesId),index=data.getFormIndex(attr);
              const form=species.forms.length?species.forms[index]:species;
              if(form?.validateStarterMoveset(starter.moveset,data.starterEggMoveData[starter.speciesId]??0))
                data.starterMoveData[starter.speciesId]=[...starter.moveset];
            }break;
          case 'egg-progress': {
            if(payload.version!==2||!binding||!Array.isArray(fact.before)||!Array.isArray(fact.after)
              ||fact.before.length!==fact.after.length)throw new Error('INVALID_EGG_PROGRESS');
            const {originalOwnedEggStateCodec}=await import('../original-phase-checkpoints');
            originalOwnedEggStateCodec.restore({players:[fact.before,fact.after]});
            if(fact.before.length&&(eggRun?.sourceRunId!==binding.runId||canonical(eggRun.eggs)!==canonical(fact.before.map(e=>({id:e.id,timestamp:e.timestamp})))))throw new Error('COOP_EGG_INVENTORY_CONFLICT');
            eggFacts=true;
            for(let index=0;index<fact.before.length;index++){
              const before=fact.before[index],after=fact.after[index];
              if(canonical({...before,hatchWaves:before.hatchWaves>0?before.hatchWaves-1:before.hatchWaves})!==canonical(after))throw new Error('INVALID_EGG_PROGRESS');
              const egg=data.eggs.find(e=>e.id===before.id&&e.timestamp===before.timestamp);
              const reserved=deferredHatches.find(h=>h.eggId===before.id);
              if(!egg||canonical({...new EggData(egg)})!==canonical(before)
                ||reserved&&reserved.sourceRunId!==binding.runId)throw new Error('COOP_EGG_INVENTORY_CONFLICT');
              egg.hatchWaves=after.hatchWaves;
              if(egg.hatchWaves<=0&&!reserved)deferredHatches.push({sourceRunId:binding.runId,eggId:egg.id,
                eggTimestamp:egg.timestamp,state:'waiting-terminal',terminal:null});
            }break;
          }
          case 'egg-terminal':
            if(payload.version!==2||!binding||!['victory','defeat'].includes(fact.result))throw new Error('INVALID_EGG_TERMINAL');
            eggFacts=true;
            if(eggRun?.sourceRunId===binding.runId)eggRun=null;
            for(const hatch of deferredHatches)if(hatch.sourceRunId===binding.runId){
              hatch.state='released';hatch.terminal={result:fact.result,receiptId:grant.id};
            }break;
          case 'statistics':
            for(const [key,value] of Object.entries(fact.values)){
              if(!['battles','trainersDefeated','pokemonDefeated','pokemonFused','highestLevel','highestMoney','highestDamage','highestHeal','highestEndlessWave'].includes(key)
                ||!Number.isSafeInteger(value)||Number(value)<0)throw new Error('INVALID_COOP_STATISTICS');
              data.gameStats[key]=key.startsWith('highest')?Math.max(data.gameStats[key],Number(value)):data.gameStats[key]+Number(value);
            }break;
          default:throw new Error('UNSUPPORTED_COOP_RESULT');
        }
      }
    }
    // Preserve original serialization and untouched inventory/identity fields.
    return {system:JSON.parse(data.captureSystemData()),kinds:grants.map(()=> 'completion'),...(eggFacts?{deferredHatches,eggRun}:{})};
  }

  /** Original system serialization, also used to create a genuinely new profile. */
  public captureSystemData(): string {
    const data: SystemSaveData = {
          trainerId: this.trainerId,
          secretId: this.secretId,
          gender: this.gender,
          dexData: this.dexData,
          starterMoveData: this.starterMoveData,
          starterEggMoveData: this.starterEggMoveData,
          gameStats: this.gameStats,
          unlocks: this.unlocks,
          achvUnlocks: this.achvUnlocks,
          voucherUnlocks: this.voucherUnlocks,
          voucherCounts: this.voucherCounts,
          eggs: this.eggs.map(e => new EggData(e)),
          gameVersion: this.scene.game.config.gameVersion,
          timestamp: new Date().getTime()
        };

    const maxIntAttrValue = Math.pow(2, 31);
    return JSON.stringify(data, (k: any, v: any) => typeof v === 'bigint' ? v <= maxIntAttrValue ? Number(v) : v.toString() : v);
  }

  private trackSave(work:Promise<boolean>):Promise<boolean>{
    this.pendingSaves.add(work);void work.then(()=>this.pendingSaves.delete(work),()=>this.pendingSaves.delete(work));return work;
  }
  public saveSystem(): Promise<boolean> {
    if(this.profileClosing)return Promise.resolve(false);
    return this.trackSave(this.saveSystemInternal());
  }
  private saveSystemInternal(): Promise<boolean> {
    if (this.readonlyView || this.profileClosing) return Promise.resolve(false);
    if (this.profileIO) {
      const data = this.captureSystemData();
      const generation=this.resultsGeneration;
      const write = this.localSystemSaveQueue.catch(() => {}).then(async () => {
        if(generation!==this.resultsGeneration)throw new Error('LOCAL_STALE_SYSTEM_SAVE');
        this.localSystemSnapshot = await this.profileIO.writeSystem(data, this.localSystemSnapshot);
      });
      this.localSystemSaveQueue = write;
      return write.then(() => true, error => { console.error('Profile save failed', error); return false; });
    }
    return new Promise<boolean>(resolve => {
      this.refreshUserInfo().then((success: boolean) => {
        if (!success) return resolve(false);
        const systemData = this.captureSystemData();

        if (!bypassLogin) {
          Utils.apiPost(`savedata/update?datatype=${GameDataType.SYSTEM}`, systemData)
            .then(response => response.text())
            .then(error => {
              if (error) {
                console.error(error);
                return resolve(false);
              }
              resolve(true);
            });
        } else {
          const write = this.localSystemSaveQueue.catch(() => {}).then(async () => {
            await writeLocalSave('data', systemData, this.localSystemSnapshot);
            this.localSystemSnapshot = systemData;
          });
          this.localSystemSaveQueue = write;
          write.then(() => resolve(true), error => {
            console.error('Local collection save failed', error);
            resolve(false);
          });
        }
      }).catch(error => { console.error('Collection save failed', error); resolve(false); });
    });
  }

  public loadSystem(options: { readOnly?: boolean } = {}): Promise<boolean> {
    const readOnly = this.readonlyView || options.readOnly;
    return new Promise<boolean>((resolve, reject) => {
      const handleSystemData = (systemDataStr: string) => {
        try {
          const systemData = this.parseSystemData(systemDataStr);
          if (readOnly && (!systemData?.dexData || typeof systemData.dexData !== 'object' || Array.isArray(systemData.dexData)
            || ![systemData.trainerId, systemData.secretId].every(id => Number.isInteger(id) && id >= 0 && id < 65536)))
            throw new Error('个人收藏资料格式不完整，请使用存档工具检查原资料');

          if (!readOnly) console.debug(systemData);

          /*const versions = [ this.scene.game.config.gameVersion, data.gameVersion || '0.0.0' ];
          
          if (versions[0] !== versions[1]) {
            const [ versionNumbers, oldVersionNumbers ] = versions.map(ver => ver.split('.').map(v => parseInt(v)));
          }*/

          this.trainerId = systemData.trainerId;
          this.secretId = systemData.secretId;

          this.gender = systemData.gender;

          if (!readOnly) this.saveSetting(Setting.Player_Gender, systemData.gender === PlayerGender.FEMALE ? 1 : 0);

          this.starterMoveData = systemData.starterMoveData || {};
          
          this.starterEggMoveData = {};
          this.initEggMoveData();

          if (systemData.starterEggMoveData) {
            for (let key of Object.keys(systemData.starterEggMoveData)) {
              if (this.starterEggMoveData.hasOwnProperty(key))
                this.starterEggMoveData[key] = systemData.starterEggMoveData[key];
            }
          }

          if (systemData.gameStats)
            this.gameStats = systemData.gameStats;

          if (systemData.unlocks) {
            for (let key of Object.keys(systemData.unlocks)) {
              if (this.unlocks.hasOwnProperty(key))
                this.unlocks[key] = systemData.unlocks[key];
            }
          }

          if (systemData.achvUnlocks) {
            for (let a of Object.keys(systemData.achvUnlocks)) {
              if (achvs.hasOwnProperty(a))
                this.achvUnlocks[a] = systemData.achvUnlocks[a];
            } 
          }

          if (systemData.voucherUnlocks) {
            for (let v of Object.keys(systemData.voucherUnlocks)) {
              if (vouchers.hasOwnProperty(v))
                this.voucherUnlocks[v] = systemData.voucherUnlocks[v];
            }
          }

          if (systemData.voucherCounts) {
            Utils.getEnumKeys(VoucherType).forEach(key => {
              const index = VoucherType[key];
              this.voucherCounts[index] = systemData.voucherCounts[index] || 0;
            });
          }

          this.eggs = systemData.eggs
            ? systemData.eggs.map(e => e.toEgg())
            : [];

          this.dexData = Object.assign(this.dexData, systemData.dexData);
          this.consolidateDexData(this.dexData);
          this.defaultDexData = null;

          resolve(true);
        } catch (err) {
          console.error(err);
          if (bypassLogin) reject(err);
          else resolve(false);
        }
      }

      if (!bypassLogin) {
        Utils.apiFetch(`savedata/get?datatype=${GameDataType.SYSTEM}`)
          .then(response => response.text())
          .then(response => {
            if (!response.length || response[0] !== '{') {
              console.error(response);
              return resolve(false);
            }

            handleSystemData(response);
          });
      } else {
        this.readLocalData('data').then(data => {
          this.localSystemSnapshot = data;
          return data ? handleSystemData(data) : resolve(false);
        })
          .catch(error => { console.error('Local collection load failed', error); reject(error); });
      }
    });
  }

  private parseSystemData(dataStr: string): SystemSaveData {
    return JSON.parse(dataStr, (k: string, v: any) => {
      if (k === 'gameStats')
        return new GameStats(v);
      else if (k === 'eggs') {
        const ret: EggData[] = [];
        if (v === null)
          v = [];
        for (let e of v)
          ret.push(new EggData(e));
        return ret;
      }

      return k.endsWith('Attr') && k !== 'natureAttr' ? BigInt(v) : v;
    }) as SystemSaveData;
  }

  private convertSystemDataStr(dataStr: string, shorten: boolean = false): string {
    const fromKeys = shorten ? Object.keys(systemShortKeys) : Object.values(systemShortKeys);
    const toKeys = shorten ? Object.values(systemShortKeys) : Object.keys(systemShortKeys);
    for (let k in fromKeys)
      dataStr = dataStr.replace(new RegExp(`${fromKeys[k].replace('$', '\\$')}`, 'g'), toKeys[k]);

    return dataStr;
  }

  public saveSetting(setting: Setting, valueIndex: integer): boolean {
    if (this.readonlyView) return false;
    let settings: object = {};
    if (deviceStorage().hasOwnProperty('settings'))
      settings = JSON.parse(deviceStorage().getItem('settings'));

    setSetting(this.scene, setting as Setting, valueIndex);

    Object.keys(settingDefaults).forEach(s => {
      if (s === setting)
        settings[s] = valueIndex;
    });

    deviceStorage().setItem('settings', JSON.stringify(settings));

    return true;
  }

  private loadSettings(): boolean {
    Object.values(Setting).map(setting => setting as Setting).forEach(setting => setSetting(this.scene, setting, settingDefaults[setting]));

    if (!deviceStorage().hasOwnProperty('settings'))
      return false;

    const settings = JSON.parse(deviceStorage().getItem('settings'));

    for (let setting of Object.keys(settings))
      setSetting(this.scene, setting as Setting, settings[setting]);
  }

  public saveTutorialFlag(tutorial: Tutorial, flag: boolean): boolean {
    let tutorials: object = {};
    if (deviceStorage().hasOwnProperty('tutorials'))
      tutorials = JSON.parse(deviceStorage().getItem('tutorials'));

    Object.keys(Tutorial).map(t => t as Tutorial).forEach(t => {
      const key = Tutorial[t];
      if (key === tutorial)
        tutorials[key] = flag;
      else
        tutorials[key] ??= false;
    });

    deviceStorage().setItem('tutorials', JSON.stringify(tutorials));

    return true;
  }

  public getTutorialFlags(): TutorialFlags {
    const ret: TutorialFlags = {};
    for (const tutorial of Object.values(Tutorial)) ret[tutorial] = false;

    if (!deviceStorage().hasOwnProperty('tutorials'))
      return ret;

    const tutorials = JSON.parse(deviceStorage().getItem('tutorials'));

    for (let tutorial of Object.keys(tutorials))
      ret[tutorial] = tutorials[tutorial];

    return ret;
  }

  private getSessionSaveData(scene: BattleScene): SessionSaveData {
    return {
      seed: scene.seed,
      playTime: scene.sessionPlayTime,
      gameMode: scene.gameMode.modeId,
      party: scene.getParty().map(p => new PokemonData(p)),
      enemyParty: scene.getEnemyParty().map(p => new PokemonData(p)),
      modifiers: scene.findModifiers(() => true).map(m => new PersistentModifierData(m, true)),
      enemyModifiers: scene.findModifiers(() => true, false).map(m => new PersistentModifierData(m, false)),
      arena: new ArenaData(scene.arena),
      pokeballCounts: scene.pokeballCounts,
      money: scene.money,
      score: scene.score,
      waveIndex: scene.currentBattle.waveIndex,
      battleType: scene.currentBattle.battleType,
      trainer: scene.currentBattle.battleType == BattleType.TRAINER ? new TrainerData(scene.currentBattle.trainer) : null,
      gameVersion: scene.game.config.gameVersion,
      timestamp: new Date().getTime()
    } as SessionSaveData;
  }

  public async saveEncounter(scene: BattleScene): Promise<boolean> {
    if (this.profileIO) return this.saveSession(scene, true);
    return await this.saveSystem() && await this.saveSession(scene, true);
  }

  saveSession(scene: BattleScene, skipVerification?: boolean): Promise<boolean> {
    if(this.profileClosing)return Promise.resolve(false);
    return this.trackSave(this.saveSessionInternal(scene,skipVerification));
  }
  private saveSessionInternal(scene: BattleScene, skipVerification?: boolean): Promise<boolean> {
    if (this.readonlyView || this.profileClosing) return Promise.resolve(false);
    if (this.profileIO) {
      const system = this.captureSystemData(), session = JSON.stringify(this.getSessionSaveData(scene));
      const write = this.localSystemSaveQueue.catch(() => {}).then(async () => {
        await this.profileIO.saveAdventure(system,session,scene.sessionSlotId);
        this.localSystemSnapshot = await this.profileIO.read('data');
      });
      this.localSystemSaveQueue = write;
      return write.then(() => true, error => { console.error('Profile adventure save failed', error); return false; });
    }
    return new Promise<boolean>(resolve => {
      Utils.executeIf(!skipVerification, () => this.refreshUserInfo()).then(success => {
        if (success !== null && !success)
          return resolve(false);

        const sessionData = this.getSessionSaveData(scene);

        if (!bypassLogin) {
          Utils.apiPost(`savedata/update?datatype=${GameDataType.SESSION}&slot=${scene.sessionSlotId}`, JSON.stringify(sessionData))
            .then(response => response.text())
            .then(error => {
              if (error) {
                console.error(error);
                return resolve(false);
              }
              console.debug('Session data saved');
              resolve(true);
            });
        } else {
          const write=this.localSystemSaveQueue.catch(()=>{}).then(()=>writeLocalSave(sessionSaveKey(scene.sessionSlotId), JSON.stringify(sessionData)));
          this.localSystemSaveQueue=write;
          write
            .then(() => { console.debug('Local session data saved'); resolve(true); }, error => {
              console.error('Local session save failed', error); resolve(false);
            });
        }
      }).catch(error => { console.error('Session save failed', error); resolve(false); });
    });
  }

  getSession(slotId: integer): Promise<SessionSaveData> {
    if (slotId === -1) return Promise.resolve(null);
    return new Promise(async (resolve, reject) => {
      const handleSessionData = async (sessionDataStr: string) => {
        try {
          const sessionData = this.parseSessionData(sessionDataStr);
          resolve(sessionData);
        } catch (err) {
          reject(err);
          return;
        }
      };

      if (!bypassLogin) {
        Utils.apiFetch(`savedata/get?datatype=${GameDataType.SESSION}&slot=${slotId}`)
          .then(response => response.text())
          .then(async response => {
            if (!response.length || response[0] !== '{') {
              console.error(response);
              return resolve(null);
            }

            await handleSessionData(response);
          });
      } else {
        this.readLocalData(sessionSaveKey(slotId)).then(sessionData => {
          if (sessionData) return handleSessionData(sessionData);
          resolve(null);
        }).catch(reject);
      }
    });
  }

  loadSession(scene: BattleScene, slotId: integer, sessionData?: SessionSaveData): Promise<boolean> {
    return new Promise(async (resolve, reject) => {
      try {
        const initSessionFromData = async sessionData => {
          console.debug(sessionData);

          scene.gameMode = gameModes[sessionData.gameMode || GameModes.CLASSIC];

          scene.setSeed(sessionData.seed || scene.game.config.seed[0]);
          scene.resetSeed();

          console.log('Seed:', scene.seed);

          scene.sessionPlayTime = sessionData.playTime || 0;

          const loadPokemonAssets: Promise<void>[] = [];

          const party = scene.getParty();
          party.splice(0, party.length);

          for (let p of sessionData.party) {
            const pokemon = p.toPokemon(scene) as PlayerPokemon;
            pokemon.setVisible(false);
            loadPokemonAssets.push(pokemon.loadAssets());
            party.push(pokemon);
          }

          Object.keys(scene.pokeballCounts).forEach((key: string) => {
            scene.pokeballCounts[key] = sessionData.pokeballCounts[key] || 0;
          });

          scene.money = sessionData.money || 0;
          scene.updateMoneyText();

          if (scene.money > this.gameStats.highestMoney)
            this.gameStats.highestMoney = scene.money;

          scene.score = sessionData.score;
          scene.updateScoreText();

          const battleType = sessionData.battleType || 0;
          const trainerConfig = sessionData.trainer ? trainerConfigs[sessionData.trainer.trainerType] : null;
          const battle = scene.newBattle(sessionData.waveIndex, battleType, sessionData.trainer, battleType === BattleType.TRAINER ? trainerConfig?.doubleOnly || sessionData.trainer?.variant === TrainerVariant.DOUBLE : sessionData.enemyParty.length > 1);
          battle.enemyLevels = sessionData.enemyParty.map(p => p.level);

          scene.newArena(sessionData.arena.biome, true);

          sessionData.enemyParty.forEach((enemyData, e) => {
            const enemyPokemon = enemyData.toPokemon(scene, battleType, e, sessionData.trainer?.variant === TrainerVariant.DOUBLE) as EnemyPokemon;
            battle.enemyParty[e] = enemyPokemon;
            if (battleType === BattleType.WILD)
              battle.seenEnemyPartyMemberIds.add(enemyPokemon.id);

            loadPokemonAssets.push(enemyPokemon.loadAssets());
          });

          scene.arena.weather = sessionData.arena.weather;
          // TODO
          //scene.arena.tags = sessionData.arena.tags;

          const modifiersModule = await import('../modifier/modifier');

          for (let modifierData of sessionData.modifiers) {
            const modifier = modifierData.toModifier(scene, modifiersModule[modifierData.className]);
            if (modifier)
              scene.addModifier(modifier, true);
          }

          scene.updateModifiers(true);

          for (let enemyModifierData of sessionData.enemyModifiers) {
            const modifier = enemyModifierData.toModifier(scene, modifiersModule[enemyModifierData.className]);
            if (modifier)
              scene.addEnemyModifier(modifier, true);
          }

          scene.updateModifiers(false);

          Promise.all(loadPokemonAssets).then(() => resolve(true));
        };
        if (sessionData)
          initSessionFromData(sessionData);
        else {
          this.getSession(slotId)
            .then(data => initSessionFromData(data))
            .catch(err => {
              reject(err);
              return;
            });
        }
      } catch (err) {
        reject(err);
        return;
      }
    });
  }

  deleteSession(slotId: integer): Promise<boolean> {
    if (this.readonlyView || this.profileClosing) return Promise.resolve(false);
    if (this.profileIO) return this.profileIO.deleteSession(slotId).then(() => true, () => false);
    return new Promise<boolean>(resolve => {
      if (bypassLogin) {
        deleteLocalSave(sessionSaveKey(slotId)).then(() => {
          if (loggedInUser?.lastSessionSlot === slotId) loggedInUser.lastSessionSlot = -1;
          resolve(true);
        }, error => { console.error(error); resolve(false); });
        return;
      }

      updateUserInfo().then(success => {
        if (success !== null && !success)
          return resolve(false);
        Utils.apiFetch(`savedata/delete?datatype=${GameDataType.SESSION}&slot=${slotId}`).then(response => {
          if (response.ok) {
            loggedInUser.lastSessionSlot = -1;
            return resolve(true);
          }
          resolve(false);
        });
      });
    });
  }

  tryClearSession(scene: BattleScene, slotId: integer): Promise<[success: boolean, newClear: boolean]> {
    if (this.profileClosing) return Promise.resolve([false, false]);
    // Earlier System snapshots must finish before a terminal clear is staged;
    // otherwise one of those snapshots could delete the slot without victory
    // statistics. The following original terminal save commits both together.
    if (this.profileIO) return this.localSystemSaveQueue.catch(()=>{}).then(()=>this.profileIO.beginClear(slotId));
    return new Promise<[boolean, boolean]>(resolve => {
      if (bypassLogin) {
        deleteLocalSave(sessionSaveKey(slotId)).then(() => {
          if (loggedInUser?.lastSessionSlot === slotId) loggedInUser.lastSessionSlot = -1;
          resolve([true, true]);
        }, error => { console.error(error); resolve([false, false]); });
        return;
      }

      updateUserInfo().then(success => {
        if (success !== null && !success)
          return resolve([false, false]);
        const sessionData = this.getSessionSaveData(scene);
        Utils.apiPost(`savedata/clear?slot=${slotId}`, JSON.stringify(sessionData)).then(response => {
          if (response.ok) {
            loggedInUser.lastSessionSlot = -1;
            return response.json();
          }
          resolve([false, false]);
        }).then(jsonResponse => resolve([true, jsonResponse.success as boolean]));
      });
    });
  }

  parseSessionData(dataStr: string): SessionSaveData {
    return JSON.parse(dataStr, (k: string, v: any) => {
      /*const versions = [ scene.game.config.gameVersion, sessionData.gameVersion || '0.0.0' ];

      if (versions[0] !== versions[1]) {
        const [ versionNumbers, oldVersionNumbers ] = versions.map(ver => ver.split('.').map(v => parseInt(v)));
      }*/

      if (k === 'party' || k === 'enemyParty') {
        const ret: PokemonData[] = [];
        if (v === null)
          v = [];
        for (let pd of v)
          ret.push(new PokemonData(pd));
        return ret;
      }

      if (k === 'trainer')
        return v ? new TrainerData(v) : null;

      if (k === 'modifiers' || k === 'enemyModifiers') {
        const player = k === 'modifiers';
        const ret: PersistentModifierData[] = [];
        if (v === null)
          v = [];
        for (let md of v)
          ret.push(new PersistentModifierData(md, player));
        return ret;
      }

      if (k === 'arena')
        return new ArenaData(v);

      return v;
    }) as SessionSaveData;
  }

  public tryExportData(dataType: GameDataType, slotId: integer = 0): Promise<boolean> {
    return new Promise<boolean>(resolve => {
      const dataKey: string = getDataTypeKey(dataType, slotId);
      const handleData = (dataStr: string) => {
        switch (dataType) {
          case GameDataType.SYSTEM:
            dataStr = this.convertSystemDataStr(dataStr, true);
            break;
        }
        const encryptedData = AES.encrypt(dataStr, saveKey);
        const blob = new Blob([ encryptedData.toString() ], {type: 'text/json'});
        const link = document.createElement('a');
        link.href = window.URL.createObjectURL(blob);
        link.download = `${dataKey}.prsv`;
        link.click();
        link.remove();
      };
      if (!bypassLogin && dataType < GameDataType.SETTINGS) {
        Utils.apiFetch(`savedata/get?datatype=${dataType}${dataType === GameDataType.SESSION ? `&slot=${slotId}` : ''}`)
          .then(response => response.text())
          .then(response => {
            if (!response.length || response[0] !== '{') {
              console.error(response);
              resolve(false);
              return;
            }

            handleData(response);
            resolve(true);
          });
      } else {
        const reading = dataType < GameDataType.SETTINGS ? this.readLocalData(dataKey) : Promise.resolve(deviceStorage().getItem(dataKey));
        reading.then(data => {
          if (data) handleData(data);
          resolve(!!data);
        }).catch(error => { console.error(error); resolve(false); });
      }
    });
  }

  public importData(dataType: GameDataType, slotId: integer = 0): void {
    if (this.profileIO && dataType < GameDataType.SETTINGS) {
      this.scene.ui.showText(i18next.t('localMeta:useProfileImport')); return;
    }
    const dataKey = getDataTypeKey(dataType, slotId);

    let saveFile: any = document.getElementById('saveFile');
    if (saveFile)
      saveFile.remove();
  
    saveFile = document.createElement('input');
    saveFile.id = 'saveFile';
    saveFile.type = 'file';
    saveFile.accept = '.prsv';
    saveFile.style.display = 'none';
    saveFile.addEventListener('change',
      e => {
        let reader = new FileReader();

        reader.onload = (_ => {
            return e => {
              let dataStr = AES.decrypt(e.target.result.toString(), saveKey).toString(enc.Utf8);
              let valid = false;
              try {
                switch (dataType) {
                  case GameDataType.SYSTEM:
                    dataStr = this.convertSystemDataStr(dataStr);
                    const systemData = this.parseSystemData(dataStr);
                    valid = !!systemData.dexData && !!systemData.timestamp;
                    break;
                  case GameDataType.SESSION:
                    const sessionData = this.parseSessionData(dataStr);
                    valid = !!sessionData.party && !!sessionData.enemyParty && !!sessionData.timestamp;
                    break;
                  case GameDataType.SETTINGS:
                  case GameDataType.TUTORIALS:
                    valid = true;
                    break;
                }
              } catch (ex) {
                console.error(ex);
              }

              let dataName: string;
              switch (dataType) {
                case GameDataType.SYSTEM:
                  dataName = 'save';
                  break;
                case GameDataType.SESSION:
                  dataName = 'session';
                  break;
                case GameDataType.SETTINGS:
                  dataName = 'settings';
                  break;
                case GameDataType.TUTORIALS:
                  dataName = 'tutorials';
                  break;
              }

              const displayError = (error: string) => this.scene.ui.showText(error, null, () => this.scene.ui.showText(null, 0), Utils.fixedInt(1500));

              if (!valid)
                return this.scene.ui.showText((i18next.resolvedLanguage??i18next.language)==='zh-Hans'?i18next.t('earlyBattle:dataCorrupted',{dataName:i18next.t(`earlyBattle:dataName.${dataName}`)}):`Your ${dataName} data could not be loaded. It may be corrupted.`, null, () => this.scene.ui.showText(null, 0), Utils.fixedInt(1500));
              this.scene.ui.showText((i18next.resolvedLanguage??i18next.language)==='zh-Hans'?i18next.t('earlyBattle:dataImportConfirm',{dataName:i18next.t(`earlyBattle:dataName.${dataName}`)}):`Your ${dataName} data will be overridden and the page will reload. Proceed?`, null, () => {
                this.scene.ui.setOverlayMode(Mode.CONFIRM, () => {
                  if (!bypassLogin && dataType < GameDataType.SETTINGS) {
                    updateUserInfo().then(success => {
                      if (!success)
                        return displayError((i18next.resolvedLanguage??i18next.language)==='zh-Hans'?i18next.t('earlyBattle:dataImportConnectionFailed',{dataName:i18next.t(`earlyBattle:dataName.${dataName}`)}):`Could not contact the server. Your ${dataName} data could not be imported.`);
                      Utils.apiPost(`savedata/update?datatype=${dataType}${dataType === GameDataType.SESSION ? `&slot=${slotId}` : ''}`, dataStr)
                        .then(response => response.text())
                        .then(error => {
                          if (error) {
                            console.error(error);
                            return displayError((i18next.resolvedLanguage??i18next.language)==='zh-Hans'?i18next.t('earlyBattle:dataUpdateFailed',{dataName:i18next.t(`earlyBattle:dataName.${dataName}`)}):`An error occurred while updating ${dataName} data. Please contact the administrator.`);
                          }
                          window.location.reload();
                        });
                    });
                  } else {
                    const writing = dataType < GameDataType.SETTINGS ? writeLocalSave(dataKey, dataStr)
                      : Promise.resolve(deviceStorage().setItem(dataKey, dataStr));
                    writing.then(() => window.location.reload())
                      .catch(error => { console.error(error); displayError((i18next.resolvedLanguage??i18next.language)==='zh-Hans'?i18next.t('earlyBattle:dataImportFailed'):'Local save could not be imported.'); });
                  }
                }, () => {
                  this.scene.ui.revertMode();
                  this.scene.ui.showText(null, 0);
                }, false, -98);
              });
            };
          })((e.target as any).files[0]);

        reader.readAsText((e.target as any).files[0]);
      }
    );
    saveFile.click();
    /*(this.scene.plugins.get('rexfilechooserplugin') as FileChooserPlugin).open({ accept: '.prsv' })
      .then(result => {
    });*/
  }

  private initDexData(): void {
    const data: DexData = {};

    for (let species of allSpecies) {
      data[species.speciesId] = {
        seenAttr: 0n, caughtAttr: 0n, natureAttr: 0, seenCount: 0, caughtCount: 0, hatchedCount: 0, ivs: [ 0, 0, 0, 0, 0, 0 ]
      };
    }

    const defaultStarters: Species[] = [
      Species.BULBASAUR, Species.CHARMANDER, Species.SQUIRTLE,
      Species.CHIKORITA, Species.CYNDAQUIL, Species.TOTODILE,
      Species.TREECKO, Species.TORCHIC, Species.MUDKIP,
      Species.TURTWIG, Species.CHIMCHAR, Species.PIPLUP,
      Species.SNIVY, Species.TEPIG, Species.OSHAWOTT,
      Species.CHESPIN, Species.FENNEKIN, Species.FROAKIE,
      Species.ROWLET, Species.LITTEN, Species.POPPLIO,
      Species.GROOKEY, Species.SCORBUNNY, Species.SOBBLE,
      Species.SPRIGATITO, Species.FUECOCO, Species.QUAXLY
    ];

    const defaultStarterAttr = DexAttr.NON_SHINY | DexAttr.MALE | DexAttr.ABILITY_1 | DexAttr.DEFAULT_FORM;

    const defaultStarterNatures: Nature[] = [];

    this.scene.executeWithSeedOffset(() => {
      const neutralNatures = [ Nature.HARDY, Nature.DOCILE, Nature.SERIOUS, Nature.BASHFUL, Nature.QUIRKY ];
      for (let s = 0; s < defaultStarters.length; s++)
        defaultStarterNatures.push(Utils.randSeedItem(neutralNatures));
    }, 0, 'default');

    for (let ds = 0; ds < defaultStarters.length; ds++) {
      let entry = data[defaultStarters[ds]] as DexEntry;
      entry.seenAttr = defaultStarterAttr;
      entry.caughtAttr = defaultStarterAttr;
      entry.natureAttr = Math.pow(2, defaultStarterNatures[ds] + 1);
      for (let i in entry.ivs)
        entry.ivs[i] = 10;
    }

    this.defaultDexData = Object.assign({}, data);
    this.dexData = data;
  }

  private initEggMoveData(): void {
    const data: StarterEggMoveData = {};
    
    const starterSpeciesIds = Object.keys(speciesEggMoves).map(k => parseInt(k) as Species);

    for (let speciesId of starterSpeciesIds)
      data[speciesId] = 0;

    this.starterEggMoveData = data;
  }

  setPokemonSeen(pokemon: Pokemon, incrementCount: boolean = true): void {
    const dexEntry = this.dexData[pokemon.species.speciesId];
    dexEntry.seenAttr |= pokemon.getDexAttr();
    if (incrementCount) {
      dexEntry.seenCount++;
      this.gameStats.pokemonSeen++;
      if (pokemon.isShiny())
        this.gameStats.shinyPokemonSeen++;
    }
  }

  setPokemonCaught(pokemon: Pokemon, incrementCount: boolean = true, fromEgg: boolean = false): Promise<void> {
    return this.setPokemonSpeciesCaught(pokemon, pokemon.species, incrementCount, fromEgg);
  }

  setPokemonSpeciesCaught(pokemon: Pokemon, species: PokemonSpecies, incrementCount: boolean = true, fromEgg: boolean = false): Promise<void> {
    return new Promise<void>(resolve => {
      const dexEntry = this.dexData[species.speciesId];
      const caughtAttr = dexEntry.caughtAttr;
      dexEntry.caughtAttr |= pokemon.getDexAttr();
      dexEntry.natureAttr |= Math.pow(2, pokemon.nature + 1);
      if (incrementCount) {
        if (!fromEgg) {
          dexEntry.caughtCount++;
          this.gameStats.pokemonCaught++;
          if (pokemon.species.pseudoLegendary || pokemon.species.legendary)
            this.gameStats.legendaryPokemonCaught++;
          else if (pokemon.species.mythical)
            this.gameStats.mythicalPokemonCaught++;
          if (pokemon.isShiny())
            this.gameStats.shinyPokemonCaught++;
        } else {
          dexEntry.hatchedCount++;
          this.gameStats.pokemonHatched++;
          if (pokemon.species.pseudoLegendary || pokemon.species.legendary)
            this.gameStats.legendaryPokemonHatched++;
          else if (pokemon.species.mythical)
            this.gameStats.mythicalPokemonHatched++;
          if (pokemon.isShiny())
            this.gameStats.shinyPokemonHatched++;
        }
      }

      const hasPrevolution = pokemonPrevolutions.hasOwnProperty(species.speciesId);
      const newCatch = !caughtAttr;

      const checkPrevolution = () => {
        if (hasPrevolution) {
          const prevolutionSpecies = pokemonPrevolutions[species.speciesId];
          return this.setPokemonSpeciesCaught(pokemon, getPokemonSpecies(prevolutionSpecies), incrementCount, fromEgg).then(() => resolve());
        } else
          resolve();
      };

      if (newCatch && speciesStarters.hasOwnProperty(species.speciesId)) {
        this.scene.playSoundWithoutBgm('level_up_fanfare', 1500);
        this.scene.ui.showText((i18next.resolvedLanguage??i18next.language)==='zh-Hans'?i18next.t('battle:addedAsAStarter',{pokemonName:species.name}):`${species.name} has been\nadded as a starter!`, null, () => checkPrevolution(), null, true);
      } else
        checkPrevolution();
    });
  }

  setEggMoveUnlocked(species: PokemonSpecies, eggMoveIndex: integer): Promise<boolean> {
    return new Promise<boolean>(resolve => {
      const speciesId = species.speciesId;
      if (!speciesEggMoves.hasOwnProperty(speciesId) || !speciesEggMoves[speciesId][eggMoveIndex]) {
        resolve(false);
        return;
      }

      if (!this.starterEggMoveData.hasOwnProperty(speciesId))
        this.starterEggMoveData[speciesId] = 0;

      const value = Math.pow(2, eggMoveIndex);

      if (this.starterEggMoveData[speciesId] & value) {
        resolve(false);
        return;
      }

      this.starterEggMoveData[speciesId] |= value;

      this.scene.playSoundWithoutBgm('level_up_fanfare', 1500);
      this.scene.ui.showText((i18next.resolvedLanguage??i18next.language)==='zh-Hans'?i18next.t(eggMoveIndex===3?'egg:rareEggMoveUnlock':'egg:eggMoveUnlock',{moveName:allMoves[speciesEggMoves[speciesId][eggMoveIndex]].name}):`${eggMoveIndex === 3 ? 'Rare ' : ''}Egg Move unlocked: ${allMoves[speciesEggMoves[speciesId][eggMoveIndex]].name}`, null, () => resolve(true), null, true);
    });
  }

  updateSpeciesDexIvs(speciesId: Species, ivs: integer[]): void {
    let dexEntry: DexEntry;
    do {
      dexEntry = this.scene.gameData.dexData[speciesId];
      const dexIvs = dexEntry.ivs;
      for (let i = 0; i < dexIvs.length; i++) {
        if (dexIvs[i] < ivs[i])
          dexIvs[i] = ivs[i];
      }
      if (dexIvs.filter(iv => iv === 31).length === 6)
        this.scene.validateAchv(achvs.PERFECT_IVS);
    } while (pokemonPrevolutions.hasOwnProperty(speciesId) && (speciesId = pokemonPrevolutions[speciesId]));
  }

  getSpeciesDefaultDexAttr(species: PokemonSpecies, forSeen: boolean = false): bigint {
    let ret = 0n;
    const dexEntry = this.dexData[species.speciesId];
    const attr = dexEntry.caughtAttr;
    ret |= attr & DexAttr.NON_SHINY || !(attr & DexAttr.SHINY) ? DexAttr.NON_SHINY : DexAttr.SHINY;
    ret |= attr & DexAttr.MALE || !(attr & DexAttr.FEMALE) ? DexAttr.MALE : DexAttr.FEMALE;
    ret |= attr & DexAttr.ABILITY_1 || (!(attr & DexAttr.ABILITY_2) && !(attr & DexAttr.ABILITY_HIDDEN)) ? DexAttr.ABILITY_1 : attr & DexAttr.ABILITY_2 ? DexAttr.ABILITY_2 : DexAttr.ABILITY_HIDDEN;
    ret |= this.getFormAttr(this.getFormIndex(attr));
    return ret;
  }

  getSpeciesDexAttrProps(species: PokemonSpecies, dexAttr: bigint): DexAttrProps {
    const shiny = !(dexAttr & DexAttr.NON_SHINY);
    const female = !(dexAttr & DexAttr.MALE);
    const abilityIndex = dexAttr & DexAttr.ABILITY_1 ? 0 : !species.ability2 || dexAttr & DexAttr.ABILITY_2 ? 1 : 2;
    const formIndex = this.getFormIndex(dexAttr);

    return {
      shiny,
      female,
      abilityIndex,
      formIndex
    };
  }

  getSpeciesDefaultNature(species: PokemonSpecies): Nature {
    const dexEntry = this.dexData[species.speciesId];
    for (let n = 0; n < 25; n++) {
      if (dexEntry.natureAttr & Math.pow(2, n + 1))
        return n as Nature;
    }
    return 0 as Nature;
  }

  getSpeciesDefaultNatureAttr(species: PokemonSpecies): integer {
    return Math.pow(2, this.getSpeciesDefaultNature(species));
  }

  getNaturesForAttr(natureAttr: integer): Nature[] {
    let ret: Nature[] = [];
    for (let n = 0; n < 25; n++) {
      if (natureAttr & Math.pow(2, n + 1))
        ret.push(n);
    }
    return ret;
  }

  getSpeciesStarterValue(speciesId: Species): number {
    const baseValue = speciesStarters[speciesId];
    let value = baseValue;
    const caughtHatchedCount = this.dexData[speciesId].caughtCount + this.dexData[speciesId].hatchedCount;

    const decrementValue = (value: number) => {
      if (value > 1)
        value--;
      else
        value /= 2;
      return value;
    }

    let thresholdA: integer;
    let thresholdB: integer;

    switch (baseValue) {
      case 1:
        [ thresholdA, thresholdB ] = [ 25, 100 ];
        break;
      case 2:
        [ thresholdA, thresholdB ] = [ 20, 70 ];
        break;
      case 3:
        [ thresholdA, thresholdB ] = [ 15, 50 ];
        break;
      case 4:
        [ thresholdA, thresholdB ] = [ 10, 30 ];
        break;
      case 5:
        [ thresholdA, thresholdB ] = [ 8, 25 ];
        break;
      case 6:
        [ thresholdA, thresholdB ] = [ 5, 15 ];
        break;
      case 7:
        [ thresholdA, thresholdB ] = [ 4, 12 ];
        break;
      case 8:
        [ thresholdA, thresholdB ] = [ 3, 10 ];
        break;
      default:
        [ thresholdA, thresholdB ] = [ 2, 5 ];
        break;
    }

    if (caughtHatchedCount >= thresholdA) {
      value = decrementValue(value);
      if (caughtHatchedCount >= thresholdB)
        value = decrementValue(value);
    }

    return value;
  }

  getFormIndex(attr: bigint): integer {
    if (!attr || attr < DexAttr.DEFAULT_FORM)
      return 0;
    let f = 0;
    while (!(attr & this.getFormAttr(f)))
      f++;
    return f;
  }

  getFormAttr(formIndex: integer): bigint {
    return BigInt(Math.pow(2, 7 + formIndex));
  }
  
  consolidateDexData(dexData: DexData): void {
    for (let k of Object.keys(dexData)) {
      const entry = dexData[k] as DexEntry;
      if (!entry.hasOwnProperty('hatchedCount'))
        entry.hatchedCount = 0;
      if (!entry.hasOwnProperty('natureAttr') || (entry.caughtAttr && !entry.natureAttr))
        entry.natureAttr = this.defaultDexData[k].natureAttr || Math.pow(2, Utils.randInt(25, 1));
    }
  }
}
