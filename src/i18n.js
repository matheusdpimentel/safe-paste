import { enUS } from './locales/en-US.js';
import { ptBR } from './locales/pt-BR.js';

export const SUPPORTED_LOCALES = Object.freeze(['pt-BR', 'en-US']);
export const LANGUAGE_STORAGE_KEY = 'safepaste-language';
export const catalogs = Object.freeze({ 'en-US': enUS, 'pt-BR': ptBR });

/** Errors carry translation keys, so an already visible error can change language. */
export class LocalizedError extends Error {
  constructor(code, values = {}) {
    super(code);
    this.name = 'LocalizedError';
    this.code = code;
    this.values = values;
  }
}

export function detectLocale(languages = []) {
  for (const language of languages) {
    if (/^pt(?:-|$)/i.test(language)) return 'pt-BR';
    if (/^en(?:-|$)/i.test(language)) return 'en-US';
  }
  return 'en-US';
}

/** Storage access is optional: file:// and private browsing can restrict it. */
export function createI18n({ storage, languages = [] } = {}) {
  let saved;
  try { saved = storage?.getItem(LANGUAGE_STORAGE_KEY); } catch { /* Use browser language. */ }
  let locale = SUPPORTED_LOCALES.includes(saved) ? saved : detectLocale(languages);
  const listeners = new Set();
  return {
    get locale() { return locale; },
    t(key, values = {}) {
      let message = catalogs[locale][key] ?? enUS[key];
      if (message === undefined) throw new Error(`Unknown translation key: ${key}`);
      if (typeof message === 'object') {
        // Use the plural for empty counts (for example, '0 caracteres').
        const form = Number(values.count) === 0 ? 'other' : new Intl.PluralRules(locale).select(values.count);
        message = message[form] ?? message.other;
      }
      return message.replace(/\{(\w+)\}/g, (_, name) => String(values[name] ?? `{${name}}`));
    },
    setLocale(next) {
      if (!SUPPORTED_LOCALES.includes(next)) return false;
      // Persist even when the user explicitly selects the detected language.
      try { storage?.setItem(LANGUAGE_STORAGE_KEY, next); } catch { /* Keep working in memory. */ }
      if (next !== locale) {
        locale = next;
        for (const listener of listeners) listener();
      }
      return true;
    },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  };
}

/** Only application-owned text/attributes are translated. Never translate imported content. */
export function translatePage(i18n, document) {
  document.documentElement.lang = i18n.locale;
  document.title = i18n.t('page.title');
  document.querySelector('meta[name="description"]')?.setAttribute('content', i18n.t('page.description'));
  for (const element of document.querySelectorAll('[data-i18n]')) {
    element.textContent = i18n.t(element.dataset.i18n);
  }
  for (const attribute of ['aria-label', 'placeholder', 'title']) {
    for (const element of document.querySelectorAll(`[data-i18n-${attribute}]`)) {
      element.setAttribute(attribute, i18n.t(element.getAttribute(`data-i18n-${attribute}`)));
    }
  }
  for (const button of document.querySelectorAll('[data-locale]')) {
    button.setAttribute('aria-pressed', String(button.dataset.locale === i18n.locale));
  }
}

export function translatedError(error, i18n) {
  if (error instanceof LocalizedError) return i18n.t(error.code, error.values);
  if (error?.name === 'PasswordException') return i18n.t('pdf.password');
  if (error?.name === 'InvalidPDFException') return i18n.t('pdf.invalid');
  // Third-party messages may contain source content; expose only our own safe messages.
  return i18n.t('error.unknown');
}
