import { LanguageSwitcher } from './components/LanguageSwitcher';
import { OfflineNotice } from './components/OfflineNotice';
import { JourneyPlanner } from './features/journey/JourneyPlanner';
import { useI18n } from './i18n';
import { StationList } from './map/StationList';
import { StationPage } from './map/StationPage';
import { useRoute } from './router';

function Home({ journeyParams }: { journeyParams: string }) {
  const { t } = useI18n();
  return (
    <>
      <p className="lead">{t.intro}</p>
      <JourneyPlanner params={journeyParams} />
      <section aria-labelledby="status-title" className="notice">
        <h2 id="status-title">{t.statusTitle}</h2>
        <p>{t.statusBody}</p>
      </section>
      <StationList />
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
    </>
  );
}

export function App() {
  const { t } = useI18n();
  const route = useRoute();
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
      <OfflineNotice onJourney={route.page === 'journey'} />
      <main id="main" tabIndex={-1}>
        {route.page === 'station' ? (
          <StationPage key={route.id} id={route.id} />
        ) : (
          <Home journeyParams={route.page === 'journey' ? route.params : ''} />
        )}
      </main>
      <footer className="site-footer">
        <p>{t.footerData}</p>
      </footer>
    </>
  );
}
