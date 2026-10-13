import { copy, requireContract as check } from './coop-contract.mjs';

// Every Trainer declaration is accounted for by the source coverage test.
// Container fields (including scene/sprites) are deliberately not serialized.
export const trainerStateFields = Object.freeze(['config', 'variant', 'partyTemplateIndex', 'name', 'partnerName']);
const exact = (value, keys) => check(value && !Array.isArray(value) && typeof value === 'object'
  && Object.keys(value).sort().join(',') === [...keys].sort().join(','), 'INVALID_TRAINER');
function own(value, key) {
  const d = Object.getOwnPropertyDescriptor(value, key);
  check(d && 'value' in d && d.enumerable, 'INVALID_TRAINER_FIELD');
  return d.value;
}
function nameState(value, key) {
  if (!Object.hasOwn(value, key)) return { presence: 'absent' };
  const name = own(value, key);
  return name === undefined ? { presence: 'undefined' } : { presence: 'value', value: name };
}

/** Trusted original constructor and config catalog only. Restored models are
 * detached rule objects, not renderable Containers. No constructors/RNG/hooks.
 * Names are retained for checkpoint fidelity; omit them in battle hash views. */
export function createTrainerStateCodec({ Trainer, trainerConfigs }) {
  check(typeof Trainer === 'function' && Trainer.prototype && trainerConfigs, 'INVALID_TRAINER_REGISTRY');
  function configFor(id) {
    check(Number.isSafeInteger(id) && id >= 0 && Object.hasOwn(trainerConfigs, id), 'UNKNOWN_TRAINER_CONFIG');
    const config = trainerConfigs[id];
    check(config?.trainerType === id && Array.isArray(config.partyTemplates), 'INVALID_TRAINER_CONFIG');
    return config;
  }
  function restore(input) {
    const s = copy(input);
    exact(s, ['version','type','configId','variant','partyTemplateIndex','name','partnerName']);
    check(s.version === 1 && s.type === 'Trainer', 'UNSUPPORTED_TRAINER');
    const config = configFor(s.configId);
    check(Number.isInteger(s.variant) && s.variant >= 0 && s.variant <= 2, 'INVALID_TRAINER_VARIANT');
    // The original constructor produces -1 for an empty template list. A
    // dynamic partyTemplateFunc may supply its template later using the scene.
    check(Number.isSafeInteger(s.partyTemplateIndex) && (config.partyTemplates.length
      ? s.partyTemplateIndex >= 0 && s.partyTemplateIndex < config.partyTemplates.length
      : s.partyTemplateIndex === -1), 'INVALID_TRAINER_TEMPLATE');
    const result = Object.create(Trainer.prototype);
    const set = (key, value) => {
      for (let p = Trainer.prototype; p; p = Object.getPrototypeOf(p)) {
        const d = Object.getOwnPropertyDescriptor(p, key);
        check(!d || 'value' in d, 'TRAINER_ACCESSOR');
      }
      Object.defineProperty(result, key, { value, writable: true, configurable: true, enumerable: true });
    };
    set('config', config); set('variant', s.variant); set('partyTemplateIndex', s.partyTemplateIndex);
    for (const key of ['name','partnerName']) {
      const n = s[key];
      check(n && ['absent','undefined','value'].includes(n.presence), 'INVALID_TRAINER_NAME');
      exact(n, n.presence === 'value' ? ['presence','value'] : ['presence']);
      if (n.presence === 'value') check(n.value === null || typeof n.value === 'string', 'INVALID_TRAINER_NAME');
      if (n.presence !== 'absent') set(key, n.presence === 'undefined' ? undefined : n.value);
    }
    return result;
  }
  function capture(value) {
    check(value && Object.getPrototypeOf(value) === Trainer.prototype, 'UNSUPPORTED_TRAINER');
    const config = own(value, 'config'), id = config?.trainerType;
    check(configFor(id) === config, 'UNKNOWN_TRAINER_CONFIG');
    const s = { version: 1, type: 'Trainer', configId: id, variant: own(value, 'variant'),
      partyTemplateIndex: own(value, 'partyTemplateIndex'), name: nameState(value, 'name'), partnerName: nameState(value, 'partnerName') };
    restore(s); return s;
  }
  return Object.freeze({ capture, restore, validate: input => { restore(input); } });
}
