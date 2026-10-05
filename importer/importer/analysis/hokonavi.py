"""Analysis of the ほこナビ walking-space network and station-map data (Ōedo Line).

Field codes follow 歩行空間ネットワークデータ整備仕様 (MLIT, 2024-07, tables 3.2 and 3.8) and
階層別屋内地理空間情報データ仕様書 (GSI, 2019-03).
"""

from __future__ import annotations

import json
import re
import zipfile
from dataclasses import dataclass
from pathlib import Path

import geopandas as gpd
import networkx as nx
import pandas as pd

from importer.manifest import RAW_DIR

HOKONAVI_DIR = RAW_DIR / "hokonavi"
UNKNOWN = 99

ROUTE_TYPE = {
    1: "no specific type", 2: "moving walkway", 3: "level crossing", 4: "elevator",
    5: "escalator", 6: "stairs", 7: "slope", 99: "unknown",
}
RT_STRUCT = {
    1: "road/sidewalk separated", 2: "road/sidewalk not separated", 3: "crosswalk",
    4: "unmarked crossing", 5: "underground passage", 6: "pedestrian bridge",
    7: "indoor passage", 8: "other", 99: "unknown",
}
WIDTH = {1: "<1.0 m", 2: "1.0-2.0 m", 3: "2.0-3.0 m", 4: ">=3.0 m", 99: "unknown"}
SLOPE = {
    1: "0%", 2: "0-5%", 3: "5-8% up", 4: "5-8% down", 5: "8-18% up", 6: "8-18% down",
    7: ">18% up", 8: ">18% down", 99: "unknown",
}
LEV_DIFF = {1: "0 cm", 2: "0-2 cm", 3: "2-5 cm", 4: "5-10 cm", 5: ">10 cm", 99: "unknown"}
ELEVATOR = {
    1: "no elevator", 2: "elevator (not accessible)", 3: "elevator (wheelchair)",
    4: "elevator (visually impaired)", 5: "elevator (wheelchair + visually impaired)",
    99: "unknown",
}
DIRECTION = {1: "both", 2: "start to end", 3: "end to start", 99: "unknown"}
IN_OUT = {1: "outside", 2: "boundary", 3: "inside"}
CODE_TABLES = {
    "route_type": ROUTE_TYPE, "rt_struct": RT_STRUCT, "width": WIDTH, "vtcl_slope": SLOPE,
    "lev_diff": LEV_DIFF, "elevator": ELEVATOR, "direction": DIRECTION,
}


@dataclass(frozen=True)
class Station:
    slug: str
    nodes: gpd.GeoDataFrame
    links: gpd.GeoDataFrame
    floors: gpd.GeoDataFrame
    spaces: gpd.GeoDataFrame
    facilities: gpd.GeoDataFrame
    map_files: list[str]


def station_slugs(root: Path = HOKONAVI_DIR) -> list[str]:
    return sorted(p.name for p in root.iterdir() if p.is_dir())


def _read_geojson_members(zip_path: Path) -> dict[str, gpd.GeoDataFrame]:
    out: dict[str, gpd.GeoDataFrame] = {}
    with zipfile.ZipFile(zip_path) as z:
        for name in z.namelist():
            if not name.endswith(".geojson"):
                continue
            fc = json.loads(z.read(name))
            out[Path(name).name] = gpd.GeoDataFrame.from_features(fc["features"], crs="EPSG:6668")
    return out


def _concat(frames: list[gpd.GeoDataFrame]) -> gpd.GeoDataFrame:
    if not frames:
        return gpd.GeoDataFrame()
    return gpd.GeoDataFrame(pd.concat(frames, ignore_index=True), crs="EPSG:6668")


def load_station(slug: str, root: Path = HOKONAVI_DIR) -> Station:
    nwd = _read_geojson_members(next((root / slug).glob("nwd_*_geojson.zip")))
    smap = _read_geojson_members(next((root / slug).glob("stationmap_*_geojson.zip")))

    def kind(prefix: str) -> gpd.GeoDataFrame:
        frames = []
        for name, gdf in smap.items():
            if re.search(rf"_{prefix}(_|\.)", name):
                frames.append(gdf.assign(source_file=name))
        return _concat(frames)

    return Station(
        slug, nwd["node.geojson"], nwd["link.geojson"], kind("Floor"), kind("Space"),
        kind("Facility"), sorted(smap),
    )


