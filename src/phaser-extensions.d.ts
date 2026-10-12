import 'phaser';

declare module 'phaser' {
  namespace GameObjects {
    interface GameObject {
      setPositionRelative(guide: GameObject, x: number, y: number): this;
    }
  }
}
