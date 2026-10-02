// Map points to a network's metres: the same transverse Mercator frame the GIS bake uses
// (tools/gis/src/tbgis/tmerc.py: WGS84, central meridian at the origin's longitude, scale 1,
// Krüger's series), so a far landmark sits where it is on the map relative to a real road.
// World axes: x east, z south (docs/architecture.md, "One world coordinate system").

const A = 6_378_137;
const F = 1 / 298.257223563;
const N = F / (2 - F);
const BIG_A = (A / (1 + N)) * (1 + N ** 2 / 4 + N ** 4 / 64 + N ** 6 / 256);
const E = Math.sqrt(F * (2 - F));
const ALPHA = [
  N / 2 -
    (2 * N ** 2) / 3 +
    (5 * N ** 3) / 16 +
    (41 * N ** 4) / 180 -
    (127 * N ** 5) / 288 +
    (7891 * N ** 6) / 37800,
  (13 * N ** 2) / 48 -
    (3 * N ** 3) / 5 +
    (557 * N ** 4) / 1440 +
    (281 * N ** 5) / 630 -
    (1983433 * N ** 6) / 1935360,
  (61 * N ** 3) / 240 - (103 * N ** 4) / 140 + (15061 * N ** 5) / 26880 + (167603 * N ** 6) / 181440,
  (49561 * N ** 4) / 161280 - (179 * N ** 5) / 168 + (6601661 * N ** 6) / 7257600,
  (34729 * N ** 5) / 80640 - (3418889 * N ** 6) / 1995840,
  (212378941 * N ** 6) / 319334400,
];
const rad = (d: number) => (d * Math.PI) / 180;

function raw(latDeg: number, dLonDeg: number): [number, number] {
  const phi = rad(latDeg);
  const lam = rad(dLonDeg);
  const t = Math.sinh(Math.atanh(Math.sin(phi)) - E * Math.atanh(E * Math.sin(phi)));
  const xiP = Math.atan2(t, Math.cos(lam));
  const etaP = Math.atanh(Math.sin(lam) / Math.sqrt(1 + t * t));
  let xi = xiP;
  let eta = etaP;
  ALPHA.forEach((a, i) => {
    const j = 2 * (i + 1);
    xi += a * Math.sin(j * xiP) * Math.cosh(j * etaP);
    eta += a * Math.cos(j * xiP) * Math.sinh(j * etaP);
  });
  return [BIG_A * eta, BIG_A * xi];
}

/** A network's map frame: [lat, lon] degrees to world [x, z] metres. */
export interface GeoFrame {
  toWorld(lat: number, lon: number): [number, number];
}

export function geoFrame(originLatDeg: number, originLonDeg: number): GeoFrame {
  const north0 = raw(originLatDeg, 0)[1];
  return {
    toWorld(lat, lon) {
      const [east, north] = raw(lat, lon - originLonDeg);
      return [east, -(north - north0)];
    },
  };
}
