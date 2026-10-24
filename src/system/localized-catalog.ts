import i18next from '../i18n';
import {presentationText,rememberPresentationText} from './presentation-text.mjs';

// Upstream catalog keys use enum names in camelCase. Keep the early catalog's
// English fallback and implementation markers; never alter IDs or asset keys.
export const localeKey = (name: string) => name?.toLowerCase().replace(/_([a-z0-9])/g, (_, letter) => letter.toUpperCase());

export function catalogName(namespace: string, enumName: string, original: string): string {
  const marker = original.match(/ \([NP]\)$/)?.[0] || '';
  // Early Z moves separate their damage category with two underscores. The
  // upstream display catalog uses the same category with one separator.
  const displayEnum = namespace === 'move' ? enumName?.replace(/__(PHYSICAL|SPECIAL)$/, '_$1') : enumName;
  const name=i18next.t(`${namespace}:${localeKey(displayEnum)}${namespace === 'pokemon' ? '' : '.name'}`, {
    defaultValue: marker ? original.slice(0, -marker.length) : original
  });
  const provenance=presentationText(name);
  return provenance&&marker?rememberPresentationText(name+marker,{...provenance,suffix:marker}):name+marker;
}

export function catalogDescription(namespace: string, enumName: string, field: string, original: string): string {
  const key = `${namespace}:${localeKey(enumName)}.${field}`;
  const normalize = (value: string) => value?.replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim();
  const earlyKey=`earlyCatalog:${namespace}.${localeKey(enumName)}.${field}`;
  if (normalize(i18next.t(earlyKey,{lng:'en',defaultValue:''}))===normalize(original))
    return i18next.t(earlyKey,{defaultValue:original});
  // A modern translation of changed mechanics must not describe early rules.
  if (normalize(i18next.t(key, { lng: 'en', defaultValue: '' })) !== normalize(original)) return original;
  return i18next.t(key, { defaultValue: original });
}
