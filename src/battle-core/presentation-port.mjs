const ports = new WeakMap();
export function bindPresentationPort(scene, port) {
  if (ports.has(scene) || typeof port !== 'function') throw new Error('INVALID_PRESENTATION_PORT');
  ports.set(scene, port);
  return () => ports.delete(scene);
}
export function presentOnHost(scene, kind, payload) {
  const port = ports.get(scene);
  if (!port) return false;
  port(kind, payload); return true;
}
