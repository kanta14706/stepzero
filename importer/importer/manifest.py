"""Download manifest: records URL, licence and download date for every raw file."""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
RAW_DIR = REPO_ROOT / "data" / "raw"
MANIFEST_PATH = RAW_DIR / "manifest.json"


@dataclass(frozen=True)
class ManifestEntry:
    id: str  # stable key, e.g. "toei-gtfs" or "hokonavi:daimon:network-geojson"
    source: str  # human-readable dataset name
    url: str
    local_path: str  # relative to data/raw/
    licence: str
    licence_url: str
    downloaded_at: str  # ISO date (UTC)
    sha256: str
    size_bytes: int
    notes: list[str] = field(default_factory=list)


def load_manifest(path: Path = MANIFEST_PATH) -> dict[str, ManifestEntry]:
    if not path.exists():
        return {}
    raw = json.loads(path.read_text(encoding="utf-8"))
    return {e["id"]: ManifestEntry(**e) for e in raw["entries"]}


def save_manifest(entries: dict[str, ManifestEntry], path: Path = MANIFEST_PATH) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {"entries": [asdict(e) for e in sorted(entries.values(), key=lambda e: e.id)]}
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def upsert(entry: ManifestEntry, path: Path = MANIFEST_PATH) -> None:
    entries = load_manifest(path)
    entries[entry.id] = entry
    save_manifest(entries, path)
