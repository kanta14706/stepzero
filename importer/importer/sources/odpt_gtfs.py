"""GTFS of the other Tokyo rail operators from ODPT (step 1.6, Tier 1).

Basic-licence feeds come from api.odpt.org with ODPT_CONSUMER_KEY. The 「チャレンジ限定」
feeds (JR East, Keio, Tobu, Sotetsu) come from api-challenge.odpt.org with
ODPT_CHALLENGE_KEY and are core Tier-1 data by D-026. The key is read from `.env` and is
never written to the manifest: the recorded URL is the key-less one.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from importer.http import download, today_utc
from importer.manifest import RAW_DIR, REPO_ROOT, ManifestEntry, upsert

BASIC = ("api.odpt.org", "ODPT_CONSUMER_KEY", "ODPT basic licence")
CHALLENGE = (
    "api-challenge.odpt.org",
    "ODPT_CHALLENGE_KEY",
    "ODPT challenge-limited licence (チャレンジ限定); core Tier-1 data by D-026",
)


@dataclass(frozen=True)
class Feed:
    id: str
    operator: str  # ODPT folder, e.g. "TokyoMetro"
    filename: str
    dataset: str  # ckan.odpt.org dataset slug
    tier: tuple[str, str, str]


FEEDS = [
    Feed("tokyometro-gtfs", "TokyoMetro", "TokyoMetro-Train-GTFS.zip", "train-tokyometro", BASIC),
    Feed("twr-gtfs", "TWR", "TWR-Train-GTFS.zip", "train-twr", BASIC),
    Feed("mir-gtfs", "MIR", "MIR-Train-GTFS.zip", "train-mir", BASIC),
    Feed(
        "tamamonorail-gtfs",
        "TamaMonorail",
        "TamaMonorail-Train-GTFS.zip",
        "train-tamamonorail",
        BASIC,
    ),
    Feed("jreast-gtfs", "JR-East", "JR-East-Train-GTFS.zip", "jreast_tokyo_area", CHALLENGE),
    Feed("keio-gtfs", "Keio", "Keio-Train-GTFS.zip", "keio_train", CHALLENGE),
    Feed("tobu-gtfs", "Tobu", "Tobu-Train-GTFS.zip", "tobu_train", CHALLENGE),
    Feed("sotetsu-gtfs", "Sotetsu", "Sotetsu-Train-GTFS.zip", "sotetsu_train", CHALLENGE),
]


def read_env(name: str) -> str:
    """Value of `name` from the environment or the repo's .env (stdlib, no dotenv)."""
    if value := os.environ.get(name):
        return value
    env_file = REPO_ROOT / ".env"
    if env_file.exists():
        for line in env_file.read_text(encoding="utf-8").splitlines():
            key, sep, value = line.partition("=")
            if sep and key.strip() == name and value.strip():
                return value.strip()
    raise RuntimeError(f"{name} is not set (environment or .env)")


def fetch(raw_dir: Path = RAW_DIR, only: str | None = None) -> list[ManifestEntry]:
    entries = []
    for feed in FEEDS:
        if only and only != feed.id:
            continue
        host, key_name, licence = feed.tier
        base = f"https://{host}/api/v4/files/{feed.operator}/data/{feed.filename}"
        rel = f"gtfs/{feed.filename}"
        sha, size = download(f"{base}?acl:consumerKey={read_env(key_name)}", raw_dir / rel)
        entry = ManifestEntry(
            id=feed.id,
            source=f"{feed.operator} train GTFS (ODPT {feed.dataset})",
            url=base,
            local_path=rel,
            licence=licence,
            licence_url=f"https://ckan.odpt.org/dataset/{feed.dataset}",
            downloaded_at=today_utc(),
            sha256=sha,
            size_bytes=size,
            notes=[
                f"Dataset page: https://ckan.odpt.org/dataset/{feed.dataset}",
                f"Key: {key_name} (not stored)",
            ],
        )
        upsert(entry)
        entries.append(entry)
    return entries
