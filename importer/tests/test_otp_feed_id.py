"""The OTP feed id the station list assumes for Toei must be the one otp/build.sh pins."""

import re
from pathlib import Path

from importer.graph.stations import FEED_ID

BUILD_SH = Path(__file__).resolve().parents[2] / "otp" / "build.sh"


def test_build_sh_pins_toei_to_the_feed_id_the_station_list_uses():
    script = BUILD_SH.read_text(encoding="utf-8")
    pinned = re.search(r"toei \| toei-pathway\) echo (\S+) ;;", script)
    assert pinned, "feed_id() in otp/build.sh no longer pins Toei"
    assert pinned.group(1) == FEED_ID


def test_every_feed_that_build_sh_can_load_has_a_distinct_feed_id():
    script = BUILD_SH.read_text(encoding="utf-8")
    block = script.split("feed_id() {")[1].split("\n}\n")[0]
    ids = re.findall(r"echo (\d+) ;;", block)
    assert len(ids) == len(set(ids)) >= 9
