# StepZero — build prompts for Claude Code

Work through these in order, one session per milestone. Start a new Claude Code session when you begin a new milestone.
Later prompts assume earlier ones worked. If a finding changes the plan (e.g. a dataset is missing), tell Claude and ask it to update CLAUDE.md and this file.

---

## Where we are (read this first; update it whenever the order or status changes)

Last updated 2026-10-07 (after 2.10). The checkboxes below are the source of truth for what is done; this section explains the exceptions.

- **Out of order on purpose.** We did 2.1 (web scaffold) and 2.3 (profiles and A*) before finishing Phase 1, because 1.6 is waiting on API keys and a licence decision. **2.2 (map with floors) is now done** (floor-polygon export plus the MapLibre station page; see D-019).
- **1.6 (Tier-1 station data) is in progress, not done.** The first pass without keys is in docs/data-notes.md ("step 1.6, in progress"). Done 2026-10-07: the other operators' GTFS are downloaded (`importer.download --only gtfs`, 4.8 MB) and `wheelchair_boarding` is empty on all of them (data-notes "step 1.6"). Still to do: propose how Tier-1 stations without data are shown (Opus). Both keys (`ODPT_CONSUMER_KEY`, `ODPT_CHALLENGE_KEY`) are in `.env` and tested (2026-10-07). The licence question is decided: challenge-limited operators are core data for Tier 1 (D-026).
- **1.7 (OTP spike): the builds are done (2026-10-07), the recommendation is not.** Toei alone: 27 s, 2.4 GiB peak, 1.3 GiB serving (data-notes 2026-10-06, D-018). All nine operators: about 31 s, 2.4 GiB peak, 1.33 GiB serving, 113 MB graph, routing works across JR East and Metro (data-notes 2026-10-07). Feed ids are now pinned in `otp/build.sh` (Toei is always `1`, so the app and recorded OTP answers still work). Still open: the OSM extract may not reach west Tokyo (新宿 → 調布 failed), and with more operators OTP offers wheelchair itineraries over JR stops it cannot verify (data-notes 2026-10-07), so non-Tier-2 legs must stay flagged. **Still to do:** write the final all-operators-or-subset recommendation in decisions.md. Leave 1.7 unticked until then. That recommendation is an Opus step.
- **Known gaps carried forward.** 新宿 is flagged "not verified on site" (D-014); 麻布十番 and 新宿西口 have no wheelchair route in the data because the only way down is an 8 to 18% ramp (data-notes, step 1.5); the routing penalty sizes and base timings are assumptions to revisit after user tests (D-015, D-017).
- **The UI is temporary scaffolding.** A dedicated visual design step (2.11) is planned after 2.5; it must start by consulting the user on the visual direction.
- **Web app state:** the home page has the journey planner (2.4: station, address or place to station, address or place, through OTP and the station graphs, re-planned live on outage reports). Each station page (12 Ōedo stations) has the route planner with its step list, the floor map with the route drawn on it, the text list for the floor, and outage reports (2.8). Offline works (2.9): every station, the last journey, and reports queued until back online. Every station shows its tier in words (2.10), no live train status (2.7). The app is not deployed anywhere (4.5).

**2.5 (inside-station step view) is done, in four slices.** (1) `routeToSteps` in `apps/web/src/routing/steps.ts` (D-020). (2) Four-language step text (`features/station-view/describe.ts`) and the planner with its step list (`features/station-view/RoutePlanner.tsx`, on the station page above the floor map; it routes through the real worker, with an inline fallback when there is no `Worker`). (3) The route on the map (`map/routeGeojson.ts`, route layers in `map/StationMap.tsx`): yellow line with numbered markers matching the list, and a "地図で見る" toggle per step that switches floor, zooms and highlights; a new route opens the map on the floor where it starts. (4) Accessibility: `docs/a11y-checklist.md`, `e2e/planner-a11y.spec.ts` (axe in four languages and states, dark and high contrast, keyboard walkthrough, targets), a skip-the-step-list button, and the map's own labels localised. Lighthouse accessibility is 100.

