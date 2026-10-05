import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { App } from './App';
import { I18nProvider, dictionaries } from './i18n';

function renderApp() {
  return render(
    <I18nProvider>
      <App />
    </I18nProvider>,
  );
}

describe('App', () => {
  it('shows the Japanese page by default with landmarks and a skip link', () => {
    renderApp();
    expect(screen.getByRole('heading', { level: 1, name: dictionaries.ja.appName })).toBeVisible();
    expect(screen.getByRole('banner')).toBeVisible();
    expect(screen.getByRole('main')).toBeVisible();
    expect(screen.getByRole('contentinfo')).toBeVisible();
    expect(screen.getByRole('link', { name: dictionaries.ja.skipToContent })).toHaveAttribute(
      'href',
      '#main',
    );
    expect(document.documentElement.lang).toBe('ja');
  });

  it('shows what the app can do so far', () => {
    renderApp();
    expect(screen.getByText(dictionaries.ja.statusBody)).toBeVisible();
  });

  it('switches language, updates html lang and remembers the choice', async () => {
    const user = userEvent.setup();
    renderApp();
    await user.selectOptions(screen.getByLabelText(dictionaries.ja.language), 'en');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(dictionaries.en.appName);
    expect(document.documentElement.lang).toBe('en');
    expect(localStorage.getItem('stepzero.lang')).toBe('en');
  });

  it('keeps easy Japanese on lang=ja', async () => {
    const user = userEvent.setup();
    renderApp();
    await user.selectOptions(screen.getByLabelText(dictionaries.ja.language), 'ja-easy');
    expect(document.documentElement.lang).toBe('ja');
    expect(screen.getByText(dictionaries['ja-easy'].statusBody)).toBeVisible();
  });
});
