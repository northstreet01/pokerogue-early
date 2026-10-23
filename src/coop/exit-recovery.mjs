// Contains no room identifiers or credentials. Independent fallback when IDB is
// blocked, fails, or is still opening during navigation.
const KEY = 'coop-play-auto-resume-paused';
export function pauseAutoResume() {
  let saved = false;
  for (const name of ['localStorage', 'sessionStorage']) {
    try { globalThis[name].setItem(KEY, '1'); saved = true; } catch { /* URL fallback remains available. */ }
  }
  return saved;
}
export function autoResumePaused() {
  if (new URLSearchParams(globalThis.location?.search ?? '').get('fresh') === '1') return true;
  for (const name of ['localStorage', 'sessionStorage']) {
    try { if (globalThis[name].getItem(KEY) === '1') return true; } catch { /* IDB still protects ordinary reload. */ }
  }
  return false;
}
export function allowAutoResume() {
  for (const name of ['localStorage', 'sessionStorage']) {
    try { globalThis[name].removeItem(KEY); } catch { /* Never claim success for unavailable storage. */ }
  }
  // Explicit new-session activation has committed before removing fresh mode.
  if (globalThis.location?.search && globalThis.history?.replaceState) {
    const url = new URL(globalThis.location.href);
    url.searchParams.delete('fresh');
    globalThis.history.replaceState(null, '', url);
  }
}
