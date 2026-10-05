"""Tests on the exported map polygons. Need data/raw (skipped when it is not downloaded)."""

import json
import math

import pytest

from importer.analysis.pathways import PATHWAY_ZIP, load_feed
from importer.graph.export import build_station_graph
from importer.graph.maps import build_map
from importer.graph.stitch import STATION_SLUGS

pytestmark = pytest.mark.skipif(not PATHWAY_ZIP.exists(), reason="data/raw not downloaded")


@pytest.fixture(scope="module")
def graph_levels():
    feed = load_feed()
    return {
        sid: build_station_graph(feed, sid)["station"]["levels"] for sid in STATION_SLUGS
    }


@pytest.fixture(scope="module")
def maps(graph_levels):
    return {sid: build_map(sid, graph_levels[sid]) for sid in STATION_SLUGS}


def test_every_map_is_a_json_serialisable_feature_collection(maps):
    for m in maps.values():
        assert m["type"] == "FeatureCollection" and m["features"]
        json.dumps(m)
        for f in m["features"]:
            assert f["geometry"]["type"] in ("Polygon", "Point")


def test_every_graph_level_is_shown_on_some_panel(maps, graph_levels):
    for sid, m in maps.items():
        shown = {lv for p in m["panels"] for lv in p["levels"]}
        assert shown == set(graph_levels[sid]), sid
        for p in m["panels"]:
            assert all(math.floor(lv) == p["panel"] for lv in p["levels"])


def test_has_map_means_there_are_floor_polygons(maps):
    for sid, m in maps.items():
        with_polygons = {
            f["properties"]["ordinal"] for f in m["features"] if f["properties"]["kind"] == "floor"
        }
        for p in m["panels"]:
            assert p["hasMap"] == (p["panel"] in with_polygons), (sid, p["panel"])
        for f in m["features"]:
            assert f["properties"]["ordinal"] in with_polygons


def test_the_ground_never_has_polygons(maps):
    for sid, m in maps.items():
        ground = [p for p in m["panels"] if p["panel"] == 0]
        assert all(not p["hasMap"] for p in ground), sid


def test_known_missing_whole_floors_are_flagged_not_invented(maps):
    """data-notes 2026-10-05: 青山一丁目 floor -2 and 六本木 floor -3 have no map polygons."""
    assert {p["panel"]: p["hasMap"] for p in maps["425"]["panels"]}[-2.0] is False
    assert {p["panel"]: p["hasMap"] for p in maps["424"]["panels"]}[-3.0] is False


def test_daimon_counts_and_categories(maps):
    m = maps["421"]
    kinds = {
        k: sum(f["properties"]["kind"] == k for f in m["features"])
        for k in ("floor", "space", "facility")
    }
    assert kinds == {"floor": 14, "space": 337, "facility": 130}
    elevators = [f for f in m["features"] if f["properties"].get("category") == "B022"]
    assert elevators and all(f["properties"]["categoryJa"] == "エレベーター" for f in elevators)
    assert {p["panel"] for p in m["panels"] if p["hasMap"]} == {-1.0, -2.0, -3.0, -4.0, -5.0}


def test_blank_names_become_absent_not_a_space(maps):
    for m in maps.values():
        for f in m["features"]:
            n = f["properties"].get("nameJa")
            assert n is None or n.strip() == n and n != ""