**Still open from 2.5, do not forget:** (a) **the manual VoiceOver pass** (section 4 of `docs/a11y-checklist.md`) has not been done; only the user can do it on a device; (b) **native-speaker review** of the zh-Hant and ja-easy wording (see `apps/web/src/i18n/README.md`); (c) ~~elevator time overcounted~~ fixed in 2.4 (D-023: 30 s wait once per ride plus 5 s per level); (d) the map colours are placeholders for 2.11.

**2.6 (boarding position) is done** (D-021): each platform step says front, middle or back of the train, named by the next station, with the platform picker showing each platform's direction; no car numbers, because the data has none. It also found a data error: a 都庁前 platform-2 boarding area outside the fare gates, now left out by the importer (data-notes 2026-10-06, step 2.6). **Still open from 2.6:** verify the positions on site, especially 六本木 and 新宿 (few boarding areas) and 新宿西口 (direction estimated).

**2.8 (outage reports) is done, in four slices** (D-022). (1) Database: `supabase/migrations/`, `station_devices` seeded by the importer, writes only through `report_outage()` with anonymous sign-in, rate limits, 6-hour TTL, confirmations, one active report per device; 27 pgTAP tests (`supabase test db`). (2) Client: `apps/web/src/features/report/`, `useOutages` feeds `blockedEdgeIds` to the planner; works without Supabase configured. (3) UI: "故障を報告" on elevator and escalator steps (two taps), "この駅の故障情報" list with "まだ使えない / 使えるようになった", a notice when reports change the route (only after the reports first loaded). (4) `pnpm e2e:live` (`e2e/outages.live.spec.ts`): two browsers against local Supabase; B re-routes 0.3 to 0.9 s after A's report, confirmations and "working again" reach the other page, axe clean with the report UI open. Also fixed a pre-existing race in `station-map.spec.ts` (the route moved the floor after the test chose one).

**Still open from 2.8:** (a) the report flow in the manual VoiceOver pass (added to `docs/a11y-checklist.md` section 4); (b) native-speaker review of the new zh-Hant and ja-easy strings (`report`, `outageStatus`); (c) hosted Supabase project not created yet: needs anonymous sign-ins on, the migration, and the devices seed after each import (with 4.5 Deploy); (d) if report spam appears, add Cloudflare Turnstile to anonymous sign-in (D-022); (e) `home.spec.ts` axe test timed out once at 30 s on a cold start in one of five runs; watch it; (f) broken devices are listed in text but not marked on the map yet (2.11 or 3.3).

**2.4 (journey planner) is done, in three commits** (D-023, D-024). (0) Elevator time per ride in the importer (D-023). (1) Building blocks: `data/stations.json` (all 149 Toei stations, `importer/graph/stations.py`), the OTP client (`apps/web/src/features/journey/otp.ts`, `plan.graphql`), address (国土地理院) and place (Nominatim) search, entrance choice by street distance (`fromCost`/`toCost` in `astar.ts`), and `assemble.ts`, which joins OTP's trains with the in-station routes and works out where to ride. (2) UI: the planner on the home page and at `#/journey?...` (`JourneyPlanner.tsx`, `PlacePicker.tsx`, `JourneyTimeline.tsx`), four languages, re-planned live on outage reports (`useOutagesFor`), report buttons in the journey. Tests: `e2e/journey.spec.ts` (大門 → 新宿 wheelchair, replaying a recorded OTP answer) and `e2e/journey.live.spec.ts` (live OTP + Supabase: B's journey changes about 0.3 s after A reports a lift). The dev and preview servers forward `/otp` to a local OTP (`cd otp && docker compose up otp`).

**Still open from 2.4:** (a) the journey items in the manual VoiceOver pass (`docs/a11y-checklist.md` section 4); (b) native-speaker review of the new `journey` strings (zh-Hant, ja-easy); (c) OTP's feed id `1` is assumed for Toei: pin feed ids when other operators are added (1.7); (d) the journey has no map yet (each station links to its station page); (e) credit 国土地理院 and OpenStreetMap (Nominatim, street walks) on the Data sources page (5.1); (f) a deployed OTP for the app (4.5, `VITE_OTP_URL`); (g) live delays on the timeline are 2.7.

