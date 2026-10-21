import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createOriginalRuleHost} from '../../server/original-rule-host.mjs';
import {progressNatural,owned} from './native-natural-learning.mjs';

// Fresh default collection from original GameData initialization, never a save
// import or a fabricated wave/EXP/HP checkpoint. No permanent writes are made.
export async function defaultTrainerRoute({seed='learning-natural-2'}={}) {
  const api=createRequire(import.meta.url)('../../build/coop-runtime/original-runtime.cjs');
  const identities=[{trainerId:1,secretId:2},{trainerId:3,secretId:4}];
  const config={seed,identity:identities[0]},profiles=[];
  for(const [seat,species] of [[0,[909,7]],[1,[906,7]]]){
    const runtime=api.createOriginalRuntime(seed,identities[seat]);
    const data=Object.assign(Object.create(api.GameData.prototype),{scene:runtime.scene,...identities[seat],eggs:[],starterEggMoveData:{}});
    api.withStarterRandomContext(runtime.context,()=>data.initDexData());
    const starters=species.map(speciesId=>{
      const entry=data.dexData[speciesId];
      assert.ok(entry.caughtAttr>0n);
      assert.deepEqual(entry.ivs,[10,10,10,10,10,10]);
      data.starterEggMoveData[speciesId]=0;
      return {species:api.getPokemonSpecies(speciesId),dexAttr:entry.caughtAttr,
        nature:data.getNaturesForAttr(entry.natureAttr)[0],moveset:undefined,pokerus:false};
    });
    profiles.push(api.captureProfile(data,starters));
  }
  const h=await createOriginalRuleHost(config);
  try {
    let total=0;
    for(const profile of profiles){const priced=await h.request('validate-profile',profile);assert.ok(priced.total<=10);total+=priced.total;}
    assert.ok(total<=14);
    const selection={identities,starterSelections:profiles.map(p=>p.starters),eggState:{players:[[],[]]}};
    let c=(await h.request('native-open-selected-to-input',selection)).checkpoint;
    const initial=structuredClone(c),trace=[];
    for(let n=0;n<240;n++){
      if(c.battle.waveIndex===4&&c.decision.kind==='continuing'&&c.decision.reason==='next-battle')
        return {h,c,initial,trace,profiles,config};
      const result=await progressDefault(h,c);trace.push({wave:c.battle.waveIndex,kind:c.decision.kind,events:result.events});c=result.checkpoint;
    }
    assert.fail('default collection must reach wave four end naturally');
  }catch(error){await h.close();throw error;}
}

export async function progressDefault(h,c){
  if(c.decision.kind==='learn-move'){
    const seat=c.decision.requiredSeats[0];
    return h.request('native-progression',{checkpoint:c,seat,action:c.decision.options[seat].find(o=>o.slot===null)});
  }
  if(c.decision.kind==='wait-actions'){
    const inputs={};
    for(const seat of c.decision.requiredSeats){
      const moves=owned(c,seat)[0].pokemon.fields.moveset;
      const options=c.decision.options[seat].filter(o=>o.kind==='fight'&&(o.target===null||o.target>=2));
      inputs[seat]=options.find(o=>[52,55,22,670].includes(moves[o.cursor]?.fields.moveId))
        ??options.find(o=>[33,10].includes(moves[o.cursor]?.fields.moveId))??options[0];
      assert.ok(inputs[seat]);
    }
    return h.request('native-submit',{checkpoint:c,inputs});
  }
  return progressNatural(h,c);
}
