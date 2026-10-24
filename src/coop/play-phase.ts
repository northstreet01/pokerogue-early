import BattleScene from '../battle-scene';
import { Phase } from '../phase';
import { Mode } from '../ui/ui';
import { capturePokemonState, restorePokemonState } from '../field/pokemon';
import { CoopBattlePresentation, createCoopPokemonDisplay, captureResultText } from './battle-presentation';
import { captureProfile, captureProfileDraft } from './original-profile-entry';
import { restoreStarterSelection } from './original-starter-selection';
import { getPokemonSpecies } from '../data/pokemon-species';
import { createOriginalClientModel } from './original-client-model.mjs';
import { createSnapshotConsumer } from '../battle-core/coop-client.mjs';
import { PROTOCOL_VERSION, CHECKPOINT_VERSION, canonical } from '../battle-core/coop-contract.mjs';
import { createPlayStorage } from './play-storage.mjs';
import { pauseAutoResume, autoResumePaused, allowAutoResume } from './exit-recovery.mjs';
import { GameModes } from '../game-mode';
import { Command } from '../ui/command-ui-handler';
import { ModifierTypeOption, restoreModifierTypeState } from '../modifier/modifier-type';
import { PartyUiMode, PartyOption } from '../ui/party-ui-handler';
import { getPokeballDisplayName as getPokeballName } from '../data/pokeball';
import { SummaryUiMode } from '../ui/summary-ui-handler';
import { allMoves } from '../data/move';
import { preparationItemTarget } from './preparation-item';
import { captureModifierState, restoreModifierState } from '../modifier/modifier';
import i18next from '../i18n';

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
  private modifierLine: HTMLDivElement | null = null;
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
  private starterMenuEpoch = 0;
  private starterTransition: Promise<void> = Promise.resolve();
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
  private preparationMenuEpoch = 0;
  private switchSignature = '';
  private submitted = false;
  private profileDirty = false;
  private lobbyDraft: { profile: any; retries: number; error: string | null } | null = null;
  private draftFinal = false;
  private draftResync = false;
  private lobbySelections: HTMLDivElement | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private lifecycle = 0;
  private sessionId = crypto.randomUUID();
  private exitTask: Promise<void> | null = null;
  private joining = false;
  private recoveryVersion = 0;
  private presentedSnapshot: any = null;
  private preparationViewKey = '';
  private preparationCarryRevision: number | null = null;
  private lobbyMusic = new AbortController();

  constructor(scene: BattleScene) { super(scene); }

  start() {
    super.start();
    this.scene.playBgm?.('menu', false, this.lobbyMusic.signal);
    this.scene.enableTutorials = false; // Cooperative entry does not write solo tutorial flags.
    this.createOverlay();
    this.model = createOriginalClientModel({ restorePokemonState, capturePokemonState, restoreModifierState, captureModifierState });
    this.scene.events?.once('shutdown', () => this.stopSession());
    void this.loadProfileAndConnect().catch(error =>
      this.setStatus(`本人收藏不可用：${error?.message ?? error}`, true));
  }

  private async loadProfileAndConnect() {
    const lifecycle = this.lifecycle;
    // Persist a genuinely new original default profile once, so its original
    // trainer identity survives refresh/reselection. Existing or corrupt saves
    // are never replaced; the original saveSystem uses its existing CAS store.
    const loaded = await this.scene.gameData.loadSystem();
    if (!this.current(lifecycle)) return;
    if (!loaded && !await this.scene.gameData.saveSystem()) throw new Error('INITIAL_PROFILE_SAVE_FAILED');
    if (this.current(lifecycle)) this.connect();
  }

  private current(lifecycle = this.lifecycle) { return !this.disposed && lifecycle === this.lifecycle; }
  private session(lifecycle = this.lifecycle, recovery = this.recoveryVersion) {
    return { id: this.sessionId, isCurrent: () => this.current(lifecycle) && recovery === this.recoveryVersion };
  }

  private stopSession() {
    if (this.disposed) return;
    this.lobbyMusic.abort(); this.scene.fadeOutBgm?.(150, true);
    this.disposed = true; this.lifecycle++;
    this.epoch = null; this.consumer = null;
    this.inputReady = false; this.battleInputActive = false; this.starterOpen = false;
    this.starterMenuEpoch++;
    this.lobbyDraft = null; this.draftFinal = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    const socket = this.socket; this.socket = null;
    // Cleanup cannot stop local exit if an already destroyed display throws.
    for (const clean of [() => socket?.close(), () => this.clearTeamParty(),
      () => this.presentation?.clear(), () => this.overlay?.remove()]) {
      try { clean(); } catch { /* Navigation tears down the remaining original UI. */ }
    }
  }

  private leaveSession(reason?:'defeat'|'victory'): Promise<void> {
    if (this.exitTask) return this.exitTask;
    pauseAutoResume();
    this.stopSession();
    // Neither network nor a stalled IDB open may hold the player in this page.
    this.exitTask = (async () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const committed = await Promise.race([
        this.storage.pauseSession(this.origin, this.session()).catch(() => false),
        new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(false), 500); }),
      ]);
      if (timer) clearTimeout(timer);
      location.assign(reason?`/?coopExit=${reason}`:committed ? '/?coopExit=saved' : '/?coopExit=limited');
    })();
    return this.exitTask;
  }

  private createOverlay() {
    this.overlay = document.createElement('div');
    this.overlay.id = 'coop-play-overlay';
    this.panel = document.createElement('div'); this.panel.className = 'panel';
    const title = document.createElement('h1'); title.textContent = 'Early 合作冒险';
    this.status = document.createElement('div'); this.status.className = 'status'; this.status.textContent = '连接中…';
    this.budget = document.createElement('div'); this.budget.className = 'status';
    this.roomLine = document.createElement('div'); this.roomLine.className = 'status';
    this.lobbySelections = document.createElement('div'); this.lobbySelections.className = 'status';
    this.controls = document.createElement('div');
    this.reserveLine = document.createElement('div'); this.reserveLine.className = 'status'; this.reserveLine.hidden = true;
    this.modifierLine = document.createElement('div'); this.modifierLine.className = 'status'; this.modifierLine.hidden = true;
    this.panel.append(title, this.status, this.roomLine, this.budget, this.lobbySelections, this.reserveLine, this.modifierLine, this.controls);
    // Keep this outside the decision controls: no sync/menu state may hide it.
    const exit = this.button('退出本局／返回首页', () => this.leaveSession());
    exit.id = 'coop-exit-session'; exit.type = 'button';
    exit.title = '仅本人离开，房间与已提交行动保留；服务器不可达时也可退出';
    exit.setAttribute('aria-describedby', 'coop-exit-note');
    for (const type of ['keydown', 'keyup']) exit.addEventListener(type, event => event.stopPropagation());
    const note = document.createElement('span'); note.id = 'coop-exit-note'; note.className = 'status';
    note.textContent = '仅本人离开，房间保留';
    this.panel.append(exit, note);
    this.overlay.append(this.panel);
    document.body.append(this.overlay);
    this.renderLobbyControls();
  }

  private setStatus(text: string, error = false) {
    if (this.disposed) return;
    this.status.textContent = text;
    this.status.className = error ? 'error' : 'status';
  }
  private button(label: string, handler: () => void, primary = false) {
    const button = document.createElement('button');
    button.textContent = label; if (primary) button.className = 'primary';
    button.addEventListener('click', () => { void Promise.resolve().then(() => { if (!this.disposed) return handler(); })
      .catch(error => this.setStatus(`操作失败：${error?.message ?? error}`, true)); }); return button;
  }
  private renderLobbyControls() {
    if (this.disposed) return;
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
      if (this.lobbyDraft?.error) row.append(this.button('重试同步选队', async () => {
        if (!this.lobbyDraft) return;
        this.lobbyDraft.error = null; this.lobbyDraft.retries = 0;
        await this.flushLobbyDraft();
      }));
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
    const lifecycle = ++this.lifecycle;
    this.messageChain = Promise.resolve();
    const current = () => this.current(lifecycle) && socket === this.socket;
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(`${protocol}//${location.host}/coop/v1/ws`);
    this.socket = socket;
    socket.addEventListener('open', async () => {
      if (!current()) return;
      this.setStatus('已连接，恢复席位…');
      this.send({ type: 'hello', protocolVersion: PROTOCOL_VERSION, checkpointVersion: CHECKPOINT_VERSION,
        rulesVersion: RULES_VERSION, contentHash: CONTENT_HASH });
    });
    socket.addEventListener('message', event => {
      this.messageChain = this.messageChain.then(async () => {
        if (!current() || socket.readyState !== WebSocket.OPEN) return;
        await this.onMessage(JSON.parse(event.data));
      }).catch(error => { if (current()) this.setStatus(`同步失败：${error?.message ?? error}`, true); });
    });
    socket.addEventListener('close', () => {
      if (!current()) return;
      this.lifecycle++;
      this.joining = false;
      this.setStatus('连接已断开，正在重新连接…', true);
      this.consumer = null; this.epoch = null;
      this.presentation?.cancel();
      this.clearPreparationParty();
      this.clearActiveSwitchParty();
      this.inputReady = false; this.battleInputActive = false;
      this.closeStarterSelect();
      this.reconnectTimer = setTimeout(() => this.connect(), 1000);
    });
    socket.addEventListener('error', () => { if (current()) this.setStatus('WebSocket 连接失败', true); });
  }

  private send(message: any) {
    if (this.disposed) return;
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) throw new Error('WEBSOCKET_NOT_OPEN');
    this.socket.send(JSON.stringify(message));
  }

  private async onMessage(message: any) {
    const lifecycle = this.lifecycle, current = () => this.current(lifecycle);
    if (!current()) return;
    try {
      if (message.type === 'welcome') {
        this.joining = false;
        this.versions = message;
        if (message.roomId && message.resumeToken) {
          this.roomId = message.roomId; this.seat = message.seat; this.token = message.resumeToken;
          this.epoch = message.connectionEpoch;
          this.consumer = null; this.replayedEpoch = null; this.resuming = false;
          await this.persistSeat();
          if (!current()) return;
          this.renderLobbyControls();
          this.setStatus('已加入房间，等待快照…');
        }
        if (!message.roomId) await this.tryResume();
        return;
      }
      if (message.type === 'error') {
        this.joining = false;
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
          if ((this.submitted || !this.inputReady) && !(this.latest.personal.decision.kind === 'preparation'
            && this.preparationCarryRevision === message.revision && message.reason === 'WAITING_ACK')) {
            this.clearPreparationParty();
            this.clearActiveSwitchParty();
            this.battleInputActive = false;
            this.preparationSignature = ''; this.switchSignature = '';
            if (this.latest.personal.decision.kind !== 'lobby') await this.scene.ui.setMode(Mode.MESSAGE);
          } else await this.openDecisionInput();
          if (!current()) return;
          if (['RUNNER_FAILED', 'STORAGE_FAILED'].includes(message.reason)) {
            this.setStatus(`结算已暂停：${message.reason}，已提交行动仍保留`, true);
            this.controls.replaceChildren(this.button('重新同步', () => this.send({ type: 'requestSnapshot',
              roomId: this.roomId, runId: this.runId, knownRevision: this.latest.revision, reason: 'USER_RETRY' })));
          } else if (message.reason === 'DISCONNECTED') this.setStatus('队友连接已断开，等待恢复…');
          if (this.latest.personal.decision.kind === 'lobby' && this.inputReady && this.lastProfile && !this.actionId)
            this.setStatus(this.latest.shared.ready?.[this.seat!] ? '已准备，等待队友…' : '选队已保留，可以提交准备');
          if (this.latest.personal.decision.kind === 'lobby') {
            await this.flushLobbyDraft();
            this.renderDraftStatus();
          }
        }
        return;
      }
      if (message.type === 'actionReceipt' && message.roomId === this.roomId) {
        if (this.seat !== null)
          await this.storage.deleteAction(this.origin, this.roomId, this.seat, message.actionId);
        if (!current()) return;
        if (message.actionId !== this.actionId) return;
        const action = this.pendingAction?.action;
        this.actionId = null; this.pendingAction = null;
        this.preparationSignature = ''; this.switchSignature = '';
        if (action?.kind === 'profile-draft') {
          if (!message.accepted && this.lobbyDraft && this.sameProfile(action.profile, this.lobbyDraft.profile)) {
            const draft = this.lobbyDraft;
            if (['STALE_DECISION', 'SYNC_BLOCKED'].includes(message.code) && draft.retries++ < 1) {
              this.draftResync = true;
              this.send({ type: 'requestSnapshot', roomId: this.roomId, runId: this.runId,
                knownRevision: this.latest.revision, reason: 'DRAFT_RETRY' });
            } else draft.error = `操作被拒绝：${message.code}`;
          }
          this.renderDraftStatus(); this.renderLobbyControls();
          return;
        }
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
        if (['preparation', 'switch-confirm', 'switch-select', 'forced-switch', 'capture-choice', 'switch', 'ball', 'learn-move', 'evolution'].includes(action?.kind)) this.submitted = true;
        if (['preparation', 'switch-confirm', 'switch-select', 'forced-switch', 'switch', 'ball', 'learn-move', 'evolution'].includes(action?.kind))
          await this.scene.ui.setMode(Mode.MESSAGE);
        if (!current()) return;
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
                if (!current()) return;
                this.model.applySnapshot(snapshot);
                if (snapshot.personal.decision.kind !== 'lobby') await this.enterBattle(snapshot);
              },
              captureAppliedState: () => this.model.captureAppliedState(),
              applyGrantsTransaction: grants => this.model.applyGrantsTransaction(grants),
            },
            isCurrent: epoch => current() && epoch === this.epoch,
            send: message => this.send(message),
          });
        }
        const previous = this.latest;
        if (!await this.consumer(message)) return;
        if (!current()) return;
        const duplicate = previous?.connectionEpoch === message.connectionEpoch
          && previous.revision === message.revision && previous.decisionId === message.decisionId
          && previous.sharedHash === message.sharedHash && previous.personalHash === message.personalHash;
        this.runId = message.runId;
        this.latest = duplicate ? previous : message;
        this.draftResync = false;
        this.inputReady = false;
        await this.persistSeat();
        if (!current()) return;
        if (!duplicate) await this.updateLobbyView(message);
        if (!current()) return;
        await this.replayOutbox();
      }
    } catch (error: any) {
      if (current()) this.setStatus(`同步失败：${error?.message ?? error}`, true);
    }
  }

  private async updateLobbyView(snapshot: any) {
    if (this.disposed) return;
    if (snapshot.personal.decision.kind === 'lobby') {
      if (this.modifierLine) { this.modifierLine.hidden = true; this.modifierLine.textContent = ''; }
      const shared = snapshot.shared;
      this.roomLine.textContent = `房间 ${snapshot.roomId} · 席位 ${snapshot.seat + 1}`;
      this.budget.textContent = `共享点数 ${shared.budget.used}/${shared.budget.shared}（剩余 ${shared.budget.remaining}）`
        + ` · 个人点数 ${snapshot.personal.priced?.total ?? 0}/10`
        + ` · 准备 ${shared.ready.filter(Boolean).length}/2`;
      if (this.lobbySelections) {
        this.lobbySelections.hidden = false;
        this.lobbySelections.textContent = (shared.selections ?? []).map((player: any) =>
          `席位${player.seat + 1} ${player.ready ? '已准备' : player.state === 'draft' ? '编辑中' : '未准备'}：`
          + (player.starters.map((starter: any) => `${getPokemonSpecies(starter.speciesId).name}`
            + `${starter.formIndex ? `（形态${starter.formIndex}）` : ''} ${starter.cost}点`).join('、') || '未选')
          + `（${player.total}/10）`).join(' ｜ ');
      }
      if (!this.profileDirty) this.lastProfile = snapshot.personal.profile ?? this.lastProfile;
      if (!snapshot.personal.profile && !this.lastProfile && !this.starterOpen)
        void this.openStarterSelect().catch(error => this.setStatus(`选队界面失败：${error?.message ?? error}`, true));
      else if (snapshot.personal.profile) this.setStatus('已导入选队，等待队友…');
      this.renderLobbyControls();
      this.renderDraftStatus();
      return;
    }
    this.roomLine.textContent = `房间 ${snapshot.roomId} · 席位 ${snapshot.seat + 1}`;
    this.budget.textContent = `波次 ${snapshot.shared.waveIndex} · 回合 ${snapshot.shared.turn} · 状态已同步`;
    this.controls.replaceChildren();
    if (this.lobbySelections) this.lobbySelections.hidden = true;
    this.lobbyDraft = null; this.draftFinal = false;
    await this.enterBattle(snapshot);
  }

  private async enterBattle(snapshot: any) {
    if (this.seat === null) return;
    this.lobbyMusic.abort();
    if (Number.isFinite(snapshot.personal.resources?.money)) {
      this.scene.money = snapshot.personal.resources.money;
      this.scene.updateMoneyText?.();
    }
    const signature = `${snapshot.connectionEpoch}:${snapshot.decisionId}:${snapshot.revision}`;
    if (this.battleSignature === signature) return;
    const preparing = this.presentedSnapshot?.personal.decision.kind === 'preparation'
      && snapshot.personal.decision.kind === 'preparation'
      && this.presentedSnapshot.shared.waveIndex === snapshot.shared.waveIndex
      && this.presentedSnapshot.connectionEpoch === snapshot.connectionEpoch;
    const unchanged = preparing && this.preparationKey(this.presentedSnapshot) === this.preparationKey(snapshot);
    if (!unchanged) { this.clearPreparationParty(); this.clearActiveSwitchParty(); }
    this.battleInputActive = false;
    this.submitted = false;
    if (!unchanged) this.preparationSignature = '';
    this.switchSignature = '';
    if (!preparing) await this.scene.ui.setMode(Mode.MESSAGE);
    if (this.epoch !== snapshot.connectionEpoch || this.disposed) return;
    this.presentation ??= new CoopBattlePresentation(this.scene);
    let presented = false;
    try {
      await this.presentation.apply(snapshot, this.model.applied, { replay: true, preserveFieldBinding: unchanged && !!this.releaseTeamParty });
      if (this.epoch !== snapshot.connectionEpoch || this.disposed) return;
      await this.presentation.playEvents(snapshot.events ?? [], {
        revision: snapshot.revision, decisionId: snapshot.decisionId,
        isCurrent: () => this.epoch === snapshot.connectionEpoch && !this.disposed,
      });
      presented = true;
    } catch (error: any) {
      // Presentation is never allowed to hold the authoritative ACK forever.
      this.setStatus(`战斗展示回放失败：${error?.message ?? error}`, true);
    }
    if (this.epoch !== snapshot.connectionEpoch || this.disposed) return;
    this.renderReserve();
    this.renderPersonalModifiers();
    (this.scene as any).standbyPhase = this;
    (this.scene as any).waveCountText?.setText(String(snapshot.shared.waveIndex));
    this.battleSignature = presented ? signature : '';
    if (presented) { this.presentedSnapshot = snapshot; this.preparationCarryRevision = preparing ? snapshot.revision : null; }
    // Keep a presentation error visible instead of immediately overwriting it.
  }

  private async openDecisionInput() {
    if (this.disposed) return;
    if(this.latest?.personal.decision.kind==='ended'){
      const reason=this.latest.personal.decision.reason;
      await this.leaveSession(reason==='defeat'||reason==='victory'?reason:undefined);return;
    }
    if (this.releaseTeamParty) return;
    if (this.latest?.personal.decision.kind === 'capture-choice' || this.latest?.personal.decision.legacyCapture) await this.openCaptureChoice();
    else if (this.latest?.personal.decision.players?.subdecision?.kind === 'learn-move') await this.openLearnMoveMenu();
    else if (this.latest?.personal.decision.players?.subdecision?.kind === 'evolution') await this.openEvolutionMenu();
    else if (this.latest?.personal.decision.kind === 'preparation') await this.openPreparationMenu();
    else if (this.latest?.personal.decision.kind === 'learn-move') await this.openLearnMoveMenu();
    else if (this.latest?.personal.decision.kind === 'evolution') await this.openEvolutionMenu();
    else if (['switch-confirm', 'switch-select', 'wait-switch'].includes(this.latest?.personal.decision.kind)) await this.openSwitchPrompt();
    else this.openBattleCommand();
  }

  private isPersonalInputCurrent(snapshot: any, epoch: string | null) {
    const same = this.latest === snapshot || snapshot?.personal.decision.kind === 'preparation'
      && this.latest?.personal.decision.kind === 'preparation'
      && this.presentedSnapshot?.decisionId === this.latest.decisionId
      && this.preparationCarryRevision === this.latest.revision && this.preparationKey(snapshot) === this.preparationKey(this.latest);
    return !this.disposed && same && this.epoch === epoch && this.inputReady && !this.actionId && !this.submitted;
  }

  private preparationKey(snapshot: any): string {
    // A partner operation advances the shared decision id without changing our
    // choices. Only a successfully presented/verified revision may carry input.
    const {sharedMarket: _stock, ...personalDecision} = snapshot.personal.decision;
    return canonical({ runId: snapshot.runId ?? null, decision: { ...personalDecision, id: null }, resources: snapshot.personal.resources ?? null,
      party: snapshot.personal.party ?? null, field: snapshot.shared?.field ?? null,
      wave: snapshot.shared?.waveIndex ?? null, biome: snapshot.shared?.biome ?? null });
  }

  private async openPreparationMenu() {
    const snapshot = this.latest, epoch = this.epoch, decision = snapshot?.personal.decision;
    if (!decision || decision.kind !== 'preparation' || this.seat === null
      || !decision.requiredSeats.includes(this.seat) || !this.isPersonalInputCurrent(snapshot, epoch)) return;
    const signature = `${epoch}:${decision.id}:${snapshot.revision}`;
    if (this.preparationSignature === signature) return;
    const viewKey = this.preparationKey(snapshot) + canonical(decision.sharedMarket ?? null);
    if (this.preparationSignature && this.preparationViewKey === viewKey) { this.preparationSignature = signature; return; }
    const player = decision.players;
    const shared = decision.sharedMarket;
    if (shared && player.rewardResolved && !player.subdecision && !player.selection) {
      await this.scene.ui.setMode(Mode.MESSAGE);
      this.setStatus(i18next.t('coop:shoppingFinished'));
      this.preparationSignature=signature;this.preparationViewKey=viewKey;return;
    }
    const menuEpoch = ++this.preparationMenuEpoch;
    const current = () => menuEpoch === this.preparationMenuEpoch && this.isPersonalInputCurrent(snapshot, epoch);
    const submit = (operation: () => Promise<any>) => {
      this.preparationMenuEpoch++;
      void operation().catch(async error => {
        if (this.disposed || this.latest !== snapshot || this.epoch !== epoch) return;
        if (!this.actionId) {
          this.clearTeamParty(); this.preparationSignature = '';
          try { await this.openPreparationMenu(); } catch { /* Report the original error; retry stays available. */ }
        }
        this.setStatus(`整备操作失败：${error?.message ?? error}`, true);
      });
    };
    if (!player || !Number.isFinite(snapshot.personal.resources?.money)) throw new Error('PERSONAL_PREPARATION_DATA_MISSING');
    this.scene.money = snapshot.personal.resources.money;
    this.scene.updateMoneyText?.();
    this.controls.replaceChildren();
    {
      const rewards = player.rewards.map((option: any) =>
        new ModifierTypeOption(restoreModifierTypeState(option.type), 0, 0));
      if (!rewards.length) throw new Error('PERSONAL_REWARD_MENU_EMPTY');
      const shop = (player.shop ?? []).map((option: any) => new ModifierTypeOption(restoreModifierTypeState(option.type), 0, option.cost));
      this.setStatus(shared ? i18next.t('coop:sharedShop')
        : player.ready ? '本人已完成整备，等待伙伴；可在原页取消准备或继续购物'
        : player.rewardResolved ? '奖励已处理，可继续购物或在原页完成整备' : '请选择原奖励、购买道具或重抽；取消键可跳过奖励');
      await this.showOriginalPreparationMenu(true, rewards, (rowCursor: number, cursor: number) => {
        if (!current()) return false;
        if (player.selection || player.subdecision) { this.setStatus('请先处理本人必要选择，再继续整备', true); return false; }
        if (rowCursor === -1) {
          if (shared) {
            // Original overlay confirmation preserves the original menu and
            // its row/cursor on cancel. Release also guards peer updates/exit.
            let active=true;
            const release=()=>{active=false;this.scene.ui.getHandler?.(Mode.CONFIRM)?.clear();};
            this.releaseTeamParty=release;
            const confirm=async(accept:boolean)=>{
              if (!active || !current()) return;
              this.releaseTeamParty=null;active=false;
              await this.scene.ui.revertMode();
              if (!current()) return;
              if (accept) submit(()=>this.sendPreparation('skip-reward',snapshot,epoch));
              else {this.preparationSignature='';await this.openPreparationMenu();}
            };
            void this.scene.ui.setOverlayMode(Mode.CONFIRM,()=>confirm(true),()=>confirm(false));
            this.setStatus(i18next.t('coop:skipShopping'));
          } else submit(() => this.sendPreparation(player.rewardResolved ? player.ready ? 'unready' : 'ready' : 'skip-reward', snapshot, epoch));
          return false;
        }
        if (rowCursor === 0 && cursor === 0 && !player.rewardResolved) {
          submit(() => this.sendAction({ kind: 'preparation', operation: 'reroll' }, '重抽已提交，等待服务器裁定…')); return false;
        }
        const index = rowCursor > 2 || shop.length <= 6 ? cursor : cursor + 6;
        const option = rowCursor === 1 ? player.rewards?.[cursor] : rowCursor >= 2 ? player.shop?.[index] : null;
        if (!option || rowCursor === 1 && player.rewardResolved) {
          this.setStatus('该选项当前不可领取；已处理的奖励不能重复领取', true);
          return false;
        }
        if (preparationItemTarget(restoreModifierTypeState(option.type)) === null) {
          this.setStatus('该道具机制尚未接入，可返回改选；免费奖励也可跳过', true); return false;
        }
        submit(() => this.choosePreparationReward(option, snapshot, epoch, rowCursor === 1 ? 'reward' : 'buy'));
        return false;
      }, player.rerollCost, { shopOptions: shop, allowReroll: !player.rewardResolved && !shared?.rerollLocked, allowTransfer: false,
        stock: shared ? {rewards:player.rewards.map((o:any)=>shared.rewardClaims.find((claim:any)=>claim.optionId===o.id)?.seat ?? null),
          shop:player.shop.map((o:any)=>shared.shopClaims.find((claim:any)=>claim.optionId===o.id)?.seat ?? null)} : undefined,
        preparation: { automatic:!!shared, ready: player.ready, rewardResolved: player.rewardResolved, onComplete: () => {
          if (shared) return;
          if (!current()) return;
          if (!player.rewardResolved || player.selection || player.subdecision) { this.setStatus('请先处理本人必要选择并领取或跳过奖励，再完成整备', true); return; }
          submit(() => this.sendPreparation(player.ready ? 'unready' : 'ready', snapshot, epoch));
        } } });
    }
    if (this.isPersonalInputCurrent(snapshot, epoch)) { this.preparationSignature = signature; this.preparationViewKey = viewKey; }
  }

  private async showOriginalPreparationMenu(...args:any[]) {
    const ui=this.scene.ui;
    const handler=ui.getHandler?.(Mode.MODIFIER_SELECT);
    // Original UI.setMode is a no-op for the current mode. Use the original
    // handler's existing refresh branch so stock/callbacks update in place.
    if (ui.getMode?.()===Mode.MODIFIER_SELECT && handler?.active) handler.show(args);
    else await ui.setMode(Mode.MODIFIER_SELECT,...args);
  }

  private async choosePreparationReward(option: any, snapshot: any, epoch: string | null, operation = 'reward') {
    if (!this.isPersonalInputCurrent(snapshot, epoch)) return;
    const type: any = restoreModifierTypeState(option.type);
    const action = { kind: 'preparation', operation, optionId: option.id,
      pokemonId: null, moveIndex: null, fusionId: null };
    const targetKind = preparationItemTarget(type);
    if (targetKind === 'none') {
      await Promise.resolve(); // A same-turn leave can invalidate this gesture without fading the shop.
      if (!this.isPersonalInputCurrent(snapshot, epoch)) return;
      await this.sendAction(action, '道具选择已提交，等待服务器裁定…');
      return;
    }
    if (targetKind === 'party' || targetKind === 'move') {
      const personal = this.model.applied?.personal;
      if (!personal?.party?.length) throw new Error('PERSONAL_PARTY_MISSING');
      await this.showTeamParty(personal.party, targetKind === 'move' ? PartyUiMode.MOVE_MODIFIER : PartyUiMode.MODIFIER, async (slotIndex, option) => {
        const entry = personal.party[slotIndex];
        this.preparationSignature = '';
        const menuEpoch = this.teamMenuEpoch;
        await this.scene.ui.setMode(Mode.MESSAGE);
        if (!this.isPersonalInputCurrent(snapshot, epoch) || menuEpoch !== this.teamMenuEpoch) return;
        const move = Number(option) - PartyOption.MOVE_1;
        const selected = targetKind === 'move' ? move >= 0 && move < 4 && entry?.pokemon.getMoveset()[move]
          && type.moveSelectFilter(entry.pokemon.getMoveset()[move]) === null : option === PartyOption.APPLY;
        if (!entry || !selected) { await this.openPreparationMenu(); return; }
        action.pokemonId = entry.id;
        if (targetKind === 'move') action.moveIndex = move;
        await this.sendAction(action, '本人道具目标已提交…');
      }, type.selectFilter, targetKind === 'move' ? [PartyOption.MOVE_1, PartyOption.MOVE_2, PartyOption.MOVE_3, PartyOption.MOVE_4, PartyOption.SUMMARY]
        : [PartyOption.APPLY, PartyOption.SUMMARY], targetKind === 'move' ? type.moveSelectFilter : undefined);
      return;
    }
    this.setStatus('该道具机制尚未接入，可返回改选；免费奖励也可跳过', true);
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
    filter: (pokemon: any) => string | null, allowedOptions: PartyOption[], moveFilter?: (move: any) => string | null) {
    const snapshot = this.latest, epoch = this.epoch;
    if (!this.isPersonalInputCurrent(snapshot, epoch)) return false;
    this.clearPreparationParty(); this.clearActiveSwitchParty();
    const menuEpoch = this.teamMenuEpoch;
    await this.scene.ui.setMode(Mode.MESSAGE);
    if (!this.isPersonalInputCurrent(snapshot, epoch) || menuEpoch !== this.teamMenuEpoch) return false;
    const savedParty = (this.scene as any).party, savedBattle = this.scene.currentBattle;
      const savedModifiers = Object.getOwnPropertyDescriptor(this.scene, 'modifiers');
    const party = entries.map(entry => this.makeTeamPokemon(entry));
      // Original held-item filters consult Pokemon.scene and the current cap.
      // Give display copies their own read-only personal inventory/party view.
      // The verified model and public presentation scene remain detached.
      const personalScene = Object.create(this.scene);
      Object.assign(personalScene, { party, modifiers: (this.model.applied.personal.resources?.modifiers ?? [])
        .map(modifier => restoreModifierState(captureModifierState(modifier))),
        getParty: () => party, getPokemonById: id => party.find(pokemon => pokemon.id === id),
        findModifier: BattleScene.prototype.findModifier, findModifiers: BattleScene.prototype.findModifiers,
        getModifiers: BattleScene.prototype.getModifiers });
      for (const pokemon of party) pokemon.scene = personalScene;
      // Party and Summary also query their handler's scene for held icons.
      // Use the same detached personal inventory for that temporary view.
      (this.scene as any).modifiers = personalScene.modifiers;
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
        if ((this.scene as any).modifiers === personalScene.modifiers) {
          if (savedModifiers) Object.defineProperty(this.scene, 'modifiers', savedModifiers); else delete (this.scene as any).modifiers;
        }
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
      }, filter, moveFilter, undefined, { allowedOptions, readOnlySummary: true, ...(mode === PartyUiMode.RELEASE ? { submitReleaseOnly:true } : {}) });
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

  private async sendPreparation(operation: 'skip-reward' | 'ready' | 'unready', snapshot = this.latest, epoch = this.epoch) {
    if (!this.isPersonalInputCurrent(snapshot, epoch) || snapshot?.personal.decision.kind !== 'preparation') return false;
    const player = snapshot.personal.decision.players;
    if (player.selection || player.subdecision) return false;
    if (operation === 'ready' && !player.rewardResolved || operation === 'skip-reward' && player.rewardResolved) return false;
    return this.sendAction({ kind: 'preparation', operation },
      operation === 'ready' ? '准备已提交，等待服务器确认…' : operation === 'unready' ? '取消准备已提交…' : '跳过奖励已提交…');
  }

  private async openEvolutionMenu() {
    const snapshot = this.latest, epoch = this.epoch;
    const decision = snapshot?.personal.decision.players?.subdecision ?? snapshot?.personal.decision;
    if (decision?.kind !== 'evolution' || this.seat === null || !decision.requiredSeats.includes(this.seat)
      || !this.isPersonalInputCurrent(snapshot,epoch)) return;
    const evolution = decision.evolution ?? decision;
    const entry = this.model.applied?.personal?.party?.find((item:any)=>item.id===evolution?.pokemonId);
    if (!entry) throw new Error('PERSONAL_EVOLUTION_DATA_MISSING');
    this.clearTeamParty();
    const menuEpoch = this.teamMenuEpoch;
    let active = true;
    const current = () => active && this.teamMenuEpoch === menuEpoch && this.isPersonalInputCurrent(snapshot,epoch);
    this.releaseTeamParty = () => {active=false; this.scene.ui.getHandler?.(Mode.CONFIRM)?.clear();};
    const submit = async (choice:string) => {
      if (!current()) return;
      this.clearTeamParty();
      await this.scene.ui.setMode(Mode.MESSAGE);
      if (this.teamMenuEpoch !== menuEpoch+1 || !this.isPersonalInputCurrent(snapshot,epoch)) return;
      await this.sendAction({kind:'evolution',pokemonId:evolution.pokemonId,choice},i18next.t('evolutionPhase:submitted'));
    };
    await this.scene.ui.setMode(Mode.MESSAGE);
    if (!current()) return;
    const name = entry.pokemon.species.getName(entry.pokemon.formIndex);
    this.setStatus(i18next.t(evolution.stage==='pause-confirm'?'evolutionPhase:coopPausePrompt':'evolutionPhase:confirm',{pokemonName:name}));
    await this.scene.ui.setMode(Mode.CONFIRM,
      ()=>submit(evolution.stage==='pause-confirm'?'pause':'evolve'),
      ()=>submit(evolution.stage==='pause-confirm'?'continue':'cancel'));
  }

  private async openLearnMoveMenu() {
    const snapshot = this.latest, epoch = this.epoch;
    const decision = snapshot?.personal.decision.players?.subdecision ?? snapshot?.personal.decision;
    if (!decision || decision.kind !== 'learn-move' || this.seat === null
      || !decision.requiredSeats.includes(this.seat) || !this.isPersonalInputCurrent(snapshot, epoch)) return;
    const learn = decision.learn;
    const entry = this.model.applied?.personal?.party?.find((item: any) => item.id === learn?.pokemonId);
    const move = allMoves[learn?.moveId];
    if (!entry || !move) { this.setStatus('待学招式数据缺失', true); return; }
    this.clearTeamParty();
    const menuEpoch = this.teamMenuEpoch, pokemon = this.makeTeamPokemon(entry);
    let active = true, settled = false, destroyed = false;
    let step: 'prompt' | 'summary' | 'stop' | 'transition' = 'prompt';
    const current = () => active && menuEpoch === this.teamMenuEpoch && this.isPersonalInputCurrent(snapshot, epoch);
    const dispose = () => {
      if (destroyed) return;
      destroyed = true;
      this.scene.tweens?.killTweensOf(pokemon);
      if ((pokemon as any).battleInfo) this.scene.tweens?.killTweensOf((pokemon as any).battleInfo);
      pokemon.destroy();
    };
    const release = () => {
      active = false;
      this.scene.ui.getHandler?.(Mode.SUMMARY)?.clear();
      this.scene.ui.getHandler?.(Mode.CONFIRM)?.clear();
      if (settled) dispose();
    };
    this.releaseTeamParty = release;
    const recover = async (error: any) => {
      const wasCurrent = current();
      if (this.releaseTeamParty === release) this.clearTeamParty(); else if (settled) dispose();
      if (!wasCurrent) return;
      this.setStatus(`学招菜单失败：${error?.message ?? error}`, true);
      await this.scene.ui.setMode(Mode.MESSAGE);
      if (!this.isPersonalInputCurrent(snapshot, epoch) || this.teamMenuEpoch !== menuEpoch + 1) return;
      this.controls.replaceChildren(this.button('重试学招菜单', () => {
        if (this.isPersonalInputCurrent(snapshot, epoch)) return this.openDecisionInput();
      }));
    };
    const guarded = (callback: (...args: any[]) => any) => (...args: any[]) => Promise.resolve().then(() => callback(...args)).catch(recover);
    const submit = async (slot: number | null) => {
      if (!current() || step !== (slot === null ? 'stop' : 'summary')
        || !(Array.isArray(decision.options)?decision.options:decision.options[this.seat]).some((option: any) => option.kind === 'learn-move'
        && option.pokemonId === learn.pokemonId && option.slot === slot)) return;
      this.clearTeamParty();
      this.battleInputActive = false;
      await this.scene.ui.setMode(Mode.MESSAGE);
      if (!this.isPersonalInputCurrent(snapshot, epoch) || this.teamMenuEpoch !== menuEpoch + 1) return;
      await this.sendAction({ kind: 'learn-move', pokemonId: learn.pokemonId, slot }, '学招选择已提交，等待服务器确认…');
    };
    const retry = async () => {
      if (!current() || step !== 'stop') return;
      this.clearTeamParty();
      await this.scene.ui.setMode(Mode.MESSAGE);
      if (this.isPersonalInputCurrent(snapshot, epoch) && this.teamMenuEpoch === menuEpoch + 1) await this.openDecisionInput();
    };
    const stop = async () => {
      if (!current() || !['prompt', 'summary'].includes(step)) return;
      step = 'transition';
      await this.scene.ui.setMode(Mode.MESSAGE);
      if (!current()) return;
      step = 'stop';
      this.setStatus(`放弃让 ${pokemon.name} 学习 ${move.name}？`);
      await this.scene.ui.setMode(Mode.CONFIRM, guarded(() => submit(null)), guarded(retry));
    };
    try {
      pokemon.init();
      (pokemon as any).battleInfo?.setVisible(false);
      await pokemon.loadAssets();
      settled = true;
      if (!current()) { dispose(); return; }
      await this.scene.ui.setMode(Mode.MESSAGE);
      if (!current()) return;
      await this.scene.ui.setMode(Mode.CONFIRM, guarded(async () => {
        if (!current() || step !== 'prompt') return;
        step = 'transition';
        await this.scene.ui.setMode(Mode.MESSAGE);
        if (!current()) return;
        step = 'summary';
        await this.scene.ui.setMode(Mode.SUMMARY, pokemon, SummaryUiMode.LEARN_MOVE, move,
          guarded((slot: number) => step === 'summary' ? slot === 4 ? stop() : submit(slot) : undefined));
      }), guarded(() => step === 'prompt' ? stop() : undefined));
      if (!current()) return;
      this.setStatus(`是否让 ${pokemon.name} 学习 ${move.name}？`);
    } catch (error) {
      settled = true;
      await recover(error);
    }
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
    this.clearTeamParty();
    const menuEpoch = this.teamMenuEpoch;
    let consumed = false;
    const current = () => menuEpoch === this.teamMenuEpoch && this.isPersonalInputCurrent(snapshot, epoch);
    const recover = async (error: any) => {
      if (!current()) return;
      this.battleInputActive = false;
      try { await this.scene.ui.setMode(Mode.MESSAGE); } catch { /* Still attempt the original Command port. */ }
      if (!current()) return;
      this.openBattleCommand();
      this.setStatus(`投球菜单失败，未提交行动：${error?.message ?? error}，可重新选择`, true);
    };
    const choose = async (option: any | null) => {
      if (consumed || !current()) return;
      consumed = true;
      try {
        // Keep the Command gate occupied while leaving BALL. A repeated ready
        // packet must not open Command in the middle of this async transition.
        await this.scene.ui.setMode(Mode.MESSAGE);
        if (!current()) return;
        this.battleInputActive = false;
        if (!option) { this.openBattleCommand(); return; }
        await this.sendAction({ kind: 'ball', pokeballType: option.pokeballType, targetId: option.targetId },
          '已提交投球，等待服务器裁定…');
      } catch (error) { await recover(error); }
    };
    try {
      await this.scene.ui.setMode(Mode.BALL, {
        counts: { ...snapshot.personal.resources.pokeballs },
        allowed: options.map((o: any) => o.pokeballType), cancel: () => choose(null),
        select: (ball: number) => {
          const option = options.find((o: any) => o.pokeballType === ball);
          if (option) return choose(option);
        },
      });
      if (current()) this.setStatus('选择精灵球；取消可返回 Command');
    } catch (error) { await recover(error); }
  }

  private renderReserve() {
    const count = this.model?.applied?.personal?.reserve?.length ?? 0;
    this.reserveLine.hidden = count === 0;
    this.reserveLine.textContent = count ? `有 ${count} 只旧版捕获待处理，请在整备时逐只取舍。队伍最多6只。` : '';
  }

  private renderPersonalModifiers() {
    if (!this.modifierLine) return;
    const personal = this.model.applied?.personal;
    const modifiers = personal?.resources?.modifiers ?? [];
    this.modifierLine.hidden = modifiers.length === 0;
    this.modifierLine.textContent = modifiers.length ? '本人持久道具：' + modifiers.map(modifier => {
      const target = personal.party.find(entry => entry.id === modifier.pokemonId);
      return `${modifier.type.getDisplayName()} ×${modifier.stackCount}${target ? `（${getPokemonSpecies(target.pokemon.species.speciesId).name}）` : ''}`
        + (Number.isInteger(modifier.battlesLeft) ? ` 剩余${modifier.battlesLeft}战` : '');
    }).join('、') : '';
  }

  private openBattleCommand() {
    if (this.disposed) return;
    if (!this.inputReady || this.actionId || this.submitted || this.battleInputActive || this.seat === null) return;
    if (this.latest?.personal.decision.kind !== 'wait-actions'
      || !this.latest.personal.decision.requiredSeats.includes(this.seat)) return;
    if (!this.getPokemon()) return;
    this.battleInputActive = true;
    (this.scene as any).standbyPhase = this;
    const result = this.latest.events?.findLast((event: any) => event.kind === 'capture-result' && event.seat === this.seat);
    this.setStatus(result ? `${captureResultText(result)} 请选择战斗行动` : '请选择战斗行动');
    const snapshot = this.latest, epoch = this.epoch;
    void Promise.resolve(this.scene.ui.setMode(Mode.COMMAND, this.seat)).catch(error => {
      if (!this.isPersonalInputCurrent(snapshot, epoch)) return;
      this.battleInputActive = false;
      this.setStatus(`行动菜单打开失败：${error?.message ?? error}，可重新同步或退出`, true);
    });
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
    const current = () => !this.disposed && this.latest === decision && this.epoch === epoch
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
    const lifecycle = this.lifecycle, recovery = this.recoveryVersion;
    if (!this.current(lifecycle)) return;
    // An ordinary reconnect resumes this page's known seat; explicit leave has
    // already disposed the page and is never routed through this path.
    const query = new URLSearchParams(location.search);
    const resumeRoom = query.get('resumeRoom'), resumeSeat = query.get('resumeSeat');
    const explicit = query.get('fresh') !== '1' && /^[A-Z0-9]{6}$/i.test(resumeRoom ?? '') && ['0', '1'].includes(resumeSeat ?? '');
    const value = this.roomId && this.token ? { roomId: this.roomId, seat: this.seat, token: this.token }
      : explicit ? await this.storage.resumeSession(this.origin, this.session(lifecycle, recovery), resumeRoom, Number(resumeSeat))
      : autoResumePaused() ? null : await this.storage.beginSession(this.origin, this.session(lifecycle, recovery), true);
    if (!this.current(lifecycle) || recovery !== this.recoveryVersion) return;
    if (value?.roomId && value?.token) {
      if (explicit) allowAutoResume();
      this.roomId = value.roomId; this.seat = value.seat; this.token = value.token;
      this.resuming = true;
      this.send({ type: 'resumeSeat', roomId: value.roomId, resumeToken: value.token });
      return;
    }
    this.setStatus('输入房间码加入，或创建新房间');
  }

  private async createRoom() {
    if (!await this.activateSession()) return;
    this.send({ type: 'createRoom', name: `玩家${Math.floor(Math.random() * 1000)}` });
  }
  private async joinRoom(roomId: string) {
    if (roomId.length !== 6) { this.setStatus('请输入 6 位房间码', true); return; }
    if (!await this.activateSession()) return;
    this.send({ type: 'joinRoom', roomId, name: `玩家${Math.floor(Math.random() * 1000)}` });
  }

  private async activateSession() {
    const lifecycle = this.lifecycle;
    if (!this.current(lifecycle) || this.roomId || this.joining) return false;
    this.recoveryVersion++;
    this.joining = true;
    try { await this.storage.beginSession(this.origin, this.session(lifecycle)); }
    catch (error) { if (this.current(lifecycle)) this.joining = false; throw error; }
    if (!this.current(lifecycle)) return false;
    allowAutoResume();
    return true;
  }

  private async persistSeat() {
    if (this.disposed || !this.roomId || this.seat === null || !this.token) return;
    await this.storage.saveSeat(this.origin,
      { roomId: this.roomId, seat: this.seat, token: this.token, runId: this.runId }, this.session());
  }

  private async openStarterSelect() {
    if (this.disposed || this.starterOpen) return;
    const lifecycle = this.lifecycle;
    this.starterOpen = true;
    this.draftFinal = false;
    const menuEpoch = ++this.starterMenuEpoch;
    const roomId = this.roomId, runId = this.runId;
    const current = () => this.current(lifecycle) && this.roomId === roomId && this.runId === runId
      && this.starterMenuEpoch === menuEpoch;
    try {
      await this.starterTransition.catch(() => {});
      if (!current()) return;
      this.starterTransition = this.scene.ui.setMode(Mode.STARTER_SELECT, (starters: any[]) => {
        if (!current()) return;
        try {
          const profile = captureProfile(this.scene.gameData, starters);
          this.queueLobbyDraft(profile);
          this.draftFinal = true;
          this.closeStarterSelect();
          void this.flushLobbyDraft().catch(error => this.setStatus(`选队提交失败：${error?.message ?? error}`, true));
        } catch (error: any) {
          this.closeStarterSelect(); // The original callback was consumed; leave before reopening it.
          this.setStatus(`选队失败：${error?.message ?? error}`, true);
        }
      }, { gameMode: GameModes.CLASSIC,
        starters: this.lastProfile?.starters.map(restoreStarterSelection),
        onChange: (starters: any[]) => {
          if (!current() || !this.starterOpen) return;
          try { this.queueLobbyDraft(captureProfileDraft(this.scene.gameData, starters)); }
          catch (error: any) { this.setStatus(`选队草稿失败：${error?.message ?? error}`, true); }
        }, onCancel: () => {
          if (!current()) return;
          this.draftFinal = false;
          this.closeStarterSelect();
          this.setStatus('已返回大厅，可重新选队');
        } });
      await this.starterTransition;
    } catch (error) { if (current()) this.closeStarterSelect(); throw error; }
  }

  private closeStarterSelect() {
    this.starterOpen = false; this.starterMenuEpoch++;
    const lifecycle = this.lifecycle;
    this.starterTransition = this.starterTransition.catch(() => {}).then(() => this.scene.ui.setMode(Mode.MESSAGE)).catch(error => {
      if (this.current(lifecycle)) this.setStatus(`选队转场失败：${error?.message ?? error}，可重选或退出`, true);
    });
  }

  private sameProfile(left: any, right: any) { return canonical(left ?? null) === canonical(right ?? null); }

  private queueLobbyDraft(profile: any) {
    if (this.disposed || this.latest?.personal.decision.kind !== 'lobby' || this.latest.shared.ready?.[this.seat!]) return;
    if (this.lobbyDraft && this.sameProfile(this.lobbyDraft.profile, profile)) return;
    this.lastProfile = profile; this.profileDirty = true; this.draftFinal = false;
    this.lobbyDraft = { profile, retries: 0, error: null };
    this.renderDraftStatus(); this.renderLobbyControls();
    void this.flushLobbyDraft().catch(error => this.setStatus(`草稿同步失败：${error?.message ?? error}`, true));
  }

  private renderDraftStatus() {
    if (!this.lobbyDraft || this.latest?.personal.decision.kind !== 'lobby') return;
    const draft = this.lobbyDraft;
    const accepted = this.sameProfile(draft.profile, this.latest.personal.profile);
    this.setStatus(draft.error ? `${draft.error}；本地选择保留，共享剩余${this.latest.shared.budget.remaining}点，请改选或重试`
      : this.latest.shared.ready?.[this.seat!] ? '已准备，等待队友…'
      : accepted ? '选队已获服务器接受，可继续编辑或提交准备'
      : '选队待同步；公共队伍和预算以服务器已接受内容为准', !!draft.error);
  }

  private async flushLobbyDraft() {
    const draft = this.lobbyDraft;
    if (!draft || this.disposed || this.draftResync || draft.error || !this.inputReady || this.actionId
      || this.latest?.personal.decision.kind !== 'lobby' || this.latest.shared.ready?.[this.seat!]) return;
    if (this.sameProfile(draft.profile, this.latest.personal.profile)) {
      this.profileDirty = false;
      if (this.draftFinal && !this.starterOpen) {
        this.draftFinal = false;
        await this.sendAction({ kind: 'profile-ready', profile: draft.profile, ready: true }, '准备已提交，等待回执…');
      }
      return;
    }
    const saved = await this.sendAction({ kind: 'profile-draft', profile: draft.profile, ready: false }, '选队草稿已提交，等待服务器接受…');
    if (!saved && this.lobbyDraft === draft && !this.disposed) {
      draft.error = '草稿未确认提交'; this.renderDraftStatus(); this.renderLobbyControls();
    }
  }

  private async sendAction(action: any, submittedText: string) {
    const lifecycle = this.lifecycle;
    if (!this.current(lifecycle)) return false;
    if (!this.latest || this.seat === null || !this.roomId) return false;
    if (this.actionId) { this.setStatus('操作已提交，等待回执…'); return false; }
    if (!this.inputReady) { this.setStatus('正在核对双方状态，请稍后提交'); return false; }
    if (action.kind==='preparation' && this.latest.personal.decision.sharedMarket) {
      const d=this.latest.personal.decision;
      const claimed=(action.operation==='reward'?d.sharedMarket.rewardClaims:action.operation==='buy'?d.sharedMarket.shopClaims:[])
        .some((claim:any)=>claim.optionId===action.optionId);
      if (claimed || d.players.rewardResolved || action.operation==='reroll' && d.sharedMarket.rerollLocked) {
        this.clearTeamParty();this.preparationSignature='';
        await this.openPreparationMenu();this.setStatus(i18next.t(claimed?'coop:claimed':'coop:marketLocked'),true);
        return false;
      }
    }
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
      if (!this.current(lifecycle)) return false;
      this.send(message);
      this.setStatus(submittedText);
    } catch (error: any) {
      if (!this.current(lifecycle)) return false;
      if (!persisted) { this.actionId = null; this.pendingAction = null; }
      this.setStatus(`提交失败，选择已保留：${error?.message ?? error}`, true);
    }
    if (this.latest?.personal.decision.kind === 'lobby') this.renderLobbyControls();
    else if (persisted) {
      this.controls.replaceChildren();
      if (action.kind !== 'preparation' || action.operation === 'reroll') await this.scene.ui.setMode(Mode.MESSAGE);
    } else {
      this.preparationSignature = ''; this.switchSignature = '';
      await this.openDecisionInput();
    }
    return persisted;
  }

  private async sendProfile(ready: boolean, profile = this.lastProfile) {
    if (!profile || !this.latest || this.seat === null || !this.roomId) return;
    if (this.latest.personal.decision.kind !== 'lobby') return;
    if (ready && !profile.starters?.length) { this.setStatus('请至少选择一只精灵再准备', true); return; }
    if (ready && this.lobbyDraft) {
      if (this.starterOpen) { this.setStatus('请先在原选队界面确认队伍', true); return; }
      this.draftFinal = true;
      await this.flushLobbyDraft(); return;
    }
    if (!ready) profile = this.latest.personal.profile ?? profile;
    await this.sendAction({ kind: 'profile-ready', profile, ready },
      ready ? '已提交，等待回执…' : '取消准备已提交…');
  }

  private async replayOutbox() {
    const lifecycle = this.lifecycle;
    if (!this.current(lifecycle)) return;
    if (this.replayedEpoch === this.epoch || this.seat === null || !this.roomId || !this.latest) return;
    this.replayedEpoch = this.epoch;
    const pending = await this.storage.pendingActions(this.origin, this.roomId, this.seat);
    if (!this.current(lifecycle)) return;
    for (const message of pending) {
      if (message.runId !== this.runId) continue;
      this.actionId = message.actionId; this.pendingAction = message;
      this.lastProfile ??= message.action?.profile;
      if (message.action?.kind === 'profile-ready') this.profileDirty = true;
      if (message.action?.kind === 'profile-draft' && !this.lobbyDraft) {
        this.lastProfile = message.action.profile; this.profileDirty = true;
        this.lobbyDraft = { profile: message.action.profile, retries: 0, error: null };
      }
      this.send(message); // Exact persisted actionId/message, never rebase a retry.
    }
  }
}