def code_counts(links: gpd.GeoDataFrame) -> pd.DataFrame:
    """Value counts per coded link attribute, with the meaning of each code."""
    rows = []
    for field, table in CODE_TABLES.items():
        for code, n in links[field].value_counts().sort_index().items():
            rows.append({"field": field, "code": code, "meaning": table.get(code, "?"), "links": n})
    return pd.DataFrame(rows)


def unknown_share(links: gpd.GeoDataFrame) -> dict[str, float]:
    return {f: round(float((links[f] == UNKNOWN).mean()), 3) for f in CODE_TABLES}


def blank_share(df: pd.DataFrame, fields: list[str]) -> dict[str, float]:
    """Share of rows where a text field is empty or only a space (the data uses ' ')."""
    return {f: round(float(df[f].astype(str).str.strip().eq("").mean()), 3) for f in fields}


def step_free_graph(st: Station, strict: bool) -> nx.DiGraph:
    """Directed graph of links usable without stairs or escalators.

    strict also drops links with a level difference above 5 cm or a slope above 8%.
    """
    g: nx.DiGraph = nx.DiGraph()
    for r in st.links.itertuples():
        if r.route_type in (5, 6):
            continue
        if strict and (
            (r.lev_diff not in (UNKNOWN,) and r.lev_diff >= 4) or r.vtcl_slope in (5, 6, 7, 8)
        ):
            continue
        if r.direction in (1, UNKNOWN, 2):
            g.add_edge(r.start_id, r.end_id)
        if r.direction in (1, UNKNOWN, 3):
            g.add_edge(r.end_id, r.start_id)
    return g


def connectivity(st: Station) -> dict:
    """Can a ground-level entrance reach a node on the lowest floor step-free?

    Entrances are nodes on floor 0 flagged outside (1) or boundary (2). Outside nodes (1) are
    often isolated street points, so boundary nodes are what connects to the indoor network.
    """
    nodes = st.nodes
    lowest = nodes.floor.min()
    outside = set(nodes[(nodes.floor == 0) & nodes.in_out.isin([1, 2])].node_id)
    deepest = set(nodes[nodes.floor == lowest].node_id)
    res = {
        "lowest_floor": lowest,
        "entrance_nodes": len(outside),
        "lowest_floor_nodes": len(deepest),
    }
    for label, strict in (("no_stairs_or_escalators", False), ("strict", True)):
        g = step_free_graph(st, strict)
        res[label] = any(
            o in g and d in g and nx.has_path(g, o, d) for o in outside for d in deepest
        )
    return res


def floor_report(st: Station) -> dict:
    net = sorted({float(f) for f in st.nodes.floor})
    mapped = sorted({float(f) for f in st.floors.ordinal}) if len(st.floors) else []
    return {
        "network_floors": net,
        "map_floors": mapped,
        "in_network_not_map": sorted(set(net) - set(mapped)),
        "in_map_not_network": sorted(set(mapped) - set(net)),
    }


def nodes_in_spaces_share(st: Station) -> float:
    """Share of network nodes that fall inside a Space polygon of the matching floor."""
    if not len(st.spaces) or not len(st.floors):
        return float("nan")
    # ordinal is text ("-3.0") in some stations and numeric in others
    floor_of = dict(zip(st.floors.id, pd.to_numeric(st.floors.ordinal), strict=True))
    spaces = st.spaces.assign(ordinal=st.spaces.floor_id.map(floor_of))
    hit = 0
    for floor, grp in st.nodes.groupby("floor"):
        union = spaces[spaces.ordinal == floor].geometry
        if union.empty:
            continue
        hit += int(grp.geometry.within(union.union_all().buffer(0.00002)).sum())
    return hit / len(st.nodes)


