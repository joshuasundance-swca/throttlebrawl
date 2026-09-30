"""Fetch-once helpers for public data sources.

Every fetch writes the raw response bytes plus a sidecar ``.meta.json`` with the source, query,
retrieval time and SHA-256, so a bake can cite exactly what it read. A cached extract is never
fetched again unless the caller forces it: the Overpass usage policy asks for few, deliberate
queries, and the runtime never fetches anything.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path

import httpx

USER_AGENT = "throttlebrawl-gis/0.1 (+https://github.com/joshuasundance-swca/throttlebrawl)"
OVERPASS_URL = "https://overpass-api.de/api/interpreter"
EPQS_URL = "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/getSamples"


@dataclass(frozen=True)
class FetchMeta:
    """What was fetched, from where, and when."""

    source: str
    url: str
    query: str
    retrievedAt: str  # noqa: N815 (matches the pack provenance field name)
    sha256: str
    bytes: int


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def meta_path(raw: Path) -> Path:
    return raw.with_name(raw.name + ".meta.json")


def read_meta(raw: Path) -> FetchMeta:
    data = json.loads(meta_path(raw).read_text(encoding="utf-8"))
    return FetchMeta(**data)


def _store(raw: Path, body: bytes, source: str, url: str, query: str) -> FetchMeta:
    raw.parent.mkdir(parents=True, exist_ok=True)
    raw.write_bytes(body)
    meta = FetchMeta(
        source=source,
        url=url,
        query=query,
        retrievedAt=datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        sha256=sha256_bytes(body),
        bytes=len(body),
    )
    meta_path(raw).write_text(json.dumps(asdict(meta), indent=2) + "\n", encoding="utf-8")
    return meta


def overpass(query: str, raw: Path, *, force: bool = False, timeout_s: float = 180.0) -> FetchMeta:
    """Runs one Overpass QL query and caches the raw JSON; a cached result is reused."""
    if raw.exists() and meta_path(raw).exists() and not force:
        return read_meta(raw)
    with httpx.Client(headers={"User-Agent": USER_AGENT}, timeout=timeout_s) as client:
        res = client.post(OVERPASS_URL, data={"data": query})
        res.raise_for_status()
    return _store(raw, res.content, "OpenStreetMap via Overpass API", OVERPASS_URL, query)


def usgs_samples(
    points: list[tuple[float, float]], raw: Path, *, force: bool = False, timeout_s: float = 120.0
) -> FetchMeta:
    """Samples the USGS 3DEP elevation image service at (lon, lat) points in one request."""
    if raw.exists() and meta_path(raw).exists() and not force:
        return read_meta(raw)
    geometry = {"points": [[lon, lat] for lon, lat in points], "spatialReference": {"wkid": 4326}}
    params = {
        "geometry": json.dumps(geometry, separators=(",", ":")),
        "geometryType": "esriGeometryMultipoint",
        "returnFirstValueOnly": "true",
        "interpolation": "RSP_BilinearInterpolation",
        "f": "json",
    }
    with httpx.Client(headers={"User-Agent": USER_AGENT}, timeout=timeout_s) as client:
        res = client.post(EPQS_URL, data=params)
        res.raise_for_status()
    query = f"getSamples multipoint, {len(points)} points (lon, lat WGS84), bilinear"
    return _store(raw, res.content, "USGS 3DEP elevation (image service)", EPQS_URL, query)
