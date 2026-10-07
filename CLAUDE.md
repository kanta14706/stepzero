# CLAUDE.md — StepZero (ステップゼロ)

Tagline: 改札からホーム、扉まで。段差ゼロのルート案内 (step-free routes from gate to platform to train door).

Step-free journey planner for Tokyo rail, built as a PWA for the **公共交通オープンデータチャレンジ2026** (ODPT Challenge).
**Hard deadline: 2027-01-11 23:59 JST.** Scope decisions favour a working, polished demo over breadth.

## What the app does

Plans routes from street to train door and back for people who can't use stairs or escalators (wheelchair, cane/walker, stroller/luggage, low stamina, sensory-sensitive). Inside stations it names the exit, the elevator, the platform end and the car to board. Users report broken elevators and escalators, and routes recalculate. Those reports are published back as an open feed.

**Coverage tiers** (show the tier in the UI so users know how far to trust guidance):
- **Tier 1, all Tokyo stations:** station-to-station step-free planning from timetables, real-time data and station-level accessibility.
- **Tier 2, full detail:** stations with GTFS-Pathways and ほこナビ data get in-station guidance. Toei Ōedo Line, 12 stations, published 2026-09-17, is the first set and the demo centrepiece.

## Judging criteria (optimise for these)

1. 社会課題解決への寄与: real users, real barrier removed
2. オープンデータ活用におけるインパクト: combine ODPT, ほこナビ, PLATEAU, JMA and Tokyo data, and publish new open data
3. 技術的な完成度: correct routing, live re-routing, offline
4. UI/UX面の完成度: accessible by design, polished map and 3D

Key demo: report an elevator broken on phone A, and phone B's route switches within seconds.

## Architecture

```
static open data ──► importer (Python, nightly) ──► graph JSON + tiles ──► static hosting ──► PWA
live open data ───► live API (Supabase) ◄──────── reports ◄────────────────────────────────── PWA
                          │                                                                   ▲
                          └──► open outage feed (JSON / GeoJSON / GTFS-RT draft)               │
OpenTripPlanner 2 (server) ── train-leg itineraries ──────────────────────────────────────────┘
```

- **Hybrid routing.** OTP2 returns candidate train itineraries. The PWA's own A\* (in a Web Worker) routes entrance → platform inside Tier-2 stations and rejects or repairs candidates that hit an active outage.
- The PWA must stay usable offline for cached stations, since there's no signal underground.

## Stack

| Layer | Choice |
|---|---|
| Front end | React + Vite + TypeScript, `vite-plugin-pwa` |
| Map | MapLibre GL JS (deck.gl only for the 3D station view) |
| In-station routing | A\* in a Web Worker over per-station graph JSON |
| Train routing | OpenTripPlanner 2 (GTFS + GTFS-RT), Docker |
| Back end | Supabase (Postgres + PostGIS, Realtime, Auth) |
| Importer | Python 3.11+: geopandas, gtfs-kit, networkx, shapely |
| Hosting | Cloudflare Pages (app); small VM for OTP |
| Testing | Vitest, Playwright, axe-core, Lighthouse CI |

Don't swap major dependencies without recording the reason in `docs/decisions.md`.

## Repo layout

```
apps/web/            PWA (React + Vite)
  src/routing/       A* worker, profiles, cost functions
  src/map/           MapLibre layers, floor switching, 3D view
  src/features/      planner, station-view, report, share
  src/i18n/          ja, en, zh-Hant, ja-easy (やさしい日本語)
importer/            Python pipeline → data/build/ (uv project; package in importer/importer/)
  importer/sources/  one adapter per dataset (download + normalise)
  importer/graph/    stitching pathways ↔ walking network
  notebooks/         exploration notebooks
  tests/             pytest
otp/                 OTP config, build scripts, Dockerfile
supabase/            migrations, RLS policies, edge functions
data/raw/            downloaded inputs (git-ignored)
data/build/          generated graphs and tiles (git-ignored)
docs/                decisions.md, data-notes.md, feed-spec.md, graph.schema.json
```

## Data sources

