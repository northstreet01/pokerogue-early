import { copy, requireContract as check } from './coop-contract.mjs';

const fields = ['command', 'cursor', 'move', 'targets', 'skip', 'args'];
const integer = (n, min, max) => Number.isSafeInteger(n) && n >= min && n <= max;
const plain = value => check(value && Object.getPrototypeOf(value) === Object.prototype, 'INVALID_COMMAND');
function data(value, allowed) {
  plain(value);
  for (const key of Reflect.ownKeys(value)) {
    const d = Object.getOwnPropertyDescriptor(value, key);
    check(allowed.includes(key) && d.enumerable && 'value' in d, 'INVALID_COMMAND');
  }
}
function targets(value) {
  check(Array.isArray(value) && value.length <= 4 && new Set(value).size === value.length
    && value.every(n => integer(n, -1, 3)), 'INVALID_COMMAND_TARGETS');
}
function validate(command) {
  data(command, fields);
  check(integer(command.command, 0, 3), 'INVALID_COMMAND');
  if (command.cursor !== undefined) check(integer(command.cursor, -1, 9999), 'INVALID_COMMAND_CURSOR');
  if (command.skip !== undefined) check(typeof command.skip === 'boolean', 'INVALID_COMMAND');
  if (command.targets !== undefined) targets(command.targets);
  if (command.move !== undefined) {
    data(command.move, ['move','targets','ignorePP']);
    check(command.command === 0 && integer(command.move.move, 0, 65535), 'INVALID_COMMAND_MOVE');
    targets(command.move.targets);
    if (command.move.ignorePP !== undefined) check(typeof command.move.ignorePP === 'boolean', 'INVALID_COMMAND');
  }
  if (command.args !== undefined) {
    check(Array.isArray(command.args) && command.args.length <= 3, 'INVALID_COMMAND_ARGS');
    command.args.forEach((arg, i) => {
      if (i === 0) check(arg === undefined || typeof arg === 'boolean', 'INVALID_COMMAND_ARGS');
      else { data(arg, ['targets','multiple']); targets(arg.targets); check(typeof arg.multiple === 'boolean', 'INVALID_COMMAND_ARGS'); }
    });
  }
  if (!command.skip) {
    if (command.command === 0) check(command.move !== undefined, 'INVALID_COMMAND_MOVE');
    if (command.command === 1) check(integer(command.cursor, 0, 4) && command.targets?.length === 1, 'INVALID_COMMAND');
    if (command.command === 2) check(integer(command.cursor, 0, 9999) && command.args?.length === 1, 'INVALID_COMMAND');
  }
}
// Preserve absent versus explicitly undefined original optional properties. JSON
// alone would lose ignorePP and undefined queue args, changing replay inputs.
function pack(value, depth = 0) {
  check(depth < 8, 'INVALID_COMMAND');
  if (value === undefined) return { undefined: true };
  if (Array.isArray(value)) {
    check(value.length <= 10 && Reflect.ownKeys(value).length === value.length + 1, 'INVALID_COMMAND');
    return { array: Array.from({length:value.length}, (_, i) => {
      const d = Object.getOwnPropertyDescriptor(value, i);
      check(d && 'value' in d && d.enumerable, 'INVALID_COMMAND'); return pack(d.value, depth + 1);
    }) };
  }
  if (value !== null && typeof value === 'object') {
    plain(value);
    check(Reflect.ownKeys(value).every(k=>typeof k==='string'), 'INVALID_COMMAND');
    return { object: Object.fromEntries(Object.entries(Object.getOwnPropertyDescriptors(value)).map(([key, d]) => {
      check('value' in d && d.enumerable, 'INVALID_COMMAND'); return [key, pack(d.value, depth + 1)];
    })) };
  }
  check(value === null || typeof value === 'boolean' || typeof value === 'string' || typeof value === 'number' && Number.isFinite(value), 'INVALID_COMMAND');
  return { value };
}
function unpack(value, depth = 0) {
  check(depth < 8 && Object.keys(value).length === 1, 'INVALID_COMMAND');
  if (Object.hasOwn(value, 'undefined')) { check(value.undefined === true, 'INVALID_COMMAND'); return undefined; }
  if (Object.hasOwn(value, 'array')) { check(Array.isArray(value.array) && value.array.length <= 10, 'INVALID_COMMAND'); return value.array.map(v => unpack(v, depth + 1)); }
  if (Object.hasOwn(value, 'object')) { plain(value.object); return Object.fromEntries(Object.entries(value.object).map(([k,v]) => [k, unpack(v, depth + 1)])); }
  check(Object.hasOwn(value, 'value') && (value.value === null || ['number','boolean','string'].includes(typeof value.value)), 'INVALID_COMMAND');
  return value.value;
}
export function captureTurnCommands(commands) {
  data(commands, ['-1','0','1','2','3']);
  check(Object.keys(commands).length === 5 && commands[-1] === null, 'INVALID_COMMAND_QUEUE');
  return Object.fromEntries(Object.entries(commands).map(([slot, command]) => {
    if (command === null) return [slot, null];
    const state = pack(command); validate(unpack(state)); return [slot, state];
  }));
}
export function restoreTurnCommands(input) {
  const saved = copy(input); data(saved, ['-1','0','1','2','3']);
  check(Object.keys(saved).length === 5 && saved[-1] === null, 'INVALID_COMMAND_QUEUE');
  return Object.fromEntries(Object.entries(saved).map(([slot, state]) => {
    if (state === null) return [slot, null];
    const command = unpack(state); validate(command); return [slot, command];
  }));
}
