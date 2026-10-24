// The personal save/unlock transaction is deferred in co-op. Only a trusted
// native Phase execution binds this port; solo GameOver keeps its original path.
const endings=new WeakMap();
export function bindCoopGameOver(phase,complete){
 if(endings.has(phase)||typeof complete!=='function')throw Error('INVALID_COOP_GAME_OVER_BINDING');
 endings.set(phase,complete);return ()=>endings.delete(phase);
}
export function deferCoopGameOver(phase){
 const complete=endings.get(phase);if(!complete)return false;
 complete();return true;
}
