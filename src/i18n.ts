/// <reference types="vite/client" />
// Adapted from pagefaultgames/pokerogue's i18next namespaces, interpolation,
// English fallback and prLang preference. Bundle both locales for offline play.
import i18next from 'i18next';
import { readLanguage } from './system/language.mjs';

const namespaceMap = { 'ability-trigger': 'abilityTriggers', 'move-trigger': 'moveTriggers', biomes: 'biome' };
const files = import.meta.glob('../locales/*/*.json', { eager: true, import: 'default' });
const resources: Record<string, Record<string, any>> = {};
for (const [path, data] of Object.entries(files)) {
  const [, language, file] = path.match(/\/locales\/([^/]+)\/([^/]+)\.json$/);
  const namespace = namespaceMap[file] || file.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
  (resources[language] ||= {})[namespace] = data;
}
let storage: Storage;
try { storage = globalThis.localStorage; } catch { /* unavailable storage uses the default */ }
i18next.init({
  resources, lng: readLanguage(storage), fallbackLng: 'en', supportedLngs: ['zh-Hans', 'en'],
  defaultNS: 'menu', ns: Object.keys(resources.en), initAsync: false,
  interpolation: { escapeValue: false, skipOnVariables: true }
});
if (typeof document !== 'undefined') document.documentElement.lang = i18next.language;

export default i18next;
