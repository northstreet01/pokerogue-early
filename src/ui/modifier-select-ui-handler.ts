import i18next from '../i18n';
import BattleScene, { Button } from "../battle-scene";
import { getPlayerShopModifierTypeOptionsForWave, ModifierTypeOption } from "../modifier/modifier-type";
import { getPokeballAtlasKey, PokeballType } from "../data/pokeball";
import { addTextObject, getModifierTierTextTint, getTextColor, TextStyle } from "./text";
import AwaitableUiHandler from "./awaitable-ui-handler";
import { Mode } from "./ui";
import { PokemonHeldItemModifier } from "../modifier/modifier";
import { handleTutorial, Tutorial } from "../tutorial";

export const SHOP_OPTIONS_ROW_LIMIT = 6;

export default class ModifierSelectUiHandler extends AwaitableUiHandler {
  private modifierContainer: Phaser.GameObjects.Container;
  private rerollButtonContainer: Phaser.GameObjects.Container;
  private transferButtonContainer: Phaser.GameObjects.Container;
  private rerollCostText: Phaser.GameObjects.Text;
  private completeButtonContainer: Phaser.GameObjects.Container;
  private completeButtonText: Phaser.GameObjects.Text;

  private rowCursor: integer = 0;
  private player: boolean;
  private rerollCost: integer;
  private displayGeneration = 0;
  private inputPresentation: { shopOptions?: ModifierTypeOption[]; allowReroll?: boolean; allowTransfer?: boolean;
    preparation?: { ready: boolean; rewardResolved: boolean; onComplete: () => void } } = {};

  public options: ModifierOption[];
  public shopOptionsRows: ModifierOption[][];

  private cursorObj: Phaser.GameObjects.Image;

  constructor(scene: BattleScene) {
    super(scene, Mode.CONFIRM);

    this.options = [];
    this.shopOptionsRows = [];
  }

  setup() {
    const ui = this.getUi();
    
    this.modifierContainer = this.scene.add.container(0, 0);
    ui.add(this.modifierContainer);

    this.transferButtonContainer = this.scene.add.container((this.scene.game.canvas.width / 6) - 1, -64);
    this.transferButtonContainer.setVisible(false);
    ui.add(this.transferButtonContainer);

    const transferButtonText = addTextObject(this.scene, -4, -2, i18next.t("partyUiHandler:transfer"), TextStyle.PARTY);
    transferButtonText.setOrigin(1, 0);
    this.transferButtonContainer.add(transferButtonText);
    this.bindPointer(transferButtonText, () => {
      if (!this.awaitingActionInput || !this.transferButtonContainer.visible) return false;
      this.setRowCursor(0); this.setCursor(1);
    });

    this.rerollButtonContainer = this.scene.add.container(16, -64);
    this.rerollButtonContainer.setVisible(false);
    ui.add(this.rerollButtonContainer);

    const rerollButtonText = addTextObject(this.scene, -4, -2, i18next.t("modifierSelectUiHandler:reroll"), TextStyle.PARTY);
    rerollButtonText.setOrigin(0, 0);
    this.rerollButtonContainer.add(rerollButtonText);
    this.bindPointer(rerollButtonText, () => {
      if (!this.awaitingActionInput || !this.rerollButtonContainer.visible) return false;
      this.setRowCursor(0); this.setCursor(0);
    });

    this.rerollCostText = addTextObject(this.scene, 0, 0, '', TextStyle.MONEY);
    this.rerollCostText.setOrigin(0, 0);
    this.rerollCostText.setPositionRelative(rerollButtonText, rerollButtonText.displayWidth + 5, 1);
    this.rerollButtonContainer.add(this.rerollCostText);
    this.completeButtonContainer = this.scene.add.container((this.scene.game.canvas.width / 6) - 6, -38);
    this.completeButtonContainer.setVisible(false); ui.add(this.completeButtonContainer);
    this.completeButtonText = addTextObject(this.scene, 0, 0, '', TextStyle.PARTY);
    this.completeButtonText.setOrigin(1, 0); this.completeButtonContainer.add(this.completeButtonText);
    this.bindPointer(this.completeButtonText, () => {
      if (!this.awaitingActionInput || !this.inputPresentation.preparation) return false;
      this.setRowCursor(0); this.setCursor(2);
    });
  }

