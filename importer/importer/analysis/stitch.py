"""Exploration helpers for the stitching notebook (step 1.4).

The matching itself lives in `importer.graph.stitch`; this module adds the distance
statistics, summary tables, plots and the 新宿 elevator check used by
`notebooks/03_stitch.ipynb`.
"""

from __future__ import annotations

import geopandas as gpd
import numpy as np
import pandas as pd
from scipy.spatial import cKDTree

from importer.analysis import hokonavi as H
from importer.analysis import pathways as P
from importer.graph.stitch import (  # noqa: F401  (re-exported for the notebook)
    METRIC_CRS,
    STATION_SLUGS,
    Pair,
    StationStitch,
    _xy,
    hokonavi_points,
    match,
    pathway_points,
    stitch_station,
)


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
