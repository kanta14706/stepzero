import { LanguageSwitcher } from './components/LanguageSwitcher';
import { useI18n } from './i18n';

export function App() {
  const { t } = useI18n();
  return (
    <>
      <a className="skip-link" href="#main">
        {t.skipToContent}
      </a>
      <header className="site-header">
        <div className="brand">
          <h1>{t.appName}</h1>
          <p className="tagline">{t.tagline}</p>
        </div>
        <LanguageSwitcher />
      </header>
      <main id="main" tabIndex={-1}>
        <p className="lead">{t.intro}</p>
        <section aria-labelledby="status-title" className="notice">
          <h2 id="status-title">{t.statusTitle}</h2>
          <p>{t.statusBody}</p>
        </section>
        <section aria-labelledby="coverage-title">
          <h2 id="coverage-title">{t.coverageTitle}</h2>
          <p>{t.coverageIntro}</p>
          <ul className="tiers">
            <li>
              <h3>{t.tier1Name}</h3>
              <p>{t.tier1Body}</p>
            </li>
            <li>
              <h3>{t.tier2Name}</h3>
              <p>{t.tier2Body}</p>
            </li>
          </ul>
        </section>
      </main>
      <footer className="site-footer">
        <p>{t.footerData}</p>
      </footer>
    </>
  );
}
