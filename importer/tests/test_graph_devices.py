"""Tests on the reportable-device export. Pure; no data/raw needed."""

from importer.graph.devices import device_rows, devices_sql


def _node(i: str, lon: float = 139.0, lat: float = 35.0) -> dict:
    return {"id": f"9:h:{i}", "lon": lon, "lat": lat, "level": 0, "kind": "junction"}


def _edge(i: str, a: str, b: str, mode: str, pathway: str | None = None) -> dict:
    e = {"id": f"9:h:{i}", "from": f"9:h:{a}", "to": f"9:h:{b}", "mode": mode}
    if pathway:
        e["pathwayId"] = pathway
    return e


GRAPH = {
    "station": {"id": "9"},
    "nodes": [_node(x, lon=139.0 + k * 0.001) for k, x in enumerate("abcdefgh")],
    "edges": [
        # one shaft: step in, ride, step out
        _edge("e1", "a", "b", "elevator", "P1"),
        _edge("e2", "b", "c", "elevator", "P2"),
        _edge("e3", "c", "d", "elevator"),
        # a second, separate shaft
        _edge("e4", "e", "f", "elevator"),
        # two escalators sharing a node stay separate devices
        _edge("s1", "f", "g", "escalator"),
        _edge("s2", "g", "h", "escalator"),
        _edge("w1", "d", "e", "walk"),
    ],
}


def test_elevator_edges_are_grouped_by_shaft_and_escalators_stand_alone():
    rows = device_rows(GRAPH)
    by_edge = {r["edge_id"].split(":")[-1]: r["device_id"] for r in rows}
    assert set(by_edge) == {"e1", "e2", "e3", "e4", "s1", "s2"}
    assert by_edge["e1"] == by_edge["e2"] == by_edge["e3"] == "9:elevator:e1"
    assert by_edge["e4"] == "9:elevator:e4"
    assert by_edge["s1"] != by_edge["s2"]


def test_rows_keep_pathway_ids_and_place_the_device_at_its_centre():
    rows = {r["edge_id"].split(":")[-1]: r for r in device_rows(GRAPH)}
    assert rows["e1"]["pathway_id"] == "P1" and rows["e3"]["pathway_id"] is None
    assert rows["e1"]["lon"] == rows["e3"]["lon"] == round(139.0 + 0.0015, 7)


def test_sql_is_an_upsert_scoped_to_the_exported_stations():
    sql = devices_sql([GRAPH])
    assert "where station_id in ('9')" in sql
    assert "on conflict (edge_id) do update" in sql
    assert sql.count("st_makepoint") == 6
    assert "'P1'" in sql and "null" in sql
