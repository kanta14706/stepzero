"""Export per-station graph JSON (the GraphNode / GraphEdge model in CLAUDE.md).

Topology and edge attributes come from the ほこナビ network; GTFS-Pathways data (pathway_id,
entrance and boarding names, platform codes) is attached through the stitch (decision D-014).
Bucketed ほこナビ attributes are stored as conservative bounds (see docs/graph.schema.json).
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pandas as pd

from importer.analysis import hokonavi as H
from importer.analysis import pathways as P
from importer.graph import timing, travel, validate
from importer.graph.stitch import STATION_SLUGS, StationStitch, stitch_station
from importer.manifest import REPO_ROOT, load_manifest

SCHEMA_VERSION = 1
BUILD_DIR = REPO_ROOT / "data" / "build" / "graphs"

# Stations whose data we cannot yet stand behind (shown in the UI as "not verified").
UNVERIFIED = {
    "428": (
        "ほこナビ has 27 links the Pathways file lacks (the step-free street route depends on "
        "them) and the Pathways level numbers are wrong for 59 nodes; neither dataset has been "
        "verified on site."
    ),
}

ROUTE_MODE = {1: "walk", 2: "moving_walkway", 4: "elevator", 5: "escalator", 6: "stairs", 7: "ramp"}
SLOPE_UPPER_PCT = {1: 0, 2: 5, 3: 8, 4: 8, 5: 18, 6: 18, 7: 18, 8: 18}
WIDTH_LOWER_M = {1: 0.0, 2: 1.0, 3: 2.0, 4: 3.0}
STEP_UPPER_CM = {1: 0, 2: 2, 3: 5, 4: 10, 5: 10}


def _names(feed: P.Feed, ja: str | None) -> dict[str, str] | None:
    if not ja or pd.isna(ja):
        return None
    out = {"ja": ja}
    tr = feed.translations
    if tr is not None:
        hit = tr[(tr.table_name == "stops") & (tr.field_value == ja) & (tr.language == "en")]
        if len(hit) and hit.translation.iloc[0] != ja:
            out["en"] = hit.translation.iloc[0]
    return out


def _clean(d: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in d.items() if v is not None}


def _edge_mode(route_type: int, pathway_mode: str | None, link_id: str) -> str:
    if pathway_mode == "6":
        return "fare_gate"
    if pathway_mode == "3":
        return "moving_walkway"
    if route_type in ROUTE_MODE:
        return ROUTE_MODE[route_type]
    if pathway_mode == "1":  # unknown ほこナビ type, but the pathway says walkway
        return "walk"
    raise ValueError(f"link {link_id}: unknown route type and no pathway to say what it is")


_SERVICES: dict[str, travel.PlatformService] | None = None


def _services() -> dict[str, travel.PlatformService]:
    """Timetable facts per platform, read once per process (stop_times is the big file)."""
    global _SERVICES
    if _SERVICES is None:
        _SERVICES = travel.load_services()
    return _SERVICES


def build_station_graph(
    feed: P.Feed,
    station_id: str,
    s: StationStitch | None = None,
    services: dict[str, travel.PlatformService] | None = None,
) -> dict:
    s = s or stitch_station(feed, station_id)
    services = services if services is not None else _services()
    slug = STATION_SLUGS[station_id]
    st = H.load_station(slug)
    stops = feed.stops.set_index("stop_id")
    pw_edges = feed.pathways.set_index("pathway_id")
    prefix = f"{station_id}:hokonavi:"

    h2p = {p.hokonavi_node: p for p in s.pairs}
    h_of_p = {p.pathway_node: p.hokonavi_node for p in s.pairs}
    conflict = {p.hokonavi_node: p.level for p in s.pairs if p.hokonavi_level is not None}
    pathway_of_link = {lid: pid for pid, lid in s.link_of_pathway.items()}

    # --- roles from the Pathways side
    gate_nodes: set[str] = set()
    for pid in s.edge_ok:
        e = pw_edges.loc[pid]
        if e.pathway_mode == "6":
            gate_nodes |= {e.from_stop_id, e.to_stop_id}
    elevator_nodes = {
        n for lid, r in st.links.set_index("link_id").iterrows() if r.route_type == 4
        for n in (r.start_id, r.end_id)
    }

    nodes: list[dict] = []
    platform_nodes: dict[str, list[str]] = {}
    for r in st.nodes.itertuples():
        pair = h2p.get(r.node_id)
        stop = stops.loc[pair.pathway_node] if pair else None
        loc = stop.location_type if stop is not None else None
        kind = "junction"
        if loc == "4":
            kind = "platform"
        elif loc == "2":
            kind = "entrance"
        elif pair and pair.pathway_node in gate_nodes:
            kind = "gate"
        elif r.node_id in elevator_nodes:
            kind = "elevator"
        elif r.in_out == 1:
            kind = "street"
        node_id = prefix + r.node_id
        platform_id = stop.parent_station if loc == "4" else None
        if platform_id:
            platform_nodes.setdefault(platform_id, []).append(node_id)
        nodes.append(_clean({
            "id": node_id,
            "lon": round(float(r.lon), 7),
            "lat": round(float(r.lat), 7),
            "level": float(r.floor),
            "kind": kind,
            "stationId": station_id,
            "name": _names(feed, stop.stop_name) if loc == "2" else None,
            "gtfsStopId": pair.pathway_node if pair else None,
            "platformId": platform_id,
            "gtfsLevel": conflict.get(r.node_id),
        }))

    edges: list[dict] = []
    for r in st.links.itertuples():
        pid = pathway_of_link.get(r.link_id)
        pw = pw_edges.loc[pid] if pid else None
        mode = _edge_mode(int(r.route_type), pw.pathway_mode if pw is not None else None, r.link_id)
        a, b, bidirectional = r.start_id, r.end_id, True
        if r.direction == 2:
            bidirectional = False
        elif r.direction == 3:
            a, b, bidirectional = r.end_id, r.start_id, False
        elif pw is not None:  # direction unknown in ほこナビ: take the pathway's
            bidirectional = pw.is_bidirectional == "1"
            if not bidirectional:
                from_hk = h_of_p[pw.from_stop_id]
                a, b = (r.start_id, r.end_id) if from_hk == r.start_id else (r.end_id, r.start_id)
        length = float(pw.length) if pw is not None else float(r.distance)
        edges.append(_clean({
            "id": prefix + r.link_id,
            "from": prefix + a,
            "to": prefix + b,
            "mode": mode,
            "lengthM": round(length, 1),
            "seconds": timing.seconds(mode, length),
            "slopePct": SLOPE_UPPER_PCT.get(int(r.vtcl_slope)),
            "widthM": WIDTH_LOWER_M.get(int(r.width)),
            "stepHeightCm": STEP_UPPER_CM.get(int(r.lev_diff)),
            "roofed": {1: False, 2: True}.get(int(r.roof)),
            "tactilePaving": {1: False, 2: True}.get(int(r.brail_tile)),
            "pathwayId": pid,
            "bidirectional": bidirectional,
        }))

    timing.time_elevators(nodes, edges)

    station_stop = stops.loc[station_id]
    index = travel.stop_index(feed)
    node_by_id = {n["id"]: n for n in nodes}
    # Boarding areas the street reaches without a fare gate are data errors: keep the node for
    # walking, but do not route to it or use it for the boarding position.
    unpaid = validate.outside_fare_gates(nodes, edges)
    outside: list[str] = []
    platforms = []
    for plat_id, ids in sorted(platform_nodes.items()):
        code = stops.loc[plat_id].platform_code if plat_id in stops.index else None
        inside = sorted(i for i in ids if i not in unpaid)
        outside += sorted(i for i in ids if i in unpaid)
        areas = [node_by_id[i] for i in inside]
        platforms.append(_clean({
            "id": plat_id,
            "code": code if pd.notna(code) else None,
            "nodeIds": inside,
            "travel": travel.platform_travel(areas, services.get(plat_id), index),
        }))

    graph: dict[str, Any] = {
        "schemaVersion": SCHEMA_VERSION,
        "station": {
            "id": station_id,
            "slug": slug,
            "name": _names(feed, station_stop.stop_name),
            "tier": 2,
            "levels": sorted({n["level"] for n in nodes}, reverse=True),
            "bbox": [
                round(min(n["lon"] for n in nodes), 7), round(min(n["lat"] for n in nodes), 7),
                round(max(n["lon"] for n in nodes), 7), round(max(n["lat"] for n in nodes), 7),
            ],
            "platforms": platforms,
            "sources": _sources(slug),
            "stitch": {
                "matchedNodes": len(s.pairs),
                "pathwaysNodes": len(s.pw),
                "levelConflicts": len(s.level_conflicts),
                "pathways": len(s.edge_ok) + len(s.anomalies),
                "pathwaysWithLink": len(s.edge_ok),
                "hokonaviOnlyLinks": len(s.links_without_pathway),
            },
        },
        "nodes": nodes,
        "edges": edges,
    }
    graph["station"]["warnings"] = _warnings(graph, s, outside)
    graph["station"]["reachability"] = {
        "optimistic": validate.step_free_reachability(graph, strict=False),
        "strict": validate.step_free_reachability(graph, strict=True),
    }
    return graph


def _sources(slug: str) -> list[dict]:
    out = []
    for e in load_manifest().values():
        if e.id.startswith("toei-gtfs") or e.id in (
            f"hokonavi:{slug}:network-geojson", f"hokonavi:{slug}:stationmap-geojson",
        ):
            out.append({"id": e.id, "licence": e.licence, "downloadedAt": e.downloaded_at})
    return sorted(out, key=lambda x: x["id"])


def _warnings(graph: dict, s: StationStitch, outside_gates: list[str]) -> list[dict]:
    warnings: list[dict] = []
    sid = graph["station"]["id"]
    if sid in UNVERIFIED:
        warnings.append({"code": "unverified_on_site", "message": UNVERIFIED[sid]})
    if s.level_conflicts:
        warnings.append({
            "code": "gtfs_level_conflicts",
            "message": "Pathways level numbers differ from the ほこナビ floors; the floor is kept.",
            "count": len(s.level_conflicts),
        })
    if s.anomalies:
        warnings.append({
            "code": "pathway_without_link",
            "message": "Pathways with no agreeing ほこナビ link; not added to the graph.",
            "pathwayIds": sorted(s.anomalies),
        })
    if outside_gates:
        warnings.append({
            "code": "boarding_area_outside_gates",
            "message": (
                "Boarding areas reachable from the street without a fare gate; "
                "left out of their platforms (not routed to, not used for boarding position)."
            ),
            "count": len(outside_gates),
            "nodeIds": outside_gates,
        })
    comps = validate.components(graph)
    if len(comps) > 1:
        stray = sorted(set().union(*comps[1:]))
        warnings.append({
            "code": "disconnected_nodes",
            "message": "Nodes outside the main connected component.",
            "count": len(stray),
            "nodeIds": stray,
        })
    for mode, strict in (("optimistic", False), ("strict", True)):
        reach = validate.step_free_reachability(graph, strict)
        gaps = sorted(p for p, r in reach.items() if not (r["in"] and r["out"]))
        if gaps:
            warnings.append({
                "code": f"no_step_free_route_{mode}",
                "message": (
                    "No step-free path between an entrance and these platforms "
                    + ("(unknown slope or step height blocked)." if strict
                       else "(unknown slope or step height allowed).")
                ),
                "platformIds": gaps,
            })
    return warnings


def write_station(graph: dict, out_dir: Path = BUILD_DIR) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / f"{graph['station']['id']}.json"
    path.write_text(json.dumps(graph, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    return path


def write_index(graphs: list[dict], out_dir: Path = BUILD_DIR) -> Path:
    index = {
        "schemaVersion": SCHEMA_VERSION,
        "stations": [
            {
                "id": g["station"]["id"], "slug": g["station"]["slug"],
                "name": g["station"]["name"], "tier": g["station"]["tier"],
                "bbox": g["station"]["bbox"], "file": f"{g['station']['id']}.json",
                "nodes": len(g["nodes"]), "edges": len(g["edges"]),
                "warnings": [w["code"] for w in g["station"]["warnings"]],
            }
            for g in sorted(graphs, key=lambda g: g["station"]["id"])
        ],
    }
    path = out_dir / "index.json"
    path.write_text(json.dumps(index, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    return path


def export(station_ids: list[str], out_dir: Path = BUILD_DIR) -> list[dict]:
    feed = P.load_feed()
    graphs = []
    for sid in station_ids:
        g = build_station_graph(feed, sid)
        write_station(g, out_dir)
        graphs.append(g)
    write_index(graphs, out_dir)
    return graphs
