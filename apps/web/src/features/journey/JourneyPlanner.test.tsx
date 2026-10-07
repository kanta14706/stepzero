/// <reference types="node" />
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../i18n';
import { findRoute, indexGraph } from '../../routing/astar';
import { buildOutageIndex } from '../../routing/outages';
import { createInlineWorker } from '../../routing/client';
import type { StationGraph } from '../../routing/types';
import { indexDevices } from '../report/devices';
import { FakeOutageSource, outage } from '../report/fakeSource';
import { OutageSourceProvider } from '../report/useOutages';
import { JourneyPlanner } from './JourneyPlanner';
import { PlanError, parsePlan } from './otp';
import { epoch, response, stopTime, trip } from '../live/testing';
import type { LiveFetch } from '../live/useLiveStatus';
import type { PlanStore, SavedPlan } from './saved';
import { resetStationsCache } from './stations';
import type { JourneyPlanOptions } from './useJourneyPlan';

const BUILD = resolve(import.meta.dirname, '../../../../../data/build');
const HAVE_DATA = existsSync(resolve(BUILD, 'stations.json'));
const PARAMS = 'from=station:421&to=station:428&profile=wheelchair&at=2026-10-07T08:50';

const plan = parsePlan(
  (
    JSON.parse(
      readFileSync(resolve(import.meta.dirname, 'fixtures/daimon-shinjuku.json'), 'utf-8'),
    ) as { data: Parameters<typeof parsePlan>[0] }
  ).data,
);
const graph = (id: string): StationGraph =>
  JSON.parse(readFileSync(resolve(BUILD, 'graphs', `${id}.json`), 'utf-8')) as StationGraph;

function memoryPlanStore(): PlanStore & { plan: SavedPlan | null } {
  return {
    plan: null,
    load() {
      return this.plan;
    },
    save(p) {
      this.plan = p;
    },
  };
}

const baseOptions: JourneyPlanOptions = {
  plan: () => Promise.resolve(plan),
  walk: () => Promise.resolve(null),
  createWorker: createInlineWorker,
  loadGraph: (id) => Promise.resolve(indexGraph(graph(id))),
  isOnline: () => true,
};
let options: JourneyPlanOptions = baseOptions;

beforeEach(() => {
  options = { ...baseOptions, store: memoryPlanStore() };
  resetStationsCache();
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve(JSON.parse(readFileSync(resolve(BUILD, 'stations.json'), 'utf-8'))),
      } as Response),
    ),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function renderPlanner(params: string, source = new FakeOutageSource()) {
  const navigate = vi.fn();
  const view = render(
    <I18nProvider>
      <OutageSourceProvider source={source}>
        <JourneyPlanner params={params} options={options} navigate={navigate} />
      </OutageSourceProvider>
    </I18nProvider>,
  );
  return { source, navigate, unmount: view.unmount };
}

const accessElevators = (): string[] => {
  const steps = document.querySelectorAll('.timeline > li[data-role="access"] ol.steps > li');
  return [...steps].map((li) => li.textContent);
};

