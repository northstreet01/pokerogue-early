import BattleScene, { Button } from "../battle-scene";
import UI, { Mode } from "./ui";

export default abstract class UiHandler {
  protected scene: BattleScene;
  protected mode: integer;
  protected cursor: integer = 0;
  public active: boolean = false;
  private pointerBindings = new WeakMap<Phaser.GameObjects.GameObject, Function>();

  constructor(scene: BattleScene, mode: Mode) {
    this.scene = scene;
    this.mode = mode;
  }

  abstract setup(): void;

  show(_args: any[]): boolean {
    this.active = true;

    return true;
  }

  abstract processInput(button: Button): boolean;

  getUi() {
    return this.scene.ui;
  }

  getCursor(): integer {
    return this.cursor;
  }

  setCursor(cursor: integer): boolean {
    const changed = this.cursor !== cursor;
    if (changed)
      this.cursor = cursor;

    return changed;
  }

  /** Phaser performs the hit test in the object's transformed local space. */
  protected bindPointer(target: Phaser.GameObjects.GameObject,
    select: (pointer: Phaser.Input.Pointer, x: number, y: number) => boolean | void,
    button: Button | null = Button.ACTION) {
    target.setInteractive({ useHandCursor: true });
    const old = this.pointerBindings.get(target);
    if (old) target.off('pointerup', old);
    const onClick = (pointer: Phaser.Input.Pointer, x: number, y: number, event: Phaser.Types.Input.EventData) => {
      if (pointer.button !== 0) return;
      if (this.getUi().processPointerInput(this, () => select(pointer, x, y), button))
        event?.stopPropagation();
    };
    this.pointerBindings.set(target, onClick);
    target.on('pointerup', onClick);
  }

  clear() {
    this.active = false;
  }
}
