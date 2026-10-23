import BattleScene from "../battle-scene";
import { PokeballType } from "../data/pokeball";
import * as Utils from "../utils";
import { presentOnHost } from '../battle-core/presentation-port.mjs';

export function addPokeballOpenParticles(scene: BattleScene, x: number, y: number, pokeballType: PokeballType, signal?: AbortSignal): void {
  if (presentOnHost(scene, 'pokeball-open', { x, y, pokeballType })) return;
  if (signal?.aborted) return;
  const scope = signal ? new ParticleLifetime(scene, signal) : undefined;
  switch (pokeballType) {
    case PokeballType.POKEBALL:
      doDefaultPbOpenParticles(scene, x, y, 48, scope);
      break;
    case PokeballType.GREAT_BALL:
      doDefaultPbOpenParticles(scene, x, y, 96, scope);
      break;
    case PokeballType.ULTRA_BALL:
      doUbOpenParticles(scene, x, y, 8, scope);
      break;
    case PokeballType.ROGUE_BALL:
      doUbOpenParticles(scene, x, y, 10, scope);
      break;
    case PokeballType.MASTER_BALL:
      doMbOpenParticles(scene, x, y, scope);
      break;
  }
}

function doDefaultPbOpenParticles(scene: BattleScene, x: number, y: number, radius: number, scope?: ParticleLifetime) {
  const pbOpenParticlesFrameNames = scene.anims.generateFrameNames('pb_particles', { start: 0, end: 3, suffix: '.png' });
  scene.anims.create({
    key: 'pb_open_particle',
    frames: pbOpenParticlesFrameNames,
    frameRate: 16,
    repeat: -1
  });

  const addParticle = (index: integer) => {
    if (scope?.aborted) return;
    const particle = scene.add.sprite(x, y, 'pb_open_particle');
    scope?.sprite(particle);
    scene.field.add(particle);
    const angle = index * 45;
    const [ xCoord, yCoord ] = [ radius * Math.cos(angle * Math.PI / 180), radius * Math.sin(angle * Math.PI / 180) ];
    scene.tweens.add({
      targets: particle,
      x: x + xCoord,
      y: y + yCoord,
      duration: 575
    });
    particle.play({
      key: 'pb_open_particle',
      startFrame: (index + 3) % 4,
      frameRate: Math.floor(16 * scene.gameSpeed)
    });
    scene.tweens.add({
      targets: particle,
      delay: 500,
      duration: 75,
      alpha: 0,
      ease: 'Sine.easeIn',
      onComplete: () => particle.destroy()
    });
  };

  let particleCount = 0;
  scene.time.addEvent({
    delay: 20,
    repeat: 16,
    callback: () => addParticle(++particleCount)
  });
}

function doUbOpenParticles(scene: BattleScene, x: number, y: number, frameIndex: integer, scope?: ParticleLifetime) {
  let particles: Phaser.GameObjects.Image[] = [];
  for (let i = 0; i < 10; i++)
    particles.push(doFanOutParticle(scene, i * 25, x, y, 1, 1, 5, frameIndex, scope));

  scene.tweens.add({
    targets: particles,
    delay: 750,
    duration: 250,
    alpha: 0,
    ease: 'Sine.easeIn',
    onComplete: () => {
      for (let particle of particles)
        particle.destroy();
    }
  });
}

function doMbOpenParticles(scene: BattleScene, x: number, y: number, scope?: ParticleLifetime) {
  let particles: Phaser.GameObjects.Image[] = [];
  for (let j = 0; j < 2; j++) {
    for (let i = 0; i < 8; i++)
      particles.push(doFanOutParticle(scene, i * 32, x, y, j ? 1 : 2, j ? 2 : 1, 8, 4, scope));

    scene.tweens.add({
      targets: particles,
      delay: 750,
      duration: 250,
      alpha: 0,
      ease: 'Sine.easeIn',
      onComplete: () => {
        for (let particle of particles)
          particle.destroy();
      }
    });
  }
}

function doFanOutParticle(scene: BattleScene, trigIndex: integer, x: integer, y: integer, xSpeed: integer, ySpeed: integer, angle: integer, frameIndex: integer, scope?: ParticleLifetime): Phaser.GameObjects.Image {
  let f = 0; 

  const particle = scene.add.image(x, y, 'pb_particles', `${frameIndex}.png`);
  scope?.sprite(particle);
  scene.field.add(particle);
  
  const updateParticle = () => {
    if (!particle.scene)
      return particleTimer.remove();
    particle.x = x + sin(trigIndex, f * xSpeed);
    particle.y = y + cos(trigIndex, f * ySpeed);
    trigIndex = (trigIndex + angle);
    f++;
  };

  const particleTimer = scene.tweens.addCounter({
    repeat: -1,
    duration: Utils.getFrameMs(1),
    onRepeat: () => {
      updateParticle();
    }
  });

  return particle;
}

export function addPokeballCaptureStars(scene: BattleScene, pokeball: Phaser.GameObjects.Sprite): void {
  if (presentOnHost(scene, 'pokeball-capture-stars', {})) return;
  const addParticle = () => {
    const particle = scene.add.sprite(pokeball.x, pokeball.y, 'pb_particles', '4.png');
    particle.setOrigin(pokeball.originX, pokeball.originY);
    particle.setAlpha(0.5);
    scene.field.add(particle);

    scene.tweens.add({
      targets: particle,
      y: pokeball.y - 10,
      ease: 'Sine.easeOut',
      duration: 250,
      onComplete: () => {
        scene.tweens.add({
          targets: particle,
          y: pokeball.y,
          alpha: 0,
          ease: 'Sine.easeIn',
          duration: 250
        });
      }
    });

    const dist = Utils.randGauss(25);
    scene.tweens.add({
      targets: particle,
      x: pokeball.x + dist,
      duration: 500
    });

    scene.tweens.add({
      targets: particle,
      alpha: 0,
      delay: 425,
      duration: 75,
      onComplete: () => particle.destroy()
    });
  };

  new Array(3).fill(null).map(() => addParticle());
}

export function sin(index: integer, amplitude: integer): number {
  return amplitude * Math.sin(index * (Math.PI / 128));
}

export function cos(index: integer, amplitude: integer): number {
  return amplitude * Math.cos(index * (Math.PI / 128));
}

/** Only the optional cooperative lifetime owns these original visual resources. */
class ParticleLifetime {
  aborted = false;
  private sprites: Phaser.GameObjects.GameObject[] = [];
  private timers: Phaser.Time.TimerEvent[] = [];
  private counters: Phaser.Tweens.Tween[] = [];
  constructor(private scene: BattleScene, signal: AbortSignal) {
    const cancel = () => {
      this.aborted = true;
      this.timers.forEach(timer => timer.remove());
      this.counters.forEach(tween => tween.stop());
      this.sprites.forEach(sprite => { scene.tweens.killTweensOf(sprite); if (sprite.scene) sprite.destroy(); });
    };
    signal.addEventListener('abort', cancel, { once: true });
    // Original particles have all expired by 1000 ms; release the abort listener.
    const release = scene.time.delayedCall(1500, () => signal.removeEventListener('abort', cancel));
    this.timers.push(release);
  }
  sprite(sprite: Phaser.GameObjects.GameObject) { this.sprites.push(sprite); }
  timer(timer: Phaser.Time.TimerEvent) { this.timers.push(timer); }
  counter(tween: Phaser.Tweens.Tween) { this.counters.push(tween); }
}
