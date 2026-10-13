// Adapted from upstream supported-languages.ts and i18n.ts. prLang is the
// upstream preference key; an unset preference deliberately defaults to Chinese.
export const SUPPORTED_LANGUAGE_ENTRIES = Object.freeze({
  'zh-Hans': { label: '简体中文' },
  en: { label: 'English' }
});
export const DEFAULT_LANGUAGE = 'zh-Hans';

export function readLanguage(storage) {
  try {
    const language = storage?.getItem('prLang');
    return Object.hasOwn(SUPPORTED_LANGUAGE_ENTRIES, language) ? language : DEFAULT_LANGUAGE;
  } catch { return DEFAULT_LANGUAGE; }
}

export function saveLanguage(storage, language) {
  if (!Object.hasOwn(SUPPORTED_LANGUAGE_ENTRIES, language)) throw new Error('Unsupported language');
  storage.setItem('prLang', language);
}
