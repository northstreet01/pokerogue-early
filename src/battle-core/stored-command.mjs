import {canonical,requireContract as check} from './coop-contract.mjs';
// A previously validated player's narrow intent can wait behind a forced target.
// Original Phase arguments, ignorePP and rule commands are never accepted here.
export function readStoredCommandIntent(text,context,seat){
 check([0,1].includes(seat)&&typeof text==='string'&&text.length<=1024,'INVALID_STORED_COMMAND');
 let action;try{action=JSON.parse(text);}catch{check(false,'INVALID_STORED_COMMAND');}
 check(action&&typeof action==='object'&&!Array.isArray(action)&&canonical(action)===text,'INVALID_STORED_COMMAND');
 check(['fight','ball','switch'].includes(action.kind),'INVALID_STORED_COMMAND');
 const expected={fight:['kind','pokemonId','cursor','target'],ball:['kind','pokeballType','targetId'],switch:['kind','pokemonId']}[action.kind];
 check(expected&&Object.keys(action).sort().join(',')===expected.sort().join(','),'INVALID_STORED_COMMAND');
 const id=context.roster.field[seat],actor=context.roster.entries.find(e=>e.pokemon.id===id);
 check(actor?.owner===seat&&actor.pokemon.hp>0&&actor.pokemon.getMoveQueue().length===0,'INVALID_STORED_COMMAND');
 if(action.kind==='fight')check(action.pokemonId===id&&Number.isInteger(action.cursor)&&action.cursor>=0&&action.cursor<actor.pokemon.getMoveset().length
   &&(action.target===null||Number.isInteger(action.target)&&action.target>=0&&action.target<4),'INVALID_STORED_COMMAND');
 else if(action.kind==='ball')check(Number.isInteger(action.pokeballType)&&action.pokeballType>=0&&action.pokeballType<5
   &&context.roster.entries.some(e=>e.owner===null&&e.group==='enemy'&&e.pokemon.id===action.targetId&&e.pokemon.hp>0&&context.roster.field.includes(action.targetId)),'INVALID_STORED_COMMAND');
 else check(context.roster.entries.some(e=>e.owner===seat&&e.group==='party'&&e.index>0&&e.pokemon.id===action.pokemonId&&e.pokemon.hp>0),'INVALID_STORED_COMMAND');
 return action;
}
