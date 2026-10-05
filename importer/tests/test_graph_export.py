"""Tests on the exported station graphs. Need data/raw (skipped when it is not downloaded)."""

import json
from pathlib import Path

import jsonschema
import pytest

from importer.analysis.pathways import PATHWAY_ZIP, load_feed
from importer.graph import validate
from importer.graph.export import build_station_graph
from importer.graph.stitch import STATION_SLUGS

SCHEMA_PATH = Path(__file__).resolve().parents[2] / "docs" / "graph.schema.json"
SCHEMA = json.loads(SCHEMA_PATH.read_text())
pytestmark = pytest.mark.skipif(not PATHWAY_ZIP.exists(), reason="data/raw not downloaded")

# Stations where even the optimistic screen finds no step-free route between an entrance and a
# platform. Findings are in docs/data-notes.md; the exporter must log each as a warning.
KNOWN_NO_STEP_FREE_ROUTE = {"402", "423"}


@pytest.fixture(scope="module")
def graphs():
    feed = load_feed()
    return {sid: build_station_graph(feed, sid) for sid in STATION_SLUGS}


def test_every_graph_validates_against_the_schema(graphs):
    for g in graphs.values():
        jsonschema.validate(g, SCHEMA)


def test_ids_are_unique_and_edges_point_at_nodes(graphs):
    for sid, g in graphs.items():
        node_ids = [n["id"] for n in g["nodes"]]
        assert len(node_ids) == len(set(node_ids)), sid
        assert all(i.startswith(f"{sid}:hokonavi:") for i in node_ids)
        edge_ids = [e["id"] for e in g["edges"]]
        assert len(edge_ids) == len(set(edge_ids)), sid
        known = set(node_ids)
        assert all(e["from"] in known and e["to"] in known for e in g["edges"]), sid


def test_every_platform_node_exists_and_is_a_platform(graphs):
    for sid, g in graphs.items():
        by_id = {n["id"]: n for n in g["nodes"]}
        platforms = g["station"]["platforms"]
        assert platforms, sid
        for p in platforms:
            for nid in p["nodeIds"]:
                assert by_id[nid]["kind"] == "platform", (sid, nid)
                assert by_id[nid]["platformId"] == p["id"]
        # boarding areas outside the fare gates are left out of their platform, but named
        excluded = [
            nid
            for w in g["station"]["warnings"]
            if w["code"] == "boarding_area_outside_gates"
            for nid in w["nodeIds"]
        ]
        assert all(by_id[nid]["kind"] == "platform" for nid in excluded)
        assert sum(n["kind"] == "platform" for n in g["nodes"]) == sum(
            len(p["nodeIds"]) for p in platforms
        ) + len(excluded)


def test_entrances_and_platforms_are_in_the_main_component(graphs):
    for sid, g in graphs.items():
        main = validate.components(g)[0]
        for n in g["nodes"]:
            if n["kind"] in ("entrance", "platform"):
                assert n["id"] in main, (sid, n["id"])


def test_disconnected_nodes_are_logged(graphs):
    for sid, g in graphs.items():
        stray = len(g["nodes"]) - len(validate.components(g)[0])
        logged = [w for w in g["station"]["warnings"] if w["code"] == "disconnected_nodes"]
        assert (stray > 0) == bool(logged), sid
        if logged:
            assert logged[0]["count"] == stray


def test_wheelchair_path_exists_or_the_gap_is_logged(graphs):
    gaps = set()
    for sid, g in graphs.items():
        reach = validate.step_free_reachability(g, strict=False)
        missing = {p for p, r in reach.items() if not (r["in"] and r["out"])}
        logged = [
            w for w in g["station"]["warnings"] if w["code"] == "no_step_free_route_optimistic"
        ]
        if missing:
            gaps.add(sid)
            assert logged and set(logged[0]["platformIds"]) == missing, sid
        else:
            assert not logged, sid
    assert gaps == KNOWN_NO_STEP_FREE_ROUTE


def test_daimon_golden_every_platform_is_step_free_even_when_strict(graphs):
    g = graphs["421"]
    reach = validate.step_free_reachability(g, strict=True)
    assert set(reach) == {"421P3", "421P4"}
    assert all(r["in"] and r["out"] for r in reach.values())
    assert g["station"]["warnings"] == []


def test_pathway_ids_are_preserved(graphs):
    feed = load_feed()
    for sid, g in graphs.items():
        ids = [e["pathwayId"] for e in g["edges"] if "pathwayId" in e]
        assert len(ids) == len(set(ids)), sid
        all_ids = set(feed.pathways.pathway_id[feed.pathways.pathway_id.str.startswith(sid)])
        assert set(ids) <= all_ids
        anomalies = {
            pid for w in g["station"]["warnings"] if w["code"] == "pathway_without_link"
            for pid in w["pathwayIds"]
        }
        assert set(ids) | anomalies == all_ids, sid  # nothing lost without a warning


def test_daimon_counts(graphs):
    g = graphs["421"]
    assert len(g["nodes"]) == 340 and len(g["edges"]) == 378
    assert sum("pathwayId" in e for e in g["edges"]) == 364
    assert sum(e["mode"] == "elevator" for e in g["edges"]) == 18


def test_shinjuku_is_flagged_unverified_with_level_conflicts(graphs):
    codes = {w["code"] for w in graphs["428"]["station"]["warnings"]}
    assert {"unverified_on_site", "gtfs_level_conflicts"} <= codes
    assert sum("gtfsLevel" in n for n in graphs["428"]["nodes"]) == 59


def test_shinjuku_step_free_route_starts_at_an_unnamed_street_node(graphs):
    """No listed entrance connects step-free; an outside node with no Pathways entrance does."""
    g = graphs["428"]
    adj = validate._adjacency(g, lambda e: validate.passable(e, strict=False))
    entrances = {n["id"] for n in g["nodes"] if n["kind"] == "entrance"}
    platforms = {n["id"] for n in g["nodes"] if n["kind"] == "platform"}
    assert not (validate._reach(adj, entrances) & platforms)
    streets = {n["id"] for n in g["nodes"] if n["kind"] == "street"}
    assert validate._reach(adj, streets) & platforms


def test_unknown_attributes_stay_absent_not_zero(graphs):
    g = graphs["421"]
    unknown = [e for e in g["edges"] if "slopePct" not in e]
    assert unknown, "大門 has 9 links with unknown attributes"
    assert all("stepHeightCm" not in e and "widthM" not in e for e in unknown)
