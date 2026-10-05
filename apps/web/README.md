# apps/web

The StepZero PWA: React + Vite + TypeScript (strict), `vite-plugin-pwa`.

```bash
pnpm i
pnpm sync-data  # copy the importer's graphs and maps into public/data (pnpm dev and pnpm build do this too)
pnpm dev        # dev server
pnpm test       # Vitest (unit + component)
pnpm e2e        # Playwright + axe-core (builds and serves the app; run `pnpm exec playwright install chromium` once,
                #  or set PW_CHANNEL=msedge / chrome to use an installed browser)
pnpm lint       # ESLint (with jsx-a11y) + Prettier check
pnpm lighthouse # Lighthouse CI, fails below 95 accessibility (set CHROME_PATH to an installed Chromium-based browser if needed)
pnpm build
```

- UI strings live in `src/i18n/` (ja is the reference; en, zh-Hant and ja-easy must have the same keys, which the compiler and a test enforce). No hard-coded strings in components.
- Source layout follows CLAUDE.md: `src/routing/`, `src/map/`, `src/features/`.

## Routing (`src/routing/`)

Pure functions: `profiles.ts` (cost per edge for each profile), `outages.ts` (active reports to blocked edges), `astar.ts` (A\* with structured no-route reasons), `worker-protocol.ts` + `router.worker.ts` + `client.ts` (Web Worker wrapper). `golden.test.ts` runs real-station tests and is skipped unless the importer has built `data/build/graphs/` (`cd importer && uv run python -m importer.run --stations oedo`).

## Station map (`src/map/`)

`StationPage` (loaded at `#/station/<id>`) shows a floor switcher, the MapLibre map (lazy chunk, GSI vector tiles) and a text list for the selected floor. `?basemap=off` draws only the station data. Data comes from `public/data/` (see `scripts/sync-data.mjs`); the Playwright map tests skip themselves when it is missing.
