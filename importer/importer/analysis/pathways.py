"""Analysis of the Toei GTFS-Pathways data, per station.

GTFS pathway_mode: 1 walkway, 2 stairs, 3 moving walkway, 4 escalator, 5 elevator,
6 fare gate, 7 exit gate. location_type: 0 platform, 1 station, 2 entrance, 3 generic node,
4 boarding area. Toei platforms (type 0) have no pathways of their own; their boarding areas
(type 4, children of the platform) carry the edges.
"""

from __future__ import annotations

import math
import zipfile
from dataclasses import dataclass
from pathlib import Path

import networkx as nx
import pandas as pd

from importer.manifest import RAW_DIR

PATHWAY_ZIP = RAW_DIR / "toei" / "Toei-Train-GTFS-Pathway.zip"
MODE_NAMES = {
    "1": "walkway",
    "2": "stairs",
    "3": "moving_walkway",
    "4": "escalator",
    "5": "elevator",
    "6": "fare_gate",
    "7": "exit_gate",
}
# Modes a wheelchair user can take. Fare gates count as passable: the data has no gate width.
STEP_FREE_MODES = {"1", "3", "5", "6", "7"}
FAR_NODE_M = 400  # nodes further than this from the station point are suspicious


@dataclass(frozen=True)
class Feed:
    stops: pd.DataFrame
    pathways: pd.DataFrame
    levels: pd.DataFrame


def load_feed(path: Path = PATHWAY_ZIP) -> Feed:
    with zipfile.ZipFile(path) as z:
        def read(name: str) -> pd.DataFrame:
            return pd.read_csv(z.open(name), dtype=str, encoding="utf-8-sig")

        return Feed(read("stops.txt"), read("pathways.txt"), read("levels.txt"))


def tier2_stations(feed: Feed) -> pd.DataFrame:
    """Stations (location_type 1) that have in-station nodes, i.e. real Pathways coverage."""
    stops = feed.stops
    stations = stops[stops.location_type == "1"]
    has_nodes = stations.stop_id.isin(stops[stops.location_type == "3"].parent_station)
    return stations[has_nodes][["stop_id", "stop_name", "stop_code"]].reset_index(drop=True)


def station_nodes(feed: Feed, station_id: str) -> pd.DataFrame:
    """All nodes of a station, including boarding areas whose parent is a platform."""
    stops = feed.stops
    platforms = stops[(stops.location_type == "0") & (stops.parent_station == station_id)]
    own = stops[stops.parent_station.isin([station_id, *platforms.stop_id])]
    return pd.concat([stops[stops.stop_id == station_id], platforms, own]).drop_duplicates(
        "stop_id"
    )


def station_edges(feed: Feed, node_ids: set[str]) -> pd.DataFrame:
    pw = feed.pathways
    return pw[pw.from_stop_id.isin(node_ids) | pw.to_stop_id.isin(node_ids)].copy()


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = (
        math.sin((p2 - p1) / 2) ** 2
        + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2
    )
    return 2 * 6371000 * math.asin(math.sqrt(a))


def build_graph(edges: pd.DataFrame, step_free_only: bool) -> nx.DiGraph:
    g: nx.DiGraph = nx.DiGraph()
    for e in edges.itertuples():
        if step_free_only and e.pathway_mode not in STEP_FREE_MODES:
            continue
        g.add_edge(e.from_stop_id, e.to_stop_id)
        if e.is_bidirectional == "1":
            g.add_edge(e.to_stop_id, e.from_stop_id)
    return g


def is_street_level(level: str | float | None) -> bool:
    return level is not None and not pd.isna(level) and float(level) >= 0


