import type BattleScene from '../battle-scene';
import type Pokemon from '../field/pokemon';
import {EnemyPokemon} from '../field/pokemon';
import {AttemptCapturePhase} from '../phases';

/** Original throw/bounce/shake/breakout visuals, driven only by committed checks. */
export async function presentOriginalCapture(scene:BattleScene,pokemon:Pokemon,event:any,signal:AbortSignal){
  if(signal.aborted)return;
  if(!Array.isArray(event.checks)||!event.checks.length||event.checks.length>4)throw Error('INVALID_CAPTURE_PRESENTATION_TRACE');
  const timers=new Set<any>(),tweens=new Set<any>(),objects=new Set<any>(),sounds=new Set<any>();
  let active=true,finished:()=>void,failed:(error:any)=>void;
  const complete=new Promise<void>((resolve,reject)=>{finished=resolve;failed=reject;});
  const guard=fn=>function(...args){if(active&&!signal.aborted)try{return fn?.apply(this,args);}catch(error){failed(error);}};
  const port:any=Object.create(scene);
  port.time={delayedCall:(delay,fn,args,scope)=>{const timer=scene.time.delayedCall(delay,guard(fn),args,scope);timers.add(timer);return timer;},
    addEvent:config=>{const timer=scene.time.addEvent({...config,callback:guard(config.callback)});timers.add(timer);return timer;}};
  const track=(method,config)=>{
    const next={...config};for(const key of ['onStart','onUpdate','onRepeat','onYoyo','onComplete'])if(next[key])next[key]=guard(next[key]);
    const tween=scene.tweens[method](next);tweens.add(tween);return tween;
  };
  port.tweens={add:config=>track('add',config),addCounter:config=>track('addCounter',config)};
  const own=object=>{objects.add(object);return object;};
  port.add=Object.create(scene.add);
  for(const key of ['sprite','image','particles','container'])if(scene.add[key])port.add[key]=(...args)=>own(scene.add[key](...args));
  port.addFieldSprite=(...args)=>own((scene.addFieldSprite as any)(...args));
  port.playSound=(...args)=>{const sound=(scene.playSound as any)(...args);if(sound)sounds.add(sound);return sound;};
  const previousScene=pokemon.scene,position={x:pokemon.x,y:pokemon.y,scaleX:pokemon.scaleX,scaleY:pokemon.scaleY,visible:pokemon.visible};
  pokemon.scene=port;
  const phase:any=new AttemptCapturePhase(port,pokemon.getFieldIndex(),event.pokeballType);
  phase.getPokemon=()=>pokemon;phase.originalY=pokemon.y;
  phase.end=()=>port.time.delayedCall(600,()=>finished());
  phase.catch=()=>{phase.removePb();phase.end();};
  let checkIndex=0;
  const cancel=()=>{
    if(!active)return;active=false;
    for(const timer of timers)timer.destroy?.();for(const tween of tweens){tween.stop?.();tween.remove?.();}
    for(const sound of sounds)sound.stop?.();for(const object of objects)object.destroy?.();
    pokemon.scene=previousScene;pokemon.setPosition(position.x,position.y);pokemon.setScale(position.scaleX,position.scaleY);
    if(signal.aborted||event.checks.at(-1).outcome==='failed')pokemon.setVisible(position.visible);
    (pokemon as any).tintSprite?.setVisible(false);finished();
  };
  signal.addEventListener('abort',cancel,{once:true});
  try{
    phase.playCaptureAnimation(pokemon as EnemyPokemon,()=>{
      const check=event.checks[checkIndex++];
      if(!check||!['shake','failed','caught'].includes(check.outcome)||!Number.isInteger(check.shakeCount))throw Error('INVALID_CAPTURE_PRESENTATION_TRACE');
      return {...check};
    },stdev=>stdev*Math.sqrt(-2*Math.log(1-Math.random()))*Math.cos(2*Math.PI*Math.random()));
    await complete;
  }finally{signal.removeEventListener('abort',cancel);cancel();}
}
