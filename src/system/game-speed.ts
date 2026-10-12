import SoundFade from "phaser3-rex-plugins/plugins/soundfade";
import FadeIn from 'phaser3-rex-plugins/plugins/audio/fade/FadeIn';
import FadeOut from 'phaser3-rex-plugins/plugins/audio/fade/FadeOut';
import BattleScene from "../battle-scene";
import * as Utils from "../utils";

type FadeIn = typeof FadeIn;
type FadeOut = typeof FadeOut;

export function initGameSpeed() {
  const thisArg = this as BattleScene;

  const transformValue = <T>(value: T): T => {
    if (value instanceof Utils.FixedInt)
      return value.value as unknown as T;
    return typeof value === 'number' && thisArg.gameSpeed !== 1
      ? Math.ceil(value / thisArg.gameSpeed) as T : value;
  };

  const originalAddEvent = this.time.addEvent;
  this.time.addEvent = function (config: Phaser.Time.TimerEvent | Phaser.Types.Time.TimerEventConfig) {
    if (config instanceof Phaser.Time.TimerEvent) return originalAddEvent.apply(this, [ config ]);
    if (config.delay)
      config.delay = transformValue(config.delay);
    return originalAddEvent.apply(this, [ config ]);
  };
  const originalTweensAdd = this.tweens.add;
  this.tweens.add = function (config: Phaser.Types.Tweens.TweenBuilderConfig | Phaser.Types.Tweens.TweenChainBuilderConfig | Phaser.Tweens.Tween | Phaser.Tweens.TweenChain) {
    if (config instanceof Phaser.Tweens.Tween || config instanceof Phaser.Tweens.TweenChain)
      return originalTweensAdd.apply(this, [ config ]);
    if ('duration' in config && config.duration)
      config.duration = transformValue(config.duration);
    if ('delay' in config && config.delay)
      config.delay = transformValue(config.delay);
    if ('repeatDelay' in config && config.repeatDelay)
      config.repeatDelay = transformValue(config.repeatDelay);
    if (config.loopDelay)
      config.loopDelay = transformValue(config.loopDelay);
    if ('hold' in config && config.hold)
      config.hold = transformValue(config.hold);
    return originalTweensAdd.apply(this, [ config ]);
  };
  const originalTweensChain = this.tweens.chain;
  this.tweens.chain = function (config: Phaser.Types.Tweens.TweenChainBuilderConfig): Phaser.Tweens.TweenChain {
    if (config.tweens) {
      config.tweens.forEach(t => {
        if (t.duration)
          t.duration = transformValue(t.duration);
        if (t.delay)
          t.delay = transformValue(t.delay);
        if (t.repeatDelay)
          t.repeatDelay = transformValue(t.repeatDelay);
        if (t.loopDelay)
          t.loopDelay = transformValue(t.loopDelay);
        if (t.hold)
          t.hold = transformValue(t.hold);
      });
    }
    return originalTweensChain.apply(this, [ config ]);
  };
  const originalAddCounter = this.tweens.addCounter;
  this.tweens.addCounter = function (config: Phaser.Types.Tweens.NumberTweenBuilderConfig) {
    if (config.duration)
      config.duration = transformValue(config.duration);
    if (config.delay)
      config.delay = transformValue(config.delay);
    if (config.repeatDelay)
      config.repeatDelay = transformValue(config.repeatDelay);
    if (config.loopDelay)
      config.loopDelay = transformValue(config.loopDelay);
    if (config.hold)
      config.hold = transformValue(config.hold);
    return originalAddCounter.apply(this, [ config ]);
  };
  
  const originalFadeOut = SoundFade.fadeOut;
  SoundFade.fadeOut = ((
    scene: Phaser.Scene,
    sound: Phaser.Sound.BaseSound,
    duration: number,
    destroy?: boolean
  ) => originalFadeOut(scene, sound, transformValue(duration), destroy)) as FadeOut;

  const originalFadeIn = SoundFade.fadeIn;
  SoundFade.fadeIn = ((
    scene: Phaser.Scene,
    sound: string | Phaser.Sound.BaseSound,
    duration: number,
    endVolume?: number,
    startVolume?: number
  ) => originalFadeIn(scene, sound, transformValue(duration), endVolume, startVolume)) as FadeIn;
}
