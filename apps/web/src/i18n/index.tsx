import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { en } from './en';
import { jaEasy } from './ja-easy';
import { ja } from './ja';
import type { Dictionary } from './ja';
import { zhHant } from './zh-Hant';

export const LANGUAGES = ['ja', 'en', 'zh-Hant', 'ja-easy'] as const;
export type Lang = (typeof LANGUAGES)[number];

export const dictionaries: Record<Lang, Dictionary> = {
  ja,
  en,
  'zh-Hant': zhHant,
  'ja-easy': jaEasy,
};

/** The BCP 47 tag to put on <html lang>. Easy Japanese is Japanese. */
export const htmlLang: Record<Lang, string> = {
  ja: 'ja',
  en: 'en',
  'zh-Hant': 'zh-Hant',
  'ja-easy': 'ja',
};

const STORAGE_KEY = 'stepzero.lang';

export function isLang(value: unknown): value is Lang {
  return typeof value === 'string' && (LANGUAGES as readonly string[]).includes(value);
}

/** Japanese is the default; the browser language only picks a different one if we have it. */
export function detectLang(stored: string | null, browserLanguages: readonly string[]): Lang {
  if (isLang(stored)) return stored;
  for (const tag of browserLanguages) {
    const lower = tag.toLowerCase();
    if (lower.startsWith('ja')) return 'ja';
    if (lower.startsWith('zh') && (lower.includes('hant') || /-(tw|hk|mo)\b/.test(lower))) {
      return 'zh-Hant';
    }
    if (lower.startsWith('en')) return 'en';
  }
  return 'ja';
}

function readStored(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null; // private mode or blocked storage: the app still works without it
  }
}

interface I18n {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: Dictionary;
}

const I18nContext = createContext<I18n | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => detectLang(readStored(), navigator.languages));

  useEffect(() => {
    document.documentElement.lang = htmlLang[lang];
  }, [lang]);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* storage unavailable: keep the choice for this visit only */
    }
  }, []);

  const value = useMemo(() => ({ lang, setLang, t: dictionaries[lang] }), [lang, setLang]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used inside <I18nProvider>');
  return ctx;
}

/** Fill `{name}`-style placeholders. Placeholders stay visible when a value is missing. */
export function fmt(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) =>
    key in values ? String(values[key]) : whole,
  );
}
