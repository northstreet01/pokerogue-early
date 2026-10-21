import type BattleScene from '../battle-scene';
import { Phase } from '../phase';
import { Mode } from '../ui/ui';
import { capturePokemonState, restorePokemonState } from '../field/pokemon';
import { CoopBattlePresentation, createCoopPokemonDisplay } from './battle-presentation';
import { captureProfile } from './original-profile-entry';
import { createOriginalClientModel } from './original-client-model.mjs';
import { createSnapshotConsumer } from '../battle-core/coop-client.mjs';
import { PROTOCOL_VERSION, CHECKPOINT_VERSION } from '../battle-core/coop-contract.mjs';
import { createPlayStorage } from './play-storage.mjs';
import { GameModes } from '../game-mode';
import { Command } from '../ui/command-ui-handler';
import { ModifierTypeOption, PokemonHpRestoreModifierType, PokemonReviveModifierType, restoreModifierTypeState } from '../modifier/modifier-type';
import { AddPokeballModifier } from '../modifier/modifier';
import { PartyUiMode, PartyOption } from '../ui/party-ui-handler';

const RULES_VERSION = 'early-vs02';
const CONTENT_HASH = 'vs02-original-coop';

export default class CoopPlayPhase extends Phase {
  private overlay!: HTMLDivElement;
  private panel!: HTMLDivElement;
  private status!: HTMLDivElement;
  private budget!: HTMLDivElement;
  private roomLine!: HTMLDivElement;
  private controls!: HTMLDivElement;
  private reserveLine!: HTMLDivElement;
  private releaseTeamParty: (() => void) | null = null;
  private teamMenuEpoch = 0;
  private socket: WebSocket | null = null;
  private consumer: any = null;
  private model: any = null;
  private epoch: string | null = null;
  private roomId: string | null = null;
  private runId: string | null = null;
  private seat: number | null = null;
  private token: string | null = null;
  private versions: any = null;
  private latest: any = null;
  private lastProfile: any = null;
  private actionId: string | null = null;
  private pendingAction: any = null;
  private starterOpen = false;
  private origin = location.origin;
  private storage = createPlayStorage();
  private messageChain = Promise.resolve();
  private replayedEpoch: string | null = null;
  private inputReady = false;
  private resuming = false;
  private battleSignature = '';
  private battleInputActive = false;
  private presentation: CoopBattlePresentation | null = null;
  private preparationSignature = '';
  private switchSignature = '';
  private submitted = false;
  private profileDirty = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(scene: BattleScene) { super(scene); }

  start() {
    super.start();
    this.scene.enableTutorials = false; // Cooperative entry does not write solo tutorial flags.
    this.createOverlay();
    this.model = createOriginalClientModel({ restorePokemonState, capturePokemonState });
    this.scene.events?.once('shutdown', () => {
      this.disposed = true;
      this.clearPreparationParty();
      this.clearActiveSwitchParty();
      if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
      this.epoch = null; this.socket?.close(); this.presentation?.clear(); this.overlay.remove();
    });
    void this.loadProfileAndConnect().catch(error =>
      this.setStatus(`本人收藏不可用：${error?.message ?? error}`, true));
  }

  private async loadProfileAndConnect() {
    // Persist a genuinely new original default profile once, so its original
    // trainer identity survives refresh/reselection. Existing or corrupt saves
    // are never replaced; the original saveSystem uses its existing CAS store.
    if (!await this.scene.gameData.loadSystem() && !await this.scene.gameData.saveSystem())
      throw new Error('INITIAL_PROFILE_SAVE_FAILED');
    this.connect();
  }

  private createOverlay() {
    this.overlay = document.createElement('div');
    this.overlay.id = 'coop-play-overlay';
    this.panel = document.createElement('div'); this.panel.className = 'panel';
    const title = document.createElement('h1'); title.textContent = 'Early 合作冒险';
    this.status = document.createElement('div'); this.status.className = 'status'; this.status.textContent = '连接中…';
    this.budget = document.createElement('div'); this.budget.className = 'status';
    this.roomLine = document.createElement('div'); this.roomLine.className = 'status';
    this.controls = document.createElement('div');
    this.reserveLine = document.createElement('div'); this.reserveLine.className = 'status'; this.reserveLine.hidden = true;
    this.panel.append(title, this.status, this.roomLine, this.budget, this.reserveLine, this.controls);
    this.overlay.append(this.panel);
    document.body.append(this.overlay);
    this.renderLobbyControls();
  }

  private setStatus(text: string, error = false) {
    this.status.textContent = text;
    this.status.className = error ? 'error' : 'status';
  }
  private button(label: string, handler: () => void, primary = false) {
    const button = document.createElement('button');
    button.textContent = label; if (primary) button.className = 'primary';
    button.addEventListener('click', () => { void Promise.resolve().then(handler)
      .catch(error => this.setStatus(`操作失败：${error?.message ?? error}`, true)); }); return button;
  }
  private renderLobbyControls() {
    this.controls.replaceChildren();
    if (this.roomId && this.latest?.personal.decision.kind !== 'lobby' && this.latest) return;
    if (this.roomId) {
      const row = document.createElement('div'); row.className = 'row';
      const ready = !!this.latest?.shared.ready?.[this.seat!];
      row.append(this.button(ready ? '取消准备' : '提交准备', () => this.sendProfile(!ready)),
        this.button('重新选队', async () => {
          if (this.actionId || !this.inputReady) return;
          if (ready) { this.setStatus('请先取消准备，再重新选队'); return; }
          await this.openStarterSelect();
        }, true));
      this.controls.append(row);
      return;
    }
    const row = document.createElement('div'); row.className = 'row';
    const input = document.createElement('input'); input.placeholder = '房间码'; input.maxLength = 6;
    input.style.width = '8em'; input.id = 'coop-room-code';
    row.append(input, this.button('加入房间', () => this.joinRoom(input.value.trim().toUpperCase())),
      this.button('创建房间', () => this.createRoom(), true));
    this.controls.append(row);
  }

