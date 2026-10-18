import { parentPort, workerData } from 'node:worker_threads';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const bundle = new URL('../build/coop-runtime/original-runtime.cjs', import.meta.url);
const code = error => /^[A-Z][A-Z0-9_]{1,79}$/.test(error?.code ?? error?.message ?? '')
  ? (error.code ?? error.message) : 'ORIGINAL_RUNTIME_FAILED';
try {
  if (!existsSync(bundle)) throw new Error('ORIGINAL_RUNTIME_BUILD_REQUIRED');
  const api = createRequire(import.meta.url)(fileURLToPath(bundle));
  const runtime = api.createOriginalRuntime(workerData.seed, workerData.identity, workerData.randomState);
  // Native phases are callable for bounded validation. This is not a mounted
  // gameplay adapter: formal IO/profile/projection/UI integration is pending.
  let chain = Promise.resolve();
  parentPort.on('message', ({ id, operation, payload }) => { chain = chain.then(async () => {
    try {
      if (!Number.isSafeInteger(id) || id < 1) throw new Error('INVALID_RUNTIME_REQUEST');
      const value = await api.executeRuntimeOperation(runtime, operation, payload);
      parentPort.postMessage({ id, value });
    } catch (error) { parentPort.postMessage({ id, error: code(error) }); }
  }); });
  parentPort.postMessage({ type: 'ready', stage: 'model-bootstrap', gameplayReady: false });
} catch (error) { parentPort.postMessage({ type: 'failed', error: code(error) }); }