describe.skipIf(!HAVE_DATA)('JourneyPlanner', () => {
  it('fills the URL from the form', async () => {
    const user = userEvent.setup();
    const { navigate } = renderPlanner('');
    const from = await screen.findByRole('group', { name: '出発地' });
    await user.type(within(from).getByRole('searchbox'), '大門');
    await user.click(within(from).getByRole('button', { name: /^大門駅（大江戸線）/ }));
    expect(screen.getByRole('button', { name: '出発地を選び直す' })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'ルートを調べる' }));
    expect(screen.getByRole('alert')).toHaveTextContent('出発地と目的地を選んでください。');
    const to = screen.getByRole('group', { name: '目的地' });
    await user.type(within(to).getByRole('searchbox'), '大門');
    await user.click(within(to).getByRole('button', { name: /^大門駅（大江戸線）/ }));
    await user.click(screen.getByRole('button', { name: 'ルートを調べる' }));
    expect(screen.getByRole('alert')).toHaveTextContent('出発地と目的地が同じです。');
    await user.click(screen.getByRole('button', { name: '目的地を選び直す' }));
    await user.type(screen.getAllByRole('searchbox')[0] as HTMLElement, '新宿');
    await user.click(screen.getByRole('button', { name: /^新宿駅（大江戸線）/ }));
    await user.click(screen.getByRole('button', { name: 'ルートを調べる' }));
    expect(navigate).toHaveBeenCalledWith(
      '#/journey?from=station%3A421&to=station%3A428&profile=wheelchair',
    );
  });

  it('re-routes an open journey when an elevator on it is reported broken', async () => {
    const { source } = renderPlanner(PARAMS);
    await screen.findByRole('heading', { name: 'ルートの候補' });
    act(() => {
      source.push('421', [], true);
      source.push('428', [], true);
    });
    await waitFor(() => {
      expect(document.querySelectorAll('.timeline > li')).toHaveLength(3);
    });
    const before = accessElevators();
    expect(screen.queryByText('故障情報が更新されたため、ルートを変えました。')).toBeNull();

    // Break an elevator on the 大門 route that has a way round (the street lift; the platform
    // lift for platform 4 has none).
    const g = graph('421');
    const idx = indexGraph(g);
    const streets = g.nodes
      .filter((n) => n.kind === 'entrance' || n.kind === 'street')
      .map((n) => n.id);
    const platform = g.station.platforms.find((p) => p.id === '421P4')?.nodeIds ?? [];
    const route = findRoute(idx, { from: streets, to: platform, profile: 'wheelchair' });
    const used = new Set(route.ok ? route.legs.map((l) => l.edge.id) : []);
    const blocks = (edgeIds: string[]) =>
      buildOutageIndex(
        edgeIds.map((edgeId) => outage({ id: edgeId, stationId: '421', edgeId })),
        new Date(),
      );
    const shaft = indexDevices(g).devices.find(
      (d) =>
        d.mode === 'elevator' &&
        d.edgeIds.some((e) => used.has(e)) &&
        findRoute(idx, {
          from: streets,
          to: platform,
          profile: 'wheelchair',
          outages: blocks(d.edgeIds),
        }).ok,
    );
    expect(shaft).toBeDefined();
    act(() => {
      source.push(
        '421',
        (shaft?.edgeIds ?? []).map((edgeId, i) =>
          outage({ id: `o${i}`, stationId: '421', edgeId }),
        ),
      );
    });
    const lifts = g.edges.filter((e) => e.mode === 'elevator').map((e) => e.id);
    await waitFor(() => {
      expect(accessElevators()).not.toEqual(before);
    });
    expect(
      screen.getAllByText('故障情報が更新されたため、ルートを変えました。').length,
    ).toBeGreaterThan(0);

    // Every elevator broken: no step-free way in, and the page says where and why.
    act(() => {
      source.push(
        '421',
        lifts.map((edgeId, i) => outage({ id: `all${i}`, stationId: '421', edgeId })),
      );
    });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('大門駅（入口からホームまで）');
    expect(alert).toHaveTextContent('故障や通行止めが報告されている設備');
  });

  it('offline, shows the journey saved for the same trip', async () => {
    const store = memoryPlanStore();
    options = { ...options, store };
    const first = renderPlanner(PARAMS);
    await screen.findByRole('heading', { name: 'ルートの候補' });
    await waitFor(() => {
      expect(store.plan).not.toBeNull();
    });
    expect(store.plan?.time).toBe('2026-10-07T08:50:00+09:00');
    expect(store.plan?.href).toBe(
      '#/journey?from=station%3A421&to=station%3A428&profile=wheelchair',
    );
    first.unmount();

    // OTP unreachable; the trip is asked for "now", and the saved plan (08:50) answers it.
    const asked = vi.fn(() => Promise.reject(new PlanError('unavailable')));
    options = { ...options, plan: asked };
    renderPlanner('from=station:421&to=station:428&profile=wheelchair');
    await screen.findByRole('heading', { name: 'ルートの候補' });
    expect(asked).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.saved-plan')).toHaveTextContent(
      /通信できないため、.*に調べて保存したルートを表示しています（08:50出発の条件）/,
    );
    expect(document.querySelectorAll('.timeline > li')).toHaveLength(3);
  });

  it('offline with nothing saved, says so without asking OTP', async () => {
    const asked = vi.fn(() => Promise.resolve(plan));
    options = { ...options, plan: asked, isOnline: () => false };
    renderPlanner(PARAMS);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '通信できません。この端末に保存されたルートもありません。',
    );
    expect(asked).not.toHaveBeenCalled();
  });

  it('a saved plan for another trip is not used', async () => {
    const store = memoryPlanStore();
    options = { ...options, store };
    const first = renderPlanner(PARAMS);
    await waitFor(() => {
      expect(store.plan).not.toBeNull();
    });
    first.unmount();
    options = { ...options, isOnline: () => false };
    renderPlanner('from=station:421&to=station:428&profile=sensory');
    expect(await screen.findByRole('alert')).toHaveTextContent('通信できません。');
  });
});

