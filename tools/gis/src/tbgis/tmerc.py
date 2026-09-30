"""The region's transverse Mercator frame (docs/architecture.md, "One world coordinate system").

WGS84 ellipsoid, central meridian at the network's ``originLonDeg``, scale factor 1, and the
origin (x = 0, z = 0) at ``(originLatDeg, originLonDeg)``. World axes: ``x`` east, ``y`` up
(elevation), ``z`` south, so ``z = -(northing - northing_at_origin)``.

The forward projection is Krüger's series to order n^6 (Karney 2011, "Transverse Mercator with
an accuracy of a few nanometers"), which is sub-millimetre over any region this game uses. Only
the offline bake uses it; the runtime reads metres.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

WGS84_A = 6_378_137.0
WGS84_F = 1 / 298.257223563


@dataclass(frozen=True)
class Frame:
    origin_lat_deg: float
    origin_lon_deg: float
    k0: float = 1.0

    def _series(self) -> tuple[float, list[float], float]:
        n = WGS84_F / (2 - WGS84_F)
        n2, n3, n4, n5, n6 = n**2, n**3, n**4, n**5, n**6
        big_a = WGS84_A / (1 + n) * (1 + n2 / 4 + n4 / 64 + n6 / 256)
        alpha = [
            n / 2 - 2 * n2 / 3 + 5 * n3 / 16 + 41 * n4 / 180 - 127 * n5 / 288 + 7891 * n6 / 37800,
            13 * n2 / 48 - 3 * n3 / 5 + 557 * n4 / 1440 + 281 * n5 / 630 - 1983433 * n6 / 1935360,
            61 * n3 / 240 - 103 * n4 / 140 + 15061 * n5 / 26880 + 167603 * n6 / 181440,
            49561 * n4 / 161280 - 179 * n5 / 168 + 6601661 * n6 / 7257600,
            34729 * n5 / 80640 - 3418889 * n6 / 1995840,
            212378941 * n6 / 319334400,
        ]
        return n, alpha, big_a

    def _raw(self, lat_deg: float, lon_deg: float) -> tuple[float, float]:
        """Easting and northing (metres) from the central meridian and the equator."""
        n, alpha, big_a = self._series()
        e = math.sqrt(WGS84_F * (2 - WGS84_F))
        phi = math.radians(lat_deg)
        lam = math.radians(lon_deg - self.origin_lon_deg)
        t = math.sinh(math.atanh(math.sin(phi)) - e * math.atanh(e * math.sin(phi)))
        xi_p = math.atan2(t, math.cos(lam))
        eta_p = math.atanh(math.sin(lam) / math.sqrt(1 + t * t))
        xi, eta = xi_p, eta_p
        for j, a in enumerate(alpha, start=1):
            xi += a * math.sin(2 * j * xi_p) * math.cosh(2 * j * eta_p)
            eta += a * math.cos(2 * j * xi_p) * math.sinh(2 * j * eta_p)
        del n
        return self.k0 * big_a * eta, self.k0 * big_a * xi

    def to_world(self, lat_deg: float, lon_deg: float) -> tuple[float, float]:
        """World (x, z) in metres: x east, z south, zero at the origin."""
        east, north = self._raw(lat_deg, lon_deg)
        _, north0 = self._raw(self.origin_lat_deg, self.origin_lon_deg)
        return east, -(north - north0)
