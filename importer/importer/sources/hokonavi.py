"""ほこナビ walking-space network and station-map data for the Toei Ōedo Line (12 stations).

Datasets are discovered through the CKAN API (tag 都営地下鉄) rather than hard-coded, because
dataset names are inconsistent (`mlit_station_oedo_*`, `station_oedo_*`, `oedo_aoyama-itchome`,
and one typo `akanabebashi`). The station slug is taken from the resource file names.
"""

from __future__ import annotations

import re
import urllib.parse
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from importer.http import download, get_json, today_utc
from importer.manifest import RAW_DIR, ManifestEntry, upsert

CKAN = "https://ckan.hokonavi.go.jp"
TAG = "都営地下鉄"
LINE_MARK = "大江戸線"
EXPECTED_STATIONS = 12

# resource kind -> (file name prefix, format marker in file name)
WANTED = {
    "network-geojson": re.compile(r"^nwd_oedo_(?P<slug>.+)_geojson\.zip$"),
    "stationmap-geojson": re.compile(r"^stationmap_oedo_(?P<slug>.+)_geojson\.zip$"),
}


@dataclass(frozen=True)
class Resource:
    station: str
    kind: str
    url: str
    filename: str
    dataset: str
    licence: str
    licence_url: str
    notes: str


def parse_packages(packages: list[dict[str, Any]]) -> list[Resource]:
    """Pick the wanted GeoJSON resources out of CKAN package_search results."""
    out: list[Resource] = []
    for pkg in packages:
        if LINE_MARK not in pkg.get("title", ""):
            continue
        for res in pkg.get("resources", []):
            filename = Path(urllib.parse.urlparse(res["url"]).path).name
            for kind, pattern in WANTED.items():
                m = pattern.match(filename)
                if m:
                    out.append(
                        Resource(
                            station=m["slug"],
                            kind=kind,
                            url=res["url"],
                            filename=filename,
                            dataset=pkg["name"],
                            # the licence_id field is empty on several datasets; keep it as given
                            licence=pkg.get("license_id") or "",
                            licence_url=pkg.get("license_url") or "",
                            notes=pkg.get("notes", ""),
                        )
                    )
    return out


def list_resources() -> list[Resource]:
    query = urllib.parse.urlencode({"fq": f"tags:{TAG}", "rows": 100})
    data = get_json(f"{CKAN}/api/3/action/package_search?{query}")
    return parse_packages(data["result"]["results"])


def fetch(
    raw_dir: Path = RAW_DIR, manifest_path: Path | None = None, stations: set[str] | None = None
) -> list[ManifestEntry]:
    resources = [r for r in list_resources() if stations is None or r.station in stations]
    found = {r.station for r in resources}
    if stations is None and len(found) != EXPECTED_STATIONS:
        raise RuntimeError(f"expected {EXPECTED_STATIONS} stations, CKAN returned {sorted(found)}")
    entries = []
    for r in resources:
        rel = f"hokonavi/{r.station}/{r.filename}"
        sha, size = download(r.url, raw_dir / rel)
        notes = [f"CKAN dataset: {CKAN}/dataset/{r.dataset}"]
        if "限定" in r.notes:
            notes.append("Dataset notes say publication is limited to the contest period.")
        if not r.licence:
            notes.append("CKAN licence_id is empty for this dataset.")
        entry = ManifestEntry(
            id=f"hokonavi:{r.station}:{r.kind}",
            source=f"ほこナビ {r.kind} (Ōedo Line, {r.station})",
            url=r.url,
            local_path=rel,
            licence=r.licence or "unspecified in CKAN metadata",
            licence_url=r.licence_url,
            downloaded_at=today_utc(),
            sha256=sha,
            size_bytes=size,
            notes=notes,
        )
        if manifest_path is None:
            upsert(entry)
        else:
            upsert(entry, manifest_path)
        entries.append(entry)
    return entries
