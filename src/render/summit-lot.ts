// The Twin Peaks summit lot (playtest 4, run C's live check: "the Twin Peaks summit ends on a bare hilltop";
// the identity sheets' T2: "a widened paved lot, a parked tour bus, coin binoculars at the rail, and a dense
// zone of tourists"). Code-made, a few hundred flat-shaded triangles, so no model file and no Blender:
// landmarks.ts composes it as `sf-landmarks#summit_lot` into the landmark layer's one mesh, like Fred the Tree.
// Presentation only: the sim ignores landmarks, and the lot stands past the road's verge.
//
// The soup is in the landmark's own frame: the origin is at the lot's middle at the road's surface there, +Y
// up, +Z along the lot (the road's direction once the feature's `yawDeg` has turned it), +X away from the
// road (a right-hand landmark carries `yawDeg: 180`, as Fred does). The pavement is a hair above the land
// strip, which sits 0.09 m under the road; it is sheared to the road's grade by `grade` (metres of rise
// per metre of +Z), since the climb's last stretch is not level and a rigid slab would float at one end and
// sink at the other.
import { SoupBuilder, type Soup } from './fred';

/** The lot's figures, in the landmark's metres. [default] (a viewpoint lot of 68 by 16 m, inside its 84 m box: the climb bends a little under it) */
export const SUMMIT_LOT = {
  halfAcrossM: 8,
  halfAlongM: 34,
  /** The pavement's top over the road's surface: over the land strip's -0.09, under a kerb's height. */
  pavementY: 0.03,
  /** The viewpoint's rail stands near the far edge. */
  railX: 7.1,
  railHeightM: 1.1,
  /** An invented tour bus, parked along the lot: a cream body with a teal stripe, 12.4 by 2.55 by 3.3 m. */
  bus: { x0: -2.4, x1: 0.15, z0: -30, z1: -17.6, heightM: 3.3 },
  /** Two coin binoculars at the rail: where each stands (x, z), and the height of its head. */
  binoculars: [
    { x: 6.3, z: 9 },
    { x: 6.3, z: 15 },
  ],
  binocularHeadM: 1.6,
  /** Two lamps at the road side of the lot. */
  lamps: [
    { x: -6.8, z: -14 },
    { x: -6.8, z: 20 },
  ],
} as const;

const ASPHALT = '#55585b';
const KERB = '#b9b6ac';
const PAINT = '#e9e8e2';
const STONE = '#8f8979';
const RAIL = '#2f3438';
const STEEL = '#3a3e43';
const COIN = '#d9b64c';
const CREAM = '#efe8d4';
const TEAL = '#2f8f8b';
const GLASS = '#27343b';
const TYRE = '#1b1c1e';
const LAMP = '#40454a';
const LAMP_GLOW = '#fff2c4';

