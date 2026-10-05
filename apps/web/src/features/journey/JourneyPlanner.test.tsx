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
import { parsePlan } from './otp';
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

const options: JourneyPlanOptions = {
  plan: () => Promise.resolve(plan),
  walk: () => Promise.resolve(null),
  createWorker: createInlineWorker,
  loadGraph: (id) => Promise.resolve(indexGraph(graph(id))),
};

beforeEach(() => {
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
  render(
    <I18nProvider>
      <OutageSourceProvider source={source}>
        <JourneyPlanner params={params} options={options} navigate={navigate} />
      </OutageSourceProvider>
    </I18nProvider>,
  );
  return { source, navigate };
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
});
