import test from 'node:test';
import assert from 'node:assert/strict';
import { applySnapshot } from '../src/coop/snapshot-sync.mjs';
import { ENGINE_VERSION, RULES_HASH, stateHash } from '../src/coop/engine.mjs';

const state = { revision: 2, example: 'authoritative state' };
const snapshot = () => ({ version: ENGINE_VERSION, rulesHash: RULES_HASH, state, hash: stateHash(state),
  grants: [{id:'grant'}], barrier:true, acked:[false,false], seat:0 });

test('connection replaced during storage write never sends old acknowledgements to the new room',async () => {
  let current = true, finish;
  const stored = new Promise(resolve => { finish = resolve; });
  const sent = [];
  const applying = applySnapshot(snapshot(), { isCurrent:()=>current, saveGrants:()=>stored,
    send:message=>sent.push(message), canAcknowledge:()=>true });
  current = false; finish();
  assert.equal(await applying,null); assert.deepEqual(sent,[]);
});

test('collection commits before grant acknowledgement and current state acknowledgement',async () => {
  const events = [];
  assert.deepEqual(await applySnapshot(snapshot(), { isCurrent:()=>true,
    saveGrants:async()=>{ events.push('saved'); }, send:message=>events.push(message.type), canAcknowledge:()=>true }),state);
  assert.deepEqual(events,['saved','grantAck','ack']);
});

test('hash mismatch and disk failure never confirm a state',async () => {
  const sent = [];
  const context = { isCurrent:()=>true, saveGrants:async()=>{throw new Error('disk failure');},
    send:message=>sent.push(message), canAcknowledge:()=>true };
  await assert.rejects(applySnapshot({...snapshot(),hash:'wrong'},context),/校验失败/);
  await assert.rejects(applySnapshot(snapshot(),context),/disk failure/);
  assert.deepEqual(sent,[]);
});

test('server storage fault snapshot does not trigger an automatic state acknowledgement',async () => {
  const sent = [];
  await applySnapshot({...snapshot(),grants:[],storageError:true}, { isCurrent:()=>true,
    saveGrants:async()=>{},send:message=>sent.push(message),canAcknowledge:()=>true });
  assert.deepEqual(sent,[]);
});
