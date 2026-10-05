from importer.manifest import ManifestEntry, load_manifest, save_manifest, upsert


def entry(id_: str = "a") -> ManifestEntry:
    return ManifestEntry(
        id=id_, source="s", url="https://x", local_path="p", licence="CC BY 4.0",
        licence_url="https://l", downloaded_at="2026-10-05", sha256="0" * 64, size_bytes=1,
    )


def test_roundtrip(tmp_path):
    path = tmp_path / "manifest.json"
    save_manifest({"a": entry("a")}, path)
    assert load_manifest(path)["a"] == entry("a")


def test_upsert_replaces_and_keeps_others(tmp_path):
    path = tmp_path / "manifest.json"
    upsert(entry("a"), path)
    upsert(entry("b"), path)
    upsert(entry("a"), path)
    assert sorted(load_manifest(path)) == ["a", "b"]


def test_load_missing_is_empty(tmp_path):
    assert load_manifest(tmp_path / "nope.json") == {}
