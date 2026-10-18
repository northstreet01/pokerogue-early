// Server-only display boundary. Original rule classes are bundled unchanged;
// rendering and rex UI must never execute on an authoritative Node worker.
// Unknown display operations throw, rather than silently completing a phase.
import RandomDataGenerator from 'phaser/src/math/random-data-generator/RandomDataGenerator.js';
import Linear from 'phaser/src/math/Linear.js';
import BlendModes from 'phaser/src/renderer/BlendModes.js';
import GetEaseFunction from 'phaser/src/tweens/builders/GetEaseFunction.js';

export class PresentationUnavailable extends Error {
  constructor() { super('HEADLESS_PRESENTATION_UNAVAILABLE'); this.code = this.message; }
}
export function unavailable() { throw new PresentationUnavailable(); }
class DisplayOnly { constructor() { unavailable(); } }

// Pokemon's original constructor only needs Container's scene/position. A
// detached checkpoint is already not a display object (see pokemon.ts/M2).
// Keep the child list explicit for field membership; do not emulate sprites.
export class RuleContainer {
  constructor(scene, x = 0, y = 0) { this.scene = scene; this.x = x; this.y = y; this.list = []; }
  getIndex(child) { return this.list.indexOf(child); }
  add(child) { this.list.push(...(Array.isArray(child) ? child : [child])); return this; }
  remove(child) { const index = this.getIndex(child); if (index >= 0) this.list.splice(index, 1); return this; }
}
class RuleScene { constructor(key) { this.headlessKey = key; } }

export const Phaser = Object.freeze({
  Scene: RuleScene,
  GameObjects: Object.freeze({ Container: RuleContainer, GameObject: DisplayOnly, Sprite: DisplayOnly,
    Image: DisplayOnly, Text: DisplayOnly, Rectangle: DisplayOnly, NineSlice: DisplayOnly }),
  Math: Object.freeze({ RandomDataGenerator, Linear, get RND() { unavailable(); } }),
  Tweens: Object.freeze({ Builders: Object.freeze({ GetEaseFunction }) }),
  Renderer: Object.freeze({ WebGL: Object.freeze({ Pipelines: Object.freeze({ MultiPipeline: DisplayOnly, PostFXPipeline: DisplayOnly }) }) }),
  BlendModes: Object.freeze(BlendModes),
  Loader: Object.freeze({ Events: Object.freeze({ COMPLETE: 'complete' }) })
});
// Some early modules use the browser global Phaser instead of importing it.
// This module is confined to the dedicated rule worker / server bundle.
globalThis.Phaser = Phaser;
export default Phaser;
