"""The station list for the journey planner. Needs data/raw (skipped when it is not downloaded)."""

import json
from pathlib import Path

import jsonschema
import pytest

from importer.analysis.pathways import PATHWAY_ZIP
from importer.graph.stations import build_stations
from importer.graph.stitch import STATION_SLUGS

SCHEMA = json.loads(
    (Path(__file__).resolve().parents[2] / "docs" / "stations.schema.json").read_text()
)
pytestmark = pytest.mark.skipif(not PATHWAY_ZIP.exists(), reason="data/raw not downloaded")


@pytest.fixture(scope="module")
def data():
    return build_stations(tier2=set(STATION_SLUGS))


def test_validates_against_the_schema(data):
    jsonschema.validate(data, SCHEMA)


def test_every_tier2_station_is_listed_once_with_its_ota_id(data):
    by_id = {s["id"]: s for s in data["stations"]}
    assert len(by_id) == len(data["stations"])
    assert {s["id"] for s in data["stations"] if s["tier"] == 2} == set(STATION_SLUGS)
    assert by_id["421"]["otpId"] == "1:421"
    assert by_id["421"]["name"] == {"ja": "大門", "en": "Daimon"}
    assert by_id["421"]["code"] == "E-20"


def test_same_name_on_two_lines_is_two_stations_with_their_lines(data):
    daimon = [s for s in data["stations"] if s["name"]["ja"] == "大門"]
    lines = sorted(s["lines"][0]["name"]["ja"] for s in daimon)
    assert lines == ["大江戸線", "浅草線"]
    oedo = next(s for s in daimon if s["id"] == "421")
    assert oedo["lines"][0]["color"] == "#CF3366"


def test_platform_and_boarding_stops_are_not_stations(data):
    ids = {s["id"] for s in data["stations"]}
    assert "421P3" not in ids
    assert not any(i.startswith("421N") for i in ids)
