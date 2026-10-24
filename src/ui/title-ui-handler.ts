import BattleScene from "../battle-scene";
import { DailyRunScoreboard } from "./daily-run-scoreboard";
import OptionSelectUiHandler from "./option-select-ui-handler";
import { Mode } from "./ui";
import * as Utils from "../utils";
import { TextStyle, addTextObject } from "./text";
import { splashMessages } from "../data/splash-messages";
import i18next from '../i18n';

export default class TitleUiHandler extends OptionSelectUiHandler {
  private titleContainer: Phaser.GameObjects.Container;
  private dailyRunScoreboard: DailyRunScoreboard;
  private playerCountLabel: Phaser.GameObjects.Text;
  private titleLogo: Phaser.GameObjects.Image;
  private homeHeading: Phaser.GameObjects.Text;
  private splashMessage: Phaser.GameObjects.Text;

  private playerCountTimer;

  constructor(scene: BattleScene, mode: Mode = Mode.TITLE) {
    super(scene, mode);
  }

  setup() {
    super.setup();

    const ui = this.getUi();

    this.titleContainer = this.scene.add.container(0, -(this.scene.game.canvas.height / 6));
    this.titleContainer.setAlpha(0);
    ui.add(this.titleContainer);

    const logo = this.scene.add.image((this.scene.game.canvas.width / 6) / 2, 8, 'logo');
    logo.setOrigin(0.5, 0);
    this.titleLogo = logo;
    this.titleContainer.add(logo);
    this.homeHeading = addTextObject(this.scene, 160, 16, '宝可梦肉鸽 · 初始界面', TextStyle.MESSAGE);
    this.homeHeading.setOrigin(0.5, 0); this.homeHeading.setVisible(false); this.titleContainer.add(this.homeHeading);

    this.splashMessage = addTextObject(this.scene, logo.x + 64, logo.y + logo.displayHeight - 8, '', TextStyle.MONEY, { fontSize: '54px' });
    this.splashMessage.setOrigin(0.5, 0.5);
    this.splashMessage.setAngle(-20)
    this.titleContainer.add(this.splashMessage);

    this.dailyRunScoreboard = new DailyRunScoreboard(this.scene, 1, 44);
		this.dailyRunScoreboard.setup();

    this.titleContainer.add(this.dailyRunScoreboard);

    this.playerCountLabel = addTextObject(this.scene, (this.scene.game.canvas.width / 6) - 2, (this.scene.game.canvas.height / 6) - 90, i18next.t('earlyBattle:localSolo'), TextStyle.MESSAGE, { fontSize: '54px' });
    this.playerCountLabel.setOrigin(1, 0);
    this.titleContainer.add(this.playerCountLabel);

    const originalSplashMessageScale = this.splashMessage.scale;

    this.scene.tweens.add({
      targets: this.splashMessage,
      duration: Utils.fixedInt(350),
      scale: originalSplashMessageScale * 1.25,
      loop: -1,
      yoyo: true,
    })
  }

  updatePlayerCount(): void {
    this.playerCountLabel.setText(this.config?.contextLabel ?? i18next.t('earlyBattle:localSolo'));
    this.playerCountLabel.setY(this.config?.contextLabel ? 80 : 90);
  }

  show(args: any[]): boolean {
    const ret = super.show(args);

    if (ret) {
      const splash=Utils.randItem(splashMessages.map((message,index)=>({message,index})));
      this.splashMessage.setText(i18next.t(`earlySplash:${splash.index}`,{defaultValue:splash.message}));

      const ui = this.getUi();

      this.dailyRunScoreboard.setVisible(false);

      this.titleLogo?.setVisible(!this.config?.contextLabel);
      this.splashMessage.setVisible(!this.config?.contextLabel);
      this.homeHeading?.setVisible(!!this.config?.contextLabel);
      this.updatePlayerCount();

      this.playerCountTimer = setInterval(() => this.updatePlayerCount(), 10000);

      this.scene.tweens.add({
        targets: [ this.titleContainer, ui.getMessageHandler().bg ],
        duration: Utils.fixedInt(325),
        alpha: (target: any) => target === this.titleContainer ? 1 : 0,
        ease: 'Sine.easeInOut'
      });
    }

    return ret;
  }

  clear(): void {
    super.clear();

    const ui = this.getUi();

    clearInterval(this.playerCountTimer);
    this.playerCountTimer = null;

    this.scene.tweens.add({
      targets: [ this.titleContainer, ui.getMessageHandler().bg ],
      duration: Utils.fixedInt(325),
      alpha: (target: any) => target === this.titleContainer ? 0 : 1,
      ease: 'Sine.easeInOut'
    });
  }
}
