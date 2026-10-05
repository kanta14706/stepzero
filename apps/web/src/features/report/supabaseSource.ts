import type { SupabaseClient } from '@supabase/supabase-js';
import { OUTAGE_COLUMNS, fromRow, fromRows } from './rows';
import { ReportError, reportErrorCode } from './source';
import type { OutageSource } from './source';

export interface SupabaseConfig {
  url: string;
  /** The publishable (anon) key: safe in the client, RLS decides what it can do. */
  key: string;
}

/** The back end from the build environment, or null when it is not configured. */
export function supabaseConfig(
  env: Record<string, string | boolean | undefined> = import.meta.env,
): SupabaseConfig | null {
  const url = env['VITE_SUPABASE_URL'];
  const key = env['VITE_SUPABASE_PUBLISHABLE_KEY'];
  return typeof url === 'string' && url && typeof key === 'string' && key ? { url, key } : null;
}

/**
 * Outage reports from Supabase (D-022). The client library is loaded on first use, so it stays
 * out of the first-load bundle. Reading needs no session; reporting signs in anonymously once.
 */
export function createSupabaseSource(config: SupabaseConfig): OutageSource {
  let clientPromise: Promise<SupabaseClient> | null = null;
  const client = (): Promise<SupabaseClient> =>
    (clientPromise ??= import('@supabase/supabase-js').then(({ createClient }) =>
      createClient(config.url, config.key, {
        auth: { persistSession: true, autoRefreshToken: true, storageKey: 'stepzero.auth' },
      }),
    ));

  return {
    watch(stationId, handlers) {
      let stopped = false;
      let stop: (() => void) | null = null;
      handlers.onStatus('connecting');

      client().then(
        (sb) => {
          if (stopped) return;
          const load = async (): Promise<void> => {
            const { data, error } = await sb
              .from('outage_reports')
              .select(OUTAGE_COLUMNS)
              .eq('station_id', stationId)
              .gt('expires_at', new Date().toISOString());
            if (stopped) return;
            if (error) {
              handlers.onStatus('offline');
              return;
            }
            handlers.onReports(fromRows(data), true);
            handlers.onStatus('live');
          };
          const channel = sb
            .channel(`outages:${stationId}`)
            .on(
              'postgres_changes',
              {
                event: '*',
                schema: 'public',
                table: 'outage_reports',
                filter: `station_id=eq.${stationId}`,
              },
              (payload) => {
                const report = fromRow(payload.new);
                if (report && !stopped) handlers.onReports([report], false);
              },
            )
            .subscribe((status) => {
              if (stopped) return;
              // A string compare: importing the enum would pull the library into the main bundle.
              const name: string = status;
              // Load after subscribing, and again after every reconnect, so nothing is missed.
              if (name === 'SUBSCRIBED') void load();
              else handlers.onStatus('offline');
            });
          stop = () => {
            void sb.removeChannel(channel);
          };
        },
        () => {
          if (!stopped) handlers.onStatus('offline');
        },
      );

      return () => {
        stopped = true;
        stop?.();
      };
    },

    async report(edgeId, status) {
      if (typeof navigator !== 'undefined' && !navigator.onLine) throw new ReportError('offline');
      let sb: SupabaseClient;
      try {
        sb = await client();
      } catch {
        throw new ReportError('offline');
      }
      const { data: session } = await sb.auth.getSession();
      if (!session.session) {
        const { error } = await sb.auth.signInAnonymously();
        if (error) throw new ReportError(error.status === 429 ? 'rate_limited' : 'failed');
      }
      const result = await sb.rpc('report_outage', { p_edge_id: edgeId, p_status: status });
      if (result.error) throw new ReportError(reportErrorCode(result.error));
      return fromRows(result.data);
    },
  };
}
