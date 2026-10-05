from importer.sources.hokonavi import parse_packages

BASE = "https://ckan.hokonavi.go.jp/dataset/x/resource/y/download/"


def pkg(title: str, name: str, files: list[str], licence: str = "pdl-jp-1.0") -> dict:
    return {
        "title": title, "name": name, "license_id": licence, "license_url": "https://l",
        "notes": "チャレンジ限定", "resources": [{"url": BASE + f} for f in files],
    }


def test_picks_network_and_stationmap_geojson_only():
    pkgs = [pkg("歩行空間ネットワークデータ（都営地下鉄大江戸線 大門駅）", "station_oedo_daimon", [
        "nwd_oedo_daimon_csv.zip", "nwd_oedo_daimon_geojson.zip",
        "stationmap_oedo_daimon_geojson.zip", "stationmap_oedo_daimon_shapefile.zip",
        "station_oedo_daimon.pdf",
    ])]
    got = {(r.station, r.kind) for r in parse_packages(pkgs)}
    assert got == {("daimon", "network-geojson"), ("daimon", "stationmap-geojson")}


def test_hyphenated_slug_and_other_lines_ignored():
    pkgs = [
        pkg("…大江戸線 麻布十番駅）", "a", ["nwd_oedo_azabu-juban_geojson.zip"], licence=""),
        pkg("…浅草線 日本橋駅）", "b", ["nwd_asakusa_nihombashi_geojson.zip"]),
    ]
    res = parse_packages(pkgs)
    assert [r.station for r in res] == ["azabu-juban"]
    assert res[0].licence == ""
