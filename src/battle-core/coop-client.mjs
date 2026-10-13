import { validateMessage, assertVersions, requireAdapter, CLIENT_METHODS, requireContract, canonical, copy } from './coop-contract.mjs';

// SHA-256 over canonical JSON: sorted object keys, ordered arrays, finite numbers,
// no undefined/accessors. Projections must omit display/coordination fields.
export async function digestProjection(value) {
  const bytes = new TextEncoder().encode(canonical(value));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}

// One instance per authenticated connection; serialize application, including
// local transactions. A replaced connection must invalidate isCurrent().
export function createSnapshotConsumer({ versions, adapter, isCurrent, send }) {
  requireAdapter(adapter, CLIENT_METHODS);
  let chain = Promise.resolve(), latest = -1, runId = null;
  return message => {
    let authenticated = false;
    const task = chain.then(async () => {
      validateMessage(message, 'server');
      requireContract(message.type === 'snapshot'); assertVersions(message, versions);
      if (!isCurrent(message.connectionEpoch)) return false;
      requireContract(runId === null || runId === message.runId, 'RUN_MISMATCH');
      if (message.revision < latest) return false;
      authenticated = true;
      requireContract(await digestProjection(message.shared) === message.sharedHash && await digestProjection(message.personal) === message.personalHash, 'SNAPSHOT_CORRUPT');
      await adapter.applySnapshot(copy(message));
      if (!isCurrent(message.connectionEpoch)) return false;
      const applied = await adapter.captureAppliedState();
      const sharedHash = await digestProjection(applied.shared), personalHash = await digestProjection(applied.personal);
      requireContract(sharedHash === message.sharedHash && personalHash === message.personalHash, 'MODEL_MISMATCH');
      await adapter.applyGrantsTransaction(copy(message.grants), { runId: message.runId, seat: message.seat });
      if (!isCurrent(message.connectionEpoch)) return false;
      const finalModel = await adapter.captureAppliedState();
      requireContract(await digestProjection(finalModel.shared) === sharedHash && await digestProjection(finalModel.personal) === personalHash, 'MODEL_MISMATCH');
      if (!isCurrent(message.connectionEpoch)) return false;
      runId = message.runId; latest = message.revision;
      if (message.grants.length) send({ type: 'grantAck', roomId: message.roomId, runId, connectionEpoch: message.connectionEpoch, grantIds: message.grants.map(g => g.id) });
      send({ type: 'stateAck', roomId: message.roomId, runId, revision: message.revision, decisionId: message.decisionId, connectionEpoch: message.connectionEpoch, sharedHash, personalHash });
      return true;
    }).catch(error => {
      // Withdraw a previous ACK on duplicate/current-state application failure.
      // Caller decides when to retry; no success ACK is emitted on failure.
      if (authenticated && isCurrent(message.connectionEpoch)) send({ type: 'requestSnapshot', roomId: message.roomId, runId: message.runId, knownRevision: message.revision, reason: 'CLIENT_APPLY_FAILED' });
      throw error;
    });
    chain = task.catch(() => {});
    return task;
  };
}
