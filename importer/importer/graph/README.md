# graph

Stitches GTFS-Pathways to the ほこナビ walking network and (from step 1.5) exports per-station graphs.

- `stitch.py`: node and edge matching, overrides, per-station report. Run
  `uv run python -m importer.graph.stitch` to write `data/build/reports/stitch/<slug>.json`.
- Overrides live in `importer/overrides/stitch.json`. Rationale: `docs/decisions.md` D-014.
