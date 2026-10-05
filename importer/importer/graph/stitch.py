"""Stitch GTFS-Pathways to the ほこナビ walking network (decision D-014).

The ほこナビ network is the backbone: its links become graph edges. Each Pathways node is
matched to a ほこナビ node, and each pathway to a ほこナビ link, so that `pathway_id`, entrance
and boarding names and platform codes can be attached to the backbone.

Matching rules, from the data (docs/data-notes.md, 2026-10-05):
1. One-to-one per level, minimising distance, capped at `max_m` (default 1 m).
2. Leftovers are matched on position alone within `cross_level_m` (default 0.5 m). Pairs whose
   levels differ are recorded as level conflicts (the Pathways `level_id` is wrong at 新宿 for
   59 nodes); the ほこナビ floor is kept because it agrees with the station map.
3. Overrides in `importer/overrides/stitch.json` can force or forbid individual matches.

Run: `uv run python -m importer.graph.stitch` writes data/build/reports/stitch/<slug>.json.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd
from scipy.optimize import linear_sum_assignment

from importer.analysis import hokonavi as H
from importer.analysis import pathways as P

METRIC_CRS = "EPSG:6677"  # JGD2011 / plane rectangular zone IX, metres
MAX_M = 1.0
CROSS_LEVEL_M = 0.5
OVERRIDES_PATH = Path(__file__).resolve().parents[2] / "overrides" / "stitch.json"
REPORT_DIR = Path(__file__).resolve().parents[3] / "data" / "build" / "reports" / "stitch"

# Toei station_id in GTFS -> ほこナビ slug
STATION_SLUGS = {
    "402": "shinjuku-nishiguchi", "403": "higashi-shinjuku", "410": "ueno-okachimachi",
    "421": "daimon", "422": "akabanebashi", "423": "azabu-juban", "424": "roppongi",
    "425": "aoyama-itchome", "426": "kokuritsu-kyogijo", "427": "yoyogi", "428": "shinjuku",
    "429": "tochomae",
}

# GTFS pathway_mode -> ほこナビ route_type values that agree with it
MODE_AGREES = {
    "1": {1, 2, 7, 99}, "2": {6}, "3": {1, 2}, "4": {5}, "5": {4}, "6": {1, 99},
}


@dataclass(frozen=True)
class Pair:
    pathway_node: str
    hokonavi_node: str
    level: float  # Pathways level
    distance_m: float
    hokonavi_level: float | None = None  # set only when it differs from `level`


@dataclass(frozen=True)
class Overrides:
    force_match: dict[str, str] = field(default_factory=dict)
    no_match_pathway: frozenset[str] = frozenset()
    no_match_hokonavi: frozenset[str] = frozenset()
    accepted_anomalies: dict[str, str] = field(default_factory=dict)


def load_overrides(path: Path = OVERRIDES_PATH) -> dict[str, Overrides]:
    if not path.exists():
        return {}
    raw = json.loads(path.read_text(encoding="utf-8"))
    return {
        station: Overrides(
            force_match=dict(o.get("force_match", {})),
            no_match_pathway=frozenset(o.get("no_match_pathway", [])),
            no_match_hokonavi=frozenset(o.get("no_match_hokonavi", [])),
            accepted_anomalies=dict(o.get("accepted_anomalies", {})),
        )
        for station, o in raw.items()
        if not station.startswith("_")
    }


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


def _assign(
    pw: gpd.GeoDataFrame, hk: gpd.GeoDataFrame, cap_m: float
) -> list[tuple[int, int, float]]:
    """Optimal one-to-one assignment within cap_m: (row in pw, row in hk, distance)."""
    if pw.empty or hk.empty:
        return []
    a, b = _xy(pw), _xy(hk)
    cost = np.hypot(a[:, None, 0] - b[None, :, 0], a[:, None, 1] - b[None, :, 1])
    # Pairs beyond the cap are made expensive but kept so the solver stays feasible.
    rows, cols = linear_sum_assignment(np.where(cost <= cap_m, cost, 1e6))
    return [(int(r), int(c), float(cost[r, c])) for r, c in zip(rows, cols, strict=True)
            if cost[r, c] <= cap_m]


def match(
    pw: gpd.GeoDataFrame,
    hk: gpd.GeoDataFrame,
    max_m: float,
    cross_level_m: float = 0.0,
    overrides: Overrides | None = None,
) -> tuple[list[Pair], list[str], list[str]]:
    """Match Pathways nodes to ほこナビ nodes. Returns (pairs, unmatched pw ids, unmatched hk ids).

    With cross_level_m > 0 a second pass matches the leftovers on position alone (any level);
    those pairs record the ほこナビ level in `hokonavi_level`.
    """
    ov = overrides or Overrides()
    pairs: list[Pair] = []
    matched_pw: set[str] = set()
    matched_hk: set[str] = set()
    used_pw: set[str] = set(ov.no_match_pathway)  # not available for matching
    used_hk: set[str] = set(ov.no_match_hokonavi)

    pw_level = dict(zip(pw.stop_id, pw.level, strict=True))
    hk_level = dict(zip(hk.node_id, hk.level, strict=True))
    pw_xy = {i: (g.x, g.y) for i, g in zip(pw.stop_id, pw.geometry, strict=True)}
    hk_xy = {i: (g.x, g.y) for i, g in zip(hk.node_id, hk.geometry, strict=True)}
    for p, h in ov.force_match.items():
        dist = float(np.hypot(pw_xy[p][0] - hk_xy[h][0], pw_xy[p][1] - hk_xy[h][1]))
        conflict = hk_level[h] if hk_level[h] != pw_level[p] else None
        pairs.append(Pair(p, h, float(pw_level[p]), dist, conflict))
        used_pw.add(p)
        used_hk.add(h)
        matched_pw.add(p)
        matched_hk.add(h)

    for level, grp in pw[~pw.stop_id.isin(used_pw)].groupby("level"):
        cand = hk[(hk.level == level) & ~hk.node_id.isin(used_hk)]
        for r, c, d in _assign(grp, cand, max_m):
            p, h = grp.stop_id.iloc[r], cand.node_id.iloc[c]
            pairs.append(Pair(p, h, float(level), d))
            used_pw.add(p)
            used_hk.add(h)
            matched_pw.add(p)
            matched_hk.add(h)

    if cross_level_m > 0:
        rest_pw = pw[~pw.stop_id.isin(used_pw)]
        rest_hk = hk[~hk.node_id.isin(used_hk)]
        for r, c, d in _assign(rest_pw, rest_hk, cross_level_m):
            p, h = rest_pw.stop_id.iloc[r], rest_hk.node_id.iloc[c]
            pairs.append(Pair(p, h, float(pw_level[p]), d, float(hk_level[h])))
            used_pw.add(p)
            used_hk.add(h)
            matched_pw.add(p)
            matched_hk.add(h)

    return (
        pairs,
        [s for s in pw.stop_id if s not in matched_pw],
        [s for s in hk.node_id if s not in matched_hk],
    )


@dataclass
class StationStitch:
    slug: str
    station_id: str
    pw: gpd.GeoDataFrame
    hk: gpd.GeoDataFrame
    pairs: list[Pair]
    unmatched_pw: list[str]
    unmatched_hk: list[str]
    link_of_pathway: dict[str, str]  # pathway_id -> link_id, for agreeing pathways
    edge_ok: list[str]  # pathway_ids with a link of an agreeing mode
    edge_mode_mismatch: list[str]
    edge_no_link: list[str]
    edge_endpoint_unmatched: list[str]
    links_without_pathway: pd.DataFrame
    accepted_anomalies: dict[str, str]

    @property
    def anomalies(self) -> list[str]:
        return self.edge_mode_mismatch + self.edge_no_link + self.edge_endpoint_unmatched

    @property
    def unexpected_anomalies(self) -> list[str]:
        return [a for a in self.anomalies if a not in self.accepted_anomalies]

    @property
    def level_conflicts(self) -> list[Pair]:
        return [p for p in self.pairs if p.hokonavi_level is not None]


def stitch_station(
    feed: P.Feed,
    station_id: str,
    max_m: float = MAX_M,
    cross_level_m: float = CROSS_LEVEL_M,
    overrides: Overrides | None = None,
) -> StationStitch:
    slug = STATION_SLUGS[station_id]
    if overrides is None:
        overrides = load_overrides().get(station_id, Overrides())
    pw, hk = pathway_points(feed, station_id), hokonavi_points(slug)
    st = H.load_station(slug)
    pairs, upw, uhk = match(pw, hk, max_m, cross_level_m, overrides)
    p2h = {p.pathway_node: p.hokonavi_node for p in pairs}

    links: dict[frozenset[str], list[tuple[str, int]]] = {}
    for r in st.links.itertuples():
        links.setdefault(frozenset((r.start_id, r.end_id)), []).append((r.link_id, r.route_type))

    nodes = P.station_nodes(feed, station_id)
    edges = P.station_edges(feed, set(nodes.stop_id))
    ok: list[str] = []
    mismatch: list[str] = []
    no_link: list[str] = []
    unmatched: list[str] = []
    link_of: dict[str, str] = {}
    used_links: set[str] = set()
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
            continue
        agreeing = [lid for lid, rt in found if rt in MODE_AGREES[e.pathway_mode]]
        if not agreeing:
            mismatch.append(e.pathway_id)
            continue
        # Duplicate pathways between the same nodes take distinct links where possible.
        pick = next((lid for lid in agreeing if lid not in used_links), agreeing[0])
        used_links.add(pick)
        link_of[e.pathway_id] = pick
        ok.append(e.pathway_id)
    extra = st.links[
        [frozenset((r.start_id, r.end_id)) not in covered for r in st.links.itertuples()]
    ].drop(columns="geometry")
    return StationStitch(
        slug, station_id, pw, hk, pairs, upw, uhk, link_of, ok, mismatch, no_link, unmatched,
        extra, overrides.accepted_anomalies,
    )


def report(s: StationStitch) -> dict:
    """JSON-serialisable stitch report for one station (feeds the coverage map)."""
    extra = s.links_without_pathway
    return {
        "station_id": s.station_id,
        "slug": s.slug,
        "pathways_nodes": len(s.pw),
        "hokonavi_nodes": len(s.hk),
        "matched_nodes": len(s.pairs),
        "unmatched_pathways_nodes": s.unmatched_pw,
        "hokonavi_only_nodes": len(s.unmatched_hk),
        "level_conflicts": [
            {"pathway_node": p.pathway_node, "hokonavi_node": p.hokonavi_node,
             "pathways_level": p.level, "hokonavi_level": p.hokonavi_level,
             "distance_m": round(p.distance_m, 3)}
            for p in s.level_conflicts
        ],
        "pathways": len(s.edge_ok) + len(s.anomalies),
        "pathways_with_agreeing_link": len(s.edge_ok),
        "anomalies": {
            "mode_mismatch": s.edge_mode_mismatch,
            "no_direct_link": s.edge_no_link,
            "endpoint_unmatched": s.edge_endpoint_unmatched,
        },
        "unexpected_anomalies": s.unexpected_anomalies,
        "hokonavi_only_links": {
            "total": len(extra),
            "by_route_type": {
                H.ROUTE_TYPE.get(int(k), str(k)): int(v)
                for k, v in extra.route_type.value_counts().items()
            },
            "link_ids": extra.link_id.tolist(),
        },
    }


def main() -> None:
    feed = P.load_feed()
    overrides = load_overrides()
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    for sid, slug in STATION_SLUGS.items():
        s = stitch_station(feed, sid, overrides=overrides.get(sid, Overrides()))
        rep = report(s)
        (REPORT_DIR / f"{slug}.json").write_text(
            json.dumps(rep, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        print(
            f"{slug:20s} nodes {rep['matched_nodes']}/{rep['pathways_nodes']} "
            f"(level conflicts {len(rep['level_conflicts'])}) "
            f"pathways {rep['pathways_with_agreeing_link']}/{rep['pathways']} "
            f"unexpected anomalies {len(rep['unexpected_anomalies'])}"
        )


if __name__ == "__main__":
    main()
