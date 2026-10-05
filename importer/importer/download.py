"""Download raw datasets into data/raw/ and record them in data/raw/manifest.json.

    uv run python -m importer.download            # everything
    uv run python -m importer.download --only toei
"""

from __future__ import annotations

import argparse

from importer.sources import hokonavi, toei_gtfs


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--only", choices=["toei", "hokonavi"])
    args = parser.parse_args()
    if args.only in (None, "toei"):
        for e in toei_gtfs.fetch():
            print(f"{e.id}: {e.size_bytes} bytes -> {e.local_path}")
    if args.only in (None, "hokonavi"):
        for e in hokonavi.fetch():
            print(f"{e.id}: {e.size_bytes} bytes -> {e.local_path}")


if __name__ == "__main__":
    main()
