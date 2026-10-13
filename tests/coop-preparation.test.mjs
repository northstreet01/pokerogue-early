import test from 'node:test';
import assert from 'node:assert/strict';
import { createRun, createMon, prepare, nextWave, resolveRound, stateHash } from '../src/coop/engine.mjs';
const team = [1,4,7].map(species=>({species,nature:0,ivs:[10,10,10,10,10,10],dexAttr:'149'}));
test('reserve exchange cannot access teammate, preserves run instance and starts next wave only after both ready',()=>{
  let state=createRun('reserve',17,[team,team]); state.phase='prep';
  const captured=createMon('caught-mon',{...team[0],species:10},6); state.players[0].reserve.push(captured);
  assert.throws(()=>prepare(state,1,{kind:'reserve',mon:captured.id,replace:state.players[1].party[0].id}));
  state=prepare(state,0,{kind:'reserve',mon:captured.id,replace:state.players[0].party[0].id});
  assert.equal(state.players[0].party[0].id,captured.id); assert.equal(state.players[0].party[0].level,6);
  state=prepare(state,0,{kind:'reward',item:'ball'}); state=prepare(state,1,{kind:'reward',item:'potion'});
  state=prepare(state,0,{kind:'ready'}); assert.throws(()=>nextWave(state)); state=prepare(state,1,{kind:'ready'});
  const next=nextWave(state); assert.equal(next.wave,2); assert.equal(next.players[0].party[0].id,captured.id);
  assert.equal(next.players[0].bag.ball,6); assert.equal(next.players[1].bag.potion,3);
});
test('simultaneous enemy/player wipe fails and last living teammate can continue alone',()=>{
  const state=createRun('wipe',17,[team,team]);
  state.players[1].party.forEach(mon=>{mon.hp=0;}); state.players[1].active=null;
  state.players[0].party.slice(1).forEach(mon=>{mon.hp=0;});
  state.players[0].party[0].hp=1; state.players[0].party[0].stats[5]=1000; state.players[0].party[0].moves.forEach(move=>{move.pp=0;});
  state.enemies[0].hp=1; state.enemies[1].hp=0;
  const next=resolveRound(state,{0:{kind:'move',move:165,target:0}});
  assert.equal(next.phase,'over'); assert.equal(next.enemies[0].hp,0);
});
test('outstanding learn decision prevents ready; explicit skip or replacement resolves it',()=>{
  let state=createRun('learn',17,[team,team]); state.phase='prep'; state.players[0].rewardTaken=true;
  const mon=state.players[0].party[0]; mon.pendingLearn=[98];
  assert.throws(()=>prepare(state,0,{kind:'ready'}));
  state=prepare(state,0,{kind:'learn',mon:mon.id,slot:0});
  assert.equal(state.players[0].party[0].moves[0].id,98); assert.equal(state.players[0].party[0].moves[0].pp,30);
  assert.equal(prepare(state,0,{kind:'ready'}).players[0].ready,true);
});
test('insufficient money and invalid commands cannot mutate authoritative input',()=>{
  const state=createRun('invalid',17,[team,team]); state.phase='prep'; state.players[0].money=1;
  const before=stateHash(state); assert.throws(()=>prepare(state,0,{kind:'buy',item:'revive'})); assert.equal(stateHash(state),before);
});
