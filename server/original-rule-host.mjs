import { Worker } from 'node:worker_threads';

const failure = code => Object.assign(new Error(code), { code });

/** One independent original module graph per room. No test helpers, browser
 * globals, saves or renderer are loaded in the HTTP/WebSocket process. */
export async function createOriginalRuleHost({ seed, identity, randomState, timeoutMs = 15000 }) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) throw failure('INVALID_RUNTIME_TIMEOUT');
  const worker = new Worker(new URL('./original-rule-worker.mjs', import.meta.url), {
    workerData: { seed, identity, randomState }, execArgv: [], stdout: true, stderr: true
  });
  // Original constructors currently log moves / shiny rolls. Keep them out of
  // server output (and never forward profile data to a remote client).
  worker.stdout.resume(); worker.stderr.resume();
  let closed = false, closeTask, sequence = 0, readyResolve, readyReject, readyTimer;
  const pending = new Map();
  const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  const rejectPending = error => {
    readyReject(error); clearTimeout(readyTimer);
    for (const item of pending.values()) { clearTimeout(item.timer); item.reject(error); }
    pending.clear();
  };
  function close(code = 'ORIGINAL_RUNTIME_CLOSED') {
    if (closeTask) return closeTask;
    closed = true; rejectPending(failure(code));
    closeTask = worker.terminate().then(() => {});
    return closeTask;
  }
  worker.on('error', () => { void close('ORIGINAL_RUNTIME_FAILED'); });
  worker.on('exit', () => { if (!closed) { closed = true; rejectPending(failure('ORIGINAL_RUNTIME_EXITED')); } });
  worker.on('message', message => {
    if (message.type === 'ready') { clearTimeout(readyTimer); readyResolve(message); return; }
    if (message.type === 'failed') { void close(message.error); return; }
    const item = pending.get(message.id);
    if (!item) return;
    pending.delete(message.id); clearTimeout(item.timer);
    if (message.error) item.reject(failure(message.error)); else item.resolve(message.value);
  });
  readyTimer = setTimeout(() => { void close('ORIGINAL_RUNTIME_TIMEOUT'); }, timeoutMs);
  const readiness = await ready;
  return Object.freeze({
    readiness,
    request(operation, payload = null) {
      if (closed) return Promise.reject(failure('ORIGINAL_RUNTIME_CLOSED'));
      if (!['catalogs', 'state', 'construct', 'construct-starter', 'roundtrip', 'validate-profile', 'normalize-profile', 'normalize-profile-draft', 'project-profile-selection', 'native-start', 'native-step', 'native-open-to-input', 'native-open-selected', 'native-open-selected-to-input', 'native-run-to-boundary', 'native-validate', 'native-submit', 'native-preparation', 'native-prepare-action', 'native-next', 'native-switch', 'native-validate-preparation', 'native-validate-switch', 'native-progression', 'native-validate-progression', 'native-validate-checkpoint', 'native-validate-eggs', 'native-project'].includes(operation)) return Promise.reject(failure('UNSUPPORTED_RUNTIME_OPERATION'));
      const id = ++sequence;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { void close('ORIGINAL_RUNTIME_TIMEOUT'); }, timeoutMs);
        pending.set(id, { resolve, reject, timer });
        try { worker.postMessage({ id, operation, payload }); }
        catch { pending.delete(id); clearTimeout(timer); reject(failure('INVALID_RUNTIME_PAYLOAD')); }
      });
    },
    close
  });
}
