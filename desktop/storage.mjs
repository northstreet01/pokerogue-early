import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {canonical} from '../src/battle-core/coop-contract.mjs';
import {json,check} from '../src/local-meta/codec.mjs';

export const STORAGE_SCOPES=['meta','seats','outbox','legacy','preferences'];
const APP_ID=0x504b5247,VERSION=1;
const validKey=k=>typeof k==='string'&&k.length>0&&k.length<=4096&&!['__proto__','prototype','constructor'].includes(k);
function validateScope(scope,keys){
  check(STORAGE_SCOPES.includes(scope),'INVALID_STORAGE_SCOPE');
  check(keys===null||Array.isArray(keys)&&keys.length<=10000&&keys.every(validKey)&&new Set(keys).size===keys.length,'INVALID_STORE_KEYS');
}
export function validateBundle(bundle){
  check(bundle&&Object.getPrototypeOf(bundle)===Object.prototype&&Object.keys(bundle).length===STORAGE_SCOPES.length,'INVALID_STORAGE_BUNDLE');
  let total=0,count=0;
  for(const scope of STORAGE_SCOPES){
    const rows=bundle[scope];check(rows&&Object.getPrototypeOf(rows)===Object.prototype,'INVALID_STORAGE_BUNDLE');
    for(const [key,value] of Object.entries(rows)){
      check(validKey(key)&&++count<=100000,'INVALID_STORE_KEYS');
      total+=canonical(json(value)).length;check(total<=128*1024*1024,'LOCAL_DATA_TOO_LARGE');
    }
  }
  return bundle;
}
export const bundleDigest=bundle=>createHash('sha256').update(canonical(validateBundle(bundle))).digest('hex');