  private connect() {
    if (this.disposed) return;
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(`${protocol}//${location.host}/coop/v1/ws`);
    this.socket = socket;
    socket.addEventListener('open', async () => {
      this.setStatus('已连接，恢复席位…');
      this.send({ type: 'hello', protocolVersion: PROTOCOL_VERSION, checkpointVersion: CHECKPOINT_VERSION,
        rulesVersion: RULES_VERSION, contentHash: CONTENT_HASH });
    });
    socket.addEventListener('message', event => {
      this.messageChain = this.messageChain.then(async () => {
        if (socket !== this.socket || socket.readyState !== WebSocket.OPEN) return;
        await this.onMessage(JSON.parse(event.data));
      }).catch(error => this.setStatus(`同步失败：${error?.message ?? error}`, true));
    });
    socket.addEventListener('close', () => {
      if (socket !== this.socket || this.disposed) return;
      this.setStatus('连接已断开，正在重新连接…', true);
      this.consumer = null; this.epoch = null;
      this.clearPreparationParty();
      this.clearActiveSwitchParty();
      this.inputReady = false; this.battleInputActive = false;
      void this.scene.ui.setMode(Mode.MESSAGE);
      this.reconnectTimer = setTimeout(() => this.connect(), 1000);
    });
    socket.addEventListener('error', () => this.setStatus('WebSocket 连接失败', true));
  }