/** A live feed that answers for the trains of the recorded plan, `late()` seconds late. */
function liveFeed(late: () => number): LiveFetch {
  const legs = new Map(
    plan
      .flatMap((it) => it.legs)
      .flatMap((l) => (l.kind === 'ride' && l.live ? [[l.live.tripId, l] as const] : [])),
  );
  return (_operator, ids) =>
    Promise.resolve(
      response(
        Object.fromEntries(
          ids.flatMap((id) => {
            const leg = legs.get(id);
            if (!leg?.live) return [];
            return [
              [
                id,
                trip([
                  stopTime(leg.live.fromSeq, { departure: epoch(leg.departure) + late() }),
                  stopTime(leg.live.toSeq, { arrival: epoch(leg.arrival) + late() }),
                ]),
              ],
            ];
          }),
        ),
      ),
    );
}

describe.skipIf(!HAVE_DATA)('JourneyPlanner live status (step 2.7)', () => {
  it('shows a late train with its new times, and says when the data is from', async () => {
    options = {
      ...options,
      live: { config: null, fetchLive: liveFeed(() => 300), intervalMs: 60_000 },
    };
    renderPlanner(PARAMS);
    expect(await screen.findByText('約5分遅れています。')).toBeInTheDocument();
    expect(screen.getByText(/^出発 \d\d:\d\d、到着 \d\d:\d\d（時刻表：/)).toBeInTheDocument();
    expect(screen.getByTestId('live-updated')).toHaveTextContent(/に更新$/);
  });

  it('says a train is on time only when the feed says so', async () => {
    options = {
      ...options,
      live: { config: null, fetchLive: liveFeed(() => 0), intervalMs: 60_000 },
    };
    renderPlanner(PARAMS);
    expect(await screen.findByText('定刻どおりに運行しています。')).toBeInTheDocument();
  });

  it('keeps the timetable and says why when live information is not available', async () => {
    options = { ...options, live: { config: null } };
    renderPlanner(PARAMS);
    expect(
      await screen.findByText(
        'この環境ではリアルタイム情報を使えません。時刻表の時刻を表示しています。',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText('定刻どおりに運行しています。')).not.toBeInTheDocument();
  });

  it('plans again from now with one button', async () => {
    options = {
      ...options,
      live: { config: null, fetchLive: liveFeed(() => 0), intervalMs: 60_000 },
    };
    const user = userEvent.setup();
    const { navigate } = renderPlanner(PARAMS);
    await user.click(await screen.findByRole('button', { name: '今の時刻で探し直す' }));
    expect(navigate).toHaveBeenCalledTimes(1);
    const href = navigate.mock.calls[0]?.[0] as string;
    expect(href).toContain('from=station%3A421');
    expect(href).not.toContain('at=');
  });

  it('announces once when the live picture changes, not on every refresh', async () => {
    let late = 0;
    options = {
      ...options,
      live: { config: null, fetchLive: liveFeed(() => late), intervalMs: 40 },
    };
    renderPlanner(PARAMS);
    await screen.findByText('定刻どおりに運行しています。');
    const region = () =>
      document.querySelector('.journey-results [role="status"]')?.textContent ?? '';
    expect(region()).not.toContain('リアルタイム情報が更新されました');
    late = 300;
    await waitFor(() => {
      expect(region()).toContain('リアルタイム情報が更新されました。1本の列車に遅れがあります。');
    });
    // another refresh with the same delay: the sentence stays, it is not repeated or changed
    const before = region();
    await new Promise((r) => setTimeout(r, 120));
    expect(region()).toBe(before);
  });
});
