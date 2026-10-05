"""Importer entry point: build station graphs into data/build/.

    uv run python -m importer.run --stations oedo
    uv run python -m importer.run --stations daimon,421
"""

from __future__ import annotations

import argparse

from importer.graph.export import export
from importer.graph.stitch import STATION_SLUGS
from importer.graph.stitch import main as stitch_reports

GROUPS = {"oedo": list(STATION_SLUGS)}


def resolve(spec: str) -> list[str]:
    out: list[str] = []
    for part in spec.split(","):
        part = part.strip()
        if part in GROUPS:
            out += GROUPS[part]
        elif part in STATION_SLUGS:
            out.append(part)
        else:
            by_slug = {v: k for k, v in STATION_SLUGS.items()}
            if part not in by_slug:
                raise SystemExit(f"unknown station {part!r}; use 'oedo', a station id or a slug")
            out.append(by_slug[part])
    return out


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--stations", default="oedo")
    args = parser.parse_args()
    ids = resolve(args.stations)
    stitch_reports()
    for g in export(ids):
        st = g["station"]
        print(
            f"{st['id']} {st['slug']:20s} nodes {len(g['nodes']):4d} edges {len(g['edges']):4d} "
            f"warnings {[w['code'] for w in st['warnings']]}"
        )


if __name__ == "__main__":
    main()
