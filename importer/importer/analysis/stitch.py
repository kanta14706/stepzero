"""Exploration of how GTFS-Pathways nodes match ほこナビ nodes (step 1.4).

Both layers are projected to EPSG:6677 (JGD2011 / plane rectangular zone IX, metres). A
Pathways node can match a ほこナビ node on the same level (`level_id` == `floor`). Matching is
one-to-one per level, solved as an assignment problem so two Pathways nodes never claim the
same ほこナビ node.
"""

from __future__ import annotations

from dataclasses import dataclass

import geopandas as gpd
import numpy as np
import pandas as pd
from scipy.optimize import linear_sum_assignment
from scipy.spatial import cKDTree

from importer.analysis import hokonavi as H
from importer.analysis import pathways as P

METRIC_CRS = "EPSG:6677"
# Toei station_id in GTFS -> ほこナビ slug
STATION_SLUGS = {
    "402": "shinjuku-nishiguchi", "403": "higashi-shinjuku", "410": "ueno-okachimachi",
    "421": "daimon", "422": "akabanebashi", "423": "azabu-juban", "424": "roppongi",
    "425": "aoyama-itchome", "426": "kokuritsu-kyogijo", "427": "yoyogi", "428": "shinjuku",
    "429": "tochomae",
}


@dataclass(frozen=True)
class Pair:
    pathway_node: str
    hokonavi_node: str
    level: float  # Pathways level
    distance_m: float
    hokonavi_level: float | None = None  # set only when it differs from `level`


def pathway_points(feed: P.Feed, station_id: str) -> gpd.GeoDataFrame:
    n = P.station_nodes(feed, station_id)
    n = n[n.location_type.isin(["2", "3", "4"])].copy()
    n["level"] = pd.to_numeric(n.level_id)
    g = gpd.GeoDataFrame(
        n, geometry=gpd.points_from_xy(n.stop_lon.astype(float), n.stop_lat.astype(float)),
        crs="EPSG:4326",
    )
    return g.to_crs(METRIC_CRS)


def hokonavi_points(slug: str) -> gpd.GeoDataFrame:
    return H.load_station(slug).nodes.to_crs(METRIC_CRS).assign(level=lambda d: d.floor)


def _xy(g: gpd.GeoDataFrame) -> np.ndarray:
    return np.c_[g.geometry.x.to_numpy(), g.geometry.y.to_numpy()]


def nearest_same_level(pw: gpd.GeoDataFrame, hk: gpd.GeoDataFrame) -> pd.Series:
    """Distance from each Pathways node to the nearest ほこナビ node on the same level.

    NaN where ほこナビ has no node on that level.
    """
    out = pd.Series(np.nan, index=pw.index)
    for level, grp in pw.groupby("level"):
        cand = hk[hk.level == level]
        if cand.empty:
            continue
        d, _ = cKDTree(_xy(cand)).query(_xy(grp))
        out.loc[grp.index] = d
    return out


def nearest_any_level(pw: gpd.GeoDataFrame, hk: gpd.GeoDataFrame) -> pd.DataFrame:
    """Nearest ほこナビ node regardless of level: distance and that node's level."""
    d, i = cKDTree(_xy(hk)).query(_xy(pw))
    return pd.DataFrame({"distance_m": d, "hk_level": hk.level.to_numpy()[i]}, index=pw.index)


