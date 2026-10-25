import { check, exact, json, uint, id, hash, digest } from './codec.mjs';

const INDEX = 'index';
const pkey = id => `profile:${id}`, lkey = id => `lease:${id}`, hkey = id => `history:${id}`;
const emptyIndex = () => ({format:'pokerogue-local-index',schemaVersion:1,revision:0,activeProfileId:null,profiles:[]});
const summary = p => ({profileId:p.profileId,revision:p.revision,displayName:p.displayName,updatedAt:p.updatedAt});
const identity = p => [p.originalSystem.trainerId,p.originalSystem.secretId].join(':');

/** All port mutations are synchronous and atomic; no network/crypto await in IDB. */
export function createProfileRepository({ store, codec, now = Date.now, uuid = () => globalThis.crypto.randomUUID(), cryptoApi = globalThis.crypto }) {
  check(store?.read && store?.transact && codec?.profile && codec?.index, 'LOCAL_REPOSITORY_PORT_REQUIRED');
  const indexOf = value => value === null ? emptyIndex() : codec.index(value);
  const stamp = () => { const t = now(); check(uint(t),'INVALID_LOCAL_CLOCK'); return t; };
  const token = () => { const v = uuid(); check(id(v),'INVALID_LOCAL_ID'); return v; };
  const leaseRecord = record => {
    if (record === null) return null;
    exact(record,['owner','token','expires']);
    check(id(record.owner) && id(record.token) && uint(record.expires),'LOCAL_LEASE_CORRUPT');
    return record;
  };
  const assertLease = (record, lease) => {
    leaseRecord(record);
    check(lease && id(lease.owner) && id(lease.token),'LOCAL_WRITER_LOST');
    check(record && lease && record.owner === lease.owner && record.token === lease.token && record.expires > stamp(), 'LOCAL_WRITER_LOST');
  };
  function updateIndex(index, profile) {
    const next = {...index, revision:index.revision+1,
      profiles:[...index.profiles.filter(p => p.profileId !== profile.profileId),summary(profile)]};
    return codec.index(next);
  }
  function readHistory(raw, profileId) {
    check(raw && raw.origin && Array.isArray(raw.automatic) && raw.automatic.length <= 5, 'LOCAL_HISTORY_CORRUPT');
    const origin = codec.profile(raw.origin); check(origin.profileId === profileId);
    return {...raw,origin};
  }
  function appendHistory(history, previous) {
    return {...history, automatic:[previous,...history.automatic].slice(0,5)};
  }
  async function installed(profileId) {
    check(id(profileId));
    const r = await store.read([INDEX,pkey(profileId)]), index = indexOf(r[INDEX]);
    const entry = index.profiles.find(p => p.profileId === profileId); check(entry,'LOCAL_PROFILE_NOT_FOUND');
    const profile = codec.profile(r[pkey(profileId)]);
    check(profile.profileId === profileId && profile.revision === entry.revision, 'LOCAL_DIRECTORY_MISMATCH');
    return profile;
  }
  async function validatePlan(input) {
    const plan = json(input);
    exact(plan,['format','schemaVersion','source','sourceDigest','profile','planDigest']);
    check(plan.format === 'pokerogue-local-migration' && plan.schemaVersion === 1, 'LOCAL_VERSION_MISMATCH');
    check(hash(plan.sourceDigest) && hash(plan.planDigest));
    check(await digest(plan.source,cryptoApi) === plan.sourceDigest, 'LOCAL_SOURCE_CHANGED');
    const p = codec.profile(plan.profile);
    check(p.revision === 0 && p.migration?.sourceDigest === plan.sourceDigest, 'INVALID_MIGRATION_PROFILE');
    check(await digest({source:plan.source,profile:p},cryptoApi) === plan.planDigest, 'LOCAL_PLAN_CHANGED');
    exact(plan.source,['format','records','preferences']);
    check(p.migration.sourceFormat === plan.source.format && p.grantLedger.length === 0 && p.deferredHatches.length === 0,'INVALID_MIGRATION_PROFILE');
    check(JSON.stringify(p.isolated) === JSON.stringify(plan.source.records)
      && JSON.stringify(p.preferences) === JSON.stringify(plan.source.preferences)
      && JSON.stringify(p.originalSystem) === JSON.stringify(codec.original.system(JSON.parse(plan.source.records.data))),'LOCAL_MIGRATION_PAYLOAD_MISMATCH');
    const sourceSlots = [0,1,2].filter(slot => Object.hasOwn(plan.source.records,slot ? `sessionData${slot}` : 'sessionData'));
    check(p.soloRuns.length === sourceSlots.length && sourceSlots.every(slot => {
      const run = p.soloRuns.find(r => r.legacySlot === slot);
      return run?.ownership === 'unconfirmed' && run.grantCursor.length === 0
        && JSON.stringify(run.originalSession) === JSON.stringify(codec.original.session(JSON.parse(plan.source.records[slot ? `sessionData${slot}` : 'sessionData'])));
    }),'LOCAL_MIGRATION_PAYLOAD_MISMATCH');
    return {...plan,profile:p};
  }
  async function previewLegacy(input, { sourceId, displayName = '本地训练家', profileId = token() } = {}) {
    check(id(sourceId),'LOCAL_SOURCE_ID_REQUIRED');
    const source = json(input);
    exact(source,['format','records','preferences']);
    check(['legacy-records','backup-v1','prsv-system'].includes(source.format), 'UNSUPPORTED_LEGACY_FORMAT');
    check(source.records && typeof source.records === 'object' && !Array.isArray(source.records));
    // Unknown and experimental records are preserved in isolation, never merged.
    for (const [key,value] of Object.entries(source.records)) {
      check(/^(data|sessionData[12]?|coop-grants|coop-experiment-data|coop-experiment-grants|coop-seats)(:backup)?$/.test(key)
        && typeof value === 'string','INVALID_LEGACY_RECORD');
      json(JSON.parse(value));
    }
    check(typeof source.records.data === 'string','ORPHAN_SOLO_REQUIRES_PROFILE');
    const originalSystem = codec.original.system(JSON.parse(source.records.data));
    const sourceDigest = await digest(source,cryptoApi), time = stamp();
    const staged = (await store.read([`stage:${sourceDigest}`]))[`stage:${sourceDigest}`];
    if (staged !== null) {
      const pending = await validatePlan(staged);
      check(pending.profile.migration.sourceId === sourceId,'LOCAL_STAGED_PLAN_CONFLICT');
      return pending; // A reload can recover its UUID/manifest without old JS memory.
    }
    const soloRuns = [0,1,2].flatMap(slot => {
      const key = slot ? `sessionData${slot}` : 'sessionData';
      if (!source.records[key]) return [];
      return [{runId:token(),profileId,legacySlot:slot,ownership:'unconfirmed',
        originalSession:codec.original.session(JSON.parse(source.records[key])),grantCursor:[]}];
    });
    const profile = codec.profile({format:'pokerogue-local-profile',schemaVersion:1,profileId,revision:0,
      createdAt:time,updatedAt:time,displayName,avatarId:'default',originalSystem,soloRuns,
      grantLedger:[],deferredHatches:[],preferences:source.preferences,
      migration:{sourceDigest,sourceFormat:source.format,sourceId},isolated:source.records});
    return {format:'pokerogue-local-migration',schemaVersion:1,source,sourceDigest,profile,
      planDigest:await digest({source,profile},cryptoApi)};
  }
  async function install(input) {
    const plan = await validatePlan(input), p = plan.profile, sourceKey = `source:${p.migration.sourceId}`;
    const receiptKey = `migration:${plan.sourceDigest}`, stageKey = `stage:${plan.sourceDigest}`;
    const existing = await store.read([receiptKey,sourceKey]);
    if (existing[receiptKey]) {
      check(existing[sourceKey]?.profileId === existing[receiptKey].profileId,'LOCAL_SOURCE_ALREADY_IMPORTED');
      const saved = await installed(existing[receiptKey].profileId);
      check(saved.migration?.sourceDigest === plan.sourceDigest,'LOCAL_MIGRATION_RECEIPT_CORRUPT');
      return {profileId:existing[receiptKey].profileId,repeated:true};
    }
    // Durable stage is deliberately separate. Failed publication leaves the old
    // index intact; callers retry the exact plan after a process restart.
    await store.transact([stageKey], r => {
      if (r[stageKey] !== null) check(r[stageKey].planDigest === plan.planDigest,'LOCAL_STAGED_PLAN_CONFLICT');
      return {changes:{[stageKey]:plan}};
    });
    const staged = (await store.read([stageKey]))[stageKey]; await validatePlan(staged);
    check(staged.planDigest === plan.planDigest,'LOCAL_STAGED_PLAN_CONFLICT');
    return store.transact([INDEX,pkey(p.profileId),hkey(p.profileId),lkey(p.profileId),receiptKey,sourceKey,stageKey], r => {
      const index = indexOf(r[INDEX]);
      if (r[receiptKey]) {
        check(r[receiptKey].profileId === p.profileId,'LOCAL_SOURCE_ALREADY_IMPORTED');
        return {changes:{[stageKey]:null},result:{profileId:p.profileId,repeated:true}};
      }
      check(r[sourceKey] === null,'LOCAL_SOURCE_ALREADY_MIGRATED');
      check(r[pkey(p.profileId)] === null && !index.profiles.some(v => v.profileId === p.profileId),'LOCAL_PROFILE_EXISTS');
      check(r[lkey(p.profileId)] === null,'LOCAL_WRITER_BUSY');
      check(r[stageKey]?.planDigest === plan.planDigest,'LOCAL_STAGED_PLAN_CONFLICT');
      return {changes:{[INDEX]:updateIndex(index,p),[pkey(p.profileId)]:p,
        [hkey(p.profileId)]:{origin:p,automatic:[],recovery:null},
        [receiptKey]:{profileId:p.profileId,sourceDigest:plan.sourceDigest},
        [sourceKey]:{profileId:p.profileId,sourceDigest:plan.sourceDigest},[stageKey]:null},
        result:{profileId:p.profileId,repeated:false}};
    });
  }
  async function acquire(profileId, owner, ttlMs = 30000) {
    check(id(profileId) && id(owner) && uint(ttlMs) && ttlMs >= 1000 && ttlMs <= 60000);
    const freshToken = token();
    return store.transact([INDEX,lkey(profileId)], r => {
      check(indexOf(r[INDEX]).profiles.some(p => p.profileId === profileId),'LOCAL_PROFILE_NOT_FOUND');
      leaseRecord(r[lkey(profileId)]);
      check(!r[lkey(profileId)] || r[lkey(profileId)].expires <= stamp(),'LOCAL_WRITER_BUSY');
      const lease = {owner,token:freshToken,expires:stamp()+ttlMs};
      return {changes:{[lkey(profileId)]:lease},result:lease};
    });
  }
  async function renew(profileId, lease, ttlMs = 30000) {
    check(id(profileId) && uint(ttlMs) && ttlMs >= 1000 && ttlMs <= 60000);
    return store.transact([lkey(profileId)], r => {
      assertLease(r[lkey(profileId)],lease);
      const next = {...r[lkey(profileId)],expires:stamp()+ttlMs};
      return {changes:{[lkey(profileId)]:next},result:next};
    });
  }
  async function release(profileId, lease) {
    check(id(profileId) && lease && id(lease.owner) && id(lease.token),'LOCAL_WRITER_LOST');
    return store.transact([lkey(profileId)], r => {
      const current = leaseRecord(r[lkey(profileId)]);
      return {changes:current?.token === lease?.token && current?.owner === lease?.owner ? {[lkey(profileId)]:null} : {}};
    });
  }
  async function change(profileId, expectedRevision, lease, mutation, restore = false) {
    check(id(profileId) && uint(expectedRevision) && typeof mutation === 'function');
    check(Object.prototype.toString.call(mutation) !== '[object AsyncFunction]','ASYNC_LOCAL_TRANSACTION');
    return store.transact([INDEX,pkey(profileId),hkey(profileId),lkey(profileId)], r => {
      assertLease(r[lkey(profileId)],lease);
      const index = indexOf(r[INDEX]), entry = index.profiles.find(p => p.profileId === profileId);
      check(entry && entry.revision === expectedRevision,'LOCAL_REVISION_CONFLICT');
      const history = readHistory(r[hkey(profileId)],profileId);
      let previous;
      try { previous = codec.profile(r[pkey(profileId)]); check(previous.revision === entry.revision,'LOCAL_DIRECTORY_MISMATCH'); }
      catch (error) { if (!restore) throw error; }
      const raw = mutation(previous ? json(previous) : null, json(history));
      if (raw && typeof raw.then === 'function') Promise.resolve(raw).catch(() => {});
      check(raw && !('then' in raw),'ASYNC_LOCAL_TRANSACTION');
      const next = codec.profile({...raw,revision:expectedRevision+1,updatedAt:Math.max(stamp(),raw.createdAt,previous?.updatedAt ?? 0)});
      check(next.profileId === profileId && identity(next) === identity(history.origin)
        && next.createdAt === history.origin.createdAt && JSON.stringify(next.migration) === JSON.stringify(history.origin.migration),'LOCAL_IDENTITY_CHANGED');
      if (!restore) for (const grant of previous.grantLedger) {
        check(next.grantLedger.some(g => JSON.stringify(g) === JSON.stringify(grant)),'LOCAL_LEDGER_REMOVAL');
      }
      const nextHistory = previous ? appendHistory(history,previous) : history;
      if (restore && previous) nextHistory.recovery = previous;
      return {changes:{[INDEX]:updateIndex(index,next),[pkey(profileId)]:next,[hkey(profileId)]:nextHistory},result:next};
    });
  }
  async function exportArchive(profileId) {
    const p = await installed(profileId);
    return {format:'pokerogue-local-profile-backup',schemaVersion:1,createdAt:stamp(),profile:p,digest:await digest(p,cryptoApi)};
  }
  async function previewArchive(input) {
    const a = json(input); exact(a,['format','schemaVersion','createdAt','profile','digest']);
    check(a.format === 'pokerogue-local-profile-backup' && a.schemaVersion === 1,'LOCAL_VERSION_MISMATCH');
    check(uint(a.createdAt) && hash(a.digest) && await digest(a.profile,cryptoApi) === a.digest,'LOCAL_ARCHIVE_CORRUPT');
    a.profile = codec.profile(a.profile); return a;
  }
  async function importArchive(input, { expectedRevision, lease } = {}) {
    const a = await previewArchive(input), p = a.profile;
    const r = await store.read([INDEX]), exists = indexOf(r[INDEX]).profiles.some(v => v.profileId === p.profileId);
    if (exists) return change(p.profileId,expectedRevision,lease,() => p,true);
    const receipt = p.migration ? `migration:${p.migration.sourceDigest}` : `import:${p.profileId}`;
    const sourceKey = p.migration ? `source:${p.migration.sourceId}` : `import-source:${p.profileId}`;
    return store.transact([INDEX,pkey(p.profileId),hkey(p.profileId),lkey(p.profileId),receipt,sourceKey], current => {
      const index = indexOf(current[INDEX]);
      check(!index.profiles.some(v => v.profileId === p.profileId) && current[pkey(p.profileId)] === null,'LOCAL_PROFILE_EXISTS');
      check(current[lkey(p.profileId)] === null,'LOCAL_WRITER_BUSY');
      check(current[receipt] === null && current[sourceKey] === null,'LOCAL_SOURCE_ALREADY_IMPORTED');
      return {changes:{[INDEX]:updateIndex(index,p),[pkey(p.profileId)]:p,[hkey(p.profileId)]:{origin:p,automatic:[],recovery:null},
        [receipt]:{profileId:p.profileId,sourceDigest:p.migration?.sourceDigest ?? a.digest},
        [sourceKey]:{profileId:p.profileId,sourceDigest:p.migration?.sourceDigest ?? a.digest}},result:p};
    });
  }
  async function recoveryPoints(profileId) {
    const raw = (await store.read([hkey(profileId)]))[hkey(profileId)], h = readHistory(raw,profileId);
    return {origin:h.origin,recovery:h.recovery,automatic:h.automatic.map(value => {
      try { return {valid:true,profile:codec.profile(value)}; } catch { return {valid:false,profile:null}; }
    })};
  }
  async function restore(profileId, point, expectedRevision, lease) {
    check(point === 'origin' || point === 'recovery' || (Number.isInteger(point) && point >= 0 && point < 5));
    return change(profileId,expectedRevision,lease,(_,h) => {
      const candidate = typeof point === 'number' ? h.automatic[point] : h[point];
      check(candidate,'LOCAL_RECOVERY_NOT_FOUND'); return codec.profile(candidate);
    },true);
  }
  async function setActive(profileId) {
    const current = indexOf((await store.read([INDEX]))[INDEX]);
    const ids = [...new Set([profileId,current.activeProfileId].filter(Boolean))]; check(id(profileId));
    return store.transact([INDEX,pkey(profileId),...ids.map(lkey)], r => {
      const index = indexOf(r[INDEX]); check(index.revision === current.revision,'LOCAL_REVISION_CONFLICT');
      check(index.profiles.some(p => p.profileId === profileId),'LOCAL_PROFILE_NOT_FOUND');
      const profile = codec.profile(r[pkey(profileId)]);
      check(profile.profileId === profileId && index.profiles.find(p => p.profileId === profileId).revision === profile.revision,'LOCAL_DIRECTORY_MISMATCH');
      for (const key of ids.map(lkey)) {leaseRecord(r[key]);check(!r[key] || r[key].expires <= stamp(),'LOCAL_WRITER_BUSY');}
      const next = codec.index({...index,revision:index.revision+1,activeProfileId:profileId});
      return {changes:{[INDEX]:next},result:next};
    });
  }
  async function create(originalSystem, {displayName = '本地训练家',preferences = {settings:null,tutorials:null,prLang:null}} = {}) {
    const time = stamp(), profile = codec.profile({format:'pokerogue-local-profile',schemaVersion:1,profileId:token(),revision:0,
      createdAt:time,updatedAt:time,displayName,avatarId:'default',originalSystem,soloRuns:[],grantLedger:[],deferredHatches:[],
      preferences,migration:null,isolated:{}});
    return importArchive({format:'pokerogue-local-profile-backup',schemaVersion:1,createdAt:time,profile,digest:await digest(profile,cryptoApi)});
  }
  return Object.freeze({list:async () => indexOf((await store.read([INDEX]))[INDEX]),read:installed,create,
    previewLegacy,install,acquire,renew,release,
    save:(profileId,expectedRevision,lease,mutation) => change(profileId,expectedRevision,lease,mutation),
    exportArchive,previewArchive,importArchive,recoveryPoints,restore,setActive});
}

export function legacyBackupSource(input) {
  const b = json(input);
  exact(b,['format','version','createdAt','records'],['settings','tutorials','prLang']);
  check(b.format === 'pokerogue-early-backup' && b.version === 1,'UNSUPPORTED_LEGACY_FORMAT');
  check(typeof b.createdAt === 'string' && Number.isFinite(Date.parse(b.createdAt)));
  return {format:'backup-v1',records:b.records,preferences:{settings:b.settings ?? null,tutorials:b.tutorials ?? null,prLang:b.prLang ?? null}};
}
