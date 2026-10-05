"""Which end of each platform is the front of the train (step 2.6, boarding position).

The data has no car or door positions and no stop marks, so the app can only say whether the
step-free way on or off the platform is near the front, the middle or the back of the train.
For that it needs, per platform:

- the axis of the platform, taken from its boarding areas (GTFS location_type 4; the platform
  stop itself has no own coordinates), and the boarding areas at its two ends;
- the direction trains travel along it, taken from the timetable: trips stopping at the platform
  continue to a next stop (the front points that way) and came from a previous stop (the back
  points that way). Both are checked against each other; if they disagree, or the stations lie
  too far off the platform axis to tell, no direction is given.

Everything here is derived from the open data; see docs/data-notes.md (step 2.6) for the limits.
"""

from __future__ import annotations

import math
import zipfile
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import pandas as pd

from importer.analysis.pathways import PATHWAY_ZIP, Feed

# |score| below this: the neighbouring stations lie across the platform, no direction.
MIN_SCORE = 0.2
# |score| below this: direction given, but flagged as weak.
CLEAR_SCORE = 0.5
# A headsign is listed when at least this share of the platform's trips show it.
HEADSIGN_SHARE = 0.1
# Fewer boarding areas than this: the platform ends are uncertain, positions are approximate.
FEW_AREAS = 6


@dataclass
class PlatformService:
    """What the timetable says about one platform."""

    trips: int = 0
    terminating: int = 0
    next_stops: Counter[str] = field(default_factory=Counter)
    prev_stops: Counter[str] = field(default_factory=Counter)
    headsigns: Counter[str] = field(default_factory=Counter)


def load_services(path: Path = PATHWAY_ZIP) -> dict[str, PlatformService]:
    with zipfile.ZipFile(path) as z:

        def read(name: str) -> pd.DataFrame:
            return pd.read_csv(z.open(name), dtype=str, encoding="utf-8-sig")

        return platform_services(read("stop_times.txt"), read("trips.txt"))


def platform_services(stop_times: pd.DataFrame, trips: pd.DataFrame) -> dict[str, PlatformService]:
    """Per stop_id: trips, next and previous stops, headsigns and trips that end there."""
    st = stop_times[["trip_id", "stop_id", "stop_sequence"]].copy()
    st["seq"] = st.stop_sequence.astype(int)
    st = st.sort_values(["trip_id", "seq"])
    st["next"] = st.groupby("trip_id").stop_id.shift(-1)
    st["prev"] = st.groupby("trip_id").stop_id.shift(1)
    st = st.merge(trips[["trip_id", "trip_headsign"]], on="trip_id", how="left")
    out: dict[str, PlatformService] = {}
    for r in st.itertuples(index=False):
        s = out.setdefault(r.stop_id, PlatformService())
        s.trips += 1
        if pd.isna(r.next):
            s.terminating += 1
        else:
            s.next_stops[r.next] += 1
        if pd.notna(r.prev):
            s.prev_stops[r.prev] += 1
        if pd.notna(r.trip_headsign):
            s.headsigns[r.trip_headsign] += 1
    return out


def _projector(lat0: float):
    kx = 111320 * math.cos(math.radians(lat0))
    ky = 110540
    return lambda lon, lat: (lon * kx, lat * ky)


@dataclass
class StopIndex:
    """Where each stop's station is, and what stops and headsigns are called (ja, en)."""

    station_coord: dict[str, tuple[float, float]]
    stop_names: dict[str, dict[str, str]]
    english: dict[tuple[str, str], str]

    def names(self, table: str, ja: str) -> dict[str, str]:
        en = self.english.get((table, ja))
        return {"ja": ja, "en": en} if en and en != ja else {"ja": ja}


