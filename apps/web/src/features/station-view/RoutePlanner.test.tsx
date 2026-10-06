import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../i18n';
import { edge, graph, node } from '../../routing/fixtures';
import type { StationGraph } from '../../routing/types';
import { testGraph } from '../../map/mapFixtures';
import { RoutePlanner, nextSeen } from './RoutePlanner';
import type { Seen } from './RoutePlanner';
import type { RouteState } from './useStationRoute';

/** Exit A1, a lift down to the gates and a platform: step-free all the way. */
function stepFreeGraph(): StationGraph {
  const g = graph(
    [
      { ...node('a1', 'entrance', 0), name: { ja: 'A1' } },
      node('lift-top', 'elevator', 0),
      node('lift-bot', 'elevator', -1),
      node('gate', 'gate', -1),
      { ...node('p', 'platform', -2), platformId: 'P1' },
    ],
    [
      edge('e-walk', 'a1', 'lift-top', 'walk'),
      edge('e-lift', 'lift-top', 'lift-bot', 'elevator', { seconds: 40 }),
      edge('e-gate', 'lift-bot', 'gate', 'fare_gate'),
      edge('e-down', 'gate', 'p', 'walk'),
    ],
  );
  return {
    ...g,
    station: { ...g.station, platforms: [{ id: 'P1', code: '3', nodeIds: ['p'] }] },
  };
}

/** Exit A1 with two lifts down to the platform; the near one is faster. */
function twoLiftGraph(): StationGraph {
  const g = graph(
    [
      { ...node('a1', 'entrance', 0), name: { ja: 'A1' } },
      node('l1-top', 'elevator', 0),
      node('l2-top', 'elevator', 0),
      { ...node('p', 'platform', -1), platformId: 'P1' },
    ],
    [
      edge('w1', 'a1', 'l1-top', 'walk'),
      edge('lift1', 'l1-top', 'p', 'elevator', { seconds: 40 }),
      edge('w2', 'a1', 'l2-top', 'walk', { seconds: 60, lengthM: 70 }),
      edge('lift2', 'l2-top', 'p', 'elevator', { seconds: 40 }),
    ],
  );
  return {
    ...g,
    station: { ...g.station, platforms: [{ id: 'P1', code: '1', nodeIds: ['p'] }] },
  };
}

function renderPlanner(g: StationGraph) {
  return render(
    <I18nProvider>
      <RoutePlanner graph={g} />
    </I18nProvider>,
  );
}

afterEach(() => {
  localStorage.clear();
});