def match(
    pw: gpd.GeoDataFrame, hk: gpd.GeoDataFrame, max_m: float, cross_level_m: float = 0.0
) -> tuple[list[Pair], list[str], list[str]]:
    """One-to-one matching per level, minimising total distance, capped at max_m.

    With cross_level_m > 0 a second pass matches the leftovers on position alone (any level)
    within that distance; those pairs record the ほこナビ level in `hokonavi_level`.

    Returns (pairs, unmatched Pathways node ids, unmatched ほこナビ node ids).
    """
    pairs: list[Pair] = []
    used_hk: set[str] = set()
    used_pw: set[str] = set()
    for level, grp in pw.groupby("level"):
        cand = hk[hk.level == level]
        if cand.empty:
            continue
        a, b = _xy(grp), _xy(cand)
        cost = np.hypot(a[:, None, 0] - b[None, :, 0], a[:, None, 1] - b[None, :, 1])
        # Pairs beyond the cap are made expensive but kept so the solver stays feasible.
        rows, cols = linear_sum_assignment(np.where(cost <= max_m, cost, 1e6))
        for r, c in zip(rows, cols, strict=True):
            if cost[r, c] <= max_m:
                p, h = grp.stop_id.iloc[r], cand.node_id.iloc[c]
                pairs.append(Pair(p, h, float(level), float(cost[r, c])))
                used_pw.add(p)
                used_hk.add(h)
    if cross_level_m > 0:
        # Second pass on the leftovers: ignore level, accept only very close positions.
        rest_pw = pw[~pw.stop_id.isin(used_pw)]
        rest_hk = hk[~hk.node_id.isin(used_hk)]
        if len(rest_pw) and len(rest_hk):
            a, b = _xy(rest_pw), _xy(rest_hk)
            cost = np.hypot(a[:, None, 0] - b[None, :, 0], a[:, None, 1] - b[None, :, 1])
            rows, cols = linear_sum_assignment(np.where(cost <= cross_level_m, cost, 1e6))
            for r, c in zip(rows, cols, strict=True):
                if cost[r, c] <= cross_level_m:
                    p, h = rest_pw.stop_id.iloc[r], rest_hk.node_id.iloc[c]
                    pairs.append(
                        Pair(p, h, float(rest_pw.level.iloc[r]), float(cost[r, c]),
                             float(rest_hk.level.iloc[c]))
                    )
                    used_pw.add(p)
                    used_hk.add(h)
    return (
        pairs,
        [s for s in pw.stop_id if s not in used_pw],
        [s for s in hk.node_id if s not in used_hk],
    )


# GTFS pathway_mode -> ほこナビ route_type values that agree with it
MODE_AGREES = {
    "1": {1, 2, 7, 99}, "2": {6}, "3": {1, 2}, "4": {5}, "5": {4}, "6": {1, 99},
}


@dataclass
class StationStitch:
    slug: str
    station_id: str
    pw: gpd.GeoDataFrame
    hk: gpd.GeoDataFrame
    pairs: list[Pair]
    unmatched_pw: list[str]
    unmatched_hk: list[str]
    edge_ok: list[str]  # pathway_ids with a matching ほこナビ link (same mode family)
    edge_mode_mismatch: list[str]
    edge_no_link: list[str]
    edge_endpoint_unmatched: list[str]
    links_without_pathway: pd.DataFrame


def stitch_station(
    feed: P.Feed, station_id: str, max_m: float = 1.0, cross_level_m: float = 0.0
) -> StationStitch:
    slug = STATION_SLUGS[station_id]
    pw, hk = pathway_points(feed, station_id), hokonavi_points(slug)
    st = H.load_station(slug)
    pairs, upw, uhk = match(pw, hk, max_m, cross_level_m)
    p2h = {p.pathway_node: p.hokonavi_node for p in pairs}

    links: dict[frozenset[str], list[int]] = {}
    for r in st.links.itertuples():
        links.setdefault(frozenset((r.start_id, r.end_id)), []).append(r.route_type)

    nodes = P.station_nodes(feed, station_id)
    edges = P.station_edges(feed, set(nodes.stop_id))
    ok: list[str] = []
    mismatch: list[str] = []
    no_link: list[str] = []
    unmatched: list[str] = []
    covered: set[frozenset[str]] = set()
    for e in edges.itertuples():
        a, b = p2h.get(e.from_stop_id), p2h.get(e.to_stop_id)
        if a is None or b is None:
            unmatched.append(e.pathway_id)
            continue
        key = frozenset((a, b))
        covered.add(key)
        found = links.get(key)
        if not found:
            no_link.append(e.pathway_id)
        elif any(t in MODE_AGREES[e.pathway_mode] for t in found):
            ok.append(e.pathway_id)
        else:
            mismatch.append(e.pathway_id)
    extra = st.links[
        [frozenset((r.start_id, r.end_id)) not in covered for r in st.links.itertuples()]
    ].drop(columns="geometry")
    return StationStitch(slug, station_id, pw, hk, pairs, upw, uhk, ok, mismatch, no_link,
                         unmatched, extra)


def match_table(
    feed: P.Feed, thresholds: tuple[float, ...] = (0.25, 1.0, 5.0, 10.0)
) -> pd.DataFrame:
    """Per station: node match counts at several distance caps, plus nearest-distance stats."""
    rows = []
    for sid, slug in STATION_SLUGS.items():
        pw, hk = pathway_points(feed, sid), hokonavi_points(slug)
        near = nearest_same_level(pw, hk)
        row: dict = {
            "station": slug, "pathways nodes": len(pw), "hokonavi nodes": len(hk),
            "median nearest m": round(float(near.median()), 2),
            "max nearest m": round(float(near.max()), 2),
        }
        for t in thresholds:
            row[f"matched <= {t:g} m"] = len(match(pw, hk, t)[0])
        rows.append(row)
    return pd.DataFrame(rows)