  show(args: any[]): boolean {
    if (this.active) {
      if (args.length >= 3) {
        this.awaitingActionInput = true;
        this.onActionInput = args[2];
        if (args[4]?.preparation) {
          this.inputPresentation = args[4]; this.rerollCost = args[3];
          this.options.forEach(option => option.setAlpha(this.inputPresentation.preparation.rewardResolved ? 0.35 : 1));
          this.completeButtonText?.setText(this.inputPresentation.preparation.ready ? '已完成，等待伙伴（取消准备）'
            : this.inputPresentation.preparation.rewardResolved ? '本轮整备完成 [Enter]' : '领取／跳过奖励后完成整备');
          this.rerollButtonContainer.setVisible(this.inputPresentation.allowReroll !== false);
          this.updateCostText();
        }
      }
      return false;
    }

    if (![4, 5].includes(args.length) || !(args[1] instanceof Array) || !args[1].length || !(args[2] instanceof Function))
      return false;

    super.show(args);
    const generation = ++this.displayGeneration;
    this.inputPresentation = args[4] ?? {};
    this.completeButtonContainer?.setVisible(!!this.inputPresentation.preparation);
    this.completeButtonText?.setText(this.inputPresentation.preparation?.ready ? '已完成，等待伙伴（取消准备）'
      : this.inputPresentation.preparation?.rewardResolved ? '本轮整备完成 [Enter]' : '领取／跳过奖励后完成整备');

    this.getUi().clearText();

    this.player = args[0];

    const partyHasHeldItem = this.inputPresentation.allowTransfer !== false && this.player && !!this.scene.findModifiers(m => m instanceof PokemonHeldItemModifier && (m as PokemonHeldItemModifier).getTransferrable(true)).length;

    this.transferButtonContainer.setVisible(false);
    this.transferButtonContainer.setAlpha(0);

    this.rerollButtonContainer.setVisible(false);
    this.rerollButtonContainer.setAlpha(0);

    this.rerollCost = args[3] as integer;

    this.updateRerollCostText();

    const typeOptions = args[1] as ModifierTypeOption[];
    const shopTypeOptions = this.inputPresentation.shopOptions ?? (!this.scene.gameMode.hasNoShop
      ? getPlayerShopModifierTypeOptionsForWave(this.scene.currentBattle.waveIndex, this.scene.getWaveMoneyAmount(1))
      : []);
    const optionsYOffset = shopTypeOptions.length >= SHOP_OPTIONS_ROW_LIMIT ? -8 : -24;
    
    for (let m = 0; m < typeOptions.length; m++) {
      const sliceWidth = (this.scene.game.canvas.width / 6) / (typeOptions.length + 2);
      const option = new ModifierOption(this.scene, sliceWidth * (m + 1) + (sliceWidth * 0.5), -this.scene.game.canvas.height / 12 + optionsYOffset, typeOptions[m]);
      option.setScale(0.5);
      this.scene.add.existing(option);
      this.modifierContainer.add(option);
      this.options.push(option);
      if (this.inputPresentation.preparation?.rewardResolved) option.setAlpha(0.35);
      option.setSize(96, 128);
      this.bindPointer(option, () => {
        if (!this.awaitingActionInput || generation !== this.displayGeneration) return false;
        this.setRowCursor(1); this.setCursor(m);
      });
    }

    for (let m = 0; m < shopTypeOptions.length; m++) {
      const row = m < SHOP_OPTIONS_ROW_LIMIT ? 0 : 1;
      const col = m < SHOP_OPTIONS_ROW_LIMIT ? m : m - SHOP_OPTIONS_ROW_LIMIT;
      const rowOptions = shopTypeOptions.slice(row ? SHOP_OPTIONS_ROW_LIMIT : 0, row ? undefined : SHOP_OPTIONS_ROW_LIMIT);
      const sliceWidth = (this.scene.game.canvas.width / SHOP_OPTIONS_ROW_LIMIT) / (rowOptions.length + 2);
      const option = new ModifierOption(this.scene, sliceWidth * (col + 1) + (sliceWidth * 0.5), ((-this.scene.game.canvas.height / 12) - (this.scene.game.canvas.height / 32) - (40 - (28 * row - 1))), shopTypeOptions[m]);
      option.setScale(0.375);
      this.scene.add.existing(option);
      this.modifierContainer.add(option);

      if (row >= this.shopOptionsRows.length)
        this.shopOptionsRows.push([]);
      this.shopOptionsRows[row].push(option);
      option.setSize(96, 128);
      this.bindPointer(option, () => {
        if (!this.awaitingActionInput || generation !== this.displayGeneration) return false;
        this.setRowCursor(this.shopOptionsRows.length - row + 1); this.setCursor(col);
      });
    }

    const maxUpgradeCount = typeOptions.map(to => to.upgradeCount).reduce((max, current) => Math.max(current, max), 0);

    this.scene.showFieldOverlay(750);

    let i = 0;
    
    this.scene.tweens.addCounter({
      ease: 'Sine.easeIn',
      duration: 1250,
      onUpdate: t => {
        if (generation !== this.displayGeneration) return;
        const value = t.getValue();
        const index = Math.floor(value * typeOptions.length);
        if (index > i && index <= typeOptions.length) {
          const option = this.options[i];
          option?.show(Math.floor((1 - value) * 1250) * 0.325 + 2000 * maxUpgradeCount, -(maxUpgradeCount - typeOptions[i].upgradeCount));
          i++;
        }
      }
    });

    this.scene.time.delayedCall(1000 + maxUpgradeCount * 2000, () => {
      if (generation !== this.displayGeneration) return;
      for (let shopOption of this.shopOptionsRows.flat())
        shopOption.show(0, 0);
    });

    this.scene.time.delayedCall(4000 + maxUpgradeCount * 2000, () => {
      if (generation !== this.displayGeneration) return;
      if (partyHasHeldItem) {
        this.transferButtonContainer.setAlpha(0);
        this.transferButtonContainer.setVisible(true);
        this.scene.tweens.add({
          targets: this.transferButtonContainer,
          alpha: 1,
          duration: 250
        });
      }

      if (this.inputPresentation.allowReroll !== false && this.scene.currentBattle.waveIndex % 10) {
        this.rerollButtonContainer.setAlpha(0);
        this.rerollButtonContainer.setVisible(true);
        this.scene.tweens.add({
          targets: this.rerollButtonContainer,
          alpha: 1,
          duration: 250
        });
      }

      this.setCursor(0);
      this.setRowCursor(1);

      handleTutorial(this.scene, Tutorial.Select_Item).then(() => {
        if (generation !== this.displayGeneration) return;
        this.setCursor(0);
        this.awaitingActionInput = true;
        this.onActionInput = args[2];
        if (this.inputPresentation.preparation?.rewardResolved) { this.setRowCursor(0); this.setCursor(2); }
      });
    });

    return true;
  }

