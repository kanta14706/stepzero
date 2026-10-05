# supabase

Migrations, RLS policies and tests for outage reports (step 2.8, decisions.md D-022). Edge functions for the open feed and live train status come later (steps 3.1 and 2.7).

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
