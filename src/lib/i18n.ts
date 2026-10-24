// English and Filipino (Phase 4). The English text is the key, so a screen
// reads naturally in code and an untranslated string simply stays English.
// The choice is kept per device, so it also applies on the sign-in screen.
import { useSyncExternalStore } from 'react';
import { FIL } from './i18n.fil';

export type Lang = 'en' | 'fil';
const KEY = 'uniguard.lang';

let current: Lang = (() => {
  try {
    const saved = localStorage.getItem(KEY);
    return saved === 'fil' ? 'fil' : 'en';
  } catch {
    return 'en';
  }
})();
const listeners = new Set<() => void>();

if (typeof document !== 'undefined') document.documentElement.lang = current === 'fil' ? 'fil' : 'en';

export function getLang(): Lang {
  return current;
}

export function setLang(lang: Lang) {
  if (lang === current) return;
  current = lang;
  try {
    localStorage.setItem(KEY, lang);
  } catch {}
  if (typeof document !== 'undefined') document.documentElement.lang = lang === 'fil' ? 'fil' : 'en';
  listeners.forEach((fn) => fn());
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

// t('Hello {name}', { name }) -> translated text with the values filled in
export function t(text: string, vars?: Record<string, string | number>): string {
  let out = current === 'fil' ? FIL[text] ?? text : text;
  if (vars) out = out.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));
  return out;
}

// Components call this so they re-render when the language changes.
export function useT() {
  const lang = useSyncExternalStore(subscribe, getLang, getLang);
  return { lang, t, setLang };
}
