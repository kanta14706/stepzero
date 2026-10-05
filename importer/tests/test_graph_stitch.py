import geopandas as gpd
import pandas as pd
import pytest

from importer.analysis.pathways import PATHWAY_ZIP, load_feed
from importer.graph.stitch import (
    METRIC_CRS,
    STATION_SLUGS,
    Overrides,
    load_overrides,
    match,
    stitch_station,
)


def pts(ids, xs, levels, col):
    df = pd.DataFrame({col: ids, "level": levels})
    return gpd.GeoDataFrame(df, geometry=gpd.points_from_xy(xs, [0.0] * len(xs)), crs=METRIC_CRS)


def test_force_match_wins_over_distance():
    pw = pts(["a"], [0.0], [0], "stop_id")
    hk = pts(["x", "y"], [0.1, 3.0], [0, 0], "node_id")
    pairs, _, uhk = match(pw, hk, 1.0, overrides=Overrides(force_match={"a": "y"}))
    assert [(p.pathway_node, p.hokonavi_node) for p in pairs] == [("a", "y")]
    assert uhk == ["x"]


def test_no_match_keeps_nodes_unmatched():
    pw = pts(["a"], [0.0], [0], "stop_id")
    hk = pts(["x"], [0.1], [0], "node_id")
    pairs, upw, uhk = match(pw, hk, 1.0, overrides=Overrides(no_match_pathway=frozenset({"a"})))
    assert pairs == [] and upw == ["a"] and uhk == ["x"]


def test_force_match_records_level_conflict():
    pw = pts(["a"], [0.0], [-2], "stop_id")
    hk = pts(["x"], [0.0], [-1], "node_id")
    pairs, _, _ = match(pw, hk, 1.0, overrides=Overrides(force_match={"a": "x"}))
    assert pairs[0].hokonavi_level == -1


def test_overrides_file_loads():
    assert "429" in load_overrides()


needs_data = pytest.mark.skipif(not PATHWAY_ZIP.exists(), reason="data/raw not downloaded")


@pytest.fixture(scope="module")
def feed():
    return load_feed()


@needs_data
@pytest.mark.parametrize("station_id", list(STATION_SLUGS))
def test_every_pathways_node_matches_and_no_unexpected_anomaly(feed, station_id):
    s = stitch_station(feed, station_id)
    assert s.unmatched_pw == []
    assert s.unexpected_anomalies == []


@needs_data
def test_daimon_golden_stitch(feed):
    s = stitch_station(feed, "421")
    assert len(s.pairs) == 326 and not s.level_conflicts
    assert len(s.edge_ok) == 364 and not s.anomalies
    assert len(s.link_of_pathway) == 364


@needs_data
def test_shinjuku_level_conflicts_are_recorded_not_dropped(feed):
    s = stitch_station(feed, "428")
    assert len(s.level_conflicts) == 59
    assert {(p.level, p.hokonavi_level) for p in s.level_conflicts} == {
        (-2.0, -1.0), (-2.5, -2.0), (-1.0, -0.5),
    }
    assert len(s.edge_ok) == 236
    assert len(s.links_without_pathway) == 27


@needs_data
def test_accepted_anomalies_are_still_present(feed):
    """If an accepted anomaly disappears, the override entry is stale and should be removed."""
    for sid, ov in load_overrides().items():
        s = stitch_station(feed, sid)
        assert set(ov.accepted_anomalies) <= set(s.anomalies)
