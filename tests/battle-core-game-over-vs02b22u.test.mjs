import test from 'node:test';
import assert from 'node:assert/strict';
import {originalPhases} from './helpers/phase-model.mjs';
import {bindCoopGameOver,deferCoopGameOver} from '../src/battle-core/coop-game-over.mjs';

test('original GameOver uses the explicitly bound co-op transaction once and releases it',()=>{
 let completed=0;
 const scene={shiftPhase(){completed++;},gameData:{tryClearSession(){assert.fail('co-op must not write a solo session');}}};
 const phase=new originalPhases.GameOverPhase(scene,true);
 const unbind=bindCoopGameOver(phase,()=>phase.end());
 assert.throws(()=>bindCoopGameOver(phase,()=>{}),/INVALID_COOP_GAME_OVER_BINDING/);
 phase.start();assert.equal(completed,1);
 unbind();assert.equal(deferCoopGameOver(phase),false);
});
test('unbound original solo GameOver still enters its original personal session transaction',()=>{
 const marker=Error('ORIGINAL_SOLO_TRANSACTION');let calls=0;
 const scene={gameData:{tryClearSession(actual,slot){assert.equal(actual,scene);assert.equal(slot,3);calls++;throw marker;}},sessionSlotId:3};
 const phase=new originalPhases.GameOverPhase(scene,true);
 assert.throws(()=>phase.start(),error=>error===marker);assert.equal(calls,1);
});
