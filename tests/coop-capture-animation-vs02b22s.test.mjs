import test,{before} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'vite';
import {createRequire,isBuiltin} from 'node:module';
import {resolve} from 'node:path';
import {evolutionDisplayFixture} from './helpers/evolution-display-fixture.mjs';
let api;
before(async()=>{
 await build({configFile:false,publicDir:false,logLevel:'error',resolve:{alias:[
  {find:/^phaser$/,replacement:resolve('server/headless-presentation.mjs')},
  {find:/^phaser3-rex-plugins\/.*/,replacement:resolve('server/headless-rex.mjs')}]},ssr:{noExternal:true},
  build:{ssr:resolve('tests/fixtures/coop-play-ui-entry.mjs'),outDir:resolve('build/coop-capture-animation-test'),emptyOutDir:true,minify:false,
  rollupOptions:{external:isBuiltin,output:{format:'cjs',entryFileNames:'entry.cjs'}}}});
 api=createRequire(import.meta.url)('../build/coop-capture-animation-test/entry.cjs');api.describeOriginalCatalogs();
});
function fixture(){
 const f=evolutionDisplayFixture(api),objects=[],moves=[];
 const sprite=f.scene.add.sprite;
 const add=()=>{const s=sprite();s.scaleX=s.scaleY=1;s.setX=x=>{s.x=x;return s;};s.setAngle=a=>{s.angle=a;return s;};objects.push(s);return s;};
 f.scene.add.sprite=f.scene.add.image=add;f.scene.addFieldSprite=add;
 f.scene.field={add(){},moveBelow(){moves.push('behind-target');}};
 f.scene.anims={generateFrameNames:()=>[],create(){}};f.scene.gameSpeed=1;f.scene.pokeballCounts={0:5};
 const target={id:77,x:236,y:84,visible:true,scaleX:1,scaleY:1,scene:f.scene,
  getFieldIndex:()=>0,getFieldPositionOffset:()=>[0,0],getHpRatio:()=>0.5,
  tint:()=>moves.push('tint'),untint:()=>moves.push('untint'),cry:()=>moves.push('cry'),
  setY(y){this.y=y;return this;},setPosition(x,y){this.x=x;this.y=y;return this;},
  setVisible(v){this.visible=v;return this;},setScale(x,y=x){this.scaleX=x;this.scaleY=y;return this;},
  randSeedInt(){assert.fail('capture display must not reroll');},addExp(){assert.fail('capture display must not grant');}};
 return {...f,target,objects,moves};
}
for(const last of [1,2,3,4])test(`original throw, absorb, bounce and ${last===4?'success':`breakout ${last}`} follow committed checks only`,async()=>{
 const f=fixture(),controller=new AbortController();
 const checks=Array.from({length:last},(_,i)=>({shakeCount:i+1,outcome:i===last-1?(last===4?'caught':'failed'):'shake'}));
 let settled=false;const task=api.presentOriginalCapture(f.scene,f.target,{pokeballType:0,checks},controller.signal).finally(()=>settled=true);task.catch(()=>{});
 for(let n=0;n<2000&&!settled;n++)await f.advance();assert.equal(settled,true);await task;
 const sounds=f.sounds.map(s=>s.key);
 for(const key of ['pb_throw','pb_rel','pb_catch','pb_bounce_1'])assert.ok(sounds.includes(key),key);
 assert.equal(sounds.filter(k=>k==='pb_move').length,last===4?3:last-1);
 assert.equal(sounds.includes('pb_lock'),last===4);
 assert.ok(f.tweenConfigs.some(c=>c.duration===500&&c.scale===0.25));assert.ok(f.tweenConfigs.some(c=>c.yoyo&&c.repeat===4));
 assert.ok(f.objects.every(o=>o.destroyed));assert.deepEqual(f.scene.pokeballCounts,{0:5});
 assert.equal(f.target.scene,f.scene);assert.equal(f.target.y,84);
 if(last<4){assert.ok(f.moves.includes('cry'));assert.equal(f.target.visible,true);}
});
test('exit during the original throw cancels old callbacks, sprites and sounds',async()=>{
 const f=fixture(),controller=new AbortController(),checks=[{shakeCount:1,outcome:'failed'}];
 const task=api.presentOriginalCapture(f.scene,f.target,{pokeballType:0,checks},controller.signal);
 controller.abort();await task;const before=f.sounds.length;
 for(const callback of f.callbacks)callback?.({getValue:()=>1});for(let n=0;n<100&&f.queue.length;n++)await f.advance();
 assert.equal(f.sounds.length,before);assert.ok(f.sounds.every(s=>s.stopped));assert.ok(f.objects.every(o=>o.destroyed));
 assert.equal(f.target.visible,true);assert.equal(f.target.scene,f.scene);assert.deepEqual(f.scene.pokeballCounts,{0:5});
});
