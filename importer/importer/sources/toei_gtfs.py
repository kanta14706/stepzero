"""Toei GTFS and GTFS-Pathways from ODPT (ckan.odpt.org, dataset `train-toei`).

Both files are served from the public ODPT endpoint, which needs no consumer key. The
keyed endpoint (api.odpt.org ... ?acl:consumerKey=) is not used, so ODPT_CONSUMER_KEY is
not required for these downloads.
"""

from __future__ import annotations

from pathlib import Path

from importer.http import download, today_utc
from importer.manifest import RAW_DIR, ManifestEntry, upsert

DATASET_PAGE = "https://ckan.odpt.org/dataset/train-toei"
CC_BY_4 = "https://creativecommons.org/licenses/by/4.0/"
BASE = "https://api-public.odpt.org/api/v4/files/Toei/data"

# (manifest id, file name, licence label, notes)
FILES = [
    (
        "toei-gtfs",
        "Toei-Train-GTFS.zip",
        "CC BY 4.0",
        [],
    ),
    (
        "toei-gtfs-pathway",
        "Toei-Train-GTFS-Pathway.zip",
        "CC BY 4.0 (published as contest-period-only release 【コンテスト期間限定公開】)",
        ["Dataset page describes this file as limited to the contest period."],
    ),
]


def fetch(raw_dir: Path = RAW_DIR, manifest_path: Path | None = None) -> list[ManifestEntry]:
    entries = []
    for entry_id, filename, licence, notes in FILES:
        url = f"{BASE}/{filename}"
        rel = f"toei/{filename}"
        sha, size = download(url, raw_dir / rel)
        entry = ManifestEntry(
            id=entry_id,
            source="Toei Bureau of Transportation train information (ODPT train-toei)",
            url=url,
            local_path=rel,
            licence=licence,
            licence_url=CC_BY_4,
            downloaded_at=today_utc(),
            sha256=sha,
            size_bytes=size,
            notes=[f"Dataset page: {DATASET_PAGE}", *notes],
        )
        if manifest_path is None:
            upsert(entry)
        else:
            upsert(entry, manifest_path)
        entries.append(entry)
    return entries
