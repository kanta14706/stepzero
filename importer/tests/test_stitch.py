import geopandas as gpd
import pandas as pd

from importer.analysis.stitch import METRIC_CRS, match


def pts(ids, xs, levels, col):
    df = pd.DataFrame({col: ids, "level": levels})
    return gpd.GeoDataFrame(df, geometry=gpd.points_from_xy(xs, [0.0] * len(xs)), crs=METRIC_CRS)


def test_one_to_one_on_same_level():
    pw = pts(["a", "b"], [0.0, 10.0], [0, 0], "stop_id")
    hk = pts(["x", "y"], [0.1, 10.1], [0, 0], "node_id")
    pairs, upw, uhk = match(pw, hk, max_m=1.0)
    assert {(p.pathway_node, p.hokonavi_node) for p in pairs} == {("a", "x"), ("b", "y")}
    assert not upw and not uhk


def test_level_mismatch_needs_the_cross_level_pass():
    pw = pts(["a"], [0.0], [-2], "stop_id")
    hk = pts(["x"], [0.05], [-1], "node_id")
    assert match(pw, hk, max_m=1.0)[0] == []
    pairs, upw, _ = match(pw, hk, max_m=1.0, cross_level_m=0.5)
    assert pairs[0].hokonavi_level == -1 and pairs[0].level == -2 and not upw


def test_distance_cap_leaves_far_nodes_unmatched():
    pw = pts(["a"], [0.0], [0], "stop_id")
    hk = pts(["x"], [5.0], [0], "node_id")
    pairs, upw, uhk = match(pw, hk, max_m=1.0)
    assert pairs == [] and upw == ["a"] and uhk == ["x"]
