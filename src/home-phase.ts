import type BattleScene from './battle-scene';
import { bypassLogin } from './battle-scene';
import { Phase } from './phase';
import { LoginPhase, ConsolidateDataPhase, TitlePhase } from './phases';
import { Mode } from './ui/ui';
import type { OptionSelectItem } from './ui/abstact-option-select-ui-handler';
import CoopPlayPhase from './coop/play-phase';
import { createPlayStorage } from './coop/play-storage.mjs';
import { GameData } from './system/game-data';

/** Root has no login/save/room side effects. Direct game entries retain login. */
export function entryPhases(scene: BattleScene, coop: boolean, solo: boolean): Phase[] {
  if (!coop && !solo) return [new HomePhase(scene)];
  return [new LoginPhase(scene), ...(!bypassLogin ? [new ConsolidateDataPhase(scene)] : []),
    coop ? new CoopPlayPhase(scene) : new TitlePhase(scene)];
}

export class HomePhase extends Phase {
  private epoch = 0;
  private disposed = false;
  private transitions: Promise<void> = Promise.resolve();
  private returnButton?: HTMLButtonElement;
  private originalData?: GameData;

  start(): void {
    super.start();
    this.scene.fadeOutBgm(0, false);
    this.scene.ui.fadeIn(250);
    const button = document.createElement('button');
    button.type = 'button'; button.textContent = '返回初始界面';
    button.id = 'home-return';
    Object.assign(button.style, { position: 'fixed', bottom: '8px', left: '8px', zIndex: '999',
      padding: '8px 12px', maxWidth: '90vw', font: '14px system-ui' });
    for (const name of ['keydown', 'keyup']) button.addEventListener(name, event => event.stopPropagation());
    button.addEventListener('click', () => { void this.showHome(); });
    document.body.append(button); this.returnButton = button;
    this.scene.events.once('shutdown', () => this.dispose());
    void this.showHome();
  }

  private current(epoch: number): boolean { return !this.disposed && epoch === this.epoch; }

  private dispose(): void {
    this.disposed = true; this.epoch++;
    this.returnButton?.remove();
    this.releaseView();
  }

  private releaseView(): void {
    if (this.originalData) { this.scene.gameData = this.originalData; this.originalData = undefined; }
  }

  private navigate(url: string): void {
    this.dispose();
    location.assign(url);
  }

  /** Serialize original UI fades; late completions cannot cover the next view. */
  private display(epoch: number, mode: Mode, args: any[], view?: GameData): Promise<void> {
    const transition = this.transitions.catch(() => {}).then(async () => {
      if (!this.current(epoch)) return;
      await this.scene.ui.setMode(Mode.MESSAGE);
      this.releaseView();
      if (!this.current(epoch)) return;
      this.scene.ui.clearText();
      if (view) { this.originalData = this.scene.gameData; this.scene.gameData = view; }
      await this.scene.ui.setMode(mode, ...args);
    });
    this.transitions = transition;
    return transition;
  }

  private menu(epoch: number, items: [string, () => void][]): Promise<void> {
    const options: OptionSelectItem[] = items.map(([label, action]) => {
      let used = false;
      return { label, keepOpen: true, handler: () => {
        if (!this.current(epoch) || used) return;
        used = true; action();
      } };
    });
    return this.display(epoch, Mode.TITLE, [{ options, noCancel: true, maxOptions: 4, yOffset: 47,
      contextLabel: '选择冒险 / 个人资料' }]);
  }

  showHome(): Promise<void> {
    const epoch = ++this.epoch;
    return this.menu(epoch, [
      ['单人冒险', () => this.navigate('/?solo=1')],
      ['联机冒险', () => this.navigate('/coop-play.html?fresh=1')],
      ['恢复已有联机', () => { void this.showRecovery(); }],
      ['个人收藏 / 蛋 / 券', () => { void this.showPersonal(); }],
    ]);
  }

  private showPersonal(): Promise<void> {
    const epoch = ++this.epoch;
    return this.menu(epoch, [
      ['我的收藏', () => { void this.browse(Mode.STARTER_SELECT); }],
      ['我的未孵化蛋', () => { void this.browse(Mode.EGG_LIST); }],
      ['我的蛋券', () => { void this.browse(Mode.EGG_GACHA); }],
      ['返回初始界面', () => { void this.showHome(); }],
    ]);
  }

  private async browse(mode: Mode): Promise<void> {
    const epoch = ++this.epoch;
    await this.menu(epoch, [['正在读取，返回', () => { void this.showHome(); }]]);
    try {
      // Original parsing/consolidation runs on an isolated view. A late load may
      // finish after return, but cannot mutate the scene's live personal data.
      const view = new GameData(this.scene, { readOnly: true });
      const exists = await view.loadSystem({ readOnly: true });
      if (!this.current(epoch)) return;
      if (!exists) {
        await this.menu(epoch, [['尚无个人资料，返回', () => { void this.showHome(); }]]);
        return;
      }
      const onCancel = () => { if (this.current(epoch)) void this.showHome(); };
      const options = { readOnly: true, onCancel };
      await this.display(epoch, mode, mode === Mode.STARTER_SELECT ? [() => {}, options] : [options], view);
    } catch {
      if (this.current(epoch)) await this.menu(epoch, [
        ['个人资料读取失败，重试', () => { void this.browse(mode); }],
        ['返回初始界面', () => { void this.showHome(); }],
      ]);
    }
  }

  private async showRecovery(): Promise<void> {
    const epoch = ++this.epoch;
    await this.menu(epoch, [['正在读取，返回', () => { void this.showHome(); }]]);
    try {
      const seats = await createPlayStorage().listSeats(location.origin);
      if (!this.current(epoch)) return;
      await this.menu(epoch, [
        ...seats.map(value => [`房间 ${value.roomId} · 玩家${value.seat + 1}`, () =>
          this.navigate(`/coop-play.html?resumeRoom=${encodeURIComponent(value.roomId)}&resumeSeat=${value.seat}`)] as [string, () => void]),
        [seats.length ? '返回初始界面' : '没有可恢复席位，返回', () => { void this.showHome(); }],
      ]);
    } catch {
      if (this.current(epoch)) await this.menu(epoch, [
        ['读取失败，重试', () => { void this.showRecovery(); }],
        ['返回初始界面', () => { void this.showHome(); }],
      ]);
    }
  }
}
