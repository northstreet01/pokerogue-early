export function evolutionDisplayFixture(api){
 const queue=[],sounds=[],calls=[],tweenConfigs=[],callbacks=[];let now=0,order=0;
 const schedule=(delay,fn)=>{const timer={at:now+delay,order:order++,active:true,fn,destroy(){this.active=false;},remove(){this.active=false;}};queue.push(timer);return timer;};
 const sprite=()=>({x:0,y:0,scale:1,alpha:1,visible:true,displayWidth:320,displayHeight:180,pipelineData:{},children:[],
  setOrigin(){return this;},setScale(v){this.scale=v;return this;},setVisible(v){this.visible=v;return this;},
  setAlpha(v){this.alpha=v;return this;},setTintFill(){return this;},setPipeline(){return this;},setTexture(){return this;},
  setPosition(x,y){this.x=x;this.y=y;return this;},play(){return this;},stop(){return this;},add(child){this.children.push(child);return this;},
  removeAll(){this.children=[];},destroy(){this.destroyed=true;}});
 const scene={game:{canvas:{width:1920,height:1080}},spritePipeline:{},
  modifiers:[],enemyModifiers:[],findModifier:api.BattleScene.prototype.findModifier,
  add:{image:sprite,sprite,rectangle:sprite,video:sprite},addPokemonSprite:sprite,
  time:{delayedCall:(delay,fn,args=[],scope=null)=>schedule(delay,()=>fn.apply(scope,args)),
   addEvent:config=>schedule(config.delay??0,()=>config.callback())},
  tweens:{add(config){return this.addCounter(config);},addCounter(config){
   tweenConfigs.push(config);callbacks.push(config.onComplete);let repeats=config.repeat??0;
   const tween={active:true,stop(){this.active=false;},remove(){this.active=false;},getValue:()=>config.to??1};
   const step=()=>{if(!tween.active)return;config.onUpdate?.(tween);
    if(repeats===-1||repeats>0){if(repeats>0)repeats--;config.onRepeat?.(tween);schedule(config.duration??0,step);}
    else config.onComplete?.(tween);};
   schedule((config.delay??0)+(config.duration??0),step);return tween;
  }},fadeOutBgm(){calls.push('fade-bgm');},playBgm(){calls.push('room-bgm');},
  playSound(key){const sound={key,stopped:false,stop(){this.stopped=true;}};sounds.push(sound);return sound;},
  playSoundWithoutBgm(key){return this.playSound(key);},
 };
 const handler={scene,evolutionContainer:sprite(),clear(){this.canCancel=false;this.cancelled=false;this.evolutionContainer.removeAll();},canCancel:false,cancelled:false};
 scene.ui={getHandler:()=>handler,add(){},async setModeCancellable(mode,signal){if(!signal.aborted)calls.push(['mode',mode]);},
  showText(text,_delay,done,callbackDelay){calls.push(['text',text]);if(done)handler.scene.time.delayedCall(callbackDelay??0,done);}};
 const runtime=api.createOriginalRuntime('evolution-visual',{trainerId:1,secretId:2});
 const before=api.constructOriginalPokemon(runtime,10,7),after=api.constructOriginalPokemon(runtime,11,7);after.id=before.id;
 before.getSprite=after.getSprite=()=>sprite();before.cry=()=>calls.push('cry');after.destroy=()=>{calls.push('destroy-after');};
 for(const pokemon of [before,after])for(const method of ['evolve','addExp','calculateStats','getEvolution'])pokemon[method]=()=>{throw new Error(`CLIENT_RULE_FORBIDDEN:${method}`);};
 const advance=async()=>{queue.sort((a,b)=>a.at-b.at||a.order-b.order);const task=queue.shift();
  if(task){now=task.at;if(task.active)task.fn();}for(let n=0;n<6;n++)await Promise.resolve();return !!task;};
 return {scene,handler,before,after,calls,sounds,tweenConfigs,callbacks,advance,queue};
}