// The Electron main process owns this connection. No SQL or file paths cross IPC.
export function openDesktopStorage(directory,{beforeCommit=()=>{}}={}){
  mkdirSync(directory,{recursive:true});
  const path=join(directory,'personal.sqlite');let db;
  try{
    db=new DatabaseSync(path);
    check(Object.values(db.prepare('PRAGMA quick_check').get())[0]==='ok','DESKTOP_DATABASE_CORRUPT');
    const version=db.prepare('PRAGMA user_version').get().user_version;
    const appId=db.prepare('PRAGMA application_id').get().application_id;
    check(version===0||version===VERSION,'DESKTOP_DATABASE_VERSION');
    check(appId===0||appId===APP_ID,'DESKTOP_DATABASE_FORMAT');
    if(version===0){
      check(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().length===0,'DESKTOP_DATABASE_FORMAT');
      db.exec(`BEGIN IMMEDIATE; CREATE TABLE state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE records (scope TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(scope,key));
        INSERT INTO state VALUES ('revision','0'),('initialized','0');
        PRAGMA application_id=${APP_ID}; PRAGMA user_version=${VERSION}; COMMIT;`);
    }else check(appId===APP_ID,'DESKTOP_DATABASE_FORMAT');
    db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;');
  }catch(error){try{db?.close();}catch{}throw error;}
  const state=key=>db.prepare('SELECT value FROM state WHERE key=?').get(key)?.value;
  const revision=()=>{const value=Number(state('revision'));check(Number.isSafeInteger(value)&&value>=0,'DESKTOP_DATABASE_CORRUPT');return value;};
  const putState=(key,value)=>db.prepare('INSERT OR REPLACE INTO state VALUES (?,?)').run(key,String(value));
  const status=()=>({initialized:state('initialized')==='1',revision:revision(),formatVersion:VERSION});
  function transaction(operation,work){
    db.exec('BEGIN IMMEDIATE');
    try{const result=work();beforeCommit(operation);db.exec('COMMIT');return result;}
    catch(error){db.exec('ROLLBACK');throw error;}
  }
  function snapshot(scope,keys=null){
    validateScope(scope,keys);check(status().initialized,'DESKTOP_MIGRATION_REQUIRED');
    db.exec('BEGIN');
    try{
      const rev=revision(),records={};
      if(keys===null)for(const row of db.prepare('SELECT key,value FROM records WHERE scope=? ORDER BY key').all(scope))records[row.key]=json(JSON.parse(row.value));
      else for(const key of keys){const row=db.prepare('SELECT value FROM records WHERE scope=? AND key=?').get(scope,key);records[key]=row?json(JSON.parse(row.value)):null;}
      db.exec('COMMIT');return {revision:rev,records};
    }catch(error){db.exec('ROLLBACK');throw error;}
  }
  function commit({scope,keys,expectedRevision,changes}){
    validateScope(scope,keys);check(Number.isSafeInteger(expectedRevision)&&expectedRevision>=0,'INVALID_STORAGE_REVISION');
    const values=json(changes);check(values&&typeof values==='object'&&!Array.isArray(values),'INVALID_STORAGE_CHANGES');
    check(Object.keys(values).every(k=>validKey(k)&&(keys===null||keys.includes(k))),'UNREAD_LOCAL_WRITE');
    return transaction('commit',()=>{
      check(status().initialized,'DESKTOP_MIGRATION_REQUIRED');check(revision()===expectedRevision,'DESKTOP_REVISION_CONFLICT');
      for(const [key,value] of Object.entries(values)){
        if(value===null)db.prepare('DELETE FROM records WHERE scope=? AND key=?').run(scope,key);
        else db.prepare('INSERT OR REPLACE INTO records VALUES (?,?,?)').run(scope,key,canonical(value));
      }
      const next=expectedRevision+1;check(Number.isSafeInteger(next),'INVALID_STORAGE_REVISION');putState('revision',next);return {revision:next};
    });
  }
  function initialize(bundle,digest){
    check(bundleDigest(bundle)===digest,'DESKTOP_MIGRATION_CHANGED');
    return transaction('initialize',()=>{
      if(status().initialized){check(state('migrationDigest')===digest,'DESKTOP_ALREADY_INITIALIZED');return status();}
      check(db.prepare('SELECT COUNT(*) AS n FROM records').get().n===0,'DESKTOP_DATABASE_FORMAT');
      for(const scope of STORAGE_SCOPES)for(const [key,value] of Object.entries(bundle[scope]))
        db.prepare('INSERT INTO records VALUES (?,?,?)').run(scope,key,canonical(value));
      putState('migrationDigest',digest);putState('initialized',1);putState('revision',1);return status();
    });
  }
  function backup(){
    check(status().initialized,'DESKTOP_MIGRATION_REQUIRED');const root=join(directory,'backups');mkdirSync(root,{recursive:true});
    const target=join(root,`${Date.now()}-${randomUUID()}.sqlite`);
    db.prepare('VACUUM INTO ?').run(target);return target;
  }
  function restore(source){
    const candidate=new DatabaseSync(source,{readOnly:true});let bundle;
    try{
      check(candidate.prepare('PRAGMA user_version').get().user_version===VERSION&&candidate.prepare('PRAGMA application_id').get().application_id===APP_ID,'DESKTOP_DATABASE_VERSION');
      check(Object.values(candidate.prepare('PRAGMA quick_check').get())[0]==='ok','DESKTOP_DATABASE_CORRUPT');
      check(candidate.prepare("SELECT value FROM state WHERE key='initialized'").get()?.value==='1','DESKTOP_MIGRATION_REQUIRED');
      bundle=Object.fromEntries(STORAGE_SCOPES.map(scope=>[scope,{}]));
      for(const row of candidate.prepare('SELECT scope,key,value FROM records').all()){
        validateScope(row.scope,[row.key]);bundle[row.scope][row.key]=JSON.parse(row.value);
      }
      validateBundle(bundle);
    }finally{candidate.close();}
    const protectiveBackup=backup();
    return transaction('restore',()=>{
      const rev=revision()+1;db.exec('DELETE FROM records');
      // Old leases belong to a terminated writer, not the restored application.
      for(const scope of STORAGE_SCOPES)for(const [key,value] of Object.entries(bundle[scope])){
        if(scope==='meta'&&key.startsWith('lease:')||scope==='legacy'&&key==='coop-profile-lease')continue;
        db.prepare('INSERT INTO records VALUES (?,?,?)').run(scope,key,canonical(value));
      }
      putState('revision',rev);return {protectiveBackup,revision:rev};
    });
  }
  return {path,status,snapshot,commit,initialize,backup,restore,close:()=>db.close()};
}