def analyse_station(feed: Feed, station_id: str) -> dict:
    nodes = station_nodes(feed, station_id)
    ids = set(nodes.stop_id)
    edges = station_edges(feed, ids)
    by_id = nodes.set_index("stop_id")
    level_ids = set(feed.levels.level_id)

    entrances = nodes[nodes.location_type == "2"]
    street_entrances = entrances[entrances.level_id.map(is_street_level)]
    platforms = nodes[nodes.location_type == "0"]
    boarding = nodes[nodes.location_type == "4"]
    boarding_by_platform = boarding.groupby("parent_station").stop_id.apply(set).to_dict()

    g_free = build_graph(edges, step_free_only=True)
    g_all = build_graph(edges, step_free_only=False)

    def reach(g: nx.DiGraph, src: set[str], dst: set[str]) -> bool:
        return any(
            s in g and d in g and nx.has_path(g, s, d) for s in src for d in dst
        )

    platform_rows = []
    for p in platforms.stop_id:
        targets = boarding_by_platform.get(p, set())
        platform_rows.append(
            {
                "platform": p,
                "boarding_areas": len(targets),
                "in_from_street_free": reach(g_free, set(street_entrances.stop_id), targets),
                "in_from_any_entrance_free": reach(g_free, set(entrances.stop_id), targets),
                "out_to_street_free": reach(g_free, targets, set(street_entrances.stop_id)),
                "in_from_street_any_mode": reach(g_all, set(street_entrances.stop_id), targets),
            }
        )

    # Elevators: connected components of the elevator-only graph (one shaft = one component).
    ev = edges[edges.pathway_mode == "5"]
    elevator_shafts = nx.number_connected_components(
        nx.Graph(list(zip(ev.from_stop_id, ev.to_stop_id, strict=True)))
    )

    # Entrances that cannot reach any platform without stairs/escalators
    step_free_entrances = [
        e for e in entrances.stop_id
        if reach(g_free, {e}, set(boarding.stop_id))
    ]

    issues: dict[str, list[str]] = {
        "node_without_level": nodes[
            nodes.location_type.isin(["2", "3", "4"]) & nodes.level_id.isna()
        ].stop_id.tolist(),
        "level_not_in_levels_txt": nodes[
            nodes.level_id.notna() & ~nodes.level_id.isin(level_ids)
        ].stop_id.tolist(),
        "isolated_node": [
            n for n in nodes[nodes.location_type.isin(["2", "3", "4"])].stop_id
            if n not in g_all
        ],
        "self_loop": edges[edges.from_stop_id == edges.to_stop_id].pathway_id.tolist(),
        "duplicate_edge": edges[
            edges.duplicated(["from_stop_id", "to_stop_id", "pathway_mode"], keep=False)
        ].pathway_id.tolist(),
        "zero_or_missing_length": edges[
            edges.length.isna() | (pd.to_numeric(edges.length, errors="coerce") <= 0)
        ].pathway_id.tolist(),
        "level_change_without_vertical_mode": [],
        "vertical_mode_same_level": [],
        "edge_leaves_station": edges[
            ~(edges.from_stop_id.isin(ids) & edges.to_stop_id.isin(ids))
        ].pathway_id.tolist(),
        "node_far_from_station": [],
        "length_vs_distance_mismatch": [],
    }
    for e in edges.itertuples():
        if e.from_stop_id not in by_id.index or e.to_stop_id not in by_id.index:
            continue
        na, nb = by_id.loc[e.from_stop_id], by_id.loc[e.to_stop_id]
        if pd.notna(na.level_id) and pd.notna(nb.level_id):
            dl = abs(float(na.level_id) - float(nb.level_id))
            if e.pathway_mode in ("1", "3", "6", "7") and dl >= 1:
                issues["level_change_without_vertical_mode"].append(e.pathway_id)
            if e.pathway_mode in ("2", "4", "5") and dl == 0:
                issues["vertical_mode_same_level"].append(e.pathway_id)
        if e.pathway_mode in ("1", "3", "6", "7"):
            d = haversine_m(
                float(na.stop_lat), float(na.stop_lon), float(nb.stop_lat), float(nb.stop_lon)
            )
            length = pd.to_numeric(e.length, errors="coerce")
            if pd.notna(length) and d > 10 and (length < 0.5 * d or length > 2 * d):
                issues["length_vs_distance_mismatch"].append(e.pathway_id)

    station = by_id.loc[station_id]
    for n in nodes.itertuples():
        d = haversine_m(
            float(station.stop_lat), float(station.stop_lon), float(n.stop_lat), float(n.stop_lon)
        )
        if d > FAR_NODE_M:
            issues["node_far_from_station"].append(n.stop_id)

    levels = sorted(
        {float(x) for x in nodes.level_id.dropna()}, reverse=True
    )
    modes = edges.pathway_mode.map(MODE_NAMES).value_counts().to_dict()
    return {
        "station_id": station_id,
        "levels": levels,
        "nodes": len(nodes),
        "edges": len(edges),
        "modes": modes,
        "entrances": len(entrances),
        "street_entrances": len(street_entrances),
        "step_free_entrances": len(step_free_entrances),
        "elevator_shafts": elevator_shafts,
        "platforms": platform_rows,
        "issues": issues,
    }


def summary_table(feed: Feed) -> pd.DataFrame:
    """One row per Tier-2 station, for the notebook and docs/data-notes.md."""
    rows = []
    for st in tier2_stations(feed).itertuples():
        r = analyse_station(feed, st.stop_id)
        plats = r["platforms"]
        n = len(plats)
        rows.append(
            {
                "station": f"{st.stop_name} ({st.stop_code})",
                "levels": f"{max(r['levels']):g} to {min(r['levels']):g}",
                "nodes": r["nodes"],
                "pathways": r["edges"],
                "walk": r["modes"].get("walkway", 0) + r["modes"].get("moving_walkway", 0),
                "stairs": r["modes"].get("stairs", 0),
                "escalator": r["modes"].get("escalator", 0),
                "elevator": r["modes"].get("elevator", 0),
                "gate": r["modes"].get("fare_gate", 0),
                "elevator shafts": r["elevator_shafts"],
                "entrances (street / step-free to platform)": (
                    f"{r['entrances']} ({r['street_entrances']} / {r['step_free_entrances']})"
                ),
                "platforms step-free from street": (
                    f"{sum(p['in_from_street_free'] for p in plats)}/{n}"
                ),
                "platforms step-free from any entrance": (
                    f"{sum(p['in_from_any_entrance_free'] for p in plats)}/{n}"
                ),
                "step-free back to street": f"{sum(p['out_to_street_free'] for p in plats)}/{n}",
                "issues": {k: len(v) for k, v in r["issues"].items() if v},
            }
        )
    return pd.DataFrame(rows)


def to_markdown(df: pd.DataFrame) -> str:
    """Minimal GitHub-flavoured markdown table (avoids a tabulate dependency)."""
    cols = list(df.columns)
    lines = ["| " + " | ".join(cols) + " |", "|" + "|".join("---" for _ in cols) + "|"]
    for row in df.itertuples(index=False):
        lines.append("| " + " | ".join(str(v) for v in row) + " |")
    return "\n".join(lines)