  private send(message: any) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) throw new Error('WEBSOCKET_NOT_OPEN');
    this.socket.send(JSON.stringify(message));
  }

  private async onMessage(message: any) {
    try {
      if (message.type === 'welcome') {
        this.versions = message;
        if (message.roomId && message.resumeToken) {
          this.roomId = message.roomId; this.seat = message.seat; this.token = message.resumeToken;
          this.epoch = message.connectionEpoch;
          this.consumer = null; this.replayedEpoch = null; this.resuming = false;
          await this.persistSeat();
          this.renderLobbyControls();
          this.setStatus('已加入房间，等待快照…');
        }
        if (!message.roomId) await this.tryResume();
        return;
      }
      if (message.type === 'error') {
        if (this.resuming) {
          this.roomId = null; this.seat = null; this.token = null; this.resuming = false;
          this.renderLobbyControls();
        }
        this.setStatus(`错误：${message.code}`, true);
        return;
      }
      if (message.type === 'syncStatus') {
        if (this.latest && message.roomId === this.roomId && message.runId === this.runId
          && message.revision === this.latest.revision) {
          this.inputReady = !message.blocked;
          this.submitted = !!message.submitted?.[this.seat!];
          if (this.submitted || !this.inputReady) {
            this.clearPreparationParty();
            this.clearActiveSwitchParty();
            this.battleInputActive = false;
            this.preparationSignature = ''; this.switchSignature = '';
            if (this.latest.personal.decision.kind !== 'lobby') await this.scene.ui.setMode(Mode.MESSAGE);
          } else await this.openDecisionInput();
          if (['RUNNER_FAILED', 'STORAGE_FAILED'].includes(message.reason)) {
            this.setStatus(`结算已暂停：${message.reason}，已提交行动仍保留`, true);
            this.controls.replaceChildren(this.button('重新同步', () => this.send({ type: 'requestSnapshot',
              roomId: this.roomId, runId: this.runId, knownRevision: this.latest.revision, reason: 'USER_RETRY' })));
          } else if (message.reason === 'DISCONNECTED') this.setStatus('队友连接已断开，等待恢复…');
          if (this.latest.personal.decision.kind === 'lobby' && this.inputReady && this.lastProfile && !this.actionId)
            this.setStatus(this.latest.shared.ready?.[this.seat!] ? '已准备，等待队友…' : '选队已保留，可以提交准备');
        }
        return;
      }
      if (message.type === 'actionReceipt' && message.roomId === this.roomId) {
        if (this.seat !== null)
          await this.storage.deleteAction(this.origin, this.roomId, this.seat, message.actionId);
        if (message.actionId !== this.actionId) return;
        const action = this.pendingAction?.action;
        this.actionId = null; this.pendingAction = null;
        this.preparationSignature = ''; this.switchSignature = '';
        // A replayed durable receipt can belong to an earlier decision after
        // reconnect. Clear its outbox entry without locking the new menu.
        if (message.revision !== this.latest?.revision || message.decisionId !== this.latest?.decisionId) {
          await this.openDecisionInput();
          return;
        }
        if (!message.accepted) {
          this.setStatus(`操作被拒绝：${message.code}`, true);
          this.renderLobbyControls();
          this.battleInputActive = false; await this.openDecisionInput();
          return;
        }
        if (action?.kind === 'fight') this.submitted = true;
        if (['preparation', 'switch-confirm', 'switch-select', 'forced-switch', 'capture-choice', 'switch', 'ball'].includes(action?.kind)) this.submitted = true;
        if (['preparation', 'switch-confirm', 'switch-select', 'forced-switch', 'switch', 'ball'].includes(action?.kind))
          await this.scene.ui.setMode(Mode.MESSAGE);
        if (action?.kind === 'profile-ready') this.profileDirty = false;
        if (this.latest?.personal.decision.kind === 'wait-actions') this.setStatus('行动已提交，等待队友／结算…');
        else if (this.latest?.personal.decision.kind === 'preparation') this.setStatus('整备操作已提交，等待回执…');
        else this.setStatus('已提交，等待队友…');
        return;
      }
      if (message.type === 'snapshot') {
        if (message.connectionEpoch !== this.epoch) return;
        if (message.roomId !== this.roomId || message.seat !== this.seat) throw new Error('ROOM_SEAT_MISMATCH');
        if (!this.latest || message.revision >= this.latest.revision) this.inputReady = false;
        if (!this.consumer) {
          this.consumer = createSnapshotConsumer({
            versions: { protocolVersion: PROTOCOL_VERSION, checkpointVersion: CHECKPOINT_VERSION,
              rulesVersion: RULES_VERSION, contentHash: CONTENT_HASH },
            adapter: {
              applySnapshot: async (snapshot: any) => {
                this.model.applySnapshot(snapshot);
                if (snapshot.personal.decision.kind !== 'lobby') await this.enterBattle(snapshot);
              },
              captureAppliedState: () => this.model.captureAppliedState(),
              applyGrantsTransaction: grants => this.model.applyGrantsTransaction(grants),
            },
            isCurrent: epoch => epoch === this.epoch,
            send: message => this.send(message),
          });
        }
        const previous = this.latest;
        if (!await this.consumer(message)) return;
        const duplicate = previous?.connectionEpoch === message.connectionEpoch
          && previous.revision === message.revision && previous.decisionId === message.decisionId
          && previous.sharedHash === message.sharedHash && previous.personalHash === message.personalHash;
        this.runId = message.runId;
        this.latest = duplicate ? previous : message;
        this.inputReady = false;
        await this.persistSeat();
        if (!duplicate) await this.updateLobbyView(message);
        await this.replayOutbox();
      }
    } catch (error: any) {
      this.setStatus(`同步失败：${error?.message ?? error}`, true);
    }
  }

  private async updateLobbyView(snapshot: any) {
    if (snapshot.personal.decision.kind === 'lobby') {
      const shared = snapshot.shared;
      this.roomLine.textContent = `房间 ${snapshot.roomId} · 席位 ${snapshot.seat + 1}`;
      this.budget.textContent = `共享点数 ${shared.budget.used}/${shared.budget.shared}（剩余 ${shared.budget.remaining}）`
        + ` · 个人点数 ${snapshot.personal.priced?.total ?? 0}/10`
        + ` · 准备 ${shared.ready.filter(Boolean).length}/2`;
      if (!this.profileDirty) this.lastProfile = snapshot.personal.profile ?? this.lastProfile;
      if (!snapshot.personal.profile && !this.lastProfile && !this.starterOpen)
        void this.openStarterSelect().catch(error => this.setStatus(`选队界面失败：${error?.message ?? error}`, true));
      else if (snapshot.personal.profile) this.setStatus('已导入选队，等待队友…');
      this.renderLobbyControls();
      return;
    }
    this.roomLine.textContent = `房间 ${snapshot.roomId} · 席位 ${snapshot.seat + 1}`;
    this.budget.textContent = `波次 ${snapshot.shared.waveIndex} · 回合 ${snapshot.shared.turn} · 状态已同步`;
    this.controls.replaceChildren();
    await this.enterBattle(snapshot);
  }

  private async enterBattle(snapshot: any) {
    if (this.seat === null) return;
    const signature = `${snapshot.connectionEpoch}:${snapshot.decisionId}:${snapshot.revision}`;
    if (this.battleSignature === signature) return;
    this.clearPreparationParty();
    this.clearActiveSwitchParty();
    this.battleInputActive = false;
    this.submitted = false;
    this.preparationSignature = '';
    this.switchSignature = '';
    await this.scene.ui.setMode(Mode.MESSAGE);
    this.presentation ??= new CoopBattlePresentation(this.scene);
    await this.presentation.apply(snapshot, this.model.applied);
    this.renderReserve();
    (this.scene as any).standbyPhase = this;
    (this.scene as any).waveCountText?.setText(String(snapshot.shared.waveIndex));
    this.battleSignature = signature;
    this.setStatus(snapshot.personal.decision.kind === 'wait-actions'
      ? '等待双方状态核验…' : `已到安全停点：${snapshot.personal.decision.kind}`);
  }

  private async openDecisionInput() {
    if (this.releaseTeamParty) return;
    if (this.latest?.personal.decision.kind === 'capture-choice' || this.latest?.personal.decision.legacyCapture) await this.openCaptureChoice();
    else if (this.latest?.personal.decision.kind === 'preparation') await this.openPreparationMenu();
    else if (['switch-confirm', 'switch-select', 'wait-switch'].includes(this.latest?.personal.decision.kind)) await this.openSwitchPrompt();
    else this.openBattleCommand();
  }

  private isPersonalInputCurrent(snapshot: any, epoch: string | null) {
    return this.latest === snapshot && this.epoch === epoch && this.inputReady && !this.actionId && !this.submitted;
  }

  private async openPreparationMenu() {
    const snapshot = this.latest, epoch = this.epoch, decision = snapshot?.personal.decision;
    if (!decision || decision.kind !== 'preparation' || this.seat === null
      || !decision.requiredSeats.includes(this.seat) || !this.isPersonalInputCurrent(snapshot, epoch)) return;
    const signature = `${epoch}:${decision.id}:${snapshot.revision}`;
    if (this.preparationSignature === signature) return;
    const player = decision.players;
    if (!player || !Number.isFinite(snapshot.personal.resources?.money)) throw new Error('PERSONAL_PREPARATION_DATA_MISSING');
    this.scene.money = snapshot.personal.resources.money;
    this.renderPreparationControls(player, snapshot, epoch);
    if (player.rewardResolved) {
      await this.scene.ui.setMode(Mode.MESSAGE);
      this.setStatus(player.ready ? '已准备，等待队友；仍可取消准备' : '奖励已处理，可准备进入下一战');
    } else {
      const rewards = player.rewards.map((option: any) =>
        new ModifierTypeOption(restoreModifierTypeState(option.type), 0, 0));
      if (!rewards.length) throw new Error('PERSONAL_REWARD_MENU_EMPTY');
      this.setStatus('原奖励菜单已同步；支持精灵球补给与治疗，也可跳过奖励');
      await this.scene.ui.setMode(Mode.MODIFIER_SELECT, true, rewards, (rowCursor: number, cursor: number) => {
        if (!this.isPersonalInputCurrent(snapshot, epoch)) return false;
        if (rowCursor === -1) { void this.sendPreparation('skip-reward', snapshot, epoch); return false; }
        if (rowCursor !== 1 || !player.rewards?.[cursor]) {
          this.setStatus('当前只接普通奖励行；商店／重抽尚未接入', true);
          return false;
        }
        void this.choosePreparationReward(player.rewards[cursor], snapshot, epoch)
          .catch(error => this.setStatus(`奖励选择失败：${error?.message ?? error}`, true));
        return false;
      }, player.rerollCost, { shopOptions: [], allowReroll: false, allowTransfer: false });
    }
    if (this.isPersonalInputCurrent(snapshot, epoch)) this.preparationSignature = signature;
  }

  private async choosePreparationReward(option: any, snapshot: any, epoch: string | null) {
    if (!this.isPersonalInputCurrent(snapshot, epoch)) return;
    const type = restoreModifierTypeState(option.type);
    const action = { kind: 'preparation', operation: 'reward', optionId: option.id,
      pokemonId: null, moveIndex: null, fusionId: null };
    if (['POKEBALL', 'GREAT_BALL', 'ULTRA_BALL', 'ROGUE_BALL', 'MASTER_BALL'].includes(option.type.catalogId)
      && type.newModifier() instanceof AddPokeballModifier) {
      await this.scene.ui.setMode(Mode.MESSAGE);
      if (!this.isPersonalInputCurrent(snapshot, epoch)) return;
      await this.sendAction(action, '已提交精灵球补给领取…');
      return;
    }
    if (type instanceof PokemonHpRestoreModifierType && !(type instanceof PokemonReviveModifierType)) {
      const personal = this.model.applied?.personal;
      if (!personal?.party?.length) throw new Error('PERSONAL_PARTY_MISSING');
      await this.showTeamParty(personal.party, PartyUiMode.MODIFIER, async (slotIndex, option) => {
        const entry = personal.party[slotIndex];
        this.preparationSignature = '';
        const menuEpoch = this.teamMenuEpoch;
        await this.scene.ui.setMode(Mode.MESSAGE);
        if (!this.isPersonalInputCurrent(snapshot, epoch) || menuEpoch !== this.teamMenuEpoch) return;
        if (!entry || option !== PartyOption.APPLY) { await this.openPreparationMenu(); return; }
        action.pokemonId = entry.id;
        await this.sendAction(action, '已提交治疗领取…');
      }, type.selectFilter, [PartyOption.APPLY, PartyOption.SUMMARY]);
      return;
    }
    this.setStatus('该普通奖励尚不支持；请跳过奖励', true);
  }

  private clearPreparationParty() {
    this.clearTeamParty();
  }

  private clearActiveSwitchParty() {
    this.clearTeamParty();
  }

  private clearTeamParty() {
    this.teamMenuEpoch++;
    const release = this.releaseTeamParty;
    this.releaseTeamParty = null;
    release?.();
  }

  private makeTeamPokemon(entry: any) {
    return createCoopPokemonDisplay(this.scene, restorePokemonState(capturePokemonState(entry.pokemon)));
  }

  /** Original Party/Summary on loaded display copies; the verified model stays detached. */
  private async showTeamParty(entries: any[], mode: PartyUiMode, select: (slot: number, option: PartyOption) => any,
    filter: (pokemon: any) => string | null, allowedOptions: PartyOption[]) {
    const snapshot = this.latest, epoch = this.epoch;
    if (!this.isPersonalInputCurrent(snapshot, epoch)) return false;
    this.clearPreparationParty(); this.clearActiveSwitchParty();
    const menuEpoch = this.teamMenuEpoch;
    await this.scene.ui.setMode(Mode.MESSAGE);
    if (!this.isPersonalInputCurrent(snapshot, epoch) || menuEpoch !== this.teamMenuEpoch) return false;
    const savedParty = (this.scene as any).party, savedBattle = this.scene.currentBattle;
    const party = entries.map(entry => this.makeTeamPokemon(entry));
    const battle = Object.create(savedBattle);
    battle.double = false; battle.getBattlerCount = () => 1;
    (this.scene as any).party = party; this.scene.currentBattle = battle;
    let active = true, settled = false, destroyed = false;
    const dispose = () => {
      if (destroyed) return;
      destroyed = true;
      for (const p of party) {
        this.scene.tweens?.killTweensOf(p);
        if ((p as any).battleInfo) this.scene.tweens?.killTweensOf((p as any).battleInfo);
        p.destroy();
      }
    };
    const release = () => {
      active = false;
      if ((this.scene as any).party === party) {
        // Summary leaves Party alive underneath it. Close both immediately so
        // a stale handler cannot act while an async mode transition finishes.
        this.scene.ui.getHandler?.(Mode.SUMMARY)?.clear();
        this.scene.ui.getHandler?.(Mode.PARTY)?.clear();
        (this.scene as any).party = savedParty;
        this.controls.replaceChildren();
      }
      if (this.scene.currentBattle === battle) this.scene.currentBattle = savedBattle;
      if (settled) dispose();
    };
    this.releaseTeamParty = release;
    try {
      const loaded = await Promise.allSettled(party.map(async p => {
        p.init();
        (p as any).battleInfo?.setVisible(false);
        await p.loadAssets();
      }));
      settled = true;
      const failed = loaded.find(r => r.status === 'rejected');
      if (failed?.status === 'rejected') throw failed.reason;
      if (!active || !this.isPersonalInputCurrent(snapshot, epoch)) { release(); return false; }
      if (this.scene.ui.getMode?.() === Mode.PARTY) await this.scene.ui.setMode(Mode.MESSAGE);
      if (!active || !this.isPersonalInputCurrent(snapshot, epoch)) { release(); return false; }
      await this.scene.ui.setMode(Mode.PARTY, mode, 0, (slot: number, option: PartyOption) => {
        if (!active) return;
        const current = this.isPersonalInputCurrent(snapshot, epoch);
        this.clearTeamParty();
        if (current) return Promise.resolve(select(slot, option)).catch(error => {
          if (this.isPersonalInputCurrent(snapshot, epoch)) this.setStatus(`队伍选择失败：${error?.message ?? error}`, true);
        });
      }, filter, undefined, undefined, { allowedOptions, readOnlySummary: true, ...(mode === PartyUiMode.RELEASE ? { submitReleaseOnly:true } : {}) });
      if (!active || !this.isPersonalInputCurrent(snapshot, epoch)) {
        release();
        if (!this.releaseTeamParty && this.scene.ui.getMode?.() === Mode.PARTY) await this.scene.ui.setMode(Mode.MESSAGE);
        return false;
      }
      return true;
    } catch (error) {
      if (this.releaseTeamParty === release) this.clearTeamParty(); else release();
      if (!this.isPersonalInputCurrent(snapshot, epoch)) return false;
      this.preparationSignature = ''; this.switchSignature = ''; this.battleInputActive = false;
      await this.scene.ui.setMode(Mode.MESSAGE);
      this.controls.replaceChildren(this.button('重试队伍菜单', () => {
        if (this.isPersonalInputCurrent(snapshot, epoch)) return this.openDecisionInput();
      }));
      throw error;
    } finally { settled = true; if (!active) dispose(); }
  }

  private async returnToDecision(snapshot: any, epoch: string | null) {
    const menuEpoch = this.teamMenuEpoch;
    await this.scene.ui.setMode(Mode.MESSAGE);
    if (!this.isPersonalInputCurrent(snapshot, epoch) || menuEpoch !== this.teamMenuEpoch) return;
    this.preparationSignature = ''; this.switchSignature = ''; this.battleInputActive = false;
    await this.openDecisionInput();
  }

  private async openCaptureChoice() {
    const snapshot = this.latest, epoch = this.epoch, decision = snapshot?.personal.decision;
    const legacy = decision?.legacyCapture;
    if (!decision || !(decision.kind === 'capture-choice' || legacy) || !this.isPersonalInputCurrent(snapshot,epoch)) return;
    const signature = `capture:${epoch}:${decision.id}:${snapshot.revision}`;
    if (this.switchSignature === signature) return;
    this.switchSignature = signature; this.controls.replaceChildren();
    const options = legacy?.options ?? decision.options ?? [];
    const decline = options.find((o:any) => legacy ? o.choice === 'discard' : o.releaseId === null);
    const direct = legacy && options.find((o:any) => o.choice === 'keep' && o.releaseId === null);
    const releaseOptions = options.filter((o:any) => o.releaseId !== null);
    if (!decline || !direct && !releaseOptions.length) throw new Error('CAPTURE_OPTIONS_MISSING');
    const displayName = (entry:any) => {
      const pokemon = restorePokemonState(capturePokemonState(entry.pokemon)); pokemon.generateName();
      return `${pokemon.name} Lv.${pokemon.level}`;
    };
    const incoming = legacy && this.model.applied.personal.reserve.find((e:any) => e.id === legacy.pokemonId);
    if (legacy && !incoming) throw new Error('PERSONAL_CAPTURE_MISSING');
    const incomingName = incoming ? displayName(incoming) : '新捕获的宝可梦';
    const send = async (action:any) => {
      const menuEpoch = this.teamMenuEpoch;
      await this.scene.ui.setMode(Mode.MESSAGE);
      if (this.isPersonalInputCurrent(snapshot,epoch) && menuEpoch === this.teamMenuEpoch)
        await this.sendAction(action, '取舍已提交，等待服务器确认…');
    };
    const releaseParty = async () => {
      if (!this.isPersonalInputCurrent(snapshot,epoch)) return;
      const party = this.model.applied.personal.party, allowed = new Set(releaseOptions.map((o:any) => o.releaseId));
      await this.showTeamParty(party, PartyUiMode.RELEASE, async (slot,option) => {
        const entry = party[slot], action = option === PartyOption.RELEASE && entry
          ? releaseOptions.find((o:any) => o.releaseId === entry.id) : null;
        if (!action) { await this.returnToDecision(snapshot,epoch); return; }
        const menuEpoch = this.teamMenuEpoch;
        await this.scene.ui.setMode(Mode.MESSAGE);
        const current = () => this.isPersonalInputCurrent(snapshot,epoch) && menuEpoch === this.teamMenuEpoch;
        if (!current()) return;
        this.setStatus(`确定放生 ${displayName(entry)}，并接纳 ${incomingName}？`);
        let chosen = false;
        await this.scene.ui.setMode(Mode.CONFIRM,
          () => { if (!chosen && current()) { chosen = true; return send(action); } },
          () => { if (!chosen && current()) { chosen = true; return releaseParty(); } });
      }, (p:any) => allowed.has(p.id) ? null : '请选择允许放生的本人队员', [PartyOption.RELEASE,PartyOption.SUMMARY]);
    };
    const menuEpoch = this.teamMenuEpoch; let chosen = false;
    this.setStatus(legacy ? (direct ? `旧版捕获 ${incomingName}：是否保留并加入本人队伍？取消则放弃。`
      : `旧版捕获 ${incomingName}：队伍已满6只，是否放生现有队员后接纳？取消则放弃。`)
      : '队伍已满6只。是否放生一名现有队员后接纳新捕获？取消则放弃本次捕获。');
    const choose = (callback:()=>any) => {
      if (!chosen && this.isPersonalInputCurrent(snapshot,epoch) && menuEpoch === this.teamMenuEpoch) {
        chosen = true; return callback();
      }
    };
    await this.scene.ui.setMode(Mode.CONFIRM, () => choose(() => direct ? send(direct) : releaseParty()), () => choose(() => send(decline)));
  }

  private async openActiveSwitchParty() {
    const snapshot = this.latest, epoch = this.epoch, decision = snapshot?.personal.decision;
    if (!decision || decision.kind !== 'wait-actions' || !this.isPersonalInputCurrent(snapshot, epoch)
      || this.seat === null) return;
    const options = (decision.options ?? []).filter((option: any) => option.kind === 'switch');
    if (!options.length) {
      this.setStatus('当前没有可上场的后备宝可梦', true);
      return;
    }
    const allowed = new Set(options.map((option: any) => option.pokemonId));
    const personal = this.model.applied?.personal;
    if (!personal?.party?.length) throw new Error('PERSONAL_PARTY_MISSING');
    await this.showTeamParty(personal.party, PartyUiMode.SWITCH, async (slotIndex, option) => {
      this.battleInputActive = false;
      const entry = personal.party[slotIndex];
      if (option !== PartyOption.SEND_OUT || !entry || !allowed.has(entry.id)) {
        await this.returnToDecision(snapshot, epoch); return;
      }
      const menuEpoch = this.teamMenuEpoch;
      await this.scene.ui.setMode(Mode.MESSAGE);
      if (this.isPersonalInputCurrent(snapshot, epoch) && menuEpoch === this.teamMenuEpoch)
        await this.sendAction({ kind: 'switch', pokemonId: entry.id }, '已提交换人，等待服务器确认…');
    }, (pokemon: any) => allowed.has(pokemon.id) ? null : '不能更换为该宝可梦', [PartyOption.SEND_OUT, PartyOption.SUMMARY]);
  }

  private renderPreparationControls(player: any, snapshot: any, epoch: string | null) {
    this.controls.replaceChildren();
    const row = document.createElement('div'); row.className = 'row';
    const send = (operation: 'skip-reward' | 'ready' | 'unready') => this.sendPreparation(operation, snapshot, epoch);
    if (!player.rewardResolved) row.append(this.button('跳过奖励', () => send('skip-reward'), true));
    if (player.ready) row.append(this.button('取消准备', () => send('unready')));
    else row.append(this.button('准备', () => {
      if (!this.isPersonalInputCurrent(snapshot, epoch)) return;
      if (!player.rewardResolved) { this.setStatus('请先处理奖励或跳过奖励', true); return; }
      return send('ready');
    }, true));
    this.controls.append(row);
  }

  private async sendPreparation(operation: 'skip-reward' | 'ready' | 'unready', snapshot = this.latest, epoch = this.epoch) {
    if (!this.isPersonalInputCurrent(snapshot, epoch) || snapshot?.personal.decision.kind !== 'preparation') return false;
    const player = snapshot.personal.decision.players;
    if (operation === 'ready' && !player.rewardResolved || operation === 'skip-reward' && player.rewardResolved) return false;
    return this.sendAction({ kind: 'preparation', operation },
      operation === 'ready' ? '准备已提交，等待服务器确认…' : operation === 'unready' ? '取消准备已提交…' : '跳过奖励已提交…');
  }

  private async openSwitchPrompt() {
    const decision = this.latest?.personal.decision;
    if (!decision || !['switch-confirm', 'switch-select', 'wait-switch'].includes(decision.kind)
      || this.seat === null || !decision.requiredSeats.includes(this.seat)
      || !this.inputReady || this.actionId || this.submitted) return;
    const snapshot = this.latest, epoch = this.epoch;
    const signature = `${epoch}:${decision.id}:${snapshot.revision}`;
    if (this.switchSignature === signature) return;
    this.switchSignature = signature;
    const options = decision.options ?? [];
    this.controls.replaceChildren();
    const send = async (action: any, menuEpoch = this.teamMenuEpoch) => {
      if (!this.isPersonalInputCurrent(snapshot, epoch) || menuEpoch !== this.teamMenuEpoch) return;
      await this.scene.ui.setMode(Mode.MESSAGE);
      if (this.isPersonalInputCurrent(snapshot, epoch) && menuEpoch === this.teamMenuEpoch) await this.sendAction(action, '已提交换人选择，等待服务器确认…');
    };
    if (decision.kind === 'switch-confirm') {
      const keep = options.find((option: any) => option.accept === false);
      const change = options.find((option: any) => option.accept === true);
      if (!keep || !change) throw new Error('SWITCH_OPTIONS_MISSING');
      this.setStatus('战前是否更换本人出场者？确认更换，取消保持当前成员');
      const menuEpoch = this.teamMenuEpoch; let chosen = false;
      const choose = (action: any) => { if (!chosen) { chosen = true; return send(action, menuEpoch); } };
      await this.scene.ui.setMode(Mode.CONFIRM, () => choose(change), () => choose(keep));
    } else {
      const forced = decision.kind === 'wait-switch', party = this.model.applied.personal.party;
      const allowed = new Set(options.filter((o: any) => o.pokemonId !== null).map((o: any) => o.pokemonId));
      this.setStatus(forced ? '请选择本人存活后备补位' : '请选择本人下一位出场者，取消可保持当前成员');
      await this.showTeamParty(party, forced ? PartyUiMode.FAINT_SWITCH : PartyUiMode.POST_BATTLE_SWITCH,
        async (slot: number, option: PartyOption) => {
          const entry = party[slot];
          const action = option === PartyOption.SEND_OUT && entry && allowed.has(entry.id)
            ? options.find((o: any) => o.pokemonId === entry.id)
            : !forced && option === PartyOption.CANCEL ? options.find((o: any) => o.pokemonId === null) : null;
          if (action) await send(action);
          else { this.switchSignature = ''; await this.openSwitchPrompt(); }
        }, (p: any) => allowed.has(p.id) ? null : '请选择本人存活后备', [PartyOption.SEND_OUT, PartyOption.SUMMARY]);
    }
  }

  getPokemon() { return this.scene.getPlayerField()[this.seat!]; }
  getFieldIndex() { return this.seat!; }
  checkFightOverride(): boolean { return false; }
  cancel() { /* No intent exists before move/target confirmation. */ }

  /** Original Command UI calls this port before opening unsupported menus. */
  interceptCommand(command: Command): boolean {
    if (!this.battleInputActive || !this.inputReady || this.actionId || this.submitted) return true;
    if (command === Command.FIGHT) return false;
    if (command === Command.POKEMON) {
      void this.openActiveSwitchParty().catch(error =>
        this.setStatus(`换人菜单失败：${error?.message ?? error}`, true));
      return true;
    }
    if (command === Command.BALL) {
      void this.openCaptureMenu().catch(error => this.setStatus(`选球菜单失败：${error?.message ?? error}`, true));
      return true;
    }
    this.setStatus('该战斗菜单尚未接入；当前可验证 FIGHT／POKEMON／BALL', true);
    return true;
  }

  private async openCaptureMenu() {
    const snapshot = this.latest, epoch = this.epoch, decision = snapshot?.personal.decision;
    if (!decision || decision.kind !== 'wait-actions' || !this.isPersonalInputCurrent(snapshot, epoch)
      || this.seat === null) return;
    const options = (decision.options ?? []).filter((option: any) => option.kind === 'ball');
    this.controls.replaceChildren();
    if (!options.length) {
      this.setStatus('当前没有合法捕获目标或可用精灵球', true);
      return;
    }
    const cancel = async () => {
      if (!this.isPersonalInputCurrent(snapshot, epoch)) return;
      this.battleInputActive = false;
      await this.scene.ui.setMode(Mode.MESSAGE);
      if (this.isPersonalInputCurrent(snapshot, epoch)) this.openBattleCommand();
    };
    await this.scene.ui.setMode(Mode.BALL, {
      counts: { ...snapshot.personal.resources.pokeballs },
      allowed: options.map((o: any) => o.pokeballType), cancel,
      select: async (ball: number) => {
        if (!this.isPersonalInputCurrent(snapshot, epoch)) return;
        const option = options.find((o: any) => o.pokeballType === ball);
        if (!option) return;
        this.battleInputActive = false;
        await this.scene.ui.setMode(Mode.MESSAGE);
        if (!this.isPersonalInputCurrent(snapshot, epoch)) return;
        await this.sendAction({ kind: 'ball', pokeballType: option.pokeballType, targetId: option.targetId },
          '已提交投球，等待服务器裁定…');
      },
    });
    this.setStatus('选择精灵球；取消可返回 Command');
  }

  private renderReserve() {
    const count = this.model?.applied?.personal?.reserve?.length ?? 0;
    this.reserveLine.hidden = count === 0;
    this.reserveLine.textContent = count ? `有 ${count} 只旧版捕获待处理，请在整备时逐只取舍。队伍最多6只。` : '';
  }

  private openBattleCommand() {
    if (!this.inputReady || this.actionId || this.submitted || this.battleInputActive || this.seat === null) return;
    if (this.latest?.personal.decision.kind !== 'wait-actions'
      || !this.latest.personal.decision.requiredSeats.includes(this.seat)) return;
    if (!this.getPokemon()) return;
    this.battleInputActive = true;
    (this.scene as any).standbyPhase = this;
    this.setStatus('请选择战斗行动');
    void this.scene.ui.setMode(Mode.COMMAND, this.seat);
  }

  handleCommand(command: Command, cursor: number): boolean {
    if (!this.battleInputActive || !this.inputReady || this.actionId || this.submitted) return false;
    if (command !== Command.FIGHT) return this.interceptCommand(command);
    const actor = this.getPokemon();
    const options = (this.latest.personal.decision.options ?? []).filter((o: any) =>
      o.kind === 'fight' && o.cursor === cursor && o.pokemonId === actor?.id);
    if (!options.length) return false;
    // Server options avoid the RNG consumed by original RANDOM_NEAR_ENEMY.
    const decision = this.latest;
    const epoch = this.epoch;
    const current = () => this.latest === decision && this.epoch === epoch
      && this.battleInputActive && this.inputReady && !this.actionId && !this.submitted;
    const finish = async (target: number | null) => {
      if (!current()) return;
      const option = options.find((o: any) => o.target === target);
      if (!option) return;
      if (await this.sendAction({ kind: 'fight', cursor, pokemonId: actor.id, target }, '行动已提交，等待队友／结算…')) {
        this.battleInputActive = false;
        await this.scene.ui.setMode(Mode.MESSAGE);
      }
    };
    if (options.length === 1) void finish(options[0].target);
    else void this.scene.ui.setMode(Mode.TARGET_SELECT, this.seat!, actor.getMoveset()[cursor].moveId,
      (target: number) => {
        if (!current()) return;
        if (target < 0) { void this.scene.ui.setMode(Mode.FIGHT, this.seat!); return; }
        return finish(target);
      }, options.map((o: any) => o.target));
    return true;
  }

  private async tryResume() {
    const value = await this.storage.loadSeat(this.origin);
    if (value?.roomId && value?.token) {
      this.roomId = value.roomId; this.seat = value.seat; this.token = value.token;
      this.resuming = true;
      this.send({ type: 'resumeSeat', roomId: value.roomId, resumeToken: value.token });
      return;
    }
    this.setStatus('输入房间码加入，或创建新房间');
  }

  private createRoom() {
    this.send({ type: 'createRoom', name: `玩家${Math.floor(Math.random() * 1000)}` });
  }
  private joinRoom(roomId: string) {
    if (roomId.length !== 6) { this.setStatus('请输入 6 位房间码', true); return; }
    this.send({ type: 'joinRoom', roomId, name: `玩家${Math.floor(Math.random() * 1000)}` });
  }

  private async persistSeat() {
    if (!this.roomId || this.seat === null || !this.token) return;
    await this.storage.saveSeat(this.origin,
      { roomId: this.roomId, seat: this.seat, token: this.token, runId: this.runId });
  }

  private async openStarterSelect() {
    if (this.starterOpen) return;
    this.starterOpen = true;
    await this.scene.ui.setMode(Mode.STARTER_SELECT, (starters: any[]) => {
      this.starterOpen = false;
      try {
        const profile = captureProfile(this.scene.gameData, starters);
        this.lastProfile = profile;
        this.profileDirty = true;
        void this.scene.ui.setMode(Mode.MESSAGE);
        void this.sendProfile(true, profile);
      } catch (error: any) {
        void this.scene.ui.setMode(Mode.MESSAGE); // The original callback was consumed; leave before reopening it.
        this.setStatus(`选队失败：${error?.message ?? error}`, true);
      }
    }, { gameMode: GameModes.CLASSIC, onCancel: () => {
      this.starterOpen = false;
      void this.scene.ui.setMode(Mode.MESSAGE);
      this.setStatus('已返回大厅，可重新选队');
    } });
  }

  private async sendAction(action: any, submittedText: string) {
    if (!this.latest || this.seat === null || !this.roomId) return false;
    if (this.actionId) { this.setStatus('操作已提交，等待回执…'); return false; }
    if (!this.inputReady) { this.setStatus('正在核对双方状态，请稍后提交'); return false; }
    this.clearPreparationParty();
    this.clearActiveSwitchParty();
    const actionId = crypto.randomUUID();
    const message = { type: 'submitAction', roomId: this.roomId, runId: this.latest.runId,
      decisionId: this.latest.decisionId, expectedRevision: this.latest.revision, actionId, action };
    this.actionId = actionId;
    this.pendingAction = message;
    let persisted = false;
    try {
      await this.storage.saveAction(this.origin, this.seat, message);
      persisted = true;
      this.send(message);
      this.setStatus(submittedText);
    } catch (error: any) {
      if (!persisted) { this.actionId = null; this.pendingAction = null; }
      this.setStatus(`提交失败，选择已保留：${error?.message ?? error}`, true);
    }
    if (this.latest?.personal.decision.kind === 'lobby') this.renderLobbyControls();
    else if (persisted) {
      this.controls.replaceChildren();
      await this.scene.ui.setMode(Mode.MESSAGE);
    } else {
      this.preparationSignature = ''; this.switchSignature = '';
      await this.openDecisionInput();
    }
    return persisted;
  }

  private async sendProfile(ready: boolean, profile = this.lastProfile) {
    if (!profile || !this.latest || this.seat === null || !this.roomId) return;
    if (this.latest.personal.decision.kind !== 'lobby') return;
    await this.sendAction({ kind: 'profile-ready', profile, ready },
      ready ? '已提交，等待回执…' : '取消准备已提交…');
  }

  private async replayOutbox() {
    if (this.replayedEpoch === this.epoch || this.seat === null || !this.roomId || !this.latest) return;
    this.replayedEpoch = this.epoch;
    const pending = await this.storage.pendingActions(this.origin, this.roomId, this.seat);
    for (const message of pending) {
      if (message.runId !== this.runId) continue;
      this.actionId = message.actionId; this.pendingAction = message;
      this.lastProfile ??= message.action?.profile;
      if (message.action?.kind === 'profile-ready') this.profileDirty = true;
      this.send(message); // Exact persisted actionId/message, never rebase a retry.
    }
  }
}