def stop_index(feed: Feed) -> StopIndex:
    stops = feed.stops.set_index("stop_id")
    english: dict[tuple[str, str], str] = {}
    tr = feed.translations
    if tr is not None:
        for r in tr[tr.language == "en"].itertuples(index=False):
            english[(r.table_name, r.field_value)] = r.translation
    index = StopIndex({}, {}, english)
    for stop_id, r in stops.iterrows():
        # a platform (location_type 0 with a parent) stands for its station
        is_platform = r.location_type == "0" and pd.notna(r.parent_station)
        station_id = r.parent_station if is_platform else stop_id
        if station_id not in stops.index:
            continue
        st = stops.loc[station_id]
        index.station_coord[str(stop_id)] = (float(st.stop_lon), float(st.stop_lat))
        index.stop_names[str(stop_id)] = index.names("stops", st.stop_name)
    return index


def platform_travel(
    areas: list[dict],
    service: PlatformService | None,
    index: StopIndex,
) -> dict[str, Any] | None:
    """The `travel` block of one platform, or None when the data cannot tell the direction.

    `areas` are the platform's boarding-area nodes (id, lon, lat).
    """
    if service is None or service.trips == 0 or len(areas) < 2:
        return None
    lat0 = sum(a["lat"] for a in areas) / len(areas)
    xy = _projector(lat0)
    pts = [xy(a["lon"], a["lat"]) for a in areas]
    cx = sum(p[0] for p in pts) / len(pts)
    cy = sum(p[1] for p in pts) / len(pts)
    # principal axis of the boarding areas
    sxx = sum((x - cx) ** 2 for x, _ in pts)
    syy = sum((y - cy) ** 2 for _, y in pts)
    sxy = sum((x - cx) * (y - cy) for x, y in pts)
    ang = 0.5 * math.atan2(2 * sxy, sxx - syy)
    ux, uy = math.cos(ang), math.sin(ang)
    proj = [(x - cx) * ux + (y - cy) * uy for x, y in pts]

    def unit_to(stop_id: str) -> tuple[float, float] | None:
        coord = index.station_coord.get(stop_id)
        if coord is None:
            return None
        x, y = xy(*coord)
        d = math.hypot(x - cx, y - cy)
        return ((x - cx) / d, (y - cy) / d) if d > 0 else None

    # Front is towards the next stops and away from the previous ones; each side votes alone
    # too, so a disagreement between them is caught instead of averaged away.
    votes: list[float] = []
    vx = vy = 0.0
    neighbours = [(s, 1.0) for s in service.next_stops] + [(s, -1.0) for s in service.prev_stops]
    for stop_id, sign in neighbours:
        u = unit_to(stop_id)
        if u is None:
            continue
        vx += sign * u[0]
        vy += sign * u[1]
        votes.append(sign * (u[0] * ux + u[1] * uy))
    norm = math.hypot(vx, vy)
    if norm == 0 or not votes:
        return None
    score = (vx * ux + vy * uy) / norm
    if abs(score) < MIN_SCORE or any(v * score < 0 for v in votes):
        return None
    # the end whose projection is largest in the travel direction is the front
    order = sorted(range(len(areas)), key=lambda i: proj[i] * (1 if score > 0 else -1))
    back, front = areas[order[0]], areas[order[-1]]

    def top(counter: Counter[str]) -> str | None:
        return counter.most_common(1)[0][0] if counter else None

    headsigns = [
        h for h, c in service.headsigns.most_common() if c >= HEADSIGN_SHARE * service.trips
    ]
    next_stop = top(service.next_stops)
    prev_stop = top(service.prev_stops)
    terminating = (
        "all" if service.terminating == service.trips else "some" if service.terminating else None
    )
    return {
        k: v
        for k, v in {
            "frontNodeId": front["id"],
            "backNodeId": back["id"],
            "lengthM": round(max(proj) - min(proj), 1),
            "areas": len(areas),
            "confidence": "clear" if abs(score) >= CLEAR_SCORE else "weak",
            "approximate": True if len(areas) < FEW_AREAS else None,
            "nextStop": index.stop_names.get(next_stop) if next_stop else None,
            "prevStop": index.stop_names.get(prev_stop) if prev_stop else None,
            "headsigns": [index.names("trips", h) for h in headsigns] or None,
            "terminating": terminating,
        }.items()
        if v is not None
    }
