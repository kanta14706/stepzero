from importer.graph import timing, validate


def graph():
    def node(i, kind="junction"):
        return {"id": i, "kind": kind}

    nodes = [node("e", "entrance"), node("a"), node("b"), node("p", "platform"), node("x")]
    edge = lambda i, a, b, mode, **kw: {  # noqa: E731
        "id": i, "from": a, "to": b, "mode": mode, "bidirectional": True, **kw
    }
    return {
        "nodes": nodes,
        "edges": [
            edge("1", "e", "a", "walk", slopePct=0, stepHeightCm=0),
            edge("2", "a", "b", "elevator"),
            edge("3", "b", "p", "walk", slopePct=0, stepHeightCm=0),
        ],
        "station": {"platforms": [{"id": "P", "nodeIds": ["p"]}]},
    }


def test_passable_rules():
    p = validate.passable
    assert not p({"mode": "stairs"}, False)
    assert not p({"mode": "escalator"}, False)
    assert p({"mode": "elevator"}, True)
    assert p({"mode": "ramp", "slopePct": 8, "stepHeightCm": 0}, True)
    assert not p({"mode": "ramp", "slopePct": 18, "stepHeightCm": 0}, False)
    assert not p({"mode": "walk", "slopePct": 0, "stepHeightCm": 10}, False)
    assert p({"mode": "walk"}, False) and not p({"mode": "walk"}, True)  # unknown attributes


def test_components_largest_first_and_isolated_node():
    comps = validate.components(graph())
    assert len(comps) == 2 and comps[1] == {"x"}


def test_reachability_in_and_out():
    assert validate.step_free_reachability(graph(), False) == {"P": {"in": True, "out": True}}


def test_one_way_edge_breaks_the_return_direction():
    g = graph()
    g["edges"][2]["bidirectional"] = False  # b -> p only
    assert validate.step_free_reachability(g, False) == {"P": {"in": True, "out": False}}


def test_a_stairs_only_link_blocks_the_platform():
    g = graph()
    g["edges"][1]["mode"] = "stairs"
    assert validate.step_free_reachability(g, False) == {"P": {"in": False, "out": False}}


def test_timing():
    assert timing.seconds("elevator", 1.5) == timing.ELEVATOR_MIN_S
    assert timing.seconds("walk", 12.0) == 10.0
    assert timing.seconds("stairs", 5.0) == 10.0
    assert timing.seconds("walk", 0.0) == timing.MIN_S


def _ride(levels: list[float], hops: bool) -> tuple[list[dict], list[dict]]:
    """Halls h0..hn off a corridor, cab nodes c0..cn; with hops, a hall-cab edge per floor."""
    nodes, edges = [], []
    for i, lv in enumerate(levels):
        nodes += [{"id": f"h{i}", "level": lv}, {"id": f"w{i}", "level": lv}]
        edges.append({"from": f"w{i}", "to": f"h{i}", "mode": "walk"})
        if hops:
            nodes.append({"id": f"c{i}", "level": lv})
            edges.append({"from": f"h{i}", "to": f"c{i}", "mode": "elevator"})
    stop = (lambda i: f"c{i}") if hops else (lambda i: f"h{i}")
    for i in range(len(levels) - 1):
        edges.append({"from": stop(i), "to": stop(i + 1), "mode": "elevator"})
    return nodes, edges


def test_an_elevator_ride_pays_the_wait_once_however_the_data_splits_it():
    wait, per, hop = timing.ELEVATOR_WAIT_S, timing.ELEVATOR_PER_LEVEL_S, timing.ELEVATOR_MIN_S
    for hops in (True, False):
        nodes, edges = _ride([0.0, -2.0], hops)
        timing.time_elevators(nodes, edges)
        ride = sum(e["seconds"] for e in edges if e["mode"] == "elevator")
        assert ride == wait + 2 * per + (2 * hop if hops else 0), hops
    # A shaft split at an intermediate floor: riding through it does not wait again.
    nodes, edges = _ride([0.0, -1.0, -3.0], hops=True)
    timing.time_elevators(nodes, edges)
    by = {(e["from"], e["to"]): e["seconds"] for e in edges if e["mode"] == "elevator"}
    through = by[("h0", "c0")] + by[("c0", "c1")] + by[("c1", "c2")] + by[("h2", "c2")]
    assert through == wait + 3 * per + 2 * hop
    assert "seconds" not in edges[0]  # walking edges are left alone
