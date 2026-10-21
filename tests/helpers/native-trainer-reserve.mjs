import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {defaultTrainerRoute} from './native-default-trainer.mjs';

// Explicit synthetic Trainer initial scenario, not a natural encounter proof.
// The original Breeder constructor/template/levels/species generator supply
// the entire four-member party. No hand-authored combat formulas or enemies.
export async function trainerReserveFixture({trainerType=9,template,variant=0,frontHp}={}){
  const route=await defaultTrainerRoute();const h=route.h;
  try{
    const entered=(await h.request('native-next',route.c)).checkpoint;
    const ready=(await h.request('native-run-to-boundary',entered)).checkpoint;
    const api=createRequire(import.meta.url)('../../build/coop-runtime/original-runtime.cjs');
    const c=api.originalDecisionStateCodec.restore(ready),runtime=api.createOriginalRuntime(route.config.seed,route.config.identity);
    // Install the same dedicated native display ports in this module graph.
    await api.executeRuntimeOperation(runtime,'native-open-selected-to-input',{
      identities:route.profiles.map(p=>p.trainer),starterSelections:route.profiles.map(p=>p.starters),eggState:{players:[[],[]]}});
    const scene=runtime.scene;
    Object.assign(scene,{currentBattle:c.battle,arena:c.arena,modifiers:[],enemyModifiers:[],
      party:c.roster.entries.filter(e=>e.owner!==null&&e.index===0).map(e=>e.pokemon),
      addFieldSprite:()=>({setOrigin(){return this;},setPipeline(){return this;},setVisible(){return this;}})});
    c.arena.scene=scene;
    const oldIds=c.battle.enemyParty.map(p=>p.id),Trainer=c.battle.trainer.constructor;
    api.withStarterRandomContext(c,()=>{
      c.battle.trainer=new Trainer(scene,trainerType,variant,template); // original config/template, not a generated natural encounter
      assert.equal(c.battle.trainer.config.trainerType,trainerType);
      c.battle.enemyLevels=c.battle.trainer.getPartyLevels(c.battle.waveIndex);
      assert.ok(c.battle.enemyLevels.length>0);
      c.battle.enemyParty=[];
      for(const index of c.battle.enemyLevels.keys()){
        const pokemon=c.battle.trainer.genPartyMember(index);pokemon.resetSummonData();pokemon.resetTurnData();
        c.battle.enemyParty.push(pokemon);
      }
      if(frontHp!==undefined)for(const pokemon of c.battle.enemyParty.slice(0,2))pokemon.hp=frontHp;
    });
    c.enemyModifiers=[];
    c.roster.retiredIds.push(...oldIds);
    c.roster.entries=c.roster.entries.filter(e=>e.owner!==null).concat(c.battle.enemyParty.map((pokemon,index)=>({owner:null,group:'enemy',index,pokemon})));
    c.roster.field.splice(2,2,...c.battle.enemyParty.slice(0,2).map(p=>p.id));
    c.battle.seenEnemyPartyMemberIds=new Set(c.roster.field.slice(2));
    const checkpoint=api.originalDecisionStateCodec.capture(c);
    return {...route,c:checkpoint};
  }catch(error){await h.close();throw error;}
}
