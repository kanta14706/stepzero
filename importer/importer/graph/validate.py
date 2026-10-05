"""Checks on an exported station graph (the JSON-shaped dict).

`step_free_reachability` is a deliberately simple screen used to find gaps in the data. It is
not the routing profile (step 2.3): it forbids stairs and escalators, slopes above 8% and steps
above 5 cm, and treats unknown slope or step height as passable unless `strict`.
"""

from __future__ import annotations

from collections import defaultdict

SLOPE_LIMIT_PCT = 8.0
STEP_LIMIT_CM = 5.0
BLOCKED_MODES = {"stairs", "escalator"}


def passable(edge: dict, strict: bool) -> bool:
    if edge["mode"] in BLOCKED_MODES:
        return False
    if edge["mode"] in ("elevator", "fare_gate"):
        return True
    slope, step = edge.get("slopePct"), edge.get("stepHeightCm")
    if slope is None or step is None:
        return not strict
    return slope <= SLOPE_LIMIT_PCT and step <= STEP_LIMIT_CM


def _adjacency(graph: dict, keep) -> dict[str, set[str]]:
    adj: dict[str, set[str]] = defaultdict(set)
    for e in graph["edges"]:
        if not keep(e):
            continue
        adj[e["from"]].add(e["to"])
        if e["bidirectional"]:
            adj[e["to"]].add(e["from"])
    return adj


def components(graph: dict) -> list[set[str]]:
    """Weakly connected components, largest first."""
    adj = _adjacency(graph, lambda e: True)
    for e in graph["edges"]:
        adj[e["to"]].add(e["from"])
    seen: set[str] = set()
    out: list[set[str]] = []
    for n in graph["nodes"]:
        nid = n["id"]
        if nid in seen:
            continue
        comp, stack = {nid}, [nid]
        while stack:
            for m in adj[stack.pop()]:
                if m not in comp:
                    comp.add(m)
                    stack.append(m)
        seen |= comp
        out.append(comp)
    return sorted(out, key=len, reverse=True)


def _reach(adj: dict[str, set[str]], sources: set[str]) -> set[str]:
    seen, stack = set(sources), list(sources)
    while stack:
        for m in adj.get(stack.pop(), ()):
            if m not in seen:
                seen.add(m)
                stack.append(m)
    return seen


def step_free_reachability(graph: dict, strict: bool) -> dict[str, dict[str, bool]]:
    """Per platform: reachable from an entrance or street node (in) and one reachable back (out)."""
    adj = _adjacency(graph, lambda e: passable(e, strict))
    radj: dict[str, set[str]] = defaultdict(set)
    for a, targets in adj.items():
        for b in targets:
            radj[b].add(a)
    # The street counts as an origin too: at 新宿 the only step-free exit is an unnamed
    # outside node that Pathways does not list as an entrance.
    entrances = {n["id"] for n in graph["nodes"] if n["kind"] in ("entrance", "street")}
    reachable_from_entrance = _reach(adj, entrances)
    reaches_entrance = _reach(radj, entrances)
    out: dict[str, dict[str, bool]] = {}
    for p in graph["station"]["platforms"]:
        ids = set(p["nodeIds"])
        out[p["id"]] = {
            "in": bool(ids & reachable_from_entrance),
            "out": bool(ids & reaches_entrance),
        }
    return out


def outside_fare_gates(nodes: list[dict], edges: list[dict]) -> set[str]:
    """Nodes reachable from an entrance or the street without passing a fare gate.

    On the Tokyo subway every platform is inside the gates, so a boarding area in this set is a
    data error (at 都庁前 a walkway crosses levels into a platform-2 boarding area).
    """
    graph = {"nodes": nodes, "edges": edges}
    adj = _adjacency(graph, lambda e: e["mode"] != "fare_gate")
    street = {n["id"] for n in nodes if n["kind"] in ("entrance", "street")}
    return _reach(adj, street)

