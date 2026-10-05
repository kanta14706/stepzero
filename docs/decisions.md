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
