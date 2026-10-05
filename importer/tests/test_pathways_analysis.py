import pandas as pd

from importer.analysis.pathways import Feed, analyse_station


def node(stop_id, loc, parent=None, level=None, lat="35.0", lon="139.0", name=None):
    return {
        "stop_id": stop_id, "stop_name": name, "location_type": loc, "parent_station": parent,
        "level_id": level, "stop_lat": lat, "stop_lon": lon,
    }


def feed(edges):
    stops = pd.DataFrame([
        node("S", "1"),
        node("S_P1", "0", "S"),
        node("S_E", "2", "S", "0"),
        node("S_G", "3", "S", "-1"),
        node("S_B", "4", "S_P1", "-2"),
    ])
    pw = pd.DataFrame(edges, columns=["pathway_id", "from_stop_id", "to_stop_id", "pathway_mode",
                                      "is_bidirectional", "length"])
    levels = pd.DataFrame({"level_id": ["0", "-1", "-2"], "level_index": ["0", "-1", "-2"]})
    return Feed(stops, pw, levels)


def test_step_free_path_through_elevators():
    f = feed([("a", "S_E", "S_G", "5", "1", "5"), ("b", "S_G", "S_B", "5", "1", "5")])
    r = analyse_station(f, "S")
    assert r["platforms"][0]["in_from_street_free"] is True
    assert r["elevator_shafts"] == 1


def test_stairs_only_blocks_step_free_but_not_any_mode():
    f = feed([("a", "S_E", "S_G", "2", "1", "5"), ("b", "S_G", "S_B", "5", "1", "5")])
    p = analyse_station(f, "S")["platforms"][0]
    assert p["in_from_street_free"] is False
    assert p["in_from_street_any_mode"] is True


def test_one_way_edge_is_directional():
    f = feed([("a", "S_E", "S_G", "1", "0", "5"), ("b", "S_G", "S_B", "1", "0", "5")])
    p = analyse_station(f, "S")["platforms"][0]
    assert p["in_from_street_free"] is True
    assert p["out_to_street_free"] is False
