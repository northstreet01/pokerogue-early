import {requireContract as check} from './coop-contract.mjs';

const keys=['id','gachaType','hatchWaves','timestamp'];
const exact=(value,names)=>{
  check(value&&typeof value==='object'&&!Array.isArray(value)
    &&Object.keys(value).sort().join(',')===[...names].sort().join(','),'INVALID_EGG_STATE');
  for(const descriptor of Object.values(Object.getOwnPropertyDescriptors(value)))check('value'in descriptor,'EGG_ACCESSOR');
};

// Original Egg/EggData fields only. Tier is derived by the original pure Egg
// constructor; never generate a Pokemon, roll RNG or access a collection here.
export function createOwnedEggStateCodec({Egg,seed,gachaTypes,tiers}){
  const validate=value=>{
    exact(value,keys);
    check(Number.isSafeInteger(value.id)&&value.id>=0&&tiers.includes(Math.floor(value.id/seed))
      &&gachaTypes.includes(value.gachaType)&&Number.isSafeInteger(value.hatchWaves)
      &&Number.isSafeInteger(value.timestamp)&&value.timestamp>=0,'INVALID_EGG_STATE');
  };
  const captureEgg=egg=>{
    check(Object.getPrototypeOf(egg)===Egg.prototype,'UNSUPPORTED_EGG_MODEL');
    exact(egg,[...keys,'tier']);
    for(const descriptor of Object.values(Object.getOwnPropertyDescriptors(egg)))check('value'in descriptor,'EGG_ACCESSOR');
    const saved=Object.fromEntries(keys.map(k=>[k,egg[k]]));validate(saved);
    check(egg.tier===Math.floor(egg.id/seed),'INVALID_EGG_TIER');return saved;
  };
  return Object.freeze({
    capture(state){
      exact(state,['players']);check(Array.isArray(state.players)&&state.players.length===2,'INVALID_EGG_STATE');
      const objects=new Set();return {players:state.players.map(row=>{
        check(Array.isArray(row)&&row.length<=10000,'INVALID_EGG_STATE');const ids=new Set();
        return row.map(egg=>{const saved=captureEgg(egg);check(!objects.has(egg)&&!ids.has(saved.id),'DUPLICATE_OWNED_EGG');objects.add(egg);ids.add(saved.id);return saved;});
      })};
    },
    restore(saved){
      exact(saved,['players']);check(Array.isArray(saved.players)&&saved.players.length===2,'INVALID_EGG_STATE');
      return {players:saved.players.map(row=>{
        check(Array.isArray(row)&&row.length<=10000,'INVALID_EGG_STATE');const ids=new Set();return row.map(value=>{
          validate(value);check(!ids.has(value.id),'DUPLICATE_OWNED_EGG');ids.add(value.id);
          return new Egg(value.id,value.gachaType,value.hatchWaves,value.timestamp);
        });
      })};
    }
  });
}