  processInput(button: Button): boolean {
    const ui = this.getUi();

    if (!this.awaitingActionInput)
      return false;

    let success = false;

    if (this.inputPresentation.preparation && (button === Button.SUBMIT
      || button === Button.ACTION && this.rowCursor === 0 && this.cursor === 2)) {
      this.inputPresentation.preparation.onComplete();
      ui.playSelect(); return true;
    }

    if (button === Button.ACTION) {
      success = true;
      if (this.onActionInput) {
        const originalOnActionInput = this.onActionInput;
        this.awaitingActionInput = false;
        this.onActionInput = null;
        if (!originalOnActionInput(this.rowCursor, this.cursor)) {
          this.awaitingActionInput = true;
          this.onActionInput = originalOnActionInput;
        }
      }
    } else if (button === Button.CANCEL) {
      if (this.player) {
        success = true;
        if (this.onActionInput) {
          const originalOnActionInput = this.onActionInput;
          this.awaitingActionInput = false;
          this.onActionInput = null;
          if (originalOnActionInput(-1) === false) {
            this.awaitingActionInput = true;
            this.onActionInput = originalOnActionInput;
          }
        }
      }
    } else {
      switch (button) {
        case Button.UP:
          if (this.rowCursor < this.shopOptionsRows.length + 1)
            success = this.setRowCursor(this.rowCursor + 1);
          break;
        case Button.DOWN:
          if (this.rowCursor)
            success = this.setRowCursor(this.rowCursor - 1);
          break;
        case Button.LEFT:
          if (!this.rowCursor && this.inputPresentation.preparation) {
            const previous = [0, 1, 2].filter(index => index < this.cursor
              && (index === 0 ? this.rerollButtonContainer.visible : index === 1 ? this.transferButtonContainer.visible : true)).at(-1);
            if (previous !== undefined) success = this.setCursor(previous);
          } else if (!this.rowCursor)
            success = this.rerollButtonContainer.visible && this.setCursor(0);
          else if (this.cursor)
            success = this.setCursor(this.cursor - 1);
          else if (this.rowCursor === 1 && this.rerollButtonContainer.visible)
            success = this.setRowCursor(0);
          break;
        case Button.RIGHT:
          if (!this.rowCursor && this.inputPresentation.preparation) {
            const next = [0, 1, 2].find(index => index > this.cursor
              && (index === 0 ? this.rerollButtonContainer.visible : index === 1 ? this.transferButtonContainer.visible : true));
            if (next !== undefined) success = this.setCursor(next);
          } else if (!this.rowCursor)
            success = this.transferButtonContainer.visible && this.setCursor(1);
          else if (this.cursor < this.getRowItems(this.rowCursor) - 1)
            success = this.setCursor(this.cursor + 1);
          else if (this.rowCursor === 1 && this.transferButtonContainer.visible)
            success = this.setRowCursor(0);
          break;
      }
    }

    if (success)
      ui.playSelect();

    return success;
  }

