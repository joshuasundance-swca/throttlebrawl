"""The projection agrees with PROJ (via pyproj, an independent implementation) to a millimetre."""

from __future__ import annotations

import pytest
from pyproj import Transformer

from tbgis.tmerc import Frame

KEYS = Frame(24.70, -81.10)
POINTS = [
    (24.70, -81.10),
    (24.7063416, -81.1284518),  # east end of the Seven Mile Bridge
    (24.8033011, -80.8503393),  # Long Key Bridge
    (24.555, -81.78),  # Key West
    (25.20, -80.35),  # the top of the Keys
]


@pytest.mark.parametrize(("lat", "lon"), POINTS)
def test_matches_proj(lat: float, lon: float) -> None:
    proj = Transformer.from_crs(
        "EPSG:4326",
        "+proj=tmerc +lat_0=24.7 +lon_0=-81.1 +k=1 +x_0=0 +y_0=0 +ellps=WGS84 +units=m +no_defs",
        always_xy=True,
    )
    east, north = proj.transform(lon, lat)
    x, z = KEYS.to_world(lat, lon)
    assert x == pytest.approx(east, abs=1e-3)
    assert z == pytest.approx(-north, abs=1e-3)


def test_axes() -> None:
    x0, z0 = KEYS.to_world(24.70, -81.10)
    assert abs(x0) < 1e-6
    assert abs(z0) < 1e-6
    x, _ = KEYS.to_world(24.70, -81.00)
    _, z = KEYS.to_world(24.80, -81.10)
    assert x > 10_000  # east is +x
    assert z < -10_000  # north is -z
