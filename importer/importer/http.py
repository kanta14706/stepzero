"""Small HTTP helpers (stdlib only)."""

from __future__ import annotations

import hashlib
import json
import time
import urllib.request
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

USER_AGENT = "stepzero-importer/0.1 (+https://github.com/kanta14706/stepzero)"


def _open(url: str, retries: int = 3):
    last: Exception | None = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            return urllib.request.urlopen(req, timeout=60)  # noqa: S310 (https URLs only)
        except OSError as exc:
            last = exc
            time.sleep(2**attempt)
    raise RuntimeError(f"GET {url} failed after {retries} attempts: {last}")


def get_json(url: str) -> Any:
    with _open(url) as resp:
        return json.load(resp)


def download(url: str, dest: Path) -> tuple[str, int]:
    """Download url to dest. Returns (sha256, size_bytes)."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    sha = hashlib.sha256()
    size = 0
    tmp = dest.with_suffix(dest.suffix + ".part")
    with _open(url) as resp, tmp.open("wb") as fh:
        while chunk := resp.read(1 << 16):
            fh.write(chunk)
            sha.update(chunk)
            size += len(chunk)
    tmp.replace(dest)
    return sha.hexdigest(), size


def today_utc() -> str:
    return datetime.now(UTC).date().isoformat()