  setCursor(cursor: integer): boolean {
    const ui = this.getUi();
    const ret = super.setCursor(cursor);

    if (!this.cursorObj) {
      this.cursorObj = this.scene.add.image(0, 0, 'cursor');
      this.modifierContainer.add(this.cursorObj);
    }

    const options = (this.rowCursor === 1 ? this.options : this.shopOptionsRows[this.shopOptionsRows.length - (this.rowCursor - 1)]);

    this.cursorObj.setScale(this.rowCursor === 1 ? 2 : this.rowCursor >= 2 ? 1.5 : 1);

    if (this.rowCursor) {
      let sliceWidth = (this.scene.game.canvas.width / 6) / (options.length + 2);
      if (this.rowCursor < 2)
        this.cursorObj.setPosition(sliceWidth * (cursor + 1) + (sliceWidth * 0.5) - 20, (-this.scene.game.canvas.height / 12) - (this.shopOptionsRows.length > 1 ? 6 : 22));
      else
        this.cursorObj.setPosition(sliceWidth * (cursor + 1) + (sliceWidth * 0.5) - 16, (-this.scene.game.canvas.height / 12 - this.scene.game.canvas.height / 32) - (-16 + 28 * (this.rowCursor - (this.shopOptionsRows.length - 1))));
      ui.showText(options[this.cursor].modifierTypeOption.type.getDescription(this.scene));
    } else if (!cursor) {
      this.cursorObj.setPosition(6, -60);
      ui.showText('Spend money to reroll your item options');
    } else if (this.cursor === 2 && this.inputPresentation.preparation) {
      this.cursorObj.setPosition((this.scene.game.canvas.width / 6) - 120, -34);
      ui.showText(this.inputPresentation.preparation.ready ? '本人已完成，等待伙伴；确认可取消准备'
        : this.inputPresentation.preparation.rewardResolved ? '购物结束后确认本轮整备完成' : '请先领取或跳过本人奖励');
    } else {
      this.cursorObj.setPosition((this.scene.game.canvas.width / 6) - 50, -60);
      ui.showText('Transfer a held item from one Pokémon to another');
    }

    return ret;
  }

  setRowCursor(rowCursor: integer): boolean {
    const lastRowCursor = this.rowCursor;

    if (rowCursor !== lastRowCursor && (rowCursor || this.rerollButtonContainer.visible || this.transferButtonContainer.visible || this.inputPresentation.preparation)) {
      this.rowCursor = rowCursor;
      let newCursor = Math.round(this.cursor / Math.max(this.getRowItems(lastRowCursor) - 1, 1) * (this.getRowItems(rowCursor) - 1));
      if (!rowCursor) {
        if (this.inputPresentation.preparation && !this.rerollButtonContainer.visible && !this.transferButtonContainer.visible) newCursor = 2;
        else if (!newCursor && !this.rerollButtonContainer.visible)
          newCursor = 1;
        else if (newCursor && !this.transferButtonContainer.visible)
          newCursor = 0;
      }
      this.cursor = -1;
      this.setCursor(newCursor);
      return true;
    }

    return false;
  }

  private getRowItems(rowCursor: integer): integer {
    switch (rowCursor) {
      case 0:
        return this.inputPresentation.preparation ? 3 : 2;
      case 1:
        return this.options.length;
      default:
        return this.shopOptionsRows[this.shopOptionsRows.length - (rowCursor - 1)].length;
    }
  }