describe('RoutePlanner', () => {
  it('shows the wheelchair route as an ordered list, with a summary and an announcement', async () => {
    renderPlanner(stepFreeGraph());
    const items = await screen.findAllByRole('listitem');
    const texts = items.map((li) => li.textContent);
    expect(texts[0]).toBe('A1出入口から出発します。');
    expect(texts).toContain('A1出入口のエレベーターで地下1階へ降ります。');
    expect(texts[texts.length - 1]).toBe('3番線ホームに着きます。');
    expect(screen.getByText(/エレベーター 1回/)).toBeVisible();
    const ol = items[0]?.closest('ol');
    expect(ol?.tagName).toBe('OL');
    expect(ol?.querySelectorAll(':scope > li')).toHaveLength(items.length);
  });

  it('announces the number of steps in a polite status region', async () => {
    renderPlanner(stepFreeGraph());
    const status = await screen.findByText(/ステップの道順を表示しています/);
    expect(status).toHaveAttribute('aria-live', 'polite');
  });

  it('explains why there is no wheelchair route and offers alternatives', async () => {
    renderPlanner(testGraph()); // the only way to the platform is stairs
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByRole('heading', { name: '道順が見つかりません' })).toBeVisible();
    expect(within(alert).getByText(/階段/)).toBeVisible();
    expect(within(alert).getAllByRole('listitem').length).toBeGreaterThan(0);
  });

  it('finds a route for the profile that may use stairs when the choice changes', async () => {
    const user = userEvent.setup();
    renderPlanner(testGraph());
    await screen.findByRole('alert');
    await user.click(screen.getByRole('radio', { name: '感覚過敏' }));
    expect(await screen.findAllByRole('listitem')).not.toHaveLength(0);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText(/最も早い道順です/)).toBeVisible();
  });

  it('reverses the route when leaving the station', async () => {
    const user = userEvent.setup();
    renderPlanner(stepFreeGraph());
    await screen.findAllByRole('listitem');
    await user.click(screen.getByRole('radio', { name: /駅を出る/ }));
    expect(await screen.findByText('3番線ホームから出発します。')).toBeVisible();
    expect(screen.getByText('A1出入口に着きます。')).toBeVisible();
    expect(screen.getByText('改札を出ます。')).toBeVisible();
  });

  it('lists entrances, telling repeated or unlabelled ones apart by side', async () => {
    renderPlanner(testGraph());
    await screen.findByRole('alert');
    const select = screen.getByRole('combobox', { name: '出入口' });
    const options = within(select)
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(options[0]).toBe('いちばん早く行ける段差のない出入口');
    expect(options).toContain('A1出入口');
    expect(options).toContain('A10出入口');
    expect(options.some((o) => /^名前なし出入口（.+側）$/.test(o))).toBe(true);
  });

  it('routes from the chosen entrance only', async () => {
    const user = userEvent.setup();
    renderPlanner(stepFreeGraph());
    await screen.findAllByRole('listitem');
    await user.selectOptions(screen.getByRole('combobox', { name: '出入口' }), 'a1');
    expect(await screen.findByText('A1出入口から出発します。')).toBeVisible();
  });

  it('renders in the chosen language', async () => {
    localStorage.setItem('stepzero.lang', 'en');
    renderPlanner(stepFreeGraph());
    expect(await screen.findByText('Start at exit A1.')).toBeVisible();
    expect(screen.getByText('You arrive on platform 3.')).toBeVisible();
    expect(screen.getByRole('radio', { name: 'Wheelchair' })).toBeChecked();
  });

  it('hides the map buttons when nothing listens for them', async () => {
    renderPlanner(stepFreeGraph());
    await screen.findAllByRole('listitem');
    expect(screen.queryByRole('button', { name: /地図で見る/ })).toBeNull();
  });

  it('has one map button per step, named by its number, and reports the pressed one', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const { rerender } = render(
      <I18nProvider>
        <RoutePlanner graph={stepFreeGraph()} selectedStep={null} onSelectStep={onSelect} />
      </I18nProvider>,
    );
    const items = await screen.findAllByRole('listitem');
    const buttons = screen.getAllByRole('button', { name: /^地図で見る：ステップ\d+$/ });
    expect(buttons).toHaveLength(items.length);
    await user.click(buttons[1] as HTMLElement);
    expect(onSelect).toHaveBeenCalledWith(1);
    rerender(
      <I18nProvider>
        <RoutePlanner graph={stepFreeGraph()} selectedStep={1} onSelectStep={onSelect} />
      </I18nProvider>,
    );
    expect(buttons[1]).toHaveAttribute('aria-pressed', 'true');
    expect(buttons[0]).toHaveAttribute('aria-pressed', 'false');
    await user.click(buttons[1] as HTMLElement);
    expect(onSelect).toHaveBeenLastCalledWith(null);
  });

  it('tells the page about the route and clears it when there is none', async () => {
    const onRoute = vi.fn();
    render(
      <I18nProvider>
        <RoutePlanner graph={testGraph()} onRouteChange={onRoute} />
      </I18nProvider>,
    );
    await screen.findByRole('alert'); // wheelchair: stairs only
    expect(onRoute).toHaveBeenLastCalledWith(null);
    await userEvent.setup().click(screen.getByRole('radio', { name: '感覚過敏' }));
    await screen.findAllByRole('listitem');
    const route = onRoute.mock.calls.at(-1)?.[0] as { steps: { kind: string }[] } | null;
    expect(route?.steps[0]?.kind).toBe('start');
    expect(route?.steps.at(-1)?.kind).toBe('arrive');
  });

  it('offers a way past the step list only when the page can take the focus', async () => {
    const onSkip = vi.fn();
    const { unmount } = renderPlanner(stepFreeGraph());
    await screen.findAllByRole('listitem');
    expect(screen.queryByRole('button', { name: /道順の一覧を飛ばして/ })).toBeNull();
    unmount();
    render(
      <I18nProvider>
        <RoutePlanner graph={stepFreeGraph()} onSkipToMap={onSkip} />
      </I18nProvider>,
    );
    await userEvent
      .setup()
      .click(await screen.findByRole('button', { name: /道順の一覧を飛ばして/ }));
    expect(onSkip).toHaveBeenCalledOnce();
  });

  it('names each platform by where its trains go', async () => {
    const g = stepFreeGraph();
    const withTravel: StationGraph = {
      ...g,
      station: {
        ...g.station,
        platforms: [
          {
            id: 'P1',
            code: '3',
            nodeIds: ['p'],
            travel: {
              frontNodeId: 'p',
              backNodeId: 'p',
              lengthM: 0,
              areas: 1,
              confidence: 'clear',
              nextStop: { ja: '汐留', en: 'Shiodome' },
            },
          },
          {
            id: 'P2',
            code: '4',
            nodeIds: ['p'],
            travel: {
              frontNodeId: 'p',
              backNodeId: 'p',
              lengthM: 0,
              areas: 1,
              confidence: 'clear',
              terminating: 'all',
            },
          },
        ],
      },
    };
    renderPlanner(withTravel);
    await screen.findAllByRole('listitem');
    const options = within(screen.getByRole('combobox', { name: 'ホーム' }))
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(options).toEqual(['3番線ホーム（汐留方面）', '4番線ホーム（この駅止まり）']);
  });

  it('plans again around an elevator reported out of service, and explains when none is left', async () => {
    const g = twoLiftGraph();
    const onRouteChange = vi.fn();
    const ui = (blocked: string[]) => (
      <I18nProvider>
        <RoutePlanner graph={g} onRouteChange={onRouteChange} blockedEdgeIds={blocked} />
      </I18nProvider>
    );
    const usedEdges = () => {
      const last = onRouteChange.mock.lastCall?.[0] as
        { legs: { edge: { id: string } }[] } | null | undefined;
      return last?.legs.map((l) => l.edge.id) ?? null;
    };
    const { rerender } = render(ui([]));
    await vi.waitFor(() => {
      expect(usedEdges()).toEqual(['w1', 'lift1']);
    });
    rerender(ui(['lift1']));
    await vi.waitFor(() => {
      expect(usedEdges()).toEqual(['w2', 'lift2']);
    });
    rerender(ui(['lift1', 'lift2']));
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText(/故障/)).toBeVisible();
    expect(usedEdges()).toBeNull();
  });

  it('says the route changed because of outage reports, and offers to report the elevator', async () => {
    const user = userEvent.setup();
    const g = twoLiftGraph();
    const onReport = vi.fn();
    const ui = (blocked: string[]) => (
      <I18nProvider>
        <RoutePlanner graph={g} blockedEdgeIds={blocked} onReport={onReport} />
      </I18nProvider>
    );
    const { rerender } = render(ui([]));
    await screen.findAllByRole('listitem');
    expect(screen.queryByText(/故障情報が更新されたため/)).toBeNull();
    await user.click(screen.getByRole('button', { name: /の故障を報告/ }));
    await user.click(screen.getByRole('button', { name: '使えない' }));
    expect(onReport).toHaveBeenCalledWith('lift1', 'out_of_service');

    rerender(ui(['lift1']));
    const notices = await screen.findAllByText(/故障情報が更新されたため、道順を変えました。/);
    expect(notices.some((n) => n.getAttribute('aria-live') === 'polite')).toBe(true);
    // A change of trip clears the notice.
    await user.click(screen.getByRole('radio', { name: '駅を出る（ホームから出入口へ）' }));
    await vi.waitFor(() => {
      expect(screen.queryByText(/故障情報が更新されたため/)).toBeNull();
    });
  });

  it('hides the report buttons when reporting is not available', async () => {
    renderPlanner(twoLiftGraph());
    await screen.findAllByRole('listitem');
    expect(screen.queryByRole('button', { name: /故障を報告/ })).toBeNull();
  });

  it('does not call it a change when the reports first arrive after the route', async () => {
    const g = twoLiftGraph();
    const onRouteChange = vi.fn();
    const ui = (blocked: string[], loaded: boolean) => (
      <I18nProvider>
        <RoutePlanner
          graph={g}
          blockedEdgeIds={blocked}
          outagesLoaded={loaded}
          onRouteChange={onRouteChange}
        />
      </I18nProvider>
    );
    const { rerender } = render(ui([], false));
    await screen.findAllByRole('listitem');
    rerender(ui(['lift1'], true));
    await vi.waitFor(() => {
      const last = onRouteChange.mock.lastCall?.[0] as { legs: { edge: { id: string } }[] } | null;
      expect(last?.legs.map((l) => l.edge.id)).toEqual(['w2', 'lift2']);
    });
    expect(screen.queryByText(/故障情報が更新されたため/)).toBeNull();
  });
});

