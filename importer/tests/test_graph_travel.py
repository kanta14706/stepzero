"""Direction of travel per platform (step 2.6)."""

import math
from collections import Counter

import pytest

from importer.analysis.pathways import PATHWAY_ZIP, load_feed
from importer.graph import travel
from importer.graph.export import build_station_graph
from importer.graph.stitch import STATION_SLUGS
from importer.graph.travel import PlatformService, StopIndex, platform_travel

LAT = 35.0
M_PER_DEG_LON = 111320 * math.cos(math.radians(LAT))


def at(x_m: float, y_m: float) -> tuple[float, float]:
    """(lon, lat) of a point x metres east and y metres north of a fixed origin."""
    return 139.0 + x_m / M_PER_DEG_LON, LAT + y_m / 110540


def areas_along_x(n: int = 5, length: float = 120.0) -> list[dict]:
    out = []
    for i in range(n):
        lon, lat = at(-length / 2 + i * length / (n - 1), 0)
        out.append({"id": f"a{i}", "lon": lon, "lat": lat})
    return out


def index(**coords: tuple[float, float]) -> StopIndex:
    return StopIndex(
        station_coord=dict(coords),
        stop_names={k: {"ja": k.upper()} for k in coords},
        english={("trips", "北行"): "Northbound"},
    )


def service(
    next_stops=(), prev_stops=(), trips=10, terminating=0, headsigns=None
) -> PlatformService:
    return PlatformService(
        trips=trips,
        terminating=terminating,
        next_stops=Counter(next_stops),
        prev_stops=Counter(prev_stops),
        headsigns=Counter(headsigns or {}),
    )


def test_front_is_the_end_towards_the_next_station():
    idx = index(east=at(800, 50), west=at(-900, -40))
    t = platform_travel(areas_along_x(), service({"east": 10}, {"west": 10}), idx)
    assert t is not None
    assert t["frontNodeId"] == "a4" and t["backNodeId"] == "a0"
    assert t["confidence"] == "clear"
    assert t["nextStop"] == {"ja": "EAST"} and t["prevStop"] == {"ja": "WEST"}
    assert t["lengthM"] == pytest.approx(120, abs=0.5)

    flipped = platform_travel(areas_along_x(), service({"west": 10}, {"east": 10}), idx)
    assert flipped is not None and flipped["frontNodeId"] == "a0"


def test_no_direction_when_next_and_previous_disagree():
    # both neighbours lie east: one says front is east, the other says front is west
    idx = index(e1=at(800, 0), e2=at(900, 10))
    assert platform_travel(areas_along_x(), service({"e1": 10}, {"e2": 10}), idx) is None


def test_no_direction_when_the_neighbours_lie_across_the_platform():
    idx = index(n=at(10, 900), s=at(-10, -900))
    assert platform_travel(areas_along_x(), service({"n": 10}, {"s": 10}), idx) is None


def test_weak_when_the_neighbours_are_well_off_the_axis():
    idx = index(ne=at(400, 900), sw=at(-400, -900))  # about 24 degrees off north-south
    t = platform_travel(areas_along_x(), service({"ne": 10}, {"sw": 10}), idx)
    assert t is not None and t["confidence"] == "weak" and t["frontNodeId"] == "a4"


def test_trains_ending_here_use_the_previous_station_only():
    idx = index(west=at(-900, 0))
    t = platform_travel(
        areas_along_x(), service(prev_stops={"west": 10}, terminating=10), idx
    )
    assert t is not None
    assert t["frontNodeId"] == "a4"  # arriving from the west, the front is east
    assert t["terminating"] == "all" and "nextStop" not in t


def test_few_boarding_areas_are_flagged_and_headsigns_are_translated():
    idx = index(east=at(800, 0), west=at(-800, 0))
    t = platform_travel(
        areas_along_x(n=4),
        service({"east": 10}, {"west": 10}, headsigns={"北行": 9, "回送": 1}),
        idx,
    )
    assert t is not None and t["approximate"] is True
    # the 10% share keeps both; translations are used where they exist
    assert t["headsigns"] == [{"ja": "北行", "en": "Northbound"}, {"ja": "回送"}]


def test_no_travel_without_trips_or_with_a_single_area():
    idx = index(east=at(800, 0))
    assert platform_travel(areas_along_x(), None, idx) is None
    assert platform_travel(areas_along_x()[:1], service({"east": 1}), idx) is None