def summary_table(root: Path = HOKONAVI_DIR) -> pd.DataFrame:
    rows = []
    for slug in station_slugs(root):
        st = load_station(slug, root)
        fl, cn, un = floor_report(st), connectivity(st), unknown_share(st.links)
        rt = st.links.route_type.value_counts()
        rows.append(
            {
                "station": slug,
                "nodes": len(st.nodes),
                "links": len(st.links),
                "floors (network)": ", ".join(f"{f:g}" for f in fl["network_floors"]),
                "floors missing from map": ", ".join(f"{f:g}" for f in fl["in_network_not_map"])
                or "-",
                "elevator links": int(rt.get(4, 0)),
                "escalator": int(rt.get(5, 0)),
                "stairs": int(rt.get(6, 0)),
                "slope": int(rt.get(7, 0)),
                "unknown width": un["width"],
                "unknown slope": un["vtcl_slope"],
                "unknown step": un["lev_diff"],
                "street to lowest floor step-free": cn["no_stairs_or_escalators"],
                "... strict (<=5 cm, <=8%)": cn["strict"],
                "nodes in spaces": round(nodes_in_spaces_share(st), 2),
            }
        )
    return pd.DataFrame(rows)


ROUTE_COLOURS = {
    4: ("#1a9850", "elevator"), 5: ("#fc8d59", "escalator"), 6: ("#d73027", "stairs"),
    7: ("#4575b4", "slope"), 1: ("#777777", "other / flat"), 2: ("#777777", "other / flat"),
    99: ("#bbbb00", "unknown"),
}


def plot_station_floors(st: Station, title: str):
    """One panel per map floor. Half floors (e.g. -0.5) are drawn on the floor below."""
    import math

    import matplotlib.pyplot as plt

    floor_of_node = dict(zip(st.nodes.node_id, st.nodes.floor, strict=True))
    links = st.links.assign(floor=st.links.start_id.map(floor_of_node))
    links = links.assign(panel=links.floor.map(math.floor))
    nodes = st.nodes.assign(panel=st.nodes.floor.map(math.floor))
    floors = st.floors.assign(ordinal=pd.to_numeric(st.floors.ordinal))
    spaces = st.spaces.assign(
        ordinal=st.spaces.floor_id.map(dict(zip(st.floors.id, floors.ordinal, strict=True)))
    )
    panels = sorted(set(nodes.panel) | set(floors.ordinal), reverse=True)
    minx, miny, maxx, maxy = st.nodes.total_bounds
    cols = 2
    rows = math.ceil(len(panels) / cols)
    fig, axes = plt.subplots(rows, cols, figsize=(8 * cols, 3.2 * rows), squeeze=False)
    for ax in axes.flat:
        ax.axis("off")
    for ax, p in zip(axes.flat, panels, strict=False):
        ax.axis("on")
        sp = spaces[spaces.ordinal == p]
        if len(sp):
            sp.plot(ax=ax, color="#eeeeee", edgecolor="#cccccc", linewidth=0.3)
        sub = links[links.panel == p]
        for code, grp in sub.groupby("route_type"):
            colour = ROUTE_COLOURS.get(code, ROUTE_COLOURS[99])[0]
            grp.plot(ax=ax, color=colour, linewidth=1.6 if code in (4, 5, 6) else 1)
        nodes[nodes.panel == p].plot(ax=ax, color="black", markersize=3)
        has_map = "" if len(sp) else " (no map polygons)"
        ax.set_title(f"floor {p:g}{has_map}  links {len(sub)}")
        ax.set_xlim(minx, maxx)
        ax.set_ylim(miny, maxy)
        ax.set_xticks([])
        ax.set_yticks([])
        ax.set_aspect("equal")
    handles = [
        plt.Line2D([0], [0], color=c, lw=2, label=lab)
        for c, lab in {v for v in ROUTE_COLOURS.values()}
    ]
    fig.legend(handles=handles, loc="lower right")
    fig.suptitle(title)
    fig.tight_layout()
    return fig