| Dataset | Where | Use |
|---|---|---|
| Toei GTFS + GTFS-Pathways | ckan.odpt.org (dataset `train-toei`) | Timetables; in-station elevators, escalators, stairs, levels |
| Other operators' GTFS / GTFS-RT | ckan.odpt.org | Tier-1 routing, delays (TripUpdate, VehiclePosition, alerts) |
| ほこナビ walking network + station maps | ckan.hokonavi.go.jp (tag 都営地下鉄; group nwd_2024) | Steps, slope and width per link; floor polygons |
| PLATEAU | mlit.go.jp/plateau/open-data | Buildings in the 3D view |
| JMA weather | data.jma.go.jp/developer | Rain → prefer covered routes |
| Tokyo road works | catalog.data.metro.tokyo.lg.jp | Flag works near exits |

Rules:
- The ODPT API key lives in `.env` as `ODPT_CONSUMER_KEY`. Never commit it or ship it to the client; proxy through the back end.
- **Licences:** use the ODPT basic licence for core features. Datasets marked 「チャレンジ限定」 (e.g. Haneda TIAT flight data) may appear **only** in stretch features and must be listed in `docs/data-notes.md`. **Exception (decided 2026-10-05):** the Toei GTFS-Pathways file and the ほこナビ Ōedo station datasets are contest-period-only releases (ほこナビ until 2027-03-12) but are core data for Tier 2; they are recorded in `docs/data-notes.md` and `docs/decisions.md` (D-012). **Exception (decided 2026-10-07):** the challenge-limited datasets of JR East, Keio, Tobu, Sotetsu and Tokyu are core data for Tier 1 (D-026); the key is `ODPT_CHALLENGE_KEY` in `.env`.
- Credit every source on an in-app "Data sources" page, as the licences require.
- Record every data quirk you discover (missing levels, mismatched IDs, wrong coordinates) in `docs/data-notes.md`. These notes become the "data quality" findings in the entry.

## Core domain model

```ts
type NodeId = string;                     // "<station_id>:<source>:<local_id>"
interface GraphNode { id: NodeId; lon: number; lat: number; level: number; kind: 'entrance'|'gate'|'platform'|'elevator'|'junction'|'street'; stationId?: string; name?: Record<Lang,string>;
  gtfsStopId?: string; platformId?: string; gtfsLevel?: number; }   // gtfsLevel only when Pathways disagrees with `level`
interface GraphEdge {
  id: string; from: NodeId; to: NodeId;
  mode: 'walk'|'stairs'|'escalator'|'elevator'|'ramp'|'moving_walkway'|'fare_gate';
  lengthM: number; seconds: number;
  slopePct?: number; widthM?: number; stepCount?: number;  // absent = unknown. ほこナビ gives buckets, stored as bounds (see docs/graph.schema.json); stepCount is not in the data
  stepHeightCm?: number; roofed?: boolean; tactilePaving?: boolean;
  pathwayId?: string;                    // GTFS pathway_id when present (key for outage reports)
  bidirectional: boolean;
}
interface OutageReport {
  id: string; pathwayId: string | null; edgeId: string; stationId: string;
  status: 'out_of_service'|'working'|'blocked'|'data_wrong';
  createdAt: string; expiresAt: string;   // default TTL 6 h; each confirmation extends it
  confirmations: number; source: 'community'|'operator';
}
```

## Routing profiles

Each profile maps an edge to a cost multiplier, where `Infinity` means forbidden. Keep all profiles in `src/routing/profiles.ts` with unit tests.

| Profile | Stairs | Escalator | Steep ramp (>5%) | Long walk |
|---|---|---|---|---|
| wheelchair | ∞ | ∞ | ∞ above 8%, otherwise heavy penalty | — |
| walker_cane | ∞ | heavy penalty | penalty | penalty |
| stroller_luggage | ∞ | penalty | ok | — |
| low_stamina | heavy penalty | ok | penalty | heavy penalty; prefer seats |
| sensory | ok | ok | ok | avoid crowded hubs where known |

An edge with an active `out_of_service` or `blocked` report costs ∞. If no route exists, **never return nothing silently**: explain why and offer alternatives (another station, accessible bus, staff assistance).

