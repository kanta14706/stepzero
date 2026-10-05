import { describe, expect, it } from 'vitest';
import { LANGUAGES, detectLang, dictionaries, htmlLang } from './index';

/** Flatten a dictionary to dotted keys so missing or extra keys show up in the diff. */
function keys(obj: object, prefix = ''): string[] {
  return (Object.entries(obj) as [string, unknown][]).flatMap(([k, v]) =>
    typeof v === 'object' && v !== null ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`],
  );
}

describe('dictionaries', () => {
  it('have the same keys in every language', () => {
    const reference = keys(dictionaries.ja).sort();
    for (const lang of LANGUAGES) {
      expect(keys(dictionaries[lang]).sort(), lang).toEqual(reference);
    }
  });

  it('have no empty strings, nested ones included', () => {
    for (const lang of LANGUAGES) {
      for (const k of keys(dictionaries[lang])) {
        const v = k
          .split('.')
          .reduce<unknown>((o, part) => (o as Record<string, unknown>)[part], dictionaries[lang]);
        expect(typeof v === 'string' && v.trim(), `${lang}.${k}`).not.toBe('');
      }
    }
  });

  it('use the same placeholders in every language', () => {
    const placeholders = (lang: (typeof LANGUAGES)[number], k: string) => {
      const v = k
        .split('.')
        .reduce<unknown>((o, part) => (o as Record<string, unknown>)[part], dictionaries[lang]);
      return [...String(v).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    };
    for (const k of keys(dictionaries.ja)) {
      for (const lang of LANGUAGES) {
        expect(placeholders(lang, k), `${lang}.${k}`).toEqual(placeholders('ja', k));
      }
    }
  });

  it('give easy Japanese a Japanese html lang', () => {
    expect(htmlLang['ja-easy']).toBe('ja');
  });
});

describe('detectLang', () => {
  it('prefers a stored choice', () => {
    expect(detectLang('en', ['ja'])).toBe('en');
  });
  it('falls back to Japanese', () => {
    expect(detectLang(null, [])).toBe('ja');
    expect(detectLang('fr', ['fr-FR'])).toBe('ja');
  });
  it('maps browser languages', () => {
    expect(detectLang(null, ['en-US'])).toBe('en');
    expect(detectLang(null, ['zh-TW'])).toBe('zh-Hant');
    expect(detectLang(null, ['zh-Hant-HK'])).toBe('zh-Hant');
    expect(detectLang(null, ['zh-CN'])).toBe('ja'); // no Simplified Chinese: default
  });
});
