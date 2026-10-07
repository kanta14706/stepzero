"""Export the list of stations the journey planner can start or end at (step 2.4).

One entry per GTFS station of the Toei feed: the parent station where the feed has one (the 12
Ōedo stations with pathways), otherwise the stop itself. Each carries its names, station code,
position, the lines that serve it and its coverage tier: 2 when a station graph was exported,
otherwise 1. Toei's other lines stop at separate GTFS stops with the same name (大門 is 109 on
the Asakusa Line and 421 on the Ōedo Line), so the app shows the line next to the name.

Output: data/build/stations.json (schema: docs/stations.schema.json).
"""

from __future__ import annotations

import io
import json
import zipfile
from pathlib import Path
from typing import Any

import pandas as pd

from importer.analysis.pathways import PATHWAY_ZIP
from importer.graph.export import BUILD_DIR

SCHEMA_VERSION = 1
OUT = BUILD_DIR.parent / "stations.json"
FEED_ID = "1"  # the feed id OTP gives the Toei feed (pinned in otp/build.sh `feed_id`)


def _read(z: zipfile.ZipFile, name: str) -> pd.DataFrame:
    return pd.read_csv(
        io.TextIOWrapper(z.open(name), "utf-8-sig"), dtype=str, keep_default_na=False
    )


def _translator(tr: pd.DataFrame, table: str, field: str):
    en = tr[(tr.table_name == table) & (tr.field_name == field) & (tr.language == "en")]
    lookup = dict(zip(en.field_value, en.translation, strict=True))

    def names(ja: str) -> dict[str, str]:
        out = {"ja": ja}
        if lookup.get(ja) and lookup[ja] != ja:
            out["en"] = lookup[ja]
        return out

    return names


def build_stations(
    path: Path = PATHWAY_ZIP, tier2: set[str] | frozenset[str] = frozenset()
) -> dict:
    with zipfile.ZipFile(path) as z:
        stops = _read(z, "stops.txt")
        routes = _read(z, "routes.txt")
        trips = _read(z, "trips.txt")
        stop_times = _read(z, "stop_times.txt")[["trip_id", "stop_id"]]
        tr = _read(z, "translations.txt")
    stop_names = _translator(tr, "stops", "stop_name")
    route_names = _translator(tr, "routes", "route_long_name")

    # Which station each boarding stop belongs to.
    boarding = stops[stops.location_type.isin(["", "0"])]
    station_of = {
        r.stop_id: (r.parent_station or r.stop_id) for r in boarding.itertuples(index=False)
    }
    served = stop_times.merge(trips[["trip_id", "route_id"]], on="trip_id")
    served["station"] = served.stop_id.map(station_of)
    lines_of = served.groupby("station").route_id.agg(lambda s: sorted(set(s), key=int))
    route_by_id = routes.set_index("route_id")

    stations: list[dict[str, Any]] = []
    for r in stops.itertuples(index=False):
        is_station = r.location_type == "1" or (
            r.location_type in ("", "0") and not r.parent_station
        )
        if not is_station or r.stop_id not in lines_of:
            continue
        lines = []
        for rid in lines_of[r.stop_id]:
            route = route_by_id.loc[rid]
            line: dict[str, Any] = {
                "id": f"{FEED_ID}:{rid}",
                "name": route_names(route.route_long_name),
            }
            if route.route_color:
                line["color"] = f"#{route.route_color}"
            lines.append(line)
        entry: dict[str, Any] = {
            "id": r.stop_id,
            "otpId": f"{FEED_ID}:{r.stop_id}",
            "name": stop_names(r.stop_name),
            "lat": round(float(r.stop_lat), 6),
            "lon": round(float(r.stop_lon), 6),
            "lines": lines,
            "tier": 2 if r.stop_id in tier2 else 1,
        }
        if r.stop_code:
            entry["code"] = r.stop_code
        stations.append(entry)
    stations.sort(key=lambda s: (s.get("code") or "~", s["id"]))
    return {"schemaVersion": SCHEMA_VERSION, "feed": "toei", "stations": stations}


def export_stations(graphs: list[dict], path: Path = PATHWAY_ZIP, out: Path = OUT) -> dict:
    data = build_stations(path, {g["station"]["id"] for g in graphs})
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n")
    return data
