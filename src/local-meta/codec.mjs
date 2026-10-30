import { canonical } from '../battle-core/coop-contract.mjs';

export const fail = code => { throw Object.assign(new Error(code), { code }); };
export const check = (condition, code = 'INVALID_LOCAL_PROFILE') => { if (!condition) fail(code); };
export const uint = value => Number.isSafeInteger(value) && value >= 0;
export const id = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
const factId = value => typeof value === 'string' && /^[a-zA-Z0-9_:-]{1,256}$/.test(value);
export const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export function json(value) {
  // Bound imported data before the recursive canonicalizer, reject getters,
  // exotic prototypes, non-finite numbers and sparse arrays without executing them.
  let nodes = 0;
  const visit = (v, depth) => {
    check(depth <= 40 && ++nodes <= 300000, 'LOCAL_DATA_TOO_LARGE');
    if (!v || typeof v !== 'object') { check(['string','number','boolean'].includes(typeof v) || v === null, 'INVALID_JSON'); return; }
    check(Array.isArray(v) ? Object.getPrototypeOf(v) === Array.prototype : Object.getPrototypeOf(v) === Object.prototype, 'INVALID_JSON');
    for (const key of Reflect.ownKeys(v)) {
      check(typeof key === 'string' && !['__proto__','prototype','constructor'].includes(key), 'INVALID_JSON');
      const d = Object.getOwnPropertyDescriptor(v, key);
      check('value' in d && (d.enumerable || (Array.isArray(v) && key === 'length')), 'INVALID_JSON');
      if (key !== 'length' || !Array.isArray(v)) visit(d.value, depth + 1);
    }
  };
  visit(value, 0);
  const text = canonical(value);
  check(text.length <= 16 * 1024 * 1024, 'LOCAL_DATA_TOO_LARGE');
  return JSON.parse(text);
}
export function exact(value, required, optional = []) {
  check(value && typeof value === 'object' && !Array.isArray(value));
  check(required.every(k => Object.hasOwn(value, k)) && Object.keys(value).every(k => [...required,...optional].includes(k)), 'INVALID_LOCAL_FIELDS');
}
export const unique = (values, code = 'DUPLICATE_LOCAL_ID') => check(new Set(values).size === values.length, code);
export async function digest(value, cryptoApi = globalThis.crypto) {
  check(cryptoApi?.subtle, 'LOCAL_CRYPTO_UNAVAILABLE');
  const bytes = await cryptoApi.subtle.digest('SHA-256', new TextEncoder().encode(canonical(json(value))));
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
}

