import type BattleScene from '../battle-scene';
import type Pokemon from '../field/pokemon';
import {QuietFormChangePhase} from '../form-change-phase';

/** Replay the original white-flash transform; apply only the committed view. */
export async function presentOriginalFormChange(scene:BattleScene,pokemon:Pokemon,applyView:()=>Promise<void>,signal:AbortSignal){
 if(signal.aborted)return;
 const timers=new Set<any>(),tweens=new Set<any>(),objects=new Set<any>(),sounds=new Set<any>(),listeners=[];
 let active=true,finish:()=>void,fail:(error:any)=>void;
 const complete=new Promise<void>((resolve,reject)=>{finish=resolve;fail=reject;});
 const guard=fn=>function(...args){if(active&&!signal.aborted)try{return fn?.apply(this,args);}catch(error){fail(error);}};
 const port:any=Object.create(scene);
 port.time={delayedCall:(delay,fn,args,scope)=>{
  const timer=scene.time.delayedCall(delay,guard(fn),args,scope);timers.add(timer);return timer;
 }};
 port.tweens={add:config=>{
  const next={...config};for(const key of ['onStart','onUpdate','onComplete'])if(next[key])next[key]=guard(next[key]);
  const tween=scene.tweens.add(next);tweens.add(tween);return tween;
 }};
 port.addPokemonSprite=(...args)=>{const sprite=(scene.addPokemonSprite as any)(...args);objects.add(sprite);return sprite;};
 port.playSound=(...args)=>{const sound=(scene.playSound as any)(...args);if(sound)sounds.add(sound);return sound;};
 const previousScene=pokemon.scene,previousGetter=Object.getOwnPropertyDescriptor(pokemon,'getSprite'),getSprite=pokemon.getSprite.bind(pokemon),visible=pokemon.visible;
 const proxies=new WeakMap();
 pokemon.getSprite=()=>{
  const sprite=getSprite();if(proxies.has(sprite))return proxies.get(sprite);
  const proxy=new Proxy(sprite,{get(target,key){
   if(key==='on')return (name,listener)=>{listeners.push([target,name,listener]);return target.on(name,listener);};
   const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
  }});proxies.set(sprite,proxy);return proxy;
 };
 pokemon.scene=port;
 const phase:any=Object.create(QuietFormChangePhase.prototype);phase.scene=port;phase.pokemon=pokemon;
 const cancel=()=>{
  if(!active)return;active=false;
  for(const timer of timers)timer.destroy?.();for(const tween of tweens){tween.stop?.();tween.remove?.();}
  for(const sound of sounds)sound.stop?.();for(const object of objects)object.destroy?.();
  for(const [sprite,name,listener]of listeners)sprite.off?.(name,listener);
  pokemon.scene=previousScene;
  if(previousGetter)Object.defineProperty(pokemon,'getSprite',previousGetter);else delete (pokemon as any).getSprite;
  pokemon.setVisible(visible);finish();
 };
 signal.addEventListener('abort',cancel,{once:true});
 try{
  phase.playFormChangeAnimation(()=>Promise.resolve().then(()=>{if(active&&!signal.aborted)return applyView();}).catch(error=>{fail(error);}),guard(finish));
  await complete;
 }finally{signal.removeEventListener('abort',cancel);cancel();}
}
