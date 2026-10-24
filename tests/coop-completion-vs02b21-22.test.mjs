import test,{before} from 'node:test';
import assert from 'node:assert/strict';
import {buildCoopRuntime} from '../scripts/build-coop-runtime.mjs';
import {defaultTrainerRoute} from './helpers/native-default-trainer.mjs';
before(()=>buildCoopRuntime());
test('original natural prebattle questions carry only the owning seat and a stable localization key',async()=>{
 const route=await defaultTrainerRoute();
 try{
  const questions=route.trace.flatMap(step=>step.events).filter(event=>event.messageKey==='battle:switchQuestion');
  assert.ok(questions.length>=2);
  assert.deepEqual([...new Set(questions.map(event=>event.scope))].sort(),[0,1]);
  for(const event of questions){assert.ok(Number.isSafeInteger(event.pokemonId));assert.equal(typeof event.useName,'boolean');}
 }finally{await route.h.close();}
});
