import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../i18n';
import { edge, graph, node } from '../../routing/fixtures';
import { outage } from './fakeSource';
import { OutageList, ReportFeedback, StepReport, useReporter } from './ReportControls';
import { ReportError } from './source';
import type { CommunityStatus } from './source';

function Harness({ report }: { report: (e: string, s: CommunityStatus) => Promise<unknown> }) {
  const r = useReporter(report);
  return (
    <I18nProvider>
      <ReportFeedback feedback={r.feedback} busy={r.busy} />
      <StepReport
        mode="elevator"
        stepNumber={3}
        busy={r.busy}
        onSend={(status) => {
          r.send('lift', status);
        }}
      />
    </I18nProvider>
  );
}

describe('StepReport', () => {
  it('reports in two taps and moves the focus to the thank-you message', async () => {
    const user = userEvent.setup();
    const report = vi.fn(() => Promise.resolve([]));
    render(<Harness report={report} />);
    const open = screen.getByRole('button', { name: 'ステップ3のエレベーターの故障を報告' });
    expect(open).toHaveAttribute('aria-expanded', 'false');
    await user.click(open);
    expect(open).toHaveAttribute('aria-expanded', 'true');
    const group = screen.getByRole('group', { name: 'このエレベーターは使えますか？' });
    expect(within(group).getByRole('button', { name: '使えない' })).toHaveFocus();
    await user.click(within(group).getByRole('button', { name: '使えない' }));
    expect(report).toHaveBeenCalledWith('lift', 'out_of_service');
    const status = await screen.findByText(/「使えない」と報告しました/);
    expect(status).toHaveAttribute('role', 'status');
    expect(status).toHaveFocus();
    expect(screen.queryByRole('group')).toBeNull();
  });

  it('says when the report was kept on the device to send later', async () => {
    const user = userEvent.setup();
    render(<Harness report={() => Promise.resolve([outage({ pending: true })])} />);
    await user.click(screen.getByRole('button', { name: /故障を報告/ }));
    await user.click(screen.getByRole('button', { name: '使えない' }));
    const status = await screen.findByText(/報告をこの端末に保存しました/);
    expect(status).toHaveFocus();
  });

  it('closes with Escape and returns the focus to the report button', async () => {
    const user = userEvent.setup();
    render(<Harness report={() => Promise.resolve([])} />);
    const open = screen.getByRole('button', { name: /故障を報告/ });
    await user.click(open);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('group')).toBeNull();
    expect(open).toHaveFocus();
  });

  it.each([
    ['rate_limited', /回数が多すぎます/],
    ['offline', /通信できないため/],
    ['unavailable', /駅員にお知らせください/],
  ] as const)('explains a %s error', async (code, text) => {
    const user = userEvent.setup();
    render(<Harness report={() => Promise.reject(new ReportError(code))} />);
    await user.click(screen.getByRole('button', { name: /故障を報告/ }));
    await user.click(screen.getByRole('button', { name: '使える' }));
    expect(await screen.findByText(text)).toHaveFocus();
  });
});

describe('OutageList', () => {
  const g = graph(
    [node('a', 'junction', 0), node('b', 'junction', -1)],
    [edge('lift', 'a', 'b', 'elevator')],
  );

  it('says when nothing is reported', () => {
    render(
      <I18nProvider>
        <OutageList graph={g} reports={[]} busy={false} onSend={vi.fn()} />
      </I18nProvider>,
    );
    expect(screen.getByRole('heading', { name: 'この駅の故障情報' })).toBeVisible();
    expect(screen.getByText('いま報告されている故障はありません。')).toBeVisible();
  });

  it('marks a report made offline as not sent yet', () => {
    render(
      <I18nProvider>
        <OutageList
          graph={g}
          reports={[outage({ edgeId: 'lift', pending: true, createdAt: '2026-10-06T01:05:00Z' })]}
          busy={false}
          onSend={vi.fn()}
        />
      </I18nProvider>,
    );
    expect(screen.getByText('10:05に報告・未送信（つながったら自動で送ります）')).toBeVisible();
  });

  it('lists a broken elevator with buttons to confirm or clear it', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(
      <I18nProvider>
        <OutageList
          graph={g}
          reports={[
            outage({ edgeId: 'lift', confirmations: 2, createdAt: '2026-10-06T01:05:00Z' }),
          ]}
          busy={false}
          onSend={onSend}
        />
      </I18nProvider>,
    );
    const item = screen.getByRole('listitem');
    expect(item).toHaveTextContent('エレベーター（地上〜地下1階）');
    expect(item).toHaveTextContent('10:05に報告・確認した人 2人');
    const fixed = within(item).getByRole('button', { name: '使えるようになった' });
    expect(fixed).toHaveAccessibleDescription('エレベーター（地上〜地下1階）');
    await user.click(fixed);
    expect(onSend).toHaveBeenCalledWith('lift', 'working');
    await act(async () => {
      await user.click(within(item).getByRole('button', { name: 'まだ使えない' }));
    });
    expect(onSend).toHaveBeenLastCalledWith('lift', 'out_of_service');
  });
});