## Accessibility requirements (non-negotiable)

- WCAG 2.2 AA. Every map interaction also has a list or text equivalent; the map is never the only way.
- Screen-reader-friendly step list with landmarks ("Exit the elevator; ticket gates are ahead on the right").
- Touch targets ≥ 44 px, visible focus, honours `prefers-reduced-motion` and `prefers-contrast`.
- Languages: ja (default), en, zh-Hant, plus a やさしい日本語 mode. No hard-coded UI strings.
- CI fails if the Lighthouse accessibility score is below 95 or axe reports any serious violation.

## Open outage feed

`GET /feed/outages.json` and `/feed/outages.geojson` return active reports keyed by `pathway_id`. The draft spec lives in `docs/feed-spec.md`. Motivation: GTFS-Realtime alerts cannot target a single pathway, so the entry proposes an extension. Keep the feed CC BY 4.0 and personal-data-free: no user IDs, and timestamps rounded to the minute.

## Commands

```bash
# importer
cd importer && uv sync && uv run python -m importer.download              # raw data → data/raw/ + manifest.json
uv run python -m importer.graph.stitch           # stitch report → data/build/reports/stitch/
uv run python -m importer.run --stations oedo   # stitch reports + graphs + maps + devices seed + stations.json → data/build/
uv run pytest && uv run ruff check .             # tests that need data/raw skip themselves without it
# OTP
cd otp && ./build.sh && docker compose up otp
# web
cd apps/web && pnpm i && pnpm dev | pnpm sync-data | pnpm test | pnpm e2e | pnpm e2e:live | pnpm lint | pnpm lighthouse | pnpm build
# pnpm dev / preview forward /otp to OTP_URL (default localhost:8080) for the journey planner
# pnpm e2e:live needs `supabase start` (and OTP running for the journey tests, `supabase functions serve --env-file .env` for the real live-status test); it runs e2e/*.live.spec.ts against a build with the local keys
# node scripts/record-otp.mjs re-records the OTP answers the tests replay (needs OTP running)
# supabase (run the importer first: it writes the devices seed)
supabase start && supabase db reset && supabase test db
cd supabase/functions/live-status && deno test --allow-read=. --allow-env --allow-net=registry.npmjs.org,jsr.io   # live train status function
```

Keep these working. If you change a command, update this section in the same commit.

## Working conventions

- TypeScript strict mode; no `any` without a comment explaining why. Python: type hints plus ruff.
- Pure functions for routing and cost logic, with tests next to the code. Golden-route tests per Tier-2 station (e.g. 大門 street → Ōedo platform, wheelchair) must pass before merging.
- Small PRs; conventional commits (`feat:`, `fix:`, `data:`).
- Never fabricate data. If a field is missing, mark it unknown and surface it on the coverage map.
- Performance budget: first load < 200 KB JS gzipped (excluding map tiles); in-station re-route < 100 ms on a mid-range phone.

## Build order

1. **Data spike (weeks 1–3):** load Toei Pathways and ほこナビ for the 12 stations, stitch them, export one station graph, run OTP on Toei GTFS. Write findings to `docs/data-notes.md`.
2. **Core (must-haves):** profiles, journey planner, in-station step view, boarding position, live train status, outage reports, accessible UI, offline.
3. **Should-haves:** open feed, reliability history, data-quality and coverage map, 3D station view, effort summary, weather and road works, share link.
4. **Stretch:** airport access, no-route fallbacks, auto-import of any operator's pathways.

**PROMPTS.md also has a "Model guide": before a step it marks Opus, remind the user to switch with `/model`.**

**Progress and any out-of-order work are tracked in PROMPTS.md ("Where we are" and the checkboxes). Read it at the start of every session.**

Target: must-haves done by mid-December, user tests in Tokyo late December, then polish, demo video and write-up before 2027-01-11.

## Out of scope

Native apps, indoor positioning (BLE or Wi-Fi), user accounts beyond anonymous or optional auth, regions outside Tokyo (for now), and Hong Kong (future phase).
