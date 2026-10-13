import test from 'node:test';
import assert from 'node:assert/strict';
import {codec} from './helpers/decision-model.mjs';
import {nativeSwitchContext,nativeSwitchStep} from './helpers/native-switch-model.mjs';

test('actual native switch return/swap/summon/onEnd stages resume independently for either owned field',async()=>{
  for(const baton of [false,true])for(const seat of [0,1]){
    let original=codec.restore(codec.capture(nativeSwitchContext(baton,seat))),resumed=codec.restore(codec.capture(original));
    const before=codec.capture(original);
    for(let i=0;i<5&&original.decision.kind==='continuing';i++){
      const a=await nativeSwitchStep(original,seat,false),b=await nativeSwitchStep(codec.restore(codec.capture(resumed)),seat);
      assert.deepEqual(b.events,a.events);assert.deepEqual(codec.capture(b.context),codec.capture(a.context));original=a.context;resumed=b.context;
    }
    assert.equal(resumed.decision.kind,'wait-actions');assert.equal(resumed.roster.field[seat],110+seat);
    assert.equal(resumed.roster.entries.find(e=>e.pokemon.id===110+seat).pokemon.battleSummonData.turnCount,baton?0:1);
    assert.ok(resumed.continuation.phaseQueuePrepend.some(p=>p.phase.constructor.name==='PostSummonPhase'));
    assert.equal(before.decision.kind,'continuing');
  }
});
