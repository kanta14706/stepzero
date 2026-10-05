"""Export the ほこナビ station-map polygons for the web map (one GeoJSON per station).

Each file is a FeatureCollection of floor, space and facility features plus foreign members
describing the floors. Half floors and the ground have no polygons in the source; they are
listed with `hasMap: false` and displayed under the whole floor below (`panel`), so the map
never invents geometry.
"""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

import pandas as pd

from importer.analysis import hokonavi as H
from importer.graph.export import BUILD_DIR
from importer.graph.stitch import STATION_SLUGS

MAPS_DIR = BUILD_DIR.parent / "maps"
SCHEMA_VERSION = 1

# GSI indoor spec (階層別屋内地理空間情報データ仕様書, 2019-03): space and facility categories
# that occur in the Ōedo data. Anything else keeps its code and no name.
SPACE_NAMES = {
    "B007": "トイレ（男性用）", "B008": "トイレ（女性用）", "B009": "トイレ（男女共用）",
    "B010": "トイレ（男女不明）", "B018": "駅事務室", "B019": "その他部屋",
    "B021": "階段", "B022": "エレベーター", "B023": "エスカレーター", "B024": "動く歩道",
    "B025": "スロープ", "B026": "非公開", "B029": "通路／コンコース",
}
FACILITY_NAMES = {
    "F001": "トイレ（男性）", "F002": "トイレ（女性）", "F003": "トイレ（男女共用）",
    "F004": "トイレ（男女不明）", "F011": "階段", "F012": "エレベーター",
    "F013": "エスカレーター", "F014": "スロープ", "F015": "動く歩道",
    "F106": "改札口", "F108": "出口",
}


def _blank(value: Any) -> str | None:
    """The data uses a single space for 'no value'."""
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return None
    text = str(value).strip()
    return text or None


def _round_geometry(geom: Any) -> dict:
    mapping = json.loads(json.dumps(geom.__geo_interface__))

    def rnd(c: Any) -> Any:
        return [round(c[0], 7), round(c[1], 7)] if isinstance(c[0], (int, float)) else [
            rnd(x) for x in c
        ]

    mapping["coordinates"] = rnd(mapping["coordinates"])
    return mapping


def build_map(station_id: str, graph_levels: list[float]) -> dict:
    slug = STATION_SLUGS[station_id]
    st = H.load_station(slug)
    floors = st.floors.assign(ordinal=pd.to_numeric(st.floors.ordinal))
    ordinal_of = dict(zip(floors.id, floors.ordinal, strict=True))

    features: list[dict] = []
    for r in floors.itertuples():
        features.append({
            "type": "Feature", "geometry": _round_geometry(r.geometry),
            "properties": {"kind": "floor", "ordinal": float(r.ordinal), "nameJa": _blank(r.name)},
        })
    for r in st.spaces.itertuples():
        ordinal = ordinal_of.get(r.floor_id)
        if ordinal is None:
            continue
        features.append({
            "type": "Feature", "geometry": _round_geometry(r.geometry),
            "properties": {
                "kind": "space", "ordinal": float(ordinal), "category": r.category,
                "categoryJa": SPACE_NAMES.get(r.category), "nameJa": _blank(r.name),
            },
        })
    for r in st.facilities.itertuples():
        ordinal = ordinal_of.get(r.floor_id)
        if ordinal is None:
            continue
        features.append({
            "type": "Feature", "geometry": _round_geometry(r.geometry),
            "properties": {
                "kind": "facility", "ordinal": float(ordinal), "category": r.category,
                "categoryJa": FACILITY_NAMES.get(r.category), "nameJa": _blank(r.name),
            },
        })

    map_floors = sorted({float(o) for o in floors.ordinal}, reverse=True)
    names = {float(o): _blank(n) for o, n in zip(floors.ordinal, floors.name, strict=True)}
    panels = sorted({math.floor(level) for level in graph_levels} | set(map_floors), reverse=True)
    return {
        "type": "FeatureCollection",
        "schemaVersion": SCHEMA_VERSION,
        "stationId": station_id,
        "slug": slug,
        "crs": "EPSG:6668 (treated as WGS84 lon/lat; the difference is centimetres)",
        # one entry per switcher panel; levels are the graph levels shown on it
        "panels": [
            {
                "panel": float(p),
                "hasMap": float(p) in map_floors,
                "nameJa": names.get(float(p)),
                "levels": sorted(
                    (float(level) for level in graph_levels if math.floor(level) == p),
                    reverse=True,
                ),
            }
            for p in panels
        ],
        "features": features,
    }


def export_maps(graphs: list[dict], out_dir: Path = MAPS_DIR) -> list[dict]:
    out_dir.mkdir(parents=True, exist_ok=True)
    maps = []
    for g in graphs:
        m = build_map(g["station"]["id"], g["station"]["levels"])
        (out_dir / f"{m['stationId']}.json").write_text(
            json.dumps(m, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
        )
        maps.append(m)
    return maps
