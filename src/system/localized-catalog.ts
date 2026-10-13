import i18next from '../i18n';

// Upstream catalog keys use enum names in camelCase. Keep the early catalog's
// English fallback and implementation markers; never alter IDs or asset keys.
export const localeKey = (name: string) => name?.toLowerCase().replace(/_([a-z0-9])/g, (_, letter) => letter.toUpperCase());

export function catalogName(namespace: string, enumName: string, original: string): string {
  const marker = original.match(/ \([NP]\)$/)?.[0] || '';
  return i18next.t(`${namespace}:${localeKey(enumName)}${namespace === 'pokemon' ? '' : '.name'}`, {
    defaultValue: marker ? original.slice(0, -marker.length) : original
  }) + marker;
}

export function catalogDescription(namespace: string, enumName: string, field: string, original: string): string {
  const key = `${namespace}:${localeKey(enumName)}.${field}`;
  const normalize = (value: string) => value?.replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim();
  // A modern translation of changed mechanics must not describe early rules.
  if (normalize(i18next.t(key, { lng: 'en', defaultValue: '' })) !== normalize(original)) return original;
  return i18next.t(key, { defaultValue: original });
}