  updateCostText(): void {
    const shopOptions = this.shopOptionsRows.flat();
    for (let shopOption of shopOptions)
      shopOption.updateCostText();

    this.updateRerollCostText();
  }

  updateRerollCostText(): void {
    const canReroll = this.scene.money >= this.rerollCost;

    this.rerollCostText.setText(`₽${this.rerollCost.toLocaleString('en-US')}`);
    this.rerollCostText.setColor(getTextColor(canReroll ? TextStyle.MONEY : TextStyle.PARTY_RED));
    this.rerollCostText.setShadowColor(getTextColor(canReroll ? TextStyle.MONEY : TextStyle.PARTY_RED, true));
  }

  clear() {
    ++this.displayGeneration;
    super.clear();

    this.awaitingActionInput = false;
    this.onActionInput = null;
    this.completeButtonContainer?.setVisible(false);
    this.getUi().clearText();
    this.eraseCursor();

    this.scene.hideFieldOverlay(250);

    const options = this.options.concat(this.shopOptionsRows.flat());
    this.options.splice(0, this.options.length);
    this.shopOptionsRows.splice(0, this.shopOptionsRows.length);
  
    this.scene.tweens.add({
      targets: options,
      scale: 0.01,
      duration: 250,
      ease: 'Cubic.easeIn',
      onComplete: () => options.forEach(o => o.destroy())
    });
    
    [ this.rerollButtonContainer, this.transferButtonContainer ].forEach(container => {
      if (container.visible) {
        this.scene.tweens.add({
          targets: container,
          alpha: 0,
          duration: 250,
          ease: 'Cubic.easeIn',
          onComplete: () => {
            if (!this.options.length)
              container.setVisible(false);
            else
              container.setAlpha(1);
          }
        });
      }
    });
  }

  eraseCursor() {
    if (this.cursorObj)
      this.cursorObj.destroy();
    this.cursorObj = null;
  }
}

class ModifierOption extends Phaser.GameObjects.Container {
  public modifierTypeOption: ModifierTypeOption;
  private pb: Phaser.GameObjects.Sprite;
  private pbTint: Phaser.GameObjects.Sprite;
  private itemContainer: Phaser.GameObjects.Container;
  private item: Phaser.GameObjects.Sprite;
  private itemTint: Phaser.GameObjects.Sprite;
  private itemText: Phaser.GameObjects.Text;
  private itemCostText: Phaser.GameObjects.Text;

  constructor(scene: BattleScene, x: number, y: number, modifierTypeOption: ModifierTypeOption) {
    super(scene, x, y);

    this.modifierTypeOption = modifierTypeOption;

    this.setup();
  }

  setup() {
    if (!this.modifierTypeOption.cost) {
      const getPb = (): Phaser.GameObjects.Sprite => {
        const pb = this.scene.add.sprite(0, -182, 'pb', this.getPbAtlasKey(-this.modifierTypeOption.upgradeCount));
        pb.setScale(2);
        return pb;
      };

      this.pb = getPb();
      this.add(this.pb);

      this.pbTint = getPb();
      this.pbTint.setVisible(false);
      this.add(this.pbTint);
    }

    this.itemContainer = this.scene.add.container(0, 0);
    this.itemContainer.setScale(0.5);
    this.itemContainer.setAlpha(0);
    this.add(this.itemContainer);

    const getItem = () => {
      const item = this.scene.add.sprite(0, 0, 'items', this.modifierTypeOption.type.iconImage);
      return item;
    };

    this.item = getItem();
    this.itemContainer.add(this.item);

    if (!this.modifierTypeOption.cost) {
      this.itemTint = getItem();
      this.itemTint.setTintFill(Phaser.Display.Color.GetColor(255, 192, 255));
      this.itemContainer.add(this.itemTint);
    }

    this.itemText = addTextObject(this.scene, 0, 35, this.modifierTypeOption.type.name, TextStyle.PARTY, { align: 'center' });
    this.itemText.setOrigin(0.5, 0);
    this.itemText.setAlpha(0);
    this.itemText.setTint(getModifierTierTextTint(this.modifierTypeOption.type.tier));
    this.add(this.itemText);

    if (this.modifierTypeOption.cost) {
      this.itemCostText = addTextObject(this.scene, 0, 45, '', TextStyle.MONEY, { align: 'center' });
    
      this.itemCostText.setOrigin(0.5, 0);
      this.itemCostText.setAlpha(0);
      this.add(this.itemCostText);

      this.updateCostText();
    }
  }

