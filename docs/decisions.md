# Decisions

Record of stack and design decisions. Per CLAUDE.md, any change to a major dependency must be recorded here with the reason.

Format: date, decision, reason, alternatives considered.

The first entries (D-001 to D-011) record the initial stack from CLAUDE.md. Their reasons and alternatives were reconstructed on 2026-10-05 from the project constraints, not from notes taken when the choices were made.

---

## D-001 Hybrid routing: OTP2 for trains, own A* for in-station
- **Date:** 2026-10-05
- **Decision:** OpenTripPlanner 2 returns candidate train itineraries. The PWA runs its own A\* to route entrance → platform inside Tier-2 stations, and rejects or repairs candidates that hit an active outage.
- **Reason:** OTP2 handles timetables and GTFS-RT well but cannot take per-pathway crowd-sourced outages or per-profile edge costs. A client-side A\* lets re-routing happen instantly and offline (target < 100 ms).
- **Alternatives considered:** OTP2 only (no live per-edge outages, no offline); fully custom router for trains too (too much scope before the deadline).

## D-002 Front end: React + Vite + TypeScript, vite-plugin-pwa
- **Date:** 2026-10-05
- **Decision:** React + Vite + TypeScript (strict), with `vite-plugin-pwa`.
- **Reason:** PWA is required (native apps are out of scope) and must work offline for cached stations. Vite keeps the first-load JS budget (< 200 KB gzipped) achievable.
- **Alternatives considered:** Next.js (SSR not needed, heavier); Svelte/Solid (smaller, but weaker accessibility and map ecosystem familiarity).

## D-003 Map: MapLibre GL JS, deck.gl only for the 3D station view
- **Date:** 2026-10-05
- **Decision:** MapLibre GL JS for the main map; deck.gl restricted to the 3D station view.
- **Reason:** Open-source, tile-source agnostic, fits open-data licensing. Limiting deck.gl protects the bundle-size budget.
- **Alternatives considered:** Mapbox GL (licence/token cost); Leaflet (no vector tiles or 3D); deck.gl everywhere (larger bundle).

## D-004 In-station routing: A* in a Web Worker over per-station graph JSON
- **Date:** 2026-10-05
- **Decision:** A\* in a Web Worker, reading per-station graph JSON produced by the importer.
- **Reason:** Keeps the UI thread responsive, works offline once a station graph is cached, and keeps routing pure and testable.
- **Alternatives considered:** Server-side routing (needs signal underground); main-thread A\* (jank on mid-range phones).

## D-005 Train routing: OpenTripPlanner 2 (GTFS + GTFS-RT) in Docker
- **Date:** 2026-10-05
- **Decision:** OTP2 in Docker on a small VM, consuming GTFS and GTFS-RT.
- **Reason:** Mature multimodal planner that already consumes the ODPT feeds, so Tier-1 coverage needs no custom train routing.
- **Alternatives considered:** Valhalla/Transitous-style routers; hosted routing APIs (licensing and cost); writing our own RAPTOR.

## D-006 Back end: Supabase (Postgres + PostGIS, Realtime, Auth)
- **Date:** 2026-10-05
- **Decision:** Supabase for reports, live updates and optional anonymous auth.
- **Reason:** Realtime is what makes the key demo work (report on phone A, phone B reroutes within seconds). PostGIS suits spatial queries, and the outage feed is a straightforward view over the data.
- **Alternatives considered:** Firebase (no PostGIS, proprietary); custom Node + WebSocket server (more to build and operate).

## D-007 Importer: Python 3.11+ (geopandas, gtfs-kit, networkx, shapely)
- **Date:** 2026-10-05
- **Decision:** Nightly Python importer producing graph JSON and tiles; type hints plus ruff; `uv` for dependency management.
- **Reason:** Best geospatial and GTFS tooling for stitching GTFS-Pathways to the ほこナビ walking network.
- **Alternatives considered:** Node/TypeScript importer (shares language with the app but weaker geo libraries).

## D-008 Hosting: Cloudflare Pages for the app, small VM for OTP
- **Date:** 2026-10-05
- **Decision:** Static PWA and generated data on Cloudflare Pages; OTP on a small VM.
- **Reason:** Graphs and tiles are static files, so cheap CDN hosting suffices. Only OTP needs a long-running server.
- **Alternatives considered:** Vercel/Netlify (similar); running everything on one VM (no CDN).

