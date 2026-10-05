import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';

// jsdom reports en-US; tests assume a Japanese browser unless they say otherwise.
beforeEach(() => {
  vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['ja-JP']);
});

afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
  localStorage.clear();
  document.documentElement.lang = 'ja';
});