/** Original payload validation is injected from the early catalogue adapter. */
export function createMetaCodec(original) {
  check(typeof original?.system === 'function' && typeof original?.session === 'function', 'ORIGINAL_SAVE_CODEC_REQUIRED');
  function profile(input) {
    const p = json(input);
    exact(p, ['format','schemaVersion','profileId','revision','createdAt','updatedAt','displayName','avatarId',
      'originalSystem','soloRuns','grantLedger','deferredHatches','preferences','migration','isolated'],p.schemaVersion===2?['hatchResults','eggRun']:[]);
    check(p.format === 'pokerogue-local-profile' && [1,2].includes(p.schemaVersion), 'LOCAL_VERSION_MISMATCH');
    // v1 remains byte-compatible on read. The first egg-lifecycle grant or
    // durable hatch upgrades to v2; playback receipts survive interruptions.
    if(p.schemaVersion===2){
      check(Object.hasOwn(p,'eggRun'),'INVALID_EGG_RUN');
      if(p.eggRun!==null){
        exact(p.eggRun,['sourceRunId','eggs']);check(id(p.eggRun.sourceRunId)&&Array.isArray(p.eggRun.eggs),'INVALID_EGG_RUN');
        unique(p.eggRun.eggs.map(e=>e.id));
        for(const egg of p.eggRun.eggs){exact(egg,['id','timestamp']);
          check(uint(egg.id)&&uint(egg.timestamp)&&p.originalSystem.eggs.some(e=>e.id===egg.id&&e.timestamp===egg.timestamp),'EGG_RUN_INVENTORY_MISMATCH');}
      }
      check(Array.isArray(p.hatchResults)&&p.hatchResults.length<=10000,'INVALID_HATCH_RESULTS');
      unique(p.hatchResults.map(r=>r.id));
      for(const result of p.hatchResults){
        exact(result,['id','egg','pokemon','eggMoveIndex']);check(id(result.id),'INVALID_HATCH_RESULT');
        check(typeof original.hatchResult==='function','ORIGINAL_HATCH_CODEC_REQUIRED');original.hatchResult(result);
      }
    }
    check(id(p.profileId) && uint(p.revision) && uint(p.createdAt) && uint(p.updatedAt) && p.updatedAt >= p.createdAt);
    check(typeof p.displayName === 'string' && p.displayName.trim().length > 0 && p.displayName.length <= 40);
    check(p.avatarId === 'default', 'UNSUPPORTED_LOCAL_AVATAR');
    original.system(p.originalSystem);
    check(Array.isArray(p.soloRuns) && p.soloRuns.length <= 3);
    unique(p.soloRuns.map(r => r.runId)); unique(p.soloRuns.map(r => r.legacySlot));
    for (const r of p.soloRuns) {
      exact(r, ['runId','profileId','legacySlot','ownership','originalSession','grantCursor']);
      check(id(r.runId) && r.profileId === p.profileId && [0,1,2].includes(r.legacySlot));
      check(['unconfirmed','confirmed'].includes(r.ownership));
      check(Array.isArray(r.grantCursor) && r.grantCursor.every(factId)); unique(r.grantCursor);
      original.session(r.originalSession);
    }
    check(Array.isArray(p.grantLedger) && p.grantLedger.length <= 10000);
    unique(p.grantLedger.map(g => g.id));
    for (const g of p.grantLedger) {
      exact(g, ['id','sourceRunId','ownerProfileId','kind','payloadHash','revision']);
      check(factId(g.id) && id(g.sourceRunId) && g.ownerProfileId === p.profileId && hash(g.payloadHash)
        && ['seen','caught','ivs','evolution','hatch','voucher','completion'].includes(g.kind) && uint(g.revision) && g.revision <= p.revision);
    }
    check(Array.isArray(p.deferredHatches) && p.deferredHatches.length <= 10000);
    unique(p.deferredHatches.map(h => h.eggId));
    for (const h of p.deferredHatches) {
      exact(h, ['sourceRunId','eggId','eggTimestamp','state','terminal']);
      check(id(h.sourceRunId) && uint(h.eggId) && uint(h.eggTimestamp));
      check(p.originalSystem.eggs.some(e => e.id === h.eggId && e.timestamp === h.eggTimestamp && e.hatchWaves <= 0), 'DEFERRED_EGG_MISMATCH');
      check(['waiting-terminal','released'].includes(h.state));
      if (h.state === 'waiting-terminal') check(h.terminal === null, 'NONTERMINAL_HATCH');
      else { exact(h.terminal, ['result','receiptId']); check(['victory','defeat'].includes(h.terminal.result) && factId(h.terminal.receiptId));
        if(p.schemaVersion===2)check(p.grantLedger.some(g=>g.id===h.terminal.receiptId&&g.sourceRunId===h.sourceRunId&&g.kind==='completion'),'COOP_EGG_TERMINAL_RECEIPT_REQUIRED');
      }
    }
    exact(p.preferences, ['settings','tutorials','prLang']);
    for (const key of ['settings','tutorials']) if (p.preferences[key] !== null) {
      check(typeof p.preferences[key] === 'string'); const v = json(JSON.parse(p.preferences[key])); check(v && !Array.isArray(v) && typeof v === 'object');
    }
    check(p.preferences.prLang === null || ['zh-Hans','en'].includes(p.preferences.prLang));
    if (p.migration !== null) { exact(p.migration, ['sourceDigest','sourceFormat','sourceId']);
      check(hash(p.migration.sourceDigest) && ['legacy-records','backup-v1','prsv-system'].includes(p.migration.sourceFormat) && id(p.migration.sourceId)); }
    check(p.isolated && typeof p.isolated === 'object' && !Array.isArray(p.isolated));
    for (const [key, value] of Object.entries(p.isolated)) {
      check(/^(data|sessionData[12]?|coop-grants|coop-experiment-data|coop-experiment-grants|coop-seats)(:backup)?$/.test(key)
        && typeof value === 'string', 'INVALID_ISOLATED_RECORD');
      json(JSON.parse(value)); // Retain opaque legacy data; never apply its rewards.
    }
    return p;
  }
  function index(input) {
    const value = json(input);
    exact(value, ['format','schemaVersion','revision','activeProfileId','profiles']);
    check(value.format === 'pokerogue-local-index' && value.schemaVersion === 1, 'LOCAL_VERSION_MISMATCH');
    check(uint(value.revision) && Array.isArray(value.profiles) && value.profiles.length <= 100);
    for (const p of value.profiles) { exact(p, ['profileId','revision','displayName','updatedAt']);
      check(id(p.profileId) && uint(p.revision) && uint(p.updatedAt) && typeof p.displayName === 'string' && p.displayName.length <= 40); }
    unique(value.profiles.map(p => p.profileId));
    check(value.activeProfileId === null || value.profiles.some(p => p.profileId === value.activeProfileId));
    return value;
  }
  return Object.freeze({ profile, index, original });
}