## D-009 Testing: Vitest, Playwright, axe-core, Lighthouse CI
- **Date:** 2026-10-05
- **Decision:** Vitest for unit and golden-route tests, Playwright for e2e, axe-core and Lighthouse CI for accessibility gates (CI fails below Lighthouse a11y 95 or on any serious axe violation).
- **Reason:** Accessibility is non-negotiable (WCAG 2.2 AA) and must be enforced automatically. Vitest matches Vite.
- **Alternatives considered:** Jest (slower with Vite); Cypress (Playwright preferred for multi-browser and multi-context, useful for the two-phone demo).

## D-010 Outage reports published as an open feed with a pathway-level extension
- **Date:** 2026-10-05
- **Decision:** Publish active reports at `/feed/outages.json` and `/feed/outages.geojson`, keyed by `pathway_id`, CC BY 4.0, no personal data (no user IDs, timestamps rounded to the minute). Draft spec in `docs/feed-spec.md`.
- **Reason:** GTFS-Realtime alerts cannot target a single pathway; the feed gives back open data and supports the judging criterion on publishing new open data.
- **Alternatives considered:** GTFS-RT alerts only (cannot express pathway-level outages).

## D-011 Scope: demo quality over breadth; Tier 1 / Tier 2 coverage
- **Date:** 2026-10-05
- **Decision:** Tier 1 (all Tokyo, station-to-station) and Tier 2 (in-station detail, starting with the Toei Ōedo Line, 12 stations). Tier shown in the UI. Out of scope: native apps, indoor positioning, accounts beyond anonymous/optional auth, regions outside Tokyo.
- **Reason:** Hard deadline 2027-01-11; Pathways and ほこナビ data exist only for some stations, and users must know how far to trust guidance.
- **Alternatives considered:** Tokyo-wide in-station detail (data not available); a single-line-only app (too narrow for the social-impact criterion).

---

## D-012 Contest-period-only datasets are core data for Tier 2
- **Date:** 2026-10-05
- **Decision:** The Toei GTFS-Pathways file (【コンテスト期間限定公開】) and the ほこナビ walking-network and station-map datasets for the 12 Ōedo stations (limited to the contest period, until 2027-03-12) are treated as core data, not stretch-only. This is an exception to the 「チャレンジ限定」 rule in CLAUDE.md.
- **Reason:** Tier-2 in-station guidance, the demo centrepiece, cannot exist without them.
- **Alternatives considered:** Keeping them stretch-only (leaves no Tier-2 data); using only the generally licensed data (Tier 1 only).
- **Consequence:** The app's Data sources page must state the contest-period limit. The feature set after 2027-03-12 needs a fallback to Tier 1 or a renewed licence.

## D-013 Importer package nested at importer/importer/
- **Date:** 2026-10-05
- **Decision:** `sources/` and `graph/` live inside the Python package, at `importer/importer/`.
- **Reason:** `cd importer && uv run python -m importer.run` needs a package named `importer` directly under the project directory.
- **Alternatives considered:** Flat layout via build configuration (non-standard, fragile).

## D-014 ほこナビ network is the graph backbone; Pathways data is attached by matching
- **Date:** 2026-10-05
- **Decision:** Station graphs take their topology and edge attributes (slope, width, step height, direction, tactile paving) from the ほこナビ network. GTFS-Pathways nodes are matched to ほこナビ nodes and pathways to links, so `pathwayId`, entrance and boarding names and platform codes are attached where a match exists. Links with no pathway keep `pathwayId = null` and are keyed by `edgeId` in outage reports. Matching is by position first (one-to-one per level within 1 m, then a position-only pass within 0.5 m); level conflicts are recorded and the ほこナビ floor is kept. Pathways that have no agreeing ほこナビ link are logged as anomalies, never turned into synthetic edges, and each must be acknowledged in `importer/overrides/stitch.json` or the tests fail. 新宿 is shown as "data-derived, not verified on site".
- **Reason:** At all 12 stations every Pathways node matches a ほこナビ node, and 2,854 of the 2,864 pathways have an agreeing link (the other 10 are listed as anomalies). ほこナビ has links the Pathways file lacks, and at 新宿 the step-free street route depends on 27 of them (including 2 elevators). Only ほこナビ carries slope, width and step data, which the wheelchair profile needs. The Pathways `level_id` is wrong for 59 nodes at 新宿 and 2 at 都庁前, whereas the ほこナビ floors agree with the station map. See `docs/data-notes.md` (2026-10-05, steps 1.2 to 1.4).
- **Alternatives considered:** Pathways as the backbone with ほこナビ attributes joined on (keeps every edge keyed by the operator's `pathway_id` and generalises to other operators, but loses 新宿's step-free route unless the 27 ほこナビ links are added back, which makes it a hybrid anyway).
- **Consequences:** The open outage feed keys by `pathway_id` where one exists and by `edge_id` otherwise; `docs/feed-spec.md` must say so. The importer is specific to the ほこナビ station-data format for now; other operators need a Pathways-backbone path (stretch). The node correspondence is fragile when either dataset is refreshed, so the stitch report runs on every import. Both datasets are contest-period only (D-012).