/** The lot, built fresh; `grade` is the rise of the road per metre of +Z, applied as a shear. */
export function summitLotSoup(grade = 0): Soup {
  const L = SUMMIT_LOT;
  const b = new SoupBuilder();
  const y0 = L.pavementY;
  const A = L.halfAcrossM;
  const Z = L.halfAlongM;
  // The pavement, with a kerb along its road side and a stone wall along its far edge.
  b.box(-A, A, 0, y0, -Z, Z, ASPHALT);
  b.box(-A, -A + 0.35, 0, y0 + 0.16, -Z, Z, KERB);
  b.box(L.railX - 0.3, L.railX + 0.35, 0, 0.55, -Z, Z, STONE);
  // Parking bays: white lines across the lot's near half, every 3.2 m, clear of the bus's place.
  for (let z = 2; z <= Z - 3; z += 3.2) b.box(-A + 0.8, -A + 5.8, y0, y0 + 0.02, z, z + 0.14, PAINT);
  // The rail: a steel top bar over posts every 3 m.
  b.box(L.railX - 0.05, L.railX + 0.05, L.railHeightM - 0.06, L.railHeightM + 0.04, -Z, Z, RAIL);
  for (let z = -Z + 1; z <= Z; z += 3)
    b.box(L.railX - 0.05, L.railX + 0.05, 0.55, L.railHeightM, z - 0.05, z + 0.05, RAIL);
  // The tour bus.
  const B = L.bus;
  const wheelY = 0.5;
  b.box(B.x0, B.x1, 0.45, B.heightM, B.z0, B.z1, CREAM);
  // A teal stripe round the waist, a dark window band on both sides and the ends, and the roof's rim.
  b.box(B.x0 - 0.02, B.x1 + 0.02, 1.05, 1.5, B.z0 - 0.02, B.z1 + 0.02, TEAL);
  b.box(B.x0 - 0.03, B.x1 + 0.03, 1.85, 2.85, B.z0 + 0.5, B.z1 - 0.5, GLASS);
  b.box(B.x0 + 0.2, B.x1 - 0.2, 1.8, 2.9, B.z1 - 0.02, B.z1 + 0.04, GLASS);
  b.box(B.x0 + 0.2, B.x1 - 0.2, 1.8, 2.9, B.z0 - 0.04, B.z0 + 0.02, GLASS);
  b.box(B.x0 - 0.04, B.x1 + 0.04, B.heightM - 0.1, B.heightM + 0.1, B.z0 - 0.04, B.z1 + 0.04, TEAL);
  // Wheels: a dark block under each end's wheel arch (two axles, one pair of tyres at each).
  for (const z of [B.z0 + 2.7, B.z1 - 2.1])
    for (const [xa, xb] of [
      [B.x0 - 0.08, B.x0 + 0.28],
      [B.x1 - 0.28, B.x1 + 0.08],
    ] as const)
      b.box(xa, xb, y0, wheelY + 0.5, z - 0.55, z + 0.55, TYRE);
  // The coin binoculars: a post, a head that looks out over the rail, and a coin plate on the post.
  for (const bi of L.binoculars) {
    b.box(bi.x - 0.07, bi.x + 0.07, y0, L.binocularHeadM - 0.2, bi.z - 0.07, bi.z + 0.07, STEEL);
    b.box(
      bi.x - 0.2,
      bi.x + 0.2,
      L.binocularHeadM - 0.2,
      L.binocularHeadM + 0.18,
      bi.z - 0.26,
      bi.z + 0.26,
      STEEL,
    );
    b.box(
      bi.x + 0.2,
      bi.x + 0.55,
      L.binocularHeadM - 0.13,
      L.binocularHeadM + 0.11,
      bi.z - 0.2,
      bi.z + 0.2,
      STEEL,
    );
    b.box(bi.x - 0.09, bi.x - 0.07, 1.0, 1.18, bi.z - 0.05, bi.z + 0.05, COIN);
  }
  // Two lamps along the road side, with a warm head so they read at dusk.
  for (const lamp of L.lamps) {
    b.frustum([lamp.x, y0, lamp.z], 0.13, [lamp.x, 5.2, lamp.z], 0.07, 6, LAMP);
    b.box(lamp.x - 0.45, lamp.x + 0.1, 5.15, 5.3, lamp.z - 0.12, lamp.z + 0.12, LAMP);
    b.box(lamp.x - 0.4, lamp.x + 0.05, 5.05, 5.15, lamp.z - 0.1, lamp.z + 0.1, LAMP_GLOW);
  }
  const soup = b.soup;
  if (grade !== 0) {
    // The road's grade as a shear along +Z: positions rise with z, normals follow the inverse transpose.
    for (let i = 0; i < soup.pos.length; i += 3)
      soup.pos[i + 1] = (soup.pos[i + 1] ?? 0) + grade * (soup.pos[i + 2] ?? 0);
    for (let i = 0; i < soup.nrm.length; i += 3) {
      const nx = soup.nrm[i] ?? 0;
      const ny = soup.nrm[i + 1] ?? 0;
      const nz = (soup.nrm[i + 2] ?? 0) - grade * ny;
      const len = Math.hypot(nx, ny, nz) || 1;
      soup.nrm[i] = nx / len;
      soup.nrm[i + 1] = ny / len;
      soup.nrm[i + 2] = nz / len;
    }
  }
  return soup;
}
