import { useSyncExternalStore } from 'react';
import { defaultPlanStore, subscribeSavedPlan } from '../features/journey/saved';
import { useI18n } from '../i18n';

function subscribeOnline(onChange: () => void): () => void {
  window.addEventListener('online', onChange);
  window.addEventListener('offline', onChange);
  return () => {
    window.removeEventListener('online', onChange);
    window.removeEventListener('offline', onChange);
  };
}

/** The browser's idea of the connection; true when it cannot tell. */
export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );
}

const savedHref = (): string | null => defaultPlanStore.load()?.href ?? null;

/**
 * Says what still works without a connection (D-025), with a way back to the last journey.
 * Always in the page, so screen readers announce it when the connection drops.
 */
export function OfflineNotice({ onJourney }: { onJourney: boolean }) {
  const { t } = useI18n();
  const online = useOnline();
  const href = useSyncExternalStore(subscribeSavedPlan, savedHref, () => null);
  return (
    <div role="status" className={online ? 'offline-notice-empty' : 'notice offline-notice'}>
      {!online && (
        <>
          <p>{t.offline.notice}</p>
          {href && !onJourney && (
            <p>
              <a href={href}>{t.offline.openSaved}</a>
            </p>
          )}
        </>
      )}
    </div>
  );
}