describe('nextSeen', () => {
  const ready = (blocked: string[], edges: string[]): RouteState =>
    ({
      status: 'ready',
      ms: 1,
      query: { from: ['a'], to: ['p'], profile: 'wheelchair', blockedEdgeIds: blocked },
      result: { ok: true, legs: edges.map((id) => ({ edge: { id } })) },
    }) as unknown as RouteState; // only the fields nextSeen reads

  it('keeps the notice when a route for an earlier report renders with a newer one', () => {
    // Loaded: the first route took the (empty) reports into account.
    let seen: Seen = { state: ready([], ['w1', 'lift1']), rerouted: false, loaded: true };
    // Two rows of one device: the route for the first renders when the second is already in.
    const first = ready(['lift1a'], ['w2', 'lift2']);
    seen = nextSeen(seen, first, false) ?? seen;
    expect(seen).toMatchObject({ rerouted: true, loaded: true });
    const second = ready(['lift1a', 'lift1b'], ['w2', 'lift2']);
    seen = nextSeen(seen, second, true) ?? seen;
    expect(seen).toMatchObject({ rerouted: true, loaded: true });
  });

  it('is not a change while the first reports are still arriving', () => {
    let seen: Seen = { state: ready([], ['w1', 'lift1']), rerouted: false, loaded: false };
    seen = nextSeen(seen, ready(['lift1a'], ['w2', 'lift2']), false) ?? seen;
    seen = nextSeen(seen, ready(['lift1a', 'lift1b'], ['w2', 'lift2']), true) ?? seen;
    expect(seen).toMatchObject({ rerouted: false, loaded: true });
  });
});
