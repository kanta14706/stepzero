# importer

Python 3.11+ pipeline that turns open data into graph JSON and tiles in `data/build/`.

```bash
uv sync
uv run python -m importer.download            # raw data -> data/raw/ + manifest.json
uv run python -m importer.run --stations oedo # stitch reports + station graphs -> data/build/
uv run pytest && uv run ruff check .          # tests needing data/raw skip without it
```

Layout: `importer/sources/` (downloads), `importer/graph/` (stitching, export, validation),
`importer/analysis/` (code behind the notebooks), `notebooks/` (exploration), `overrides/`
(manual stitching overrides). Output format: `docs/graph.schema.json`.
