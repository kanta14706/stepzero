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
ELEVATOR_S = 40.0  # wait plus ride; the data gives no distance or timing for cabs
FARE_GATE_S = 5.0
MIN_S = 1.0


def seconds(mode: str, length_m: float) -> float:
    if mode == "elevator":
        return ELEVATOR_S
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