## D-015 Graph export conventions: bounds for bucketed attributes, assumed base times
- **Date:** 2026-10-05
- **Decision:** (1) ほこナビ attributes are coded buckets, so each is stored as the conservative bound for accessibility: `slopePct` = upper bound of the bucket (0, 5, 8, 18; 18 means "above 8%"), `widthM` = lower bound (0 means under 1.0 m), `stepHeightCm` = upper bound (0, 2, 5, 10; 10 means "above 5 cm"). Unknown buckets (code 99) leave the field absent. Direction of a slope and the elevator-type code are not kept. (2) Base `seconds` per edge come from assumed speeds in `importer/graph/timing.py` (walk 1.2 m/s, stairs and escalators 0.5 m/s, elevator 40 s, fare gate 5 s). (3) CLAUDE.md's `GraphNode` and `GraphEdge` gain optional `gtfsStopId`, `platformId`, `gtfsLevel`, `stepHeightCm`, `roofed` and `tactilePaving`. (4) A node is an `entrance` when its matched Pathways stop is an entrance, a `platform` when it is a boarding area, a `gate` when it touches a fare-gate pathway, an `elevator` when it ends an elevator link, a `street` when ほこナビ marks it outside, otherwise a `junction`. (5) Reachability checks treat both entrances and street nodes as origins.
- **Reason:** Bounds keep the bucketed data honest and err on the safe side for the routing rules (wheelchair: forbidden above 8%, penalty above 5%) without inventing precision. The data has no timings, so a documented assumption is better than none; profiles scale it. Street nodes count as origins because at 新宿 the only step-free exit is an outside node that Pathways does not list as an entrance.
- **Alternatives considered:** Midpoints of the buckets (false precision); raw band codes on every edge (lossless but pushes ほこナビ code tables into the router); omitting `seconds` (the planner needs a time per edge).
- **Consequences:** The router (step 2.3) must exempt elevators from the width rule (the elevator links carry a "under 1 m" width bucket) and decide how to cost unknown attributes. Timings need review after the user tests (step 4.3).

## D-016 Web scaffold choices: own minimal i18n, TypeScript pinned to 6
- **Date:** 2026-10-05
- **Decision:** (1) UI strings use a small in-repo i18n layer (`apps/web/src/i18n/`): typed dictionaries per language with Japanese as the reference type, a React context, and a stored or browser-detected language. No i18n library. (2) `typescript` is pinned to `~6` in `apps/web`.
- **Reason:** The app has four languages and no plurals, formatting or interpolation needs yet, so a library would add bundle weight (the first-load budget is 200 KB gzipped) for little. The compiler turns a missing key into a build error. `typescript-eslint` does not support TypeScript 7.0, which is what `pnpm add` installed by default, so linting failed until the pin.
- **Alternatives considered:** `i18next` and `react-i18next` (about 15 KB gzipped, more features than needed now); `react-intl` (heavier).
- **Consequences:** If interpolation, plurals or lazy-loaded language files become necessary (for example for the step view), revisit and either extend the layer or adopt a library, recording it here. Remove the TypeScript pin when `typescript-eslint` supports 7.x.