def _dist(a: dict, b: dict) -> float:
    return math.hypot(a["lon"] - b["lon"], a["lat"] - b["lat"])


@pytest.fixture(scope="module")
def graphs():
    feed = load_feed()
    services = travel.load_services()
    return {sid: build_station_graph(feed, sid, services=services) for sid in STATION_SLUGS}


@pytest.mark.skipif(not PATHWAY_ZIP.exists(), reason="data/raw not downloaded")
class TestRealData:
    def test_every_oedo_platform_has_a_direction(self, graphs):
        for g in graphs.values():
            for p in g["station"]["platforms"]:
                t = p.get("travel")
                assert t is not None, p["id"]
                assert t["frontNodeId"] in p["nodeIds"] and t["backNodeId"] in p["nodeIds"]
                assert t["frontNodeId"] != t["backNodeId"]
                assert 100 <= t["lengthM"] <= 140, (p["id"], t["lengthM"])

    def test_the_two_platforms_of_a_station_run_opposite_ways(self, graphs):
        # 大門: platform 3 towards 汐留, platform 4 towards 赤羽橋 (the opposite direction)
        p3, p4 = graphs["421"]["station"]["platforms"]
        assert p3["travel"]["nextStop"]["ja"] == "汐留"
        assert p4["travel"]["nextStop"]["ja"] == "赤羽橋"
        nodes = {n["id"]: n for n in graphs["421"]["nodes"]}
        front3 = nodes[p3["travel"]["frontNodeId"]]
        front4 = nodes[p4["travel"]["frontNodeId"]]
        back4 = nodes[p4["travel"]["backNodeId"]]
        # the front of platform 3 is at the end where platform 4's back is
        assert _dist(front3, back4) < _dist(front3, front4)

    def test_known_weak_and_approximate_platforms(self, graphs):
        conf = {
            p["id"]: p["travel"]["confidence"]
            for g in graphs.values()
            for p in g["station"]["platforms"]
        }
        assert {k for k, v in conf.items() if v == "weak"} == {"402P1", "402P2"}
        approx = {
            p["id"]
            for g in graphs.values()
            for p in g["station"]["platforms"]
            if p["travel"].get("approximate")
        }
        assert approx == {"424P1", "424P2", "428P6", "428P7"}

    def test_tochomae_platform_3_is_for_arriving_trains_only(self, graphs):
        p3 = next(p for p in graphs["429"]["station"]["platforms"] if p["id"] == "429P3")
        assert p3["travel"]["terminating"] == "all"
        assert "nextStop" not in p3["travel"]


def test_boarding_areas_outside_the_fare_gates_are_found():
    from importer.graph.validate import outside_fare_gates

    nodes = [
        {"id": "street", "kind": "street"},
        {"id": "hall", "kind": "junction"},
        {"id": "stray", "kind": "platform"},
        {"id": "gate_out", "kind": "gate"},
        {"id": "gate_in", "kind": "gate"},
        {"id": "p", "kind": "platform"},
    ]
    edges = [
        {"from": "street", "to": "hall", "mode": "walk", "bidirectional": True},
        {"from": "hall", "to": "stray", "mode": "walk", "bidirectional": True},
        {"from": "hall", "to": "gate_out", "mode": "walk", "bidirectional": True},
        {"from": "gate_out", "to": "gate_in", "mode": "fare_gate", "bidirectional": True},
        {"from": "gate_in", "to": "p", "mode": "walk", "bidirectional": True},
    ]
    assert outside_fare_gates(nodes, edges) == {"street", "hall", "stray", "gate_out"}


@pytest.mark.skipif(not PATHWAY_ZIP.exists(), reason="data/raw not downloaded")
def test_tochomae_platform_2_drops_the_boarding_area_outside_the_gates(graphs):
    g = graphs["429"]
    stray = "429:hokonavi:9b5a83601f0d4732a040ad602c773ec6"
    p2 = next(p for p in g["station"]["platforms"] if p["id"] == "429P2")
    assert stray not in p2["nodeIds"]
    assert any(n["id"] == stray for n in g["nodes"])  # still walkable
    w = next(w for w in g["station"]["warnings"] if w["code"] == "boarding_area_outside_gates")
    assert w["nodeIds"] == [stray]
    others = [w for x in graphs.values() for w in x["station"]["warnings"]]
    assert sum(w["code"] == "boarding_area_outside_gates" for w in others) == 1
