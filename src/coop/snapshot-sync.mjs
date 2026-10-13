import { ENGINE_VERSION, RULES_HASH, clone, stateHash } from './engine.mjs';

// A write may outlive its WebSocket. Never acknowledge its result on a replacement connection.
export async function applySnapshot(message, { isCurrent, saveGrants, send, canAcknowledge }) {
  if (!isCurrent()) return null;
  if (message.version !== ENGINE_VERSION || message.rulesHash !== RULES_HASH) throw new Error('规则版本不匹配');
  const model = message.state ? clone(message.state) : null;
  if (model && stateHash(model) !== message.hash) throw new Error('收到的战斗状态校验失败');
  if (message.grants.length) {
    await saveGrants(message.grants);
    if (!isCurrent()) return null;
    send({ type: 'grantAck', ids: message.grants.map(grant => grant.id) });
  }
  if (!isCurrent()) return null;
  if (canAcknowledge() && !message.storageError && model && message.barrier && !message.acked[message.seat])
    send({ type: 'ack', revision: model.revision, hash: stateHash(model) });
  return model;
}
