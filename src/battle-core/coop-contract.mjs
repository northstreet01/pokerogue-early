// Formal transport only. Game decisions and checkpoint payloads belong to the
// original-rule adapter, never to the experimental engine.
export const PROTOCOL_VERSION = 1;
export const CHECKPOINT_VERSION = 1;
export class ContractError extends Error {
  constructor(code) { super(code); this.code = code; }
}
export function requireContract(condition, code = 'INVALID_MESSAGE') {
  if (!condition) throw new ContractError(code);
}
export function canonical(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) {
    requireContract(Object.keys(value).length === value.length, 'INVALID_JSON');
    const items = [];
    for (let index = 0; index < value.length; index++) {
      const descriptor = Object.getOwnPropertyDescriptor(value, index);
      requireContract(descriptor && 'value' in descriptor, 'INVALID_JSON');
      items.push(canonical(descriptor.value));
    }
    return '[' + items.join(',') + ']';
  }
  requireContract(value && Object.getPrototypeOf(value) === Object.prototype, 'INVALID_JSON');
  return '{' + Object.keys(value).sort().map(key => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    requireContract('value' in descriptor && !['__proto__', 'prototype', 'constructor'].includes(key), 'INVALID_JSON');
    return JSON.stringify(key) + ':' + canonical(descriptor.value);
  }).join(',') + '}';
}
export const copy = value => JSON.parse(canonical(value));
const string = value => typeof value === 'string' && value.length > 0 && value.length <= 128;
const integer = value => Number.isSafeInteger(value) && value >= 0;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const seat = value => value === 0 || value === 1;
const versions = { protocolVersion: integer, rulesVersion: string, contentHash: string, checkpointVersion: integer };
const identity = { roomId: string, runId: string };
const state = { ...identity, revision: integer, decisionId: string };
const fields = {
  hello: versions,
  createRoom: { name: v => string(v) && v.trim().length > 0 && v.length <= 24 },
  joinRoom: { roomId: string, name: v => string(v) && v.trim().length > 0 && v.length <= 24 },
  resumeSeat: { roomId: string, resumeToken: string },
  submitAction: { ...identity, decisionId: string, expectedRevision: integer, actionId: string, action: v => object(v) && string(v.kind) },
  stateAck: { ...state, connectionEpoch: string, sharedHash: digest, personalHash: digest },
  grantAck: { ...identity, connectionEpoch: string, grantIds: v => Array.isArray(v) && v.length <= 100 && v.every(string) },
  requestSnapshot: { ...identity, knownRevision: integer, reason: string },
  recoverDecision: { ...state, connectionEpoch: string },
  welcome: { ...versions, roomId: v => v === null || string(v), seat: v => v === null || seat(v), connectionEpoch: v => v === null || string(v), resumeToken: v => v === null || string(v) },
  roomPresence: {...identity, players:v=>Array.isArray(v)&&v.length===2&&v.every(name=>name===null||string(name)&&name.length<=24)},
  actionReceipt: { ...state, actionId: string, accepted: v => typeof v === 'boolean', code: string },
  snapshot: { ...versions, ...state, connectionEpoch: string, seat, shared: object, personal: object, sharedHash: digest, personalHash: digest, events: Array.isArray, grants: Array.isArray },
  syncStatus: { ...identity, revision: integer, online: v => Array.isArray(v) && v.length === 2 && v.every(x => typeof x === 'boolean'), acked: v => Array.isArray(v) && v.length === 2 && v.every(x => typeof x === 'boolean'), submitted: v => Array.isArray(v) && v.length === 2 && v.every(x => typeof x === 'boolean'), blocked: v => typeof v === 'boolean', reason: string },
  error: { code: string }
};
const clientTypes = new Set(['hello','createRoom','joinRoom','resumeSeat','submitAction','stateAck','grantAck','requestSnapshot','recoverDecision']);
export function validateMessage(message, direction = 'client') {
  canonical(message);
  requireContract(object(message) && typeof message.type === 'string' && Object.hasOwn(fields, message.type));
  requireContract(clientTypes.has(message.type) === (direction === 'client'));
  const schema = fields[message.type];
  requireContract(Object.keys(message).length === Object.keys(schema).length + 1);
  for (const [key, check] of Object.entries(schema)) requireContract(Object.hasOwn(message, key) && check(message[key]));
  if (message.type === 'snapshot') for (const grant of message.grants) {
    requireContract(object(grant) && Object.keys(grant).length === 3 && string(grant.id) && seat(grant.seat) && object(grant.payload));
    requireContract(grant.seat === message.seat);
  }
  return message;
}
export function assertVersions(actual, expected) {
  for (const key of Object.keys(versions)) requireContract(actual[key] === expected[key], 'VERSION_MISMATCH');
}
export const SERVER_METHODS = ['createInitialContext','validateAction','advanceToDecision','captureCheckpoint','validateCheckpoint','restoreCheckpoint','projectSnapshot','describeDecision'];
export const CLIENT_METHODS = ['applySnapshot','captureAppliedState','applyGrantsTransaction'];
export function requireAdapter(adapter, methods) {
  requireContract(adapter && methods.every(key => typeof adapter[key] === 'function'), 'ADAPTER_UNAVAILABLE');
  return adapter;
}
