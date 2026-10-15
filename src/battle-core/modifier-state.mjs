import { copy, requireContract as check } from './coop-contract.mjs';
import { modifierFields } from './modifier-fields.mjs';

export function modifierSchema(name) {
  check(Object.hasOwn(modifierFields, name), 'UNKNOWN_MODIFIER');
  const spec = modifierFields[name];
  return { ...(spec.parent ? modifierSchema(spec.parent) : {}), ...spec.fields };
}
const exact = (v, keys) => check(v && typeof v === 'object' && !Array.isArray(v)
  && Object.keys(v).sort().join(',') === [...keys].sort().join(','), 'INVALID_MODIFIER');
export function createModifierStateCodec({ constructors, typeCodec, enums }) {
  const names = Object.keys(modifierFields).filter(n => !modifierFields[n].abstract);
  check(names.every(n => typeof constructors[n] === 'function'), 'INCOMPLETE_MODIFIER_REGISTRY');
  const byPrototype = new Map(names.map(n => [constructors[n].prototype, n]));
  const heldItem=name=>name==='PokemonHeldItemModifier'||!!modifierFields[name]?.parent&&heldItem(modifierFields[name].parent);
  function scalar(key, type, value, nullableHeldItem) {
    // Original Battle.addPostBattleLoot clears the defeated holder before the
    // same item is staged for later allocation. Other modifier IDs stay numeric.
    if(key==='pokemonId'&&value===null&&nullableHeldItem)return null;
    if (type === 'boolean') check(typeof value === 'boolean', 'INVALID_MODIFIER_FIELD');
    else {
      check(typeof value === 'number' && Number.isFinite(value), 'INVALID_MODIFIER_FIELD');
      // boostMultiplier is declared integer in early but stores fractions.
      if (type !== 'number' && key !== 'boostMultiplier') check(Number.isSafeInteger(value), 'INVALID_MODIFIER_FIELD');
      if (!['integer','number'].includes(type)) check(enums && Object.hasOwn(enums,type) && typeof enums[type][value] === 'string', 'INVALID_MODIFIER_ENUM');
      if (['stackCount','virtualStackCount','count','upPoints'].includes(key)) check(value >= 0, 'INVALID_MODIFIER_FIELD');
      if (['pokemonId','fusePokemonId'].includes(key)) check(value >= -1 && value <= 4294967295, 'INVALID_MODIFIER_FIELD');
    }
    return value;
  }
  function restore(input) {
    const s = copy(input); exact(s, ['version','type','fields']);
    check(s.version === 1 && names.includes(s.type), 'UNSUPPORTED_MODIFIER');
    const schema = modifierSchema(s.type); exact(s.fields, Object.keys(schema));
    const result = Object.create(constructors[s.type].prototype);
    for (const [key, type] of Object.entries(schema)) {
      const field = s.fields[key];
      check(field && ['absent','undefined','value'].includes(field.presence), 'INVALID_MODIFIER_FIELD');
      exact(field, field.presence === 'value' ? ['presence','value'] : ['presence']);
      check(field.presence === 'value' || key === 'battlesLeft' && field.presence === 'undefined', 'MISSING_MODIFIER_FIELD');
      for (let p = Object.getPrototypeOf(result); p; p = Object.getPrototypeOf(p)) {
        const d = Object.getOwnPropertyDescriptor(p, key); check(!d || 'value' in d, 'MODIFIER_ACCESSOR');
      }
      if (field.presence !== 'absent') Object.defineProperty(result, key, { enumerable: true, writable: true, configurable: true,
        value: field.presence === 'undefined' ? undefined : key === 'type' ? typeCodec.restore(field.value) : scalar(key, type, field.value,heldItem(s.type)) });
    }
    return result;
  }
  function capture(value) {
    const name = value && byPrototype.get(Object.getPrototypeOf(value)); check(name, 'UNSUPPORTED_MODIFIER');
    const schema = modifierSchema(name), descriptors = Object.getOwnPropertyDescriptors(value);
    check(Reflect.ownKeys(descriptors).every(k => typeof k === 'string' && Object.hasOwn(schema, k)
      && 'value' in descriptors[k] && descriptors[k].enumerable), 'INVALID_MODIFIER_FIELD');
    const fields = Object.fromEntries(Object.keys(schema).map(key => [key, !Object.hasOwn(descriptors, key) ? {presence:'absent'}
      : descriptors[key].value === undefined ? {presence:'undefined'}
      : {presence:'value',value:key === 'type' ? typeCodec.capture(descriptors[key].value) : descriptors[key].value}]));
    const saved = { version:1, type:name, fields }; restore(saved); return saved;
  }
  return Object.freeze({capture, restore, validate: s => {restore(s);}});
}
