# supabase

Migrations, RLS policies and tests for outage reports (step 2.8, decisions.md D-022). Edge functions: `live-status` (step 2.7, D-027); the open feed comes in step 3.1.

```bash
cd importer && uv run python -m importer.run --stations oedo   # also writes data/build/supabase/devices.sql
supabase start            # first run pulls Docker images; prints the local URL and keys
supabase db reset         # re-applies migrations and loads the devices seed
supabase test db          # pgTAP tests in supabase/tests/
```

- `station_devices`: the elevators and escalators that can be reported, one row per graph edge, grouped by `device_id` (an elevator shaft spans several edges). Loaded from the importer output, not committed.
- `outage_reports`: the reports, readable by anyone. No user ids; timestamps rounded to the minute. A report is active while `expires_at > now()`; an ended one has `expires_at = created_at`.
- `report_outage(p_edge_id, p_status)`: the only way to write. Needs a session (anonymous sign-in is enough). Errors: `PT401` not signed in, `PT400` bad status, `PT404` not a device, `PT429` rate limited.
- `private.report_events`: who reported what, for rate limits and dedupe; not reachable through the API.

## Edge function: live-status

`functions/live-status`: live train times and alerts from the ODPT GTFS-Realtime feeds (Toei, JR East, Keio, Tobu). `GET /functions/v1/live-status?operator=toei&trips=101773H0,101785H0` returns `status` (`ok`, `stale`), the requested trips' live stop times, and the operator's alerts; 502 `unavailable` when there is no data at all, 503 `not_configured` when a key is missing. The feeds carry times, not delays; the app computes delays against OTP's schedule (D-027).

```bash
cd supabase/functions/live-status
deno test --allow-read=. --allow-env --allow-net=registry.npmjs.org,jsr.io   # 16 tests; they use recorded and synthetic feeds
deno run --allow-net --allow-env --allow-read index.ts                       # serve on :8000 (Toei works without a key)
ODPT_CHALLENGE_KEY=... deno run --allow-net --allow-env --allow-read index.ts   # also JR East, Keio, Tobu
supabase functions serve --env-file ../.env                                   # through the local stack
```

The challenge key is read from the function's environment only (a hosted project needs `supabase secrets set ODPT_CHALLENGE_KEY=...`, step 4.5); it is never returned or logged.
