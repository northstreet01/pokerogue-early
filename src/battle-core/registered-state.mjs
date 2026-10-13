import { copy, requireContract as check } from './coop-contract.mjs';

// Explicit trusted registry for adjuncts. No constructor names from the wire,
// no constructors/getArgs/defaults/clamping, and no unrestricted object copying.
export function createRegisteredStateCodec(registry) {
  const byPrototype = new Map(Object.entries(registry).map(([id, spec]) => [spec.prototype, id]));
  const fieldsOf = value => {
    const descriptors = Object.getOwnPropertyDescriptors(value);
    check(Reflect.ownKeys(descriptors).every(k => typeof k === 'string' && 'value' in descriptors[k] && descriptors[k].enumerable), 'INVALID_COMPONENT');
    return descriptors;
  };
  function restore(input) {
    const s = copy(input);
    check(s && Object.keys(s).sort().join(',') === 'fields,type,version' && s.version === 1 && Object.hasOwn(registry, s.type), 'UNSUPPORTED_COMPONENT');
    const spec = registry[s.type], fields = fieldsOf(s.fields);
    check(Object.keys(fields).sort().join(',') === Object.keys(spec.fields).sort().join(','), 'INVALID_COMPONENT');
    const candidate = Object.create(spec.prototype);
    for (const [key, codec] of Object.entries(spec.fields)) {
      for (let p = spec.prototype; p; p = Object.getPrototypeOf(p)) { const descriptor = Object.getOwnPropertyDescriptor(p, key); check(!descriptor || 'value' in descriptor, 'COMPONENT_ACCESSOR'); }
      Object.defineProperty(candidate, key, { value: codec.restore(s.fields[key]), enumerable: true, writable: true, configurable: true });
    }
    return candidate;
  }
  return { restore, capture(value) {
    const type = byPrototype.get(Object.getPrototypeOf(value)); check(type, 'UNSUPPORTED_COMPONENT');
    const spec = registry[type], fields = fieldsOf(value);
    check(Object.keys(fields).sort().join(',') === Object.keys(spec.fields).sort().join(','), 'INVALID_COMPONENT');
    const s = { version: 1, type, fields: Object.fromEntries(Object.entries(spec.fields).map(([key, codec]) => [key, codec.capture(fields[key].value)])) };
    restore(s); return s;
  } };
}
