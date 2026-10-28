export function presentationFixture(api, scene = {}){
  const calls=[],counts={created:0,loaded:0,destroyed:0},sprite=()=>({x:0,y:0,visible:false,
    setTexture(v){this.texture=v;return this;},setPosition(x,y){this.x=x;this.y=y;return this;},setVisible(v){this.visible=v;return this;},
    setX(v){this.x=v;return this;},setAlpha(v){this.alpha=v;return this;},setOrigin(){return this;},destroy(){},play(){}});
  const base=player=>Object.assign(sprite(),{base:sprite(),player,props:[],add(){}});
  Object.assign(scene, {arena:{},arenaBg:sprite(),arenaBgTransition:sprite(),arenaPlayer:base(true),arenaEnemy:base(false),trainer:sprite(),
    arenaNextEnemy:base(false),arenaPlayerTransition:base(true),gameSpeed:1,
    time:{addEvent(config){for(let n=0;n<=(config.repeat??0);n++)config.callback();return {remove(){}};},delayedCall(){return {remove(){}};}},
    tweens:{killTweensOf(){},add(c){calls.push(['tween',c.duration]);
      for(const target of [c.targets].flat())if(target)for(const key of ['x','y','scale','alpha'])if(c[key]!==undefined)
        target[key]=typeof c[key]==='function'?c[key](target):typeof c[key]==='string'?target[key]+Number(c[key].slice(2)):c[key];
      c.onComplete?.();return {stop(){calls.push(['stop']);}};}},
    field:{add(){},remove(){},moveBelow(){}},getField(){return [...this.party,...this.currentBattle.enemyParty];},
    getPlayerPokemon(){return this.party[0];},damageNumberHandler:{add(){}},ui:{showText(){}},
    playSound:key=>calls.push(['sound',key]),updateFieldScale(){},addFieldSprite:()=>sprite(),
    add:{existing(){},sprite:()=>sprite()},anims:{generateFrameNames:()=>[],create(){}}});
  const p=new api.CoopBattlePresentation(scene);
  // Only Phaser allocation/assets are ports; production reconciliation/replay runs intact.
  p.container=(model)=>Object.assign(Object.create(Object.getPrototypeOf(model)),model,{scene,
    init(){this.battleInfo={setVisible(){},setMini(){},setOffset(){},setY(){},visible:true};counts.created++;},loadAssets:async()=>{counts.loaded++;},
    setFieldPosition(){},setVisible(v){this.visible=v;return this;},updateInfo:async function(instant){calls.push(['hp',this.hp,instant]);},
    x:0,y:0,getFieldPositionOffset:()=>[0,0],getSpriteScale:()=>1,
    hideInfo(){this.battleInfo.visible=false;return Promise.resolve();},showInfo(){this.battleInfo.visible=true;},
    faintCry(done){calls.push(['cry']);done();},cry(){},tint(){},untint(){},playAnim(){},setScale(){},
    getSprite:()=>({setVisible(){},clearTint(){}}),
    destroy(){counts.destroyed++;}});
  const runtime=api.createOriginalRuntime('vs20-display',{trainerId:1,secretId:2});
  const model=api.constructOriginalPokemon(runtime,1,5);model.hp=model.getMaxHp();
  const view={id:model.id,owner:0,index:0,speciesId:1,formIndex:0,level:5,hp:model.hp,maxHp:model.getMaxHp(),gender:model.gender,shiny:false};
  const snapshot={runId:'run',connectionEpoch:'epoch',revision:0,events:[],shared:{field:[model.id,null,null,null],pokemon:[view],
    biome:0,waveIndex:1,waveCycleOffset:17,terrainColorRatio:1,battleType:0,turn:1},personal:{decision:{kind:'wait-actions'}}};
  return {p,scene,calls,counts,model,snapshot,applied:{byId:new Map([[model.id,{pokemon:model}]])}};
}