def edge_table(feed: P.Feed, max_m: float = 1.0, cross_level_m: float = 0.0) -> pd.DataFrame:
    rows = []
    for sid, slug in STATION_SLUGS.items():
        s = stitch_station(feed, sid, max_m, cross_level_m)
        total = (
            len(s.edge_ok) + len(s.edge_mode_mismatch) + len(s.edge_no_link)
            + len(s.edge_endpoint_unmatched)
        )
        rows.append(
            {
                "station": slug,
                "pathways": total,
                "link found, mode agrees": len(s.edge_ok),
                "link found, mode differs": len(s.edge_mode_mismatch),
                "no direct link": len(s.edge_no_link),
                "endpoint unmatched": len(s.edge_endpoint_unmatched),
                "links without pathway": len(s.links_without_pathway),
                "hokonavi nodes unmatched": len(s.unmatched_hk),
                "pathways nodes unmatched": len(s.unmatched_pw),
                "level conflicts": sum(p.hokonavi_level is not None for p in s.pairs),
            }
        )
    return pd.DataFrame(rows)


def plot_unmatched(s: StationStitch, level: float):
    import matplotlib.pyplot as plt

    fig, ax = plt.subplots(figsize=(9, 5))
    pw, hk = s.pw[s.pw.level == level], s.hk[s.hk.level == level]
    matched_hk = hk[~hk.node_id.isin(s.unmatched_hk)]
    only_hk = hk[hk.node_id.isin(s.unmatched_hk)]
    only_pw = pw[pw.stop_id.isin(s.unmatched_pw)]
    ax.scatter(matched_hk.geometry.x, matched_hk.geometry.y, s=14, c="#bbbbbb", label="matched")
    ax.scatter(only_hk.geometry.x, only_hk.geometry.y, s=22, c="#4575b4", marker="s",
               label="hokonavi only")
    ax.scatter(only_pw.geometry.x, only_pw.geometry.y, s=22, c="#d73027", marker="^",
               label="pathways only")
    ax.set_aspect("equal")
    ax.set_title(f"{s.slug} level {level:g} (metres, EPSG:6677)")
    ax.legend()
    return fig


def elevator_space_check(feed: P.Feed, station_id: str) -> pd.DataFrame:
    """Do elevator endpoints fall inside a map elevator space (category B022) on their floor?

    Compares ほこナビ elevator links and GTFS-Pathways elevator pathways against the station
    map. Both come from the same MLIT product, so this checks internal consistency, not the
    real station.
    """
    slug = STATION_SLUGS[station_id]
    st = H.load_station(slug)
    ordinal = dict(zip(st.floors.id, pd.to_numeric(st.floors.ordinal), strict=True))
    spaces = st.spaces.assign(ordinal=st.spaces.floor_id.map(ordinal)).to_crs(METRIC_CRS)
    ev = spaces[spaces.category == "B022"]

    def inside(geom, floor: float) -> bool | None:
        cand = ev[ev.ordinal == floor]
        if cand.empty:
            return None
        return bool(cand.geometry.buffer(0.5).contains(geom).any())

    s = stitch_station(feed, station_id)
    nodes = s.hk.set_index("node_id")
    matched = {p.hokonavi_node for p in s.pairs}
    rows = []
    for r in st.links[st.links.route_type == 4].itertuples():
        a, b = nodes.loc[r.start_id], nodes.loc[r.end_id]
        rows.append({
            "layer": "hokonavi link", "id": r.link_id[:8],
            "floors": f"{a.level:g} -> {b.level:g}", "length m": r.distance,
            "in elevator space": f"{inside(a.geometry, a.level)} / {inside(b.geometry, b.level)}",
            "other layer has it": r.start_id in matched and r.end_id in matched,
        })
    pw = s.pw.set_index("stop_id")
    unmatched = set(s.unmatched_pw)
    for e in feed.pathways[feed.pathways.pathway_mode == "5"].itertuples():
        if e.from_stop_id not in pw.index or e.to_stop_id not in pw.index:
            continue
        a, b = pw.loc[e.from_stop_id], pw.loc[e.to_stop_id]
        rows.append({
            "layer": "pathway", "id": e.pathway_id,
            "floors": f"{a.level:g} -> {b.level:g}", "length m": float(e.length),
            "in elevator space": f"{inside(a.geometry, a.level)} / {inside(b.geometry, b.level)}",
            "other layer has it": e.from_stop_id not in unmatched
            and e.to_stop_id not in unmatched,
        })
    return pd.DataFrame(rows)