**2.9 (offline PWA) is done** (D-025). The service worker precaches the app and all 12 stations' graphs and maps (about 1.1 MB gzipped with MapLibre); GSI tiles and glyphs are cached as viewed. The last journey is kept as OTP's answer (`features/journey/saved.ts`) and assembled again offline from the precached graphs, with a "saved at" notice; an offline notice under the header links to it. Reports made offline are queued (`features/report/queue.ts`), applied at once to this device's routes, sent when back online, and dropped after an hour. Tests: `queue.test.ts`, the offline cases in `JourneyPlanner.test.tsx`, `e2e/offline.spec.ts` (Playwright offline mode, desktop and mobile) and the queued-report case in `e2e/outages.live.spec.ts`. Also fixed a 2.8 bug that made the live e2e flaky: the station planner could miss the "route changed" notice when a device's rows arrived as separate Realtime events (`nextSeen` in `RoutePlanner.tsx`).

**Still open from 2.9:** (a) the offline items in the manual VoiceOver pass (`docs/a11y-checklist.md` section 4); (b) native-speaker review of the new `offline`, `report.queued`, `report.queuedNote`, `journey.savedPlan` and `journey.errors.offline` strings (zh-Hant, ja-easy); (c) try it on a real phone in flight mode, including iOS Safari (no Background Sync there, which is why the queue lives in the page); (d) `outages.live.spec.ts` "A reports … B's route changes" still failed twice in about 20 runs at "confirmed by 2" (B's confirmation was accepted; A did not show the new count). Not reproduced in 8 runs of that test alone; watch it; (e) precaching every station does not scale beyond the Ōedo set (D-025 consequences); revisit when Tier-2 grows; (f) whether a queued report should carry the time it was made (3.1).

**2.10 (coverage tiers in the UI) is done.** One `TierBadge` (`apps/web/src/components/TierBadge.tsx`) writes the tier out ("駅の中まで案内" / "駅間ルートのみ", never colour alone) and is used in station search results, on each station segment of a journey, and on the station page with a one-line explanation. Strings are in `tierBadge` in all four dictionaries; the old `tierLine` and `journey.stationTier2` keys are gone. **Still open from 2.10:** native-speaker review of the new `tierBadge` strings (zh-Hant, ja-easy); the badge styling is placeholder until 2.11; a Tokyo-wide tier map is 3.3.

**2.7 (live train status) is in progress, slices 1 and 2 of 3 done (2026-10-07, D-027).** Slice 1: the Supabase edge function `supabase/functions/live-status` (Toei, JR East, Keio, Tobu; 16 Deno tests; checked against the live feeds; the key is never returned or logged). Slice 2: the client. `plan.graphql` now asks OTP for `trip`, `serviceDate` and `stopPosition` (fixtures re-recorded); `features/live/` has the API client, `computeLegLive` (delay = live time minus timetable time), alerts, `transferRisks`, `useLiveStatus` (polls every 30 s, pauses when the page is hidden), the wording (`describeLive`), `LiveLeg` and `LiveBar`; `JourneyTimeline` shows each train's state in words, alerts, transfer warnings and "search again from now"; a screen-reader sentence is announced once when the number of troubled trains changes; strings in all four languages (`live`). Stale data is never shown as "on time". **Still to do (slice 3):** Playwright with a mocked function and axe in the new states, a live e2e (real function through `supabase functions serve`, with the stack running), the manual VoiceOver items in `docs/a11y-checklist.md`. **Still open from 2.7:** (a) native-speaker review of the `live` strings (zh-Hant, ja-easy; `apps/web/src/i18n/README.md`); (b) Tokyo Metro and Sotetsu have no GTFS-RT in ODPT, so their trains say "no live information for this railway"; (c) OTP itself does not know about delays, so a late train can make a connection that OTP shows as fine impossible: the timeline warns, but the plan does not change (D-027, the OTP updater is not used); (d) only the shown journey asks for live data, so the option buttons show timetable times; (e) delays are not propagated to stops the feed gives no time for; (f) a stop update with an absent time is not interpolated; (g) `RoutePlanner.test.tsx` "plans again around an elevator reported out of service" failed once in a full-suite run and passed in 5 more runs and alone: watch it; (h) hosted deploy needs `ODPT_CHALLENGE_KEY` as a secret and `verify_jwt = false` kept (4.5).

**Next, in this order:**
1. **2.7 slice 3** (above).
2. **2.11 Visual design pass** (Opus; consult the user on the visual direction first).

Finish 1.6 and the rest of 1.7 first now that the keys are in (downloads and counts on Sonnet; the 1.6 proposal and 1.7 recommendation on Opus).

**Environment notes for a new session.** Installed on the user's Mac: `uv` (importer), `node` and `pnpm` (apps/web), Docker (OTP, Supabase), the Supabase CLI (`brew install supabase/tap/supabase`, 2.119). Playwright's downloaded browser stalled, so run browser tests with `PW_CHANNEL=msedge pnpm e2e` and Lighthouse with `CHROME_PATH="/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" pnpm lighthouse`. The importer output (`data/build/`) and the OTP inputs (`otp/data/`) are git-ignored; rebuild with `cd importer && uv run python -m importer.run --stations oedo` and `cd otp && ./build.sh toei-pathway`. The dev server is `cd apps/web && pnpm dev`. Network on this Mac has been slow for big downloads. Commit trailers: none (see memory). The local Supabase stack and the OTP container (`otp-otp-1`) may still be running in Docker (`supabase stop`; `cd otp && docker compose down`).

---

## Model guide (remind the user to switch with `/model` before these)

Sonnet 5.5 is enough for routine implementation, setup and docs. **Before starting any step marked Opus below, tell the user in one line and suggest switching to Opus 5.5**, then carry on after they answer. Also suggest it whenever a problem turns out to be ambiguous or a first conclusion was wrong.

| Step | Model | Why |
|---|---|---|
| 1.6 proposal for Tier-1 stations without data | Opus | data strategy and licence judgement |
| 1.7 recommendation (all operators or a subset) | Opus | trade-off from measurements |
| 2.4 Journey planner | Opus | main design: OTP legs plus in-station legs in one timeline |
| 2.5 slice 1 (route to steps) and slice 2 strings (ja, ja-easy, zh-Hant, en wording) | Opus | quality of Japanese and accessibility wording |
| 2.5 slice 2 UI (picker, step list), slice 3 (map highlight), slice 4 (a11y checklist and test runs) | Sonnet | well specified; switch to Opus if slice 4 fixes turn out ambiguous |
| 2.6 Boarding position | Opus | ambiguous geometry; honest limits |
| 2.8 Supabase, RLS, rate limiting, realtime | Opus | security-sensitive |
| 2.11 Visual design pass | Opus | design judgement; **ask the user for visual direction first** |
| 2.9 Offline PWA | Opus | service-worker edge cases |
| 3.1 Feed spec and the GTFS-Realtime extension proposal | Opus | specification writing |
| 3.4 3D station view | Opus | rendering and performance |
| 4.1 Accessibility audit, 4.2 Performance | Opus | careful verification |
| 4.4 User-test feedback to changes | Opus | synthesis and prioritisation |
| 5.1 Licences check, 5.2 Write-up, 5.3 Video script, H.1 Hearing prep | Opus | judgement and writing for judges |
| Everything else (1.x exports, 2.1, 2.2, 2.3, 2.7, 2.10, 3.2, 3.3, 3.5 to 3.7, 4.3, 4.5, 5.4, 5.5) | Sonnet | well specified |

---

## Every session

**Start of session**
> Read CLAUDE.md and docs/data-notes.md. Summarise where the project is and what's next, in 5 lines. Don't change anything yet.

**End of session**
> Run all tests and the linter. Fix anything failing. Update CLAUDE.md (commands, decisions) and docs/data-notes.md with anything we learned this session, then commit with a conventional commit message.

**When something is unclear or broken**
> Before writing code, explain what you think is wrong, show me the evidence (logs, data, failing test), and propose two ways to fix it.

---

## Phase 0 — Setup (day 1)

- [x] **0.1 Repo hygiene**
> Read CLAUDE.md. Update .gitignore to also cover Python (venv, `__pycache__`, `.ipynb_checkpoints`), `.env*` files, and `data/raw/` and `data/build/`. Create the folder layout from CLAUDE.md with a short README in each folder saying what goes there. Add `.env.example` with `ODPT_CONSUMER_KEY=` and Supabase placeholders. Commit.

- [x] **0.2 Decision log**
> Create docs/decisions.md and docs/data-notes.md. Record the stack decisions from CLAUDE.md as the first entries in decisions.md (date, decision, reason, alternatives considered). Commit.

---

## Phase 1 — Data spike (weeks 1–3)

- [x] **1.1 Importer project + downloads**
> Set up `importer/` as a Python project with uv (geopandas, gtfs-kit, networkx, shapely, pandas, jupyter, ruff, pytest). Write a source adapter that downloads the Toei GTFS (including GTFS-Pathways) from ODPT and the ほこナビ walking-network and station-map datasets for the 12 Ōedo stations into `data/raw/`, recording each source URL, licence and download date in a manifest. The ODPT key comes from `.env`; ask me before running anything that needs it.

- [x] **1.2 Explore GTFS-Pathways**
> Create `importer/notebooks/01_pathways.ipynb`. For each of the 12 Ōedo stations, report: levels, number of pathways by pathway_mode, elevators, whether every platform is reachable step-free from a street entrance, and any obvious data errors. Summarise the results as a table in docs/data-notes.md.

- [x] **1.3 Explore ほこナビ**
> Create `02_hokonavi.ipynb`. Load the walking network and station maps for the same stations. Report the schema (which attributes exist: steps, slope, width, elevator), the coordinate system, how floors are encoded, and coverage. Plot one station (大門) per floor. Add findings to docs/data-notes.md.

- [x] **1.4 Stitch pathways ↔ walking network**
> Create `03_stitch.ipynb` and then `importer/importer/graph/stitch.py`. Match GTFS-Pathways nodes to ほこナビ nodes by level and distance, as CLAUDE.md describes. Report match rate per station and list the unmatched nodes. Propose how to handle the failures (manual overrides file, distance threshold) before implementing.

- [x] **1.5 Export station graphs**
> Implement `python -m importer.run --stations oedo` to export one graph JSON per station to `data/build/graphs/`, matching the GraphNode/GraphEdge types in CLAUDE.md (pathwayId preserved). Add pytest tests: graph is connected, every platform node exists, a wheelchair-valid path exists from at least one entrance to each platform (or the gap is logged). Also export a JSON Schema for the graph format to `docs/graph.schema.json`.

- [ ] **1.6 Station-level data for Tier 1**
> Research which ODPT datasets give station-level accessibility for all Tokyo rail operators (e.g. elevator presence, wheelchair_boarding in GTFS stops). Download what's available, summarise coverage per operator in docs/data-notes.md, and propose how Tier-1 stations should be shown when data is missing.

- [ ] **1.7 OpenTripPlanner spike**
> Set up OTP2 in `otp/` with Docker. Build a graph from Toei GTFS first, then try adding more Tokyo operators' GTFS from ODPT. Record memory use and build time for each. Make a test query between 新宿 and 大門 with wheelchair=true and save the response. Write results and a recommendation (all operators or a subset) to docs/decisions.md.

---

## Phase 2 — Core app (must-haves, weeks 4–10)

- [x] **2.1 Web scaffold**
> Scaffold `apps/web` with React + Vite + TypeScript (strict), vite-plugin-pwa, Vitest, Playwright, axe-core, ESLint, Prettier. Add i18n with ja, en, zh-Hant and ja-easy, with no hard-coded strings. Add a Lighthouse CI config that fails below 95 accessibility. Create a minimal home page that passes all checks. Commit.

- [x] **2.2 Map with floors**
> Add MapLibre GL JS with a free open basemap. Load one station graph and the ほこナビ floor polygons for 大門. Add a floor switcher (B1, B2…) that is keyboard- and screen-reader-accessible. Every map element needs a text equivalent.

- [x] **2.3 Routing profiles + A***
> Implement `src/routing/profiles.ts` and an A* router in a Web Worker over the station graph, exactly as CLAUDE.md specifies (Infinity = forbidden; active outages = Infinity). Write unit tests per profile and golden-route tests for 大門 (street → Ōedo platform, wheelchair). When no route exists, return a structured reason, never an empty result.

- [x] **2.4 Journey planner**
> Build the journey planner: origin and destination by station, address or place; profile picker; calls OTP for train legs and the in-station router for each Tier-2 station end. Show one timeline: street → entrance → elevator → gate → platform → train → transfer → exit. Add a Playwright test for a full 大門 → 新宿 wheelchair journey.

- [x] **2.5 Inside-station step view**
> For each in-station segment, show a step list with floor, landmark-style instructions ("Take elevator E2 to B2; the gates are ahead on the right") and the highlighted path on the floor map. Check it with VoiceOver-style reading order (axe + a manual checklist in docs/a11y-checklist.md).

- [x] **2.6 Boarding position**
> Using platform geometry and pathway nodes, work out which end of the platform (and if possible which car) is closest to the step-free exit for each Tier-2 station. If the data can't support a car number, fall back to "front / middle / back". Document the method and its limits in docs/data-notes.md.

- [ ] **2.7 Live train status**
> Add a back-end proxy (Supabase edge function) for ODPT GTFS-RT so the key never reaches the client. Show delays and alerts on the journey timeline, with a one-tap re-plan. Handle stale or missing feeds gracefully.

- [x] **2.8 Supabase + outage reports**
> Create Supabase migrations for OutageReport (as in CLAUDE.md) with PostGIS, RLS policies, anonymous inserts, rate limiting, a 6-hour TTL and confirmations that extend it. Build the two-tap report UI on elevators and escalators ("out of service" / "working"). Subscribe to Supabase Realtime so open journeys re-route when a report affects them. Add an e2e test that simulates two clients: client A reports, client B's route changes.

- [x] **2.9 Offline PWA**
> Configure the service worker to cache the app shell, the station graphs, floor maps and the last planned journey. Offline, the app must show the cached journey and in-station steps, and queue reports until back online. Test with Playwright's offline mode.

- [x] **2.10 Coverage tiers in the UI**
> Show each station's tier (full detail vs basic) in search results and on the journey, with a short plain-language explanation of what that means for the guidance.

- [ ] **2.11 Visual design pass** (do after 2.5, once the planner and step view exist; then re-check 4.1 items)
> **First consult the user on the visual direction before designing anything**: ask for reference apps, mood, colours, logo ideas and anything they dislike, then propose 2 or 3 directions (with small mockups or screenshots) and let them choose. Do not pick a direction alone. Then restyle all screens (home, planner, step view, station map, report flow) with a small design system built on the existing CSS variables: type scale, colour tokens for light, dark and high contrast, spacing, icons, a real brand mark and map styling for floors. Keep every accessibility requirement in CLAUDE.md (contrast, 44 px targets, focus, reduced motion) and re-run axe, Lighthouse and the e2e tests. Record the decisions in docs/decisions.md.

---

## Phase 3 — Should-haves (weeks 9–11)

- [ ] **3.1 Open outage feed**
> Implement `/feed/outages.json` and `/feed/outages.geojson` as CLAUDE.md describes (CC BY 4.0, no personal data). Write docs/feed-spec.md: the format, and a draft proposal for extending GTFS-Realtime alerts to target a pathway_id, with examples.

- [ ] **3.2 Reliability history + operator dashboard**
> Add a per-station page showing current and past reports per elevator/escalator (count, total time out, last 30 days). Make it readable without the map.

- [ ] **3.3 Data-quality loop + coverage map**
> Add "this map is wrong" reports and a Tokyo-wide coverage map coloured by tier and data issues found. Generate a summary of data issues from docs/data-notes.md and reports, suitable for including in the contest entry.

- [ ] **3.4 3D station view**
> Add a 3D view: floors stacked with fill-extrusion, the route threaded through levels, PLATEAU buildings above ground. It must respect prefers-reduced-motion and never be the only way to see the route. Keep it under the performance budget on a mid-range phone.

- [ ] **3.5 Effort summary**
> On each journey, show total distance, vertical moves, elevator count, multipurpose toilets and rest points along the route (where data exists).

- [ ] **3.6 Weather + road works**
> Add JMA weather (rain → prefer covered/underground edges in the cost function) and Tokyo road-works data (flag works within 100 m of a used exit). Both through the back end, both optional if feeds fail.

- [ ] **3.7 Share a route**
> Add a share link that encodes the journey in the URL and opens without installing anything, with a clear note if live status has changed since it was shared.

---

## Phase 4 — Hardening and user tests (December)

- [ ] **4.1 Accessibility audit**
> Run a full accessibility audit: axe on every page, Lighthouse, keyboard-only walkthrough, and the docs/a11y-checklist.md items. Fix everything serious, then list remaining issues with severity.

- [ ] **4.2 Performance**
> Measure first load, route time and 3D frame rate on a throttled mid-range mobile profile. Fix anything over the budgets in CLAUDE.md and record the final numbers in docs/decisions.md.

- [ ] **4.3 User-test kit**
> Create docs/user-test/: a 30-minute test script in Japanese and English for wheelchair users, stroller users and blind/low-vision users, a consent form, a feedback form, and a template for recording results. Add a hidden "test mode" in the app that logs anonymous task timings locally.

- [ ] **4.4 Apply user-test feedback**
> Here are the user-test notes: [paste notes]. Group them into themes, propose changes ranked by impact and effort, then implement the top items after I approve.

- [ ] **4.5 Deploy**
> Deploy the web app to Cloudflare Pages, Supabase to production, and OTP to a small VM, with environment variables set correctly. Add a health-check page showing data freshness for each feed. Write the deployment steps to docs/deploy.md. Make sure the Supabase project won't pause before judging.

---

## Phase 5 — Contest entry (late December – 2027-01-11)

- [ ] **5.1 Data sources page + licences**
> Add an in-app "Data sources" page crediting every dataset with its licence, as each licence requires. Check that no challenge-only dataset is used outside stretch features.

- [ ] **5.2 Entry write-up**
> Draft the contest entry in Japanese (with an English version), structured around the four judging criteria: social impact (with user-test evidence), open-data impact (datasets used plus the outage feed and data-quality findings), technical completeness, and UI/UX. Keep claims backed by things that are actually in the repo.

- [ ] **5.3 Demo video script**
> Write a 3-minute demo video script in Japanese with English subtitles: the problem (a real user's story), the two-phone outage demo at 大門, the 3D view, the open feed. Include a shot list.

- [ ] **5.4 README for judges**
> Rewrite README.md for judges and developers: what StepZero is, a live demo link, screenshots, how to run it locally, architecture diagram, data sources, licence, and the open feed spec link.

- [ ] **5.5 Final check**
> Do a final pre-submission check: fresh clone and setup from README works, all tests pass, live site works on iOS Safari and Android Chrome, offline mode works, no secrets in the repo history, feeds are fresh. List anything that fails.

---

## Hearing prep (2027-01-23–24)

**H.1**
> Act as the judging panel described in CLAUDE.md (ODPT chair, MLIT, MobilityData GTFS lead, JR East data lead, a Mapbox/visualisation expert, a pedestrian-navigation professor). Ask me the 10 hardest questions about StepZero, one at a time, and give feedback on my answers.
