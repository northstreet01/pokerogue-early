import { copy, requireContract as check } from './coop-contract.mjs';

export const modifierPoolFields = Object.freeze([
  'modifierPoolThresholds','ignoredPoolIndexes','dailyStarterModifierPoolThresholds','ignoredDailyStarterPoolIndexes',
  'enemyModifierPoolThresholds','enemyIgnoredPoolIndexes','enemyBuffModifierPoolThresholds','enemyBuffIgnoredPoolIndexes'
]);
export const createModifierPoolState = () => Object.fromEntries(modifierPoolFields.map(k=>[k,{}]));
export function restoreModifierPoolState(input) {
  const s=copy(input);
  check(s && Object.keys(s).sort().join(',')===[...modifierPoolFields].sort().join(','), 'INVALID_MODIFIER_POOLS');
  for(const [name,tiers] of Object.entries(s)) {
    check(tiers && !Array.isArray(tiers) && typeof tiers==='object', 'INVALID_MODIFIER_POOLS');
    for(const [tier,values] of Object.entries(tiers)) {
      check(/^[0-4]$/.test(tier), 'INVALID_MODIFIER_POOLS');
      if(name.toLowerCase().includes('ignored')) {
        check(Array.isArray(values) && values.length<=10000 && new Set(values).size===values.length
          && values.every(v=>Number.isSafeInteger(v)&&v>=0&&v<10000), 'INVALID_MODIFIER_POOLS');
      } else {
        check(values && !Array.isArray(values) && typeof values==='object' && Object.keys(values).length<=10000, 'INVALID_MODIFIER_POOLS');
        for(const [threshold,index] of Object.entries(values)) check(String(Number(threshold))===threshold && Number.isFinite(Number(threshold)) && Number(threshold)>0
          && Number.isSafeInteger(index) && index>=0 && index<10000, 'INVALID_MODIFIER_POOLS');
      }
    }
  }
  return s;
}
export const captureModifierPoolState = restoreModifierPoolState;
