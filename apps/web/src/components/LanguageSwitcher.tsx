import { LANGUAGES, isLang, useI18n } from '../i18n';

export function LanguageSwitcher() {
  const { lang, setLang, t } = useI18n();
  return (
    <div className="language">
      <label htmlFor="language-select">{t.language}</label>
      <select
        id="language-select"
        value={lang}
        onChange={(e) => {
          if (isLang(e.target.value)) setLang(e.target.value);
        }}
      >
        {LANGUAGES.map((code) => (
          <option key={code} value={code} lang={code === 'ja-easy' ? 'ja' : code}>
            {t.languageNames[code]}
          </option>
        ))}
      </select>
    </div>
  );
}