  show(remainingDuration: integer, upgradeCountOffset: integer) {
    if (!this.modifierTypeOption.cost) {
      this.scene.tweens.add({
        targets: this.pb,
        y: 0,
        duration: 1250,
        ease: 'Bounce.Out'
      });

      let lastValue = 1;
      let bounceCount = 0;
      let bounce = false;

      this.scene.tweens.addCounter({
        from: 1,
        to: 0,
        duration: 1250,
        ease: 'Bounce.Out',
        onUpdate: t => {
          if (!this.scene)
            return;
          const value = t.getValue();
          if (!bounce && value > lastValue) {
            (this.scene as BattleScene).playSound('pb_bounce_1', { volume: 1 / ++bounceCount });
            bounce = true;
          } else if (bounce && value < lastValue)
            bounce = false;
          lastValue = value;
        }
      });

      for (let u = 0; u < this.modifierTypeOption.upgradeCount; u++) {
        const upgradeIndex = u;
        this.scene.time.delayedCall(remainingDuration - 2000 * (this.modifierTypeOption.upgradeCount - (upgradeIndex + 1 + upgradeCountOffset)), () => {
          (this.scene as BattleScene).playSound('upgrade', { rate: 1 + 0.25 * upgradeIndex });
          this.pbTint.setPosition(this.pb.x, this.pb.y);
          this.pbTint.setTintFill(0xFFFFFF);
          this.pbTint.setAlpha(0);
          this.pbTint.setVisible(true);
          this.scene.tweens.add({
            targets: this.pbTint,
            alpha: 1,
            duration: 1000,
            ease: 'Sine.easeIn',
            onComplete: () => {
              this.pb.setTexture('pb', this.getPbAtlasKey(-this.modifierTypeOption.upgradeCount + (upgradeIndex + 1)));
              this.scene.tweens.add({
                targets: this.pbTint,
                alpha: 0,
                duration: 750,
                ease: 'Sine.easeOut',
                onComplete: () => {
                  this.pbTint.setVisible(false);
                }
              });
            }
          });
        });
      }
    }

    this.scene.time.delayedCall(remainingDuration + 2000, () => {
      if (!this.scene)
        return;

      if (!this.modifierTypeOption.cost) {
        this.pb.setTexture('pb', `${this.getPbAtlasKey(0)}_open`);
        (this.scene as BattleScene).playSound('pb_rel');
        
        this.scene.tweens.add({
          targets: this.pb,
          duration: 500,
          delay: 250,
          ease: 'Sine.easeIn',
          alpha: 0,
          onComplete: () => this.pb.destroy()
        });
      }

      this.scene.tweens.add({
        targets: this.itemContainer,
        duration: 500,
        ease: 'Elastic.Out',
        scale: 2,
        alpha: 1
      });
      if (!this.modifierTypeOption.cost) {
        this.scene.tweens.add({
          targets: this.itemTint,
          alpha: 0,
          duration: 500,
          ease: 'Sine.easeIn',
          onComplete: () => this.itemTint.destroy()
        });
      }
      this.scene.tweens.add({
        targets: this.itemText,
        duration: 500,
        alpha: 1,
        y: 25,
        ease: 'Cubic.easeInOut'
      });
      if (this.itemCostText) {
        this.scene.tweens.add({
          targets: this.itemCostText,
          duration: 500,
          alpha: 1,
          y: 35,
          ease: 'Cubic.easeInOut'
        });
      }
    });
  }

  getPbAtlasKey(tierOffset: integer = 0) {
    return getPokeballAtlasKey((this.modifierTypeOption.type.tier + tierOffset) as integer as PokeballType);
  }

  updateCostText(): void {
    const textStyle = this.modifierTypeOption.cost <= (this.scene as BattleScene).money ? TextStyle.MONEY : TextStyle.PARTY_RED;

    this.itemCostText.setText(`₽${this.modifierTypeOption.cost.toLocaleString('en-US')}`);
    this.itemCostText.setColor(getTextColor(textStyle));
    this.itemCostText.setShadowColor(getTextColor(textStyle, true));
  }
}
