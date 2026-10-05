import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../i18n';
import * as data from './data';
import { testGraph, testIndex, testMap } from './mapFixtures';
import { StationList } from './StationList';
import { StationPage } from './StationPage';

// jsdom has no WebGL: stand in for the lazily loaded MapLibre component.
vi.mock('./StationMap', () => ({
  default: ({ label, panel }: { label: string; panel: number }) => (
    <div role="region" aria-label={label} data-panel={panel} />
  ),
}));

beforeEach(() => {
  vi.spyOn(data, 'loadStationIndex').mockResolvedValue(testIndex());
  vi.spyOn(data, 'loadStationGraph').mockResolvedValue(testGraph());
  vi.spyOn(data, 'loadStationMap').mockResolvedValue(testMap());
});

function renderWith(ui: React.ReactElement) {
  return render(<I18nProvider>{ui}</I18nProvider>);
}

describe('StationList', () => {
  it('links each station and names it in the page language', async () => {
    renderWith(<StationList />);
    const link = await screen.findByRole('link', { name: 'テスト駅の構内マップを開く' });
    expect(link).toHaveAttribute('href', '#/station/T');
  });

  it('says so when the data has not been built', async () => {
    vi.spyOn(data, 'loadStationIndex').mockRejectedValue(new data.DataNotBuiltError());
    renderWith(<StationList />);
    expect(await screen.findByText('駅のデータがまだ用意されていません。')).toBeVisible();
  });

  it('reports a load error', async () => {
    vi.spyOn(data, 'loadStationIndex').mockRejectedValue(new Error('boom'));
    renderWith(<StationList />);
    expect(await screen.findByRole('alert')).toBeVisible();
  });
});

describe('StationPage', () => {
  it('starts on the first floor that has a map and lists what is on it', async () => {
    renderWith(<StationPage id="T" />);
    expect(await screen.findByRole('radio', { name: '地下1階' })).toBeChecked();
    expect(await screen.findByRole('region', { name: /駅構内マップ、地下1階/ })).toHaveAttribute(
      'data-panel',
      '-1',
    );
    expect(screen.getByRole('heading', { name: 'この階にあるもの' })).toBeVisible();
    expect(screen.getByText('地下1階を表示しています。')).toBeVisible();
  });

  it('changes the floor, the status line and the list together', async () => {
    renderWith(<StationPage id="T" />);
    await userEvent.setup().click(await screen.findByRole('radio', { name: '地上' }));
    await waitFor(() => {
      expect(screen.getByText('地上を表示しています。')).toBeVisible();
    });
    expect(screen.getByText('A1, A10, 名前なし')).toBeVisible();
    expect(screen.getByText(/この階には駅構内図のデータがありません/)).toBeVisible();
    expect(screen.getByText('不明（この階の構内図データがありません）')).toBeVisible();
  });

  it('shows the warnings that matter to the user and no others', async () => {
    const g = testGraph();
    g.station.warnings = [
      { code: 'unverified_on_site', message: 'x' },
      { code: 'gtfs_level_conflicts', message: 'y' },
    ];
    vi.spyOn(data, 'loadStationGraph').mockResolvedValue(g);
    renderWith(<StationPage id="T" />);
    expect(
      await screen.findByText('この駅のデータは、現地ではまだ確認されていません。'),
    ).toBeVisible();
    expect(screen.queryByText(/段差のない出入口からホームまで/)).toBeNull();
  });

  it('reports a load error instead of staying blank', async () => {
    vi.spyOn(data, 'loadStationGraph').mockRejectedValue(new Error('boom'));
    renderWith(<StationPage id="T" />);
    expect(await screen.findByRole('alert')).toBeVisible();
  });
});
