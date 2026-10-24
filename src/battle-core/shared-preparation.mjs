import {canonical,copy,requireContract as check} from './coop-contract.mjs';

// Shared inventory coordinates the existing original menus/effects. It never
// computes prices, grants modifiers, charges money or draws a second pool.
export function validateSharedPreparation(d){
 if(!Object.hasOwn(d,'shared'))return;
 const s=d.shared;
 check(s&&Object.keys(s).sort().join(',')==='rewardClaims,shopClaims,version'&&s.version===1,'INVALID_SHARED_MARKET');
 check(canonical(d.players[0].rewards)===canonical(d.players[1].rewards)
   &&canonical(d.players[0].shop)===canonical(d.players[1].shop)
   &&d.players[0].rerollCount===d.players[1].rerollCount&&d.players[0].rerollCost===d.players[1].rerollCost,'SHARED_MARKET_DIVERGED');
 for(const [key,options] of [['rewardClaims',d.players[0].rewards],['shopClaims',d.players[0].shop]]){
  const rows=s[key];check(Array.isArray(rows)&&rows.length<=options.length,'INVALID_SHARED_CLAIM');
  const ids=new Set(),owners=new Set();
  for(const claim of rows){
   check(claim&&Object.keys(claim).sort().join(',')==='optionId,seat'&&[0,1].includes(claim.seat)
    &&options.some(o=>o.id===claim.optionId)&&!ids.has(claim.optionId),'INVALID_SHARED_CLAIM');ids.add(claim.optionId);
   if(key==='rewardClaims'){check(!owners.has(claim.seat)&&d.players[claim.seat].rewardResolved,'INVALID_SHARED_CLAIM');owners.add(claim.seat);}
  }
 }
}
export function validateSharedPreparationAction(c,seat,action){
 const d=c.decision;if(!d.shared)return;
 check(!d.players[seat].rewardResolved,'PREPARATION_ALREADY_FINISHED');
 check(!['ready','unready'].includes(action.operation),'PREPARATION_AUTOMATIC_COMPLETION');
 if(action.operation==='reroll')check(!d.players.some(p=>p.rewardResolved),'SHARED_REWARD_POOL_LOCKED');
 if(['reward','buy'].includes(action.operation)){
  const claims=action.operation==='reward'?d.shared.rewardClaims:d.shared.shopClaims;
  check(!claims.some(claim=>claim.optionId===action.optionId),'SHARED_ITEM_UNAVAILABLE');
 }
}
export function recordSharedPreparationEffect(c,seat,action){
 const d=c.decision;if(!d.shared)return;
 if(action.operation==='reward')d.shared.rewardClaims.push({optionId:action.optionId,seat});
 if(action.operation==='buy')d.shared.shopClaims.push({optionId:action.optionId,seat});
 if(action.operation==='reroll'){
  const mine=d.players[seat],peer=d.players[1-seat];
  for(const key of ['rewards','rerollCount','rerollCost'])peer[key]=copy(mine[key]);
  // The original callback still indexes the fixed paid catalog, including sold
  // entries. Reroll never replenishes stock or changes the shared paid catalog.
  mine.shop=copy(peer.shop);
  for(const effect of c.pendingEffects)if(effect.remaining==='reward-select')effect.phase.rerollCount=mine.rerollCount;
 }
}
export function initializeSharedPreparation(d){
 d.shared={version:1,rewardClaims:[],shopClaims:[]};
 for(const key of ['rewards','shop','rerollCount','rerollCost'])d.players[1][key]=copy(d.players[0][key]);
 validateSharedPreparation(d);
}
