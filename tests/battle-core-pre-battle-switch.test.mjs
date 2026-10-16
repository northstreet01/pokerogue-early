import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import {preBattleContext,createPreBattle,advancePreBattle,referencePreBattle,choosePreBattle,nextPostPhase} from './helpers/pre-battle-switch-model.mjs';
import {codec} from './helpers/decision-model.mjs';
import {parse} from './helpers/original-model.mjs';
import {copy} from '../src/battle-core/coop-contract.mjs';
const saved=c=>copy(codec.capture(c));
async function atChoice(kind='switch-confirm',seat=0){let c=(await createPreBattle(await preBattleContext())).context;
  for(let i=0;i<40;i++){if(c.decision.kind===kind&&c.decision.requiredSeats[0]===seat)return c;
    c=(await advancePreBattle(c,choosePreBattle(c))).context;}throw Error('missing choice');}
const cases=[{seats:[0]},{seats:[1]},{seats:[0,1]},{seats:[0,1],decline:[0,1]},
  {seats:[0,1],cancel:[0]},{seats:[0,1],decline:[1]}];
for(const options of cases)test(`original pre-battle choice/return/swap/entry equals frozen uninterrupted execution ${JSON.stringify(options)}`,async()=>{
  let c=(await createPreBattle(await preBattleContext(options))).context,r=codec.restore(saved(c));
  const events=[],stages=[],original=saved(c);
  for(let i=0;i<45;i++){
    const seat=c.decision.requiredSeats[0],inputs=choosePreBattle(c,{accept:!options.decline?.includes(seat),cancel:options.cancel?.includes(seat)});
    stages.push(c.continuation.currentPhase?.remaining??nextPostPhase(c)?.constructor.name);
    const before=saved(c),a=await advancePreBattle(c,inputs),b=await referencePreBattle(r,inputs);
    assert.deepEqual(a.events,b.events);assert.deepEqual(saved(a.context),saved(b.context));assert.deepEqual(saved(c),before);
    events.push(...a.events);c=codec.restore(saved(a.context));r=b.context;
    if(c.decision.kind==='wait-actions')break;
  }
  assert.equal(c.decision.kind,'wait-actions');assert.deepEqual(c.decision.requiredSeats,[0,1]);
  for(const seat of [0,1]){
    const switched=options.seats.includes(seat)&&!options.decline?.includes(seat)&&!options.cancel?.includes(seat);
    assert.equal(c.roster.field[seat],switched?110+seat:100+seat);
    assert.equal(c.roster.entries.find(e=>e.owner===seat&&e.index===0).pokemon.id,c.roster.field[seat]);
  }
  assert.deepEqual(saved(c).players,original.players);assert.deepEqual(saved(c).eggState,original.eggState);
  if(!options.decline?.includes(options.seats[0])&&!options.cancel?.includes(options.seats[0]))assert.ok(stages.includes('switch-swap'));
  assert.equal(events.filter(e=>e.kind==='switch-question').length,options.seats.length);
  c=(await advancePreBattle(c,choosePreBattle(c))).context;
  for(let i=0;i<70&&c.decision.kind==='continuing';i++)c=(await advancePreBattle(c)).context;
  assert.equal(c.decision.kind,'wait-actions');assert.equal(c.battle.turn,2);
  for(const id of c.roster.field.slice(0,2))assert.equal(c.roster.entries.find(e=>e.pokemon.id===id).pokemon.moveset[0].ppUsed,1);
});
for(const kind of ['switch-confirm','switch-select'])test(`${kind} uses the named original callback without restarting the old menu`,async()=>{
  const c=await atChoice(kind),before=saved(c);let called=0;
  const r=await advancePreBattle(c,choosePreBattle(c),{onChoiceBind:(_c,p,_b,_t,intent)=>{
    assert.equal(intent.kind,kind);called++;Object.defineProperty(p,'start',{value:()=>{throw Error('old menu restarted');},configurable:true});
  }});assert.equal(called,1);assert.equal(r.context.decision.kind,'continuing');assert.deepEqual(saved(c),before);
});
for(const kind of ['switch-confirm','switch-select'])test(`${kind} rejects foreign/invalid inputs and forged phase ownership before rule or RNG execution`,async()=>{
  const c=await atChoice(kind),before=saved(c),seat=c.decision.requiredSeats[0],valid=choosePreBattle(c)[seat];
  for(const input of [{[1-seat]:valid},{[seat]:{...valid,pokemonId:111}},
    {[seat]:{...valid,unexpected:true}},{}])await assert.rejects(advancePreBattle(c,input));
  for(const mutate of [s=>s.continuation.currentPhase.phase.scope=1-seat,
    s=>s.continuation.currentPhase.remaining='wait-switch',s=>s.decision.switch.outgoing[seat]=101,
    s=>s.decision.options[seat].pop(),s=>s.continuation.currentPhase.phase.fields.fieldIndex.value=1-seat]){
    const s=copy(before);mutate(s);assert.throws(()=>codec.restore(s));
  }
  if(kind==='switch-select')await assert.rejects(advancePreBattle(c,{[seat]:{kind,pokemonId:100}}),/INVALID_ACTION/);
  assert.deepEqual(saved(c),before);
});
for(const kind of ['switch-confirm','switch-select'])test(`${kind} task failure leaves the exact pending original decision intact`,async()=>{
  const c=await atChoice(kind),before=saved(c);
  await assert.rejects(advancePreBattle(c,choosePreBattle(c),{onChoiceBind:(_c,_p,_b,t)=>t.add(Promise.reject(Error('choice-fault')))}),/choice-fault/);
  assert.deepEqual(saved(c),before);
});
test('choice candidates reject partner resource/HP/alias and pending queue corruption',async()=>{
  const c=await atChoice(),before=saved(c);
  for(const corrupt of [c=>c.players[1].money--,c=>c.roster.entries[1].pokemon.hp--,
    c=>{c.roster.entries[1].pokemon.ivs=c.roster.entries[0].pokemon.ivs;},c=>c.continuation.phaseQueue.pop()]){
    await assert.rejects(advancePreBattle(c,choosePreBattle(c),{onChoiceBind:c=>corrupt(c)}),/SWITCH_CHOICE_(MODEL|QUEUE)_CHANGED/);
    assert.deepEqual(saved(c),before);
  }
});
for(const stage of ['start','switch-swap','summon-initialize','summon-finish'])test(`original optional return ${stage} task failure retains both owned field positions`,async()=>{
  let c=await atChoice('switch-select');c=(await advancePreBattle(c,choosePreBattle(c))).context;
  for(let i=0;i<8;i++){
    const current=c.continuation.currentPhase;if((current?.remaining??'start')===stage)break;c=(await advancePreBattle(c)).context;
  }
  const before=saved(c);await assert.rejects(advancePreBattle(c,{}, {onSwitchBind:(_c,_p,_b,t)=>t.add(Promise.reject(Error('entry-fault')))}),/entry-fault/);
  assert.deepEqual(saved(c),before);
});
test('pre-battle choices preserve v6 without manufacturing personal eggs',async()=>{
  let c=await preBattleContext({seats:[1]});delete c.eggState;c=(await createPreBattle(c)).context;
  for(let i=0;i<35&&c.decision.kind!=='wait-actions';i++){c=(await advancePreBattle(c,choosePreBattle(c))).context;
    assert.equal(saved(c).version,6);assert.equal(Object.hasOwn(c,'eggState'),false);}
  assert.equal(c.roster.field[1],111);
});
test('original confirmation and party callbacks retain their frozen rule bodies',()=>{
  const phases=parse('phases.ts'),check=phases.statements.find(n=>n.name?.text==='CheckSwitchPhase'),sw=phases.statements.find(n=>n.name?.text==='SwitchPhase');
  const frozenNext=JSON.parse(fs.readFileSync(new URL('./fixtures/early-next-battle-reference.json',import.meta.url),'utf8'));
  const oldCheck=ts.createSourceFile('check.ts',`class C{${frozenNext.phases.CheckSwitchPhase.start}}`,99,true);
  const frozenSwitch=JSON.parse(fs.readFileSync(new URL('./fixtures/early-pre-battle-switch-reference.json',import.meta.url),'utf8')).switchStart;
  const oldSwitch=ts.createSourceFile('switch.ts',`class C{${frozenSwitch}}`,99,true);
  const bodies=(node,file)=>{const out=[];function visit(n){if(ts.isArrowFunction(n))out.push(n.body.getText(file).replace(/\s+/g,' '));ts.forEachChild(n,visit);}visit(node);return out;};
  const currentConfirm=bodies(check.members.find(n=>n.name?.getText()==='createSwitchConfirmCallbacks'),phases);
  for(const body of currentConfirm)assert.ok(bodies(oldCheck,oldCheck).includes(body));
  const currentSelect=bodies(sw.members.find(n=>n.name?.getText()==='createSwitchSelectCallback'),phases);
  assert.equal(currentSelect.length,2);for(const body of currentSelect)assert.ok(bodies(oldSwitch,oldSwitch).includes(body));
});
