# otp

OpenTripPlanner 2 (pinned image 2.10.0) for train-leg itineraries. Street network from OpenStreetMap (BBBike Tokyo extract, ODbL: credit it on the Data sources page), transit from the GTFS in `data/raw/`.

```bash
./build.sh                   # Toei GTFS with pathways (the default, and what the app needs): builds otp/data/graph.obj, prints build time and peak memory
./build.sh toei              # the plain Toei GTFS (no platform stops, so the journey planner cannot match platforms)
docker compose up -d otp     # serve on http://localhost:8080 (the web dev server forwards /otp to it)
./query.sh 35.688462 139.699019 35.656671 139.755696 2026-10-07T09:00:00+09:00 true   # 新宿 -> 大門, wheelchair
```

`otp/data/` (OSM extract, feeds, graph) is git-ignored. `config/` is copied into it by `build.sh`. Saved query responses are in `results/`. Findings: `docs/data-notes.md` ("OpenTripPlanner spike") and `docs/decisions.md` D-018.