## D-017 Routing profile penalties and unknown attributes
- **Date:** 2026-10-05
- **Decision:** Profiles are a table of rules (`ok`, `penalty`, `heavy`, `forbidden`) in `apps/web/src/routing/profiles.ts`. A penalty multiplies an edge's seconds by 2.5, a heavy penalty by 8, forbidden is Infinity. Long walks multiply walking edges by 1.3 (penalty) or 2 (heavy). Beyond the CLAUDE.md table: wheelchair forbids steps above 5 cm and penalises 2 to 5 cm and corridors under 1 m wide; walker_cane and stroller_luggage have step penalties; elevators and fare gates ignore slope, step and width (those buckets describe the cab hop). **Unknown slope or step height is allowed with a 1.5x penalty and the edge is reported as uncertain**, never treated as flat or as forbidden. "Prefer seats" (low_stamina) and "avoid crowded hubs" (sensory) are not modelled because there is no data. An edge with an active `out_of_service` or `blocked` report costs Infinity for every profile; the newest active report per edge wins, so a later `working` clears it. When no route exists the result names why (`unknown_node`, `disconnected`, `blocked_by_profile` with counts of what is in the way, `blocked_by_outage` with the broken edges) and suggests alternatives.
- **Reason:** CLAUDE.md gives the rules but not the sizes. Forbidding unknown-attribute edges would cut 9 of 12 stations off (the street approach links are unknown, see data-notes 2026-10-05), while treating them as flat would be fabricating data; a penalty plus an "uncertain" flag keeps routes available and honest.
- **Alternatives considered:** Forbid unknown edges for wheelchair (safe, but most approaches fail); treat unknown as flat (unsafe and dishonest); penalty sizes as per-profile numbers (more tuning, no data to tune with yet).
- **Consequences:** The penalty sizes are assumptions to revisit after the user tests (step 4.3). Golden tests pin the profile behaviour on the real graphs; at 麻布十番 and 新宿西口 the wheelchair profile reports `blocked_by_profile` because the data's only way down is a 8-18% ramp.

## D-018 OTP for train legs: Toei-only results and provisional plan (step 1.7, first half)
- **Date:** 2026-10-06
- **Decision (provisional):** Run OTP 2.10.0 in Docker with the Tokyo OSM extract and the GTFS feeds, loading **the Pathways variant** of the Toei GTFS, and add further operators one at a time as their GTFS becomes available. Do not rely on OTP's `wheelchair=true` for stops without `wheelchair_boarding`; the app's own graph decides in-station accessibility and the Tier badge says so. The final all-operators-or-subset recommendation is pending the measurements for the other operators.
- **Reason:** A Toei-only graph builds in under 30 s with 2.4 GiB peak and 1.3 GiB at rest, so even several operators should fit on a small VM, but that is not measured yet. The plain feed makes wheelchair routing meaningless (no accessibility data), whereas the Pathways feed makes OTP use the pathways, which is useful and exposes the 新宿 gap. See `docs/data-notes.md` (2026-10-06).
- **Alternatives considered:** Plain GTFS only (OTP then ignores accessibility entirely); `onlyConsiderAccessible` (finds no stops while the data is empty).
- **Consequences:** Candidate itineraries from OTP must still be checked by the in-station router (CLAUDE.md hybrid routing). Where OTP and our graph disagree (新宿), the app should say which source it used. The OSM extract needs an ODbL credit on the Data sources page (step 5.1).

## D-019 Inside-station map: MapLibre on GSI vector tiles, data copied into the app, floors as panels
- **Date:** 2026-10-06
- **Decision:** (1) The map is MapLibre GL JS loaded lazily (its own chunk, 280 KB gzipped, fetched only when a station page opens; the first-load bundle stays at 77 KB). Its worker is configured explicitly with `setWorkerUrl` and a Vite `?worker&url` import, because MapLibre 6 does not find it under a bundler. (2) The basemap is a compact in-repo style (water, buildings, roads, railways; 6 layers) on the 国土地理院 vector tiles (`experimental_bvmap`), credited in the map's attribution control. GSI's own style has 774 layers and is 850 KB. `?basemap=off` shows only the station data. (3) Station graphs and map polygons are copied from `data/build/` into `apps/web/public/data/` by `scripts/sync-data.mjs` (run automatically by `pnpm dev` and `pnpm build`, skipped with a warning when the importer has not been run); the folder is git-ignored. (4) The floor switcher has one panel per whole floor (`floor(level)`): half floors share the floor below, the ground is its own panel, and panels without source polygons say so and show only the network. (5) Every map element has a text equivalent: a radio-group floor switcher, a live status line, and a list of entrances, gates, platform areas, lifts, escalators, stairs, ramps and toilets for the selected floor. Lines differ by colour, width and dash pattern.
- **Reason:** MapLibre fits the open-data licensing and the 3D plan; GSI tiles are free for this use and need no key; a compact style keeps the page light. Copying data into `public/` keeps the app static (Cloudflare Pages) and lets the service worker cache it later (step 2.9).
- **Alternatives considered:** The public OpenStreetMap raster tiles (usage policy limits heavy use); GSI's full style (large); a hosted vector-tile service (key and cost); fetching graphs from a server at runtime (not offline-friendly).
- **Consequences:** The station page scores 0.85 for performance in Lighthouse (accessibility 100) because of the MapLibre chunk and WebGL start-up; revisit in step 4.2. GSI tiles and glyphs are a runtime dependency until the offline step caches a station's area. The entrance labels (A1, B2...) use GSI's glyph server.

