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
    assert timing.seconds("elevator", 1.5) == timing.ELEVATOR_S
    assert timing.seconds("walk", 12.0) == 10.0
    assert timing.seconds("stairs", 5.0) == 10.0
    assert timing.seconds("walk", 0.0) == timing.MIN_S
