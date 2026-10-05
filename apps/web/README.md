# apps/web

The StepZero PWA: React + Vite + TypeScript (strict), `vite-plugin-pwa`.

```bash
pnpm i
pnpm sync-data  # copy the importer's graphs, maps and station list into public/data (pnpm dev and pnpm build do this too)
pnpm dev        # dev server
pnpm test       # Vitest (unit + component)
pnpm e2e        # Playwright + axe-core (builds and serves the app; run `pnpm exec playwright install chromium` once,
                #  or set PW_CHANNEL=msedge / chrome to use an installed browser)
pnpm e2e:live   # the *.live.spec.ts tests against local Supabase (and OTP for the journey ones)
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

## Outage reports (`src/features/report/`)

`useOutages(stationId)` follows a station's reports and gives the planner the edges that are out of service; the route is planned again when they change. `supabaseSource.ts` reads `outage_reports` (initial load, then Realtime, reloading after every reconnect) and reports through `report_outage` with an anonymous session; supabase-js is a lazy chunk. Without `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` the app runs without live reports and says so. For local development copy `.env.example` to `.env.development.local` and fill in the key that `supabase status` prints. Unit tests never use a real back end (`FakeOutageSource`, and `vite.config.ts` blanks the variables).

## Journey planner (`src/features/journey/`)

On the home page and at `#/journey?from=station:421&to=station:428&profile=wheelchair[&at=2026-10-07T09:00]` (the plan lives in the URL). `otp.ts` asks OpenTripPlanner for train itineraries (`plan.graphql`, transit only, station ids from `public/data/stations.json`); `assemble.ts` routes the stations along each itinerary with the station graphs (entrance to platform, platform to platform, platform to exit), rejects itineraries with no step-free route, names stations without a graph as not checked, and works out where to ride from the destination's route. `useJourneyPlan` re-assembles (without asking OTP again) when an outage report on one of the journey's stations changes what is blocked. Addresses are searched with 国土地理院 and places with OpenStreetMap Nominatim, only when the person presses the search button (`geocode.ts`).

OTP is reached at `/otp/gtfs/v1` on the app's origin, which `pnpm dev` and `pnpm preview` forward to `OTP_URL` (default `http://localhost:8080`; start it with `cd otp && docker compose up otp`). A deployed build sets `VITE_OTP_URL`. Unit and e2e tests use OTP answers recorded from the real server (`src/features/journey/fixtures/`, re-record with `node scripts/record-otp.mjs` while OTP runs).
