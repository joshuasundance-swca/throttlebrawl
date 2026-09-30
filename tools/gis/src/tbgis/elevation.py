"""Land elevation along the real path, from one USGS 3DEP sample request."""

from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np

from tbgis.config import BakeConfig
from tbgis.stretch import F64, RealPath, project_s
from tbgis.tmerc import Frame

MARGIN_M = 300.0


def sample_points(cfg: BakeConfig, rp: RealPath) -> tuple[F64, list[tuple[float, float]]]:
    """Real arc lengths and (lon, lat) points every ``sampleEveryM`` over the stretch plus a margin."""
    frame = Frame(cfg.crs.originLatDeg, cfg.crs.originLonDeg)
    s0 = project_s(rp, *frame.to_world(cfg.start.lat, cfg.start.lon)) - MARGIN_M
    s1 = project_s(rp, *frame.to_world(cfg.end.lat, cfg.end.lon)) + MARGIN_M
    s0, s1 = max(0.0, s0), min(float(rp.cum[-1]), s1)
    n = max(2, math.ceil((s1 - s0) / cfg.elevation.sampleEveryM))
    s = np.linspace(s0, s1, n + 1)
    lat = np.interp(s, rp.cum, rp.lat)
    lon = np.interp(s, rp.cum, rp.lon)
    return s, [(float(a), float(b)) for a, b in zip(lon, lat, strict=True)]


def parse_samples(raw: Path, count: int) -> F64:
    """Values in request order; NoData (water, gaps) becomes nan."""
    doc = json.loads(raw.read_text(encoding="utf-8"))
    if "samples" not in doc:
        raise ValueError(f"elevation response has no samples: {str(doc)[:200]}")
    out = np.full(count, np.nan)
    for smp in doc["samples"]:
        idx = int(smp.get("locationId", -1))
        try:
            value = float(smp.get("value"))
        except (TypeError, ValueError):
            continue
        if 0 <= idx < count and value > -100:
            out[idx] = value
    return out


def fill_gaps(s: F64, v: F64, fallback: float) -> F64:
    ok = np.isfinite(v)
    if not ok.any():
        return np.full_like(v, fallback)
    return np.interp(s, s[ok], v[ok])
