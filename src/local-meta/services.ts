import {createMetaStore} from './idb-store.mjs';
import {createMetaCodec} from './codec.mjs';
import {createProfileRepository} from './repository.mjs';
import {originalSaveCodec} from './original-save-codec';
import {openGameProfileIO} from './game-io.mjs';
import {Mode} from '../ui/ui';
import i18next from '../i18n';

// Creation is lazy. Importing phases in the headless Worker never opens a DB.
export function profileRepository(isCurrent=()=>true){
  const store=createMetaStore();
  return createProfileRepository({store:{read:store.read,transact:(keys,mutation)=>store.transact(keys,records=>{
    if(!isCurrent())throw new Error('LOCAL_PROFILE_CLOSED');return mutation(records);
  })},codec:createMetaCodec(originalSaveCodec)});
}
export function localProfileError(error:any):string {
  const key=String(error?.code??error?.message??'');
  const map={LOCAL_WRITER_BUSY:'busy',LOCAL_WRITER_LOST:'lost',LOCAL_PROFILE_CLOSED:'closed',LOCAL_REVISION_CONFLICT:'conflict',
    LOCAL_SOLO_OWNERSHIP_REQUIRED:'ownershipRequired',LOCAL_EGGS_RESERVED:'eggsReserved',LOCAL_ARCHIVE_CORRUPT:'archiveCorrupt',
    LOCAL_VERSION_MISMATCH:'unsupported',ORIGINAL_SAVE_VERSION_MISMATCH:'unsupported',LOCAL_SOURCE_ALREADY_MIGRATED:'sourceConflict',LOCAL_PROFILE_CHANGED:'profileChanged'};
  return i18next.t(`localMeta:${map[key]??'failed'}`);
}

export async function prepareProfileGameData(scene:any) {
  if(scene.gameData.localProfileId)return;
  const repository=profileRepository(),index=await repository.list();
  const requested=new URLSearchParams(location.search).get('profile');
  if(requested&&requested!==index.activeProfileId)throw Object.assign(new Error('LOCAL_PROFILE_CHANGED'),{code:'LOCAL_PROFILE_CHANGED'});
  if(!index.activeProfileId)return; // Explicit legacy compatibility; no migration.
  const mode=(globalThis as any).window?.__COOP_PLAY__?'coop':'solo';
  let io:any;
  const data=scene.gameData;
  const button=document.createElement('button');button.id='local-profile-return';button.type='button';
  button.textContent=i18next.t('localMeta:saveReturn');
  Object.assign(button.style,{position:'fixed',bottom:'8px',left:'8px',zIndex:'1000',padding:'8px 12px',font:'14px system-ui'});
  for(const name of ['keydown','keyup'])button.addEventListener(name,event=>event.stopPropagation());
  let unsaved=false;
  button.addEventListener('click',()=>{
    if(unsaved||!io){io?.invalidate();location.assign('/');return;}
    button.disabled=true;void data.closeProfile().then(()=>location.assign('/')).catch(error=>{
      unsaved=true;button.disabled=false;button.textContent=i18next.t('localMeta:returnUnsaved');
      scene.ui.setMode(Mode.MESSAGE);scene.ui.showText(localProfileError(error));
    });
  });
  document.body.append(button);
  io=await openGameProfileIO(repository,index.activeProfileId,{mode,onLost:error=>{
    scene.blockInput=true;scene.ui.setMode(Mode.MESSAGE);scene.ui.showText(localProfileError(error));
  }});
  data.bindProfileIO(io);
  // Coop already has a bounded, connection-independent exit entry.
  if(mode==='coop')button.remove();
  const invalidate=()=>io.invalidate();window.addEventListener('pagehide',invalidate,{once:true});
  scene.events?.once('shutdown',()=>{button.remove();window.removeEventListener('pagehide',invalidate);void data.closeProfile().catch(()=>{});});
}
