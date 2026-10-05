import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../i18n';
import { FloorSwitcher } from './FloorSwitcher';
import { testMap } from './mapFixtures';

function setup(value = -1) {
  const onChange = vi.fn();
  render(
    <I18nProvider>
      <FloorSwitcher panels={testMap().panels} value={value} onChange={onChange} />
    </I18nProvider>,
  );
  return onChange;
}

describe('FloorSwitcher', () => {
  it('is a named group of radios with the current floor checked', () => {
    setup();
    expect(screen.getByRole('group', { name: '階を選ぶ' })).toBeInTheDocument();
    expect(screen.getAllByRole('radio')).toHaveLength(3);
    expect(screen.getByRole('radio', { name: '地下1階' })).toBeChecked();
  });

  it('moves between floors with the arrow keys', async () => {
    const onChange = setup();
    await userEvent.setup().click(screen.getByRole('radio', { name: '地下1階' }));
    await userEvent.keyboard('{ArrowDown}');
    expect(onChange).toHaveBeenLastCalledWith(-2);
  });

  it('reports a click on another floor', async () => {
    const onChange = setup();
    await userEvent.setup().click(screen.getByRole('radio', { name: '地上' }));
    expect(onChange).toHaveBeenCalledWith(0);
  });
});