## D-020 Route steps: language-free codes, turn rules and how elevators are named
- **Date:** 2026-10-06
- **Decision:** (1) `routeToSteps` (`apps/web/src/routing/steps.ts`) turns a route into steps of kinds `start`, `walk`, `elevator`, `fare_gate`, `stairs`, `escalator` and `arrive`. Steps carry codes, numbers and leg ranges, not text; the UI renders them per language (slice 2) and the map highlights a step's legs (slice 3). (2) Turns are relative to the direction faced, taken from the last leg that moves at least 0.5 m sideways (an elevator's exit hop, a gate, the previous walk). Under 30 degrees is straight, under 60 slight, 150 or more a U-turn. Walks are straightened (Douglas–Peucker 1.5 m) and stretches under 6 m are folded into the next. (3) Elevators are named by the entrance they are at, by the nearest labelled entrance within 30 m when they reach the street, and otherwise only by the floors they connect. (4) `summary.elevators` counts rides, not elevator edges. (5) Unknown slope or step height is listed per step (`uncertainEdgeIds`).
- **Reason:** The data has no elevator names, no landmarks besides gates, entrances and platforms, and no fare-gate direction (data-notes 2026-10-06, step 2.5). Keeping steps language-free lets one tested function serve four languages and the map. The thresholds come from the real 大門, 新宿, 都庁前 and 国立競技場 routes.
- **Alternatives considered:** Text generated directly in the router (ties logic to one language); naming underground elevators after the nearest street entrance (points people the wrong way); one turn per graph edge (too many turns in zigzag corridors).
- **Consequences:** The thresholds are assumptions to check in the user tests (step 4.3). Elevator time per ride is overcounted by the importer (40 s per edge); fix before step 2.4.

## D-021 Boarding position: front, middle or back from the timetable, never a car number
- **Date:** 2026-10-06
- **Decision:** (1) The importer adds an optional `travel` block to each platform: the boarding areas at the front and back ends, the extent, the next and previous stops, main headsigns, whether trains terminate, and a confidence (`importer/graph/travel.py`). The front is the end trains run towards, from the next and previous stops of the platform's trips; each votes separately and any disagreement drops the direction. (2) The app splits the platform into thirds and says front, middle or back, with the next station to name the train ("trains towards 汐留"); it never gives a car number. (3) Weak directions (neighbours far off the axis) and approximate ends (fewer than 6 boarding areas) are said in the UI. (4) Boarding areas reachable from the street without a fare gate are left out of their platform and reported (`boarding_area_outside_gates`).
- **Reason:** The open data has no car, door or stop-mark positions, and boarding areas are path junctions, not doors; a car number would be fabricated. The timetable gives the direction unambiguously for every Ōedo platform, and next and previous stops agree everywhere. Details and the per-platform table: data-notes 2026-10-06, step 2.6.
- **Alternatives considered:** Estimating a car number by assuming the train stops centred on the boarding areas (an untested assumption presented as fact); using Toei's published barrier-free car positions (not open data, not under the ODPT licence); the next station alone (fails where the tunnel curves; using both neighbours catches disagreement).
- **Consequences:** Positions need an on-site check before the user tests (step 4.3), especially 六本木 and 新宿 (approximate) and 新宿西口 (weak). The journey planner (2.4) can use the destination station's "where to ride" for the whole trip. If an operator publishes car positions as open data, add them as a source and replace the thirds.


