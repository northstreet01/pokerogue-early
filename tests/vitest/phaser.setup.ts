import Phaser from "phaser";

// Math tests need the original seeded RNG, not a running game or asset loader.
Phaser.Math.RND = new Phaser.Math.RandomDataGenerator(['vitest']);
