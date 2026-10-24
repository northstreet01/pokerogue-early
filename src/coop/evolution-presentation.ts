import type BattleScene from '../battle-scene';
import { EvolutionPhase } from '../evolution-phase';
import { PlayerPokemon, capturePokemonState, restorePokemonState } from '../field/pokemon';
import { Mode } from '../ui/ui';

/** Run the original evolution scene against two already verified display
 * copies. Construction, evolution rules, learning queues and saves stay on
 * the server; this phase owns only the original sprites, particles and music. */
export async function presentOriginalEvolution(scene: BattleScene, before: PlayerPokemon,
  after: PlayerPokemon, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return;
  const timers = new Set<any>(), tweens = new Set<any>(), sounds = new Set<any>();
  let active = true;
  let failed:(error:any)=>void;
  const guard = (fn: Function) => function (...args: any[]) {
    if (active && !signal.aborted) {try{return fn?.apply(this,args);}catch(error){failed?.(error);}}
  };
  const port: any = Object.create(scene);
  port.time = {
    delayedCall(delay, fn, args, scope) {
      const timer = scene.time.delayedCall(delay,guard(fn),args,scope); timers.add(timer); return timer;
    },
    addEvent(config) {const timer=scene.time.addEvent({...config,callback:guard(config.callback)});timers.add(timer);return timer;},
  };
  const trackTween = (method, config) => {
    const guarded = {...config};
    for (const key of ['onStart','onUpdate','onRepeat','onComplete','onYoyo']) if (guarded[key]) guarded[key]=guard(guarded[key]);
    const tween = scene.tweens[method](guarded);tweens.add(tween);return tween;
  };
  port.tweens = {add:config=>trackTween('add',config),addCounter:config=>trackTween('addCounter',config)};
  port.playSound = key => {const sound=scene.playSound(key);if(sound)sounds.add(sound);return sound;};
  port.playSoundWithoutBgm = key => {const sound=scene.playSoundWithoutBgm.call(port,key);if(sound)sounds.add(sound);return sound;};
  // Cooperative audio restores the room track after the scene. The original
  // phase's delayed playBgm must not guess a track from its temporary view.
  port.playBgm = () => {};
  const handler: any = scene.ui.getHandler(Mode.EVOLUTION_SCENE);
  const handlerScene = handler.scene;
  const readonlyHandler = Object.create(handler);
  Object.defineProperties(readonlyHandler, {
    canCancel:{get:()=>false,set:()=>{}},cancelled:{get:()=>false,set:()=>{}},
  });
  port.ui = {
    add:child=>scene.ui.add(child),
    getHandler:()=>readonlyHandler,
    showText:(text,delay,done,callbackDelay,_prompt,promptDelay) => {
      if (!active || signal.aborted) return;
      // The owner already made the durable evolution choice. Keep the original
      // message layout/timing and automatically advance display-only prompts.
      scene.ui.showText(text,delay,guard(done),callbackDelay ?? promptDelay,false);
    },
  };
  let finished:()=>void;
  const complete = new Promise<void>((resolve,reject)=>{finished=resolve;failed=reject;});
  class DisplayEvolution extends EvolutionPhase {
    // Only particle position jitter. Never touch the verified rule RNG, even
    // when the display is tested in a process with the strict native host.
    protected visualRandomInt(range:number) {return Math.floor(Math.random()*range);}
    validate() {return true;}
    async setMode() {
      await scene.ui.setModeCancellable(Mode.EVOLUTION_SCENE,signal);
      if (!active || signal.aborted) throw new Error('PRESENTATION_CANCELLED');
      handler.scene = port;
    }
    applyEvolution() {
      // Copy the committed result into this temporary visual object only.
      const ownerScene=before.scene;
      Object.assign(before,restorePokemonState(capturePokemonState(after)),{scene:ownerScene});before.generateName();
      return Promise.resolve();
    }
    queueEndEvolution() {}
    end() {finished();}
  }
  before.scene=port;after.scene=port;
  before.getPossibleEvolution=()=>({then:callback=>{guard(callback)(after);}} as any);
  let overlay: any;
  const phase = new DisplayEvolution(port,before,null,before.level);
  const cancel = () => {
    active=false;
    for(const timer of timers)timer.destroy?.();
    for(const tween of tweens){tween.stop?.();tween.remove?.();}
    for(const sound of sounds)sound.stop?.();
    overlay?.destroy();
    handler.canCancel=false;handler.cancelled=false;
    handler.clear();handler.scene=handlerScene;
    finished();
  };
  signal.addEventListener('abort',cancel,{once:true});
  try {
    // Original start allocates the original scene; asynchronous setup errors
    // are routed through the same completion instead of becoming rejections.
    await phase.setMode();
    phase.setMode=()=>Promise.resolve();
    if (signal.aborted) return;
    await phase.start();
    overlay=(phase as any).evolutionOverlay;
    await complete;
  } finally {
    overlay ??= (phase as any).evolutionOverlay;
    signal.removeEventListener('abort',cancel);cancel();
    if (!signal.aborted) await scene.ui.setModeCancellable(Mode.MESSAGE,signal);
  }
}
