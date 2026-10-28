import {GameData} from '../system/game-data';
import {allSpecies,getPokemonSpecies,speciesStarters} from '../data/pokemon-species';
import {speciesEggMoves} from '../data/egg-moves';
import {check,exact,json} from '../local-meta/codec.mjs';

// Room-only capabilities, never a replacement SystemSaveData. Prices retain
// one contributor's original counters; combining collections cannot stack a
// discount. No trainer identity, eggs or private save metadata are published.
export function validateRoomCatalog(input:any):any[] {
  const rows=json(input);check(Array.isArray(rows)&&rows.length<=allSpecies.length,'INVALID_ROOM_CATALOG');
  const seen=new Set();
  for(const r of rows){
    exact(r,['speciesId','caughtAttr','natureAttr','ivs','eggMoves','caughtCount','hatchedCount']);
    check(Object.prototype.hasOwnProperty.call(speciesStarters,r.speciesId)&&!seen.has(r.speciesId),'INVALID_ROOM_SPECIES');seen.add(r.speciesId);
    const species=getPokemonSpecies(r.speciesId);
    const mask=(1n<<BigInt(7+Math.max(species.forms.length,1)))-1n;
    check(typeof r.caughtAttr==='string'&&/^[1-9][0-9]{0,99}$/.test(r.caughtAttr)
      &&(BigInt(r.caughtAttr)&~mask)===0n,'INVALID_ROOM_UNLOCK');
    check(Number.isSafeInteger(r.natureAttr)&&r.natureAttr>0&&r.natureAttr<2**26&&r.natureAttr%2===0,'INVALID_ROOM_NATURE');
    check(Array.isArray(r.ivs)&&r.ivs.length===6&&r.ivs.every(v=>Number.isInteger(v)&&v>=0&&v<=31),'INVALID_ROOM_IVS');
    check(Number.isInteger(r.eggMoves)&&r.eggMoves>=0&&r.eggMoves<2**(speciesEggMoves[species.getRootSpeciesId()]?.length??0),'INVALID_ROOM_EGG_MOVES');
    check(['caughtCount','hatchedCount'].every(k=>Number.isSafeInteger(r[k])&&r[k]>=0),'INVALID_ROOM_COST');
  }
  return rows.sort((a,b)=>a.speciesId-b.speciesId);
}
export function captureRoomCatalog(data:any):any[] {
  return validateRoomCatalog(Object.keys(speciesStarters).map(Number).filter(id=>data.dexData[id]?.caughtAttr)
    .map(speciesId=>{const d=data.dexData[speciesId];return {speciesId,caughtAttr:d.caughtAttr.toString(),
      natureAttr:d.natureAttr,ivs:[...d.ivs],eggMoves:data.starterEggMoveData[getPokemonSpecies(speciesId).getRootSpeciesId()]??0,
      caughtCount:d.caughtCount,hatchedCount:d.hatchedCount};}));
}
const price=(r:any)=>GameData.prototype.getSpeciesStarterValue.call({dexData:{[r.speciesId]:r}},r.speciesId);
export function mergeRoomCatalogs(catalogs:any[]):any[] {
  const byId=new Map<number,any>();
  for(const catalog of catalogs)for(const r of validateRoomCatalog(catalog)){
    const old=byId.get(r.speciesId);if(!old){byId.set(r.speciesId,r);continue;}
    const counters=price(r)<price(old)?r:old;
    byId.set(r.speciesId,{...old,caughtAttr:(BigInt(old.caughtAttr)|BigInt(r.caughtAttr)).toString(),
      natureAttr:old.natureAttr|r.natureAttr,eggMoves:old.eggMoves|r.eggMoves,
      ivs:old.ivs.map((v,i)=>Math.max(v,r.ivs[i])),caughtCount:counters.caughtCount,hatchedCount:counters.hatchedCount});
  }
  return [...byId.values()].sort((a,b)=>a.speciesId-b.speciesId);
}
export function roomSelectionData(original:any,catalog:any[]):any {
  const view=Object.create(original);view.dexData={...original.dexData};view.starterEggMoveData={...original.starterEggMoveData};
  view.starterMoveData=structuredClone(original.starterMoveData);
  for(const r of validateRoomCatalog(catalog)){
    view.dexData[r.speciesId]={...view.dexData[r.speciesId],...r,caughtAttr:BigInt(r.caughtAttr),ivs:[...r.ivs]};
    const root=getPokemonSpecies(r.speciesId).getRootSpeciesId();
    view.starterEggMoveData[root]=(view.starterEggMoveData[root]??0)|r.eggMoves;
  }
  // A selector may read fields and edit local movesets, but cannot save a
  // transient union through inherited profile IO or the original legacy store.
  view.saveSystem=async()=>false;view.saveSession=async()=>false;view.closeProfile=async()=>{};view.invalidateProfile=()=>{};
  return view;
}
export function validateRoomSelection(profile:any,catalogs:any[]):boolean {
  const union=mergeRoomCatalogs(catalogs);
  for(let i=0;i<profile.starters.length;i++){
    const starter=profile.starters[i],r=union.find(r=>r.speciesId===starter.speciesId);
    check(r,'ROOM_SPECIES_NOT_UNLOCKED');
    const u=profile.unlocks[i],cost=profile.costs[i];
    check(u.caughtAttr===r.caughtAttr&&u.natureAttr===r.natureAttr&&u.eggMoves===r.eggMoves
      &&JSON.stringify(u.ivs)===JSON.stringify(r.ivs),'ROOM_UNLOCK_MISMATCH');
    check(cost.caughtCount===r.caughtCount&&cost.hatchedCount===r.hatchedCount,'ROOM_COST_MISMATCH');
  }
  return true;
}