## D-022 Outage reports: one write function, anonymous sign-in, one active report per device
- **Date:** 2026-10-06
- **Decision:** (1) Reports are written only through the `report_outage(edge_id, status)` Postgres function (`security definer`); clients have read-only access to `station_devices` and `outage_reports`, enforced by RLS and revoked grants. (2) Reporting needs a Supabase session, and **anonymous sign-in** is enough; there are no accounts. Rate limits are per session: 10 reports an hour, 30 a day (`private.reports_per_*`), plus GoTrue's limit of 30 anonymous sign-ins per hour per IP. (3) A report on any edge of a device covers the whole device: an elevator shaft is the connected group of its elevator edges (step in, ride, step out), an escalator is one edge. The importer writes the reportable edges to `data/build/supabase/devices.sql` (`importer/graph/devices.py`), which `supabase db reset` loads; unknown edges get a 404. (4) Each device has at most one active report. The same status from a new person adds a confirmation and extends the expiry to 6 hours from now; the same person again changes nothing; a different status ends the current report (its `expires_at` is set to its `created_at`) and starts a new one. (5) Who reported what lives only in `private.report_events` (not exposed by the API), for rate limits and one-confirmation-per-person, and is deleted after 7 days once the report has ended. Public rows have no user ids and minute-rounded timestamps, so the table can be published as the open feed (step 3.1). (6) The community can report `out_of_service` and `working`; `blocked`, `data_wrong` and `source = 'operator'` are reserved for later steps and the service role. (7) In the PWA, `useOutages` loads a station's active reports after its Realtime channel is subscribed (and again after each reconnect), applies the answer to the user's own report at once, drops reports as they expire, and treats a report with `expires_at <= created_at` as ended regardless of the device clock. supabase-js is loaded lazily (55 KB gzipped) so the first-load bundle is unchanged. Without the two `VITE_SUPABASE_*` variables the app runs and says live reports are unavailable. (8) Reporting UI: two taps on an elevator or escalator step, plus a station list of devices reported out of service where people can confirm or clear them, because a route never shows a device it avoids. The client groups devices from the graph the same way as the importer, so it can name them by floors and nearby entrance.
- **Reason:** A single function keeps every rule (validation, dedupe, TTL, rate limit) in one tested place, which direct inserts with RLS cannot express. Anonymous sessions give a per-device key for limits without collecting personal data, in line with CLAUDE.md's "anonymous or optional auth". One active report per device gives clients an unambiguous state despite minute-rounded timestamps, and ending a report by setting `expires_at = created_at` needs no extra column. Grouping by device matches what people see (one lift, not three edges), and the router then blocks every hop of a broken shaft.
- **Alternatives considered:** Direct inserts under RLS (no dedupe or rate limit); rate limiting by hashed IP (shared IPs on mobile networks and stations, and it is personal data); an edge function in front of the table (another service, same logic); keeping every report active and letting the newest win (ties within a minute are ambiguous).
- **Consequences:** Someone with many IPs can still flood reports; if that happens, add Cloudflare Turnstile to anonymous sign-in (Supabase supports it) and a per-device cap. Hosted Supabase needs the same settings as `supabase/config.toml` (anonymous sign-ins on) and the devices seed loaded after each import. The feed (3.1) and reliability history (3.2) read `outage_reports`, where an ended report is recognisable by `expires_at = created_at`.

## D-023 Elevator time per ride, not per edge
- **Date:** 2026-10-06
- **Decision:** An elevator ride costs `ELEVATOR_WAIT_S` (30 s) once plus `ELEVATOR_PER_LEVEL_S` (5 s) per level travelled, with at least `ELEVATOR_MIN_S` (2 s) per edge (`importer/graph/timing.py`, `time_elevators`). Half the wait sits on each end of an elevator edge that touches a hall, i.e. a node the walking network reaches. A ride enters at one hall and leaves at another, so it pays the wait once whether the data has one edge for the ride, a hop–shaft–hop chain, or a shaft split at intermediate floors (cab nodes are not halls). This replaces D-015's 40 s per elevator edge.
- **Reason:** With 40 s per edge a ride cost 80 to 160 s depending on how the data splits it (data-notes 2026-10-06, step 2.5), which skews the journey timeline (step 2.4) and comparisons between elevators. The data still has no timings, so the numbers remain assumptions.
- **Alternatives considered:** Time only on edges that change level (misses single-edge shafts and the shafts whose ends share a level number); a fixed time per device in the client (the router works on edges).
- **Consequences:** Hall-to-hall rides in the 12 stations take 36 to 54 s (checked by `test_elevator_rides_take_the_modelled_time`). Revisit the wait after the user tests (step 4.3).

