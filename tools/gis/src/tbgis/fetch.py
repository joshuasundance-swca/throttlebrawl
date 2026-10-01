"""Fetch-once helpers for public data sources.

Every fetch writes the raw response bytes plus a sidecar ``.meta.json`` with the source, query,
retrieval time and SHA-256, so a bake can cite exactly what it read. A cached extract is never
fetched again unless the caller forces it: the Overpass usage policy asks for few, deliberate
queries, and the runtime never fetches anything.
"""

from __future__ import annotations

import hashlib
import json
import time
from collections.abc import Callable
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


RETRY_STATUS = {429, 502, 503, 504}


def post_retry(
    client: httpx.Client,
    url: str,
    data: dict[str, str],
    *,
    attempts: int = 4,
    wait: Callable[[int], None] = lambda i: time.sleep(15 * 2**i),
) -> httpx.Response:
    """POSTs, waiting and trying again while a public server says it is busy (429 or 50x).

    The Overpass servers answer "too busy" (504) or "too many requests" (429) under load; the usage
    policy asks clients to back off, which the growing wait does. Any other error raises at once.
    """
    for i in range(attempts):
        res = client.post(url, data=data)
        if res.status_code not in RETRY_STATUS or i == attempts - 1:
            break
        wait(i)
    res.raise_for_status()
    return res


def cached(raw: Path, query: str) -> FetchMeta | None:
    """The cached fetch at ``raw``, only if it answered exactly this query (a changed config
    must never bake from a stale extract)."""
    if not (raw.exists() and meta_path(raw).exists()):
        return None
    meta = read_meta(raw)
    return meta if meta.query == query else None


def overpass(query: str, raw: Path, *, force: bool = False, timeout_s: float = 180.0) -> FetchMeta:
    """Runs one Overpass QL query and caches the raw JSON; a cached result is reused."""
    if not force and (hit := cached(raw, query)):
        return hit
    with httpx.Client(headers={"User-Agent": USER_AGENT}, timeout=timeout_s) as client:
        res = post_retry(client, OVERPASS_URL, {"data": query})
    return _store(raw, res.content, "OpenStreetMap via Overpass API", OVERPASS_URL, query)


USGS_MAX_POINTS = 1000  # getSamples answers at most this many points per request


def usgs_samples(
    points: list[tuple[float, float]],
    raw: Path,
    *,
    force: bool = False,
    timeout_s: float = 120.0,
    client: httpx.Client | None = None,
) -> FetchMeta:
    """Samples the USGS 3DEP elevation image service at (lon, lat) points.

    The service returns at most ``USGS_MAX_POINTS`` samples per request (it silently drops the
    rest), so longer lists go in batches. The cached file is one ``{"samples": [...]}`` document
    with every ``locationId`` renumbered to its index in ``points``.
    """
    pts = [[lon, lat] for lon, lat in points]
    pts_sha = sha256_bytes(json.dumps(pts).encode())[:16]
    batches = range(0, len(pts), USGS_MAX_POINTS)
    query = (
        f"getSamples multipoint, {len(points)} points in {len(batches)} request(s) "
        f"(lon, lat WGS84, sha256 {pts_sha}), bilinear"
    )
    if not force and (hit := cached(raw, query)):
        return hit
    own = client is None
    http = client or httpx.Client(headers={"User-Agent": USER_AGENT}, timeout=timeout_s)
    samples: list[dict[str, object]] = []
    try:
        for b0 in batches:
            chunk = pts[b0 : b0 + USGS_MAX_POINTS]
            geometry = {"points": chunk, "spatialReference": {"wkid": 4326}}
            params = {
                "geometry": json.dumps(geometry, separators=(",", ":")),
                "geometryType": "esriGeometryMultipoint",
                "returnFirstValueOnly": "true",
                "interpolation": "RSP_BilinearInterpolation",
                "f": "json",
            }
            doc = post_retry(http, EPQS_URL, params).json()
            got = doc.get("samples")
            if not isinstance(got, list):
                raise ValueError(f"elevation response has no samples: {str(doc)[:200]}")
            for smp in got:
                samples.append({**smp, "locationId": b0 + int(smp.get("locationId", -1))})
    finally:
        if own:
            http.close()
    body = json.dumps({"samples": samples}, separators=(",", ":")).encode()
    return _store(raw, body, "USGS 3DEP elevation (image service)", EPQS_URL, query)
