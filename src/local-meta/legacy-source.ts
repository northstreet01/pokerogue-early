import { readLocalSaveSnapshot, sessionSaveKey } from '../system/local-save-store';
import { check } from './codec.mjs';
import { originalSaveCodec } from './original-save-codec';

/** Explicit read only. Never called by startup and never changes old records. */
export async function captureLegacySource(storage: Pick<Storage, 'getItem'> = localStorage) {
  const primary = ['data','coop-grants','coop-experiment-data','coop-experiment-grants','coop-seats',...[0,1,2].map(sessionSaveKey)];
  const keys = [...primary,...primary.map(k => `${k}:backup`),'coop-profile-lease'];
  const snapshot = await readLocalSaveSnapshot(keys);
  const lease = snapshot['coop-profile-lease'] ? JSON.parse(snapshot['coop-profile-lease']) : null;
  check(!lease || lease.expires <= Date.now(),'LEGACY_WRITER_BUSY');
  return {format:'legacy-records',records:Object.fromEntries(Object.entries(snapshot).filter(([k,v]) => k !== 'coop-profile-lease' && v !== null)),
    preferences:{settings:storage.getItem('settings'),tutorials:storage.getItem('tutorials'),prLang:storage.getItem('prLang')}};
}

/** The caller must choose the .prsv type; filenames do not determine ownership. */
export function prsvSystemSource(text: string) {
  return {format:'prsv-system',records:{data:JSON.stringify(originalSaveCodec.decodePrsv(text,'system'))},
    preferences:{settings:null,tutorials:null,prLang:null}};
}

// Session-only imports remain unbound candidates, not a fabricated collection.
export const previewPrsvSession = (text: string) => ({ownership:'unconfirmed',originalSession:originalSaveCodec.decodePrsv(text,'session')});
