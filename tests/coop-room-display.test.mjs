import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import i18next from 'i18next';
import {readFileSync} from 'node:fs';
import {renderTeams,renderInventory,progressText} from '../src/coop/room-display.mjs';
function setup(language='zh-Hans'){
  globalThis.document=new JSDOM('<!doctype html><body></body>').window.document;
  const translator=i18next.createInstance();translator.init({lng:language,initAsync:false,resources:Object.fromEntries(['en','zh-Hans'].map(lang=>[lang,{coop:JSON.parse(readFileSync(new URL('../locales/'+lang+'/coop.json',import.meta.url),'utf8'))}]))});
  return {target:document.createElement('div'),t:(key,params)=>translator.t('coop:'+key,params)};
}
test('team previews show own row first, accepted forms/costs and empty slots without exposing private records',()=>{
  const {target,t}=setup(),records=[{seat:0,state:'draft',ready:false,total:0.5,starters:[{speciesId:1,formIndex:2,cost:0.5}],eggs:['private']},{seat:1,state:'confirmed',ready:true,total:3,starters:[]}];
  const before=JSON.stringify(records);
  renderTeams(target,{},records,1,{t,names:['<img src=x>','队友乙'],species:id=>({getName:form=>'精灵'+id+'形态'+form,getIconAtlasKey:()=>'',getIconId:()=>''})});
  assert.equal(target.querySelector('.coop-team-row').dataset.seat,'1');assert.equal(target.querySelectorAll('.coop-team-slot').length,12);
  assert.match(target.textContent,/你.*已准备/);assert.match(target.textContent,/精灵1形态2.*0.5点/);assert.doesNotMatch(target.textContent,/private/);
  assert.equal(target.querySelector('img'),null);assert.equal(JSON.stringify(records),before);
});
test('inventory uses original atlas frame, supports click and keyboard descriptions, and never alters data',()=>{
  const {target,t}=setup(),items=[{name:'幸运蛋',description:'原道具效果',icon:'lucky_egg',count:2,owner:'妙蛙种子',battlesLeft:3}];
  const before=JSON.stringify(items),scene={textures:{exists:()=>true,getFrame:()=>({name:'lucky_egg',cutX:16,cutY:32,cutWidth:16,cutHeight:16,source:{width:256,height:256,image:{src:'http://127.0.0.1/items.png'}}})}};
  const crops=[];
  document.defaultView.HTMLCanvasElement.prototype.getContext=()=>({drawImage:(...args)=>crops.push(args.slice(1))});
  document.defaultView.HTMLCanvasElement.prototype.toDataURL=()=> 'data:image/png;base64,c3ludGhldGlj';
  renderInventory(target,scene,items,t);const button=target.querySelector('button');
  assert.equal(target.hidden,false);assert.match(button.getAttribute('aria-label'),/幸运蛋 ×2.*妙蛙种子/);
  assert.deepEqual(crops,[[16,32,16,16,0,0,16,16]]);
  assert.match(target.querySelector('.coop-atlas-frame').style.backgroundImage,/data:image\/png/);
  assert.match(target.querySelector('[role=tooltip]').textContent,/原道具效果.*剩余 3/);
  button.click();assert.equal(button.getAttribute('aria-expanded'),'true');
  const event=new document.defaultView.KeyboardEvent('keydown',{key:'Escape',bubbles:true});let escaped=false;target.addEventListener('keydown',()=>{escaped=true;});button.dispatchEvent(event);
  assert.equal(button.getAttribute('aria-expanded'),'false');assert.equal(escaped,false);assert.equal(JSON.stringify(items),before);
  assert.equal(button.dataset.dismissed,'true');button.click();assert.equal(button.dataset.dismissed,undefined);
  renderInventory(target,scene,[],t);assert.equal(target.hidden,true);assert.equal(target.children.length,0);
});
test('peer status distinguishes loading, disconnect, submitted actions and finished shared preparation in both languages',()=>{
  for(const language of ['zh-Hans','en']){
    const {t}=setup(language),s={personal:{decision:{kind:'wait-actions',requiredSeats:[0,1]}}};
    const m={online:[true,true],reason:'READY',blocked:false,submitted:[true,false]};
    assert.ok(progressText(m,s,0,t).includes(t('actionSubmitted')));assert.ok(progressText(m,s,0,t).includes(t('choosingAction')));
    assert.equal(progressText({...m,online:[true,false]},s,0,t),t('waitingConnection'));
    assert.equal(progressText({...m,reason:'WAITING_ACK',blocked:true},s,0,t),t('loadingTogether'));
    s.personal.decision={kind:'preparation',sharedMarket:{finished:[true,false]}};
    assert.ok(progressText(m,s,0,t).includes(t('finishedShopping')));assert.ok(progressText(m,s,0,t).includes(t('choosingItems')));
  }
});
