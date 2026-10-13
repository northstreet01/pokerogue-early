import { copy, canonical, requireContract as check } from './coop-contract.mjs';

// Original catalog factories build closures/descriptions, not gameplay state.
// Generated types use explicit, validated constructor arguments. Never call a
// generator, newModifier(), getArgs(), or getPregenArgs() during recovery.
export function createModifierTypeStateCodec({ factories, recipes, Generator }) {
  const display = new Set(['name','description','iconImage','soundName']);
  const callbacks = new Set(['newModifierFunc','selectFilter','moveSelectFilter','genTypeFunc']);
  const optional = (v, key) => !Object.hasOwn(v,key) ? {presence:'absent'} : v[key] === undefined ? {presence:'undefined'} : {presence:'value',value:v[key]};
  const fields = v => Object.fromEntries(Object.keys(v).filter(k => !display.has(k) && !callbacks.has(k) && !['id','generatorId','tier'].includes(k)).map(k => [k, optional(v,k)]));
  function build(s) {
    check(Object.hasOwn(factories,s.catalogId), 'UNKNOWN_MODIFIER_TYPE');
    let type;
    if (s.recipe === null) {
      check(s.args.length === 0, 'INVALID_MODIFIER_TYPE');
      type = factories[s.catalogId]();
      check(!(type instanceof Generator), 'MISSING_MODIFIER_RECIPE');
    } else {
      const recipe = recipes[s.recipe];
      check(Object.hasOwn(recipes,s.recipe) && recipe.ids.includes(s.catalogId), 'INVALID_MODIFIER_RECIPE');
      check(s.args.length === recipe.fields.length && s.args.every((v,i) => recipe.valid[i](v)), 'INVALID_MODIFIER_ARGUMENT');
      type = recipe.create(...s.args);
    }
    return type;
  }
  function restore(input) {
    const s = copy(input);
    check(s && Object.keys(s).sort().join(',') === 'args,catalogId,fields,generatorId,id,recipe,tier,version'
      && s.version === 1 && typeof s.catalogId === 'string' && Array.isArray(s.args), 'INVALID_MODIFIER_TYPE');
    const result = build(s);
    check(canonical(fields(result)) === canonical(s.fields), 'MODIFIER_TYPE_FIELDS_MISMATCH');
    for (const key of ['id','generatorId','tier']) {
      const f = s[key]; check(f && ['absent','undefined','value'].includes(f.presence), 'INVALID_MODIFIER_TYPE');
      check(Object.keys(f).sort().join(',') === (f.presence === 'value' ? 'presence,value' : 'presence'), 'INVALID_MODIFIER_TYPE');
      if (f.presence === 'value') check(key === 'tier' ? f.value === null || Number.isInteger(f.value) && f.value >= 0 && f.value <= 4
        : typeof f.value === 'string' && (key !== 'id' || f.value === s.catalogId), 'INVALID_MODIFIER_TYPE');
      if (f.presence === 'absent') delete result[key];
      else result[key] = f.presence === 'undefined' ? undefined : f.value;
    }
    return result;
  }
  function capture(value) {
    check(value && typeof value === 'object', 'INVALID_MODIFIER_TYPE');
    const descriptors = Object.getOwnPropertyDescriptors(value);
    check(Reflect.ownKeys(descriptors).every(k => typeof k === 'string' && 'value' in descriptors[k] && descriptors[k].enumerable), 'INVALID_MODIFIER_TYPE');
    const catalogId = value.id;
    check(typeof catalogId === 'string' && Object.hasOwn(factories,catalogId), 'UNKNOWN_MODIFIER_TYPE');
    const recipe = Object.keys(recipes).find(k => Object.getPrototypeOf(value) === recipes[k].prototype);
    const s = {version:1,catalogId,recipe:recipe ?? null,args:recipe ? recipes[recipe].fields.map(k => value[k]) : [],
      fields:fields(value),id:optional(value,'id'),generatorId:optional(value,'generatorId'),tier:optional(value,'tier')};
    const restored = restore(s);
    check(Object.getPrototypeOf(restored) === Object.getPrototypeOf(value), 'MODIFIER_TYPE_MISMATCH');
    // Reject unregistered callbacks/extra display fields instead of silently
    // discarding newly added state. Function bodies are trusted catalog code.
    const expectedKeys = Object.keys(restored).filter(k => !display.has(k)).sort();
    check(canonical(Object.keys(value).filter(k => !display.has(k)).sort()) === canonical(expectedKeys), 'MODIFIER_TYPE_FIELDS_MISMATCH');
    return s;
  }
  return Object.freeze({capture,restore});
}
