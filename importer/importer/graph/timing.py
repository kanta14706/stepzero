"""Base traversal times per edge mode.

These are modelling assumptions, not measurements (the open data has no timings). They give
every edge a default `seconds`; routing profiles scale or forbid edges on top of them. Revisit
after the user tests (step 4.3) and record any change in docs/decisions.md.
"""

from __future__ import annotations

WALK_MPS = 1.2  # level walkway, typical adult pace
RAMP_MPS = 1.0
MOVING_WALKWAY_MPS = 1.5
STAIRS_MPS = 0.5  # measured along the flight
ESCALATOR_MPS = 0.5  # nominal escalator speed along the incline
# Elevators: the data splits a ride into hops (hall to cab, shaft, cab to hall) and gives no
# timings, so a ride costs ELEVATOR_WAIT_S plus ELEVATOR_PER_LEVEL_S per level travelled. Half
# the wait sits on each edge end at a hall (a node the walking network reaches), so a ride pays
# it once whatever the number of hops (see `time_elevators`).
ELEVATOR_WAIT_S = 30.0
ELEVATOR_PER_LEVEL_S = 5.0
ELEVATOR_MIN_S = 2.0
FARE_GATE_S = 5.0
MIN_S = 1.0


def seconds(mode: str, length_m: float) -> float:
    """Base time for an edge. Elevator edges get a placeholder; `time_elevators` sets them."""
    if mode == "elevator":
        return ELEVATOR_MIN_S
    if mode == "fare_gate":
        return FARE_GATE_S
    speed = {
        "walk": WALK_MPS,
        "ramp": RAMP_MPS,
        "moving_walkway": MOVING_WALKWAY_MPS,
        "stairs": STAIRS_MPS,
        "escalator": ESCALATOR_MPS,
    }[mode]
    return round(max(MIN_S, length_m / speed), 1)


def time_elevators(nodes: list[dict], edges: list[dict]) -> None:
    """Set `seconds` on elevator edges in place: travel per level, plus half the wait per hall end.

    A hall is a node with at least one non-elevator edge. A ride enters through one hall and
    leaves through another, so it pays the wait once, also when the data has a single edge for the
    whole ride or splits the shaft at intermediate floors (cab nodes are not halls).
    """
    level = {n["id"]: n["level"] for n in nodes}
    halls = {end for e in edges if e["mode"] != "elevator" for end in (e["from"], e["to"])}
    for e in edges:
        if e["mode"] != "elevator":
            continue
        travel = max(ELEVATOR_MIN_S, ELEVATOR_PER_LEVEL_S * abs(level[e["from"]] - level[e["to"]]))
        wait = ELEVATOR_WAIT_S / 2 * ((e["from"] in halls) + (e["to"] in halls))
        e["seconds"] = round(travel + wait, 1)
