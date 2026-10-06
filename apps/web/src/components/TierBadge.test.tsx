import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { I18nProvider } from '../i18n';
import { TierBadge } from './TierBadge';

function show(tier: 1 | 2, explain?: boolean) {
  render(
    <I18nProvider>
      <TierBadge tier={tier} {...(explain === undefined ? {} : { explain })} />
    </I18nProvider>,
  );
}

describe('TierBadge', () => {
  it('writes the tier out and explains it', () => {
    show(2);
    expect(screen.getByText('案内の種類：駅の中まで案内')).toBeInTheDocument();
    expect(screen.getByText(/入口・エレベーター・ホームの位置まで/)).toBeInTheDocument();
  });

  it('says tier 1 does not check the way inside the station', () => {
    show(1);
    expect(screen.getByText('案内の種類：駅間ルートのみ')).toBeInTheDocument();
    expect(screen.getByText(/確認していません/)).toBeInTheDocument();
  });

  it('can leave the explanation out', () => {
    show(1, false);
    expect(screen.getByText('案内の種類：駅間ルートのみ')).toBeInTheDocument();
    expect(screen.queryByText(/確認していません/)).toBeNull();
  });
});
