// Fred the Tree (playtest 4, P4-15; the maintainer: "Old seven mile bridge should have Fred the Tree",
// https://en.wikipedia.org/wiki/Fred_the_Tree): the little Australian pine (a casuarina) that grew
// from a crack in the old Seven Mile Bridge's deck, probably from a bird's dropping, and has outlived
// the hurricanes since; a younger one has sprouted beside him, and volunteers ("Fred's Elves") hang
// lights on both every year. Code-made, a few hundred flat-shaded triangles, so no model file and no
// Blender: landmarks.ts composes it as `keys-landmarks#fred_the_tree` into the landmark layer's one
// mesh. Presentation only: the sim ignores landmarks, and he stands outside the rail anyway.
//
// The soup is in the landmark's own frame, built for a LEFT-hand landmark at `yawDeg` 0: the origin is
// at the deck's surface under the footprint's centre, +Y up, +Z along the road, and +X away from the
// road (a right-hand landmark turns him round with `yawDeg: 180`). A concrete ledge carries him out
// past the deck's edge (the bake puts his box 0.4 m clear of the shoulder's outer edge, which is the
// rail), and nothing of him hangs lower than FRED.crownBaseM over the deck's shoulder, so a rider
// who strays to the verge passes under a branch, never through one.
import { Color } from 'three';

/** A flat-shaded triangle soup: position, normal and colour, three numbers a vertex, nine a triangle. */
export interface Soup {
  pos: number[];
  nrm: number[];
  col: number[];
}

/** Fred's figures, metres. [default] (a little bigger than the real tree, so he reads at riding speed) */
export const FRED = {
  /** The top of the crown over the deck. */
  heightM: 5.2,
  /** The lowest crown branch over the deck: above a rider's head, over the shoulder. */
  crownBaseM: 2.1,
  /** The widest the crown spreads, radius, at its lowest tier. */
  crownRadiusM: 1.3,
  /** A circle that covers all of him, for the layer's levels of detail. */
  radiusM: 3.2,
} as const;

const GREEN_LOW = '#56775a';
const GREEN_MID = '#648a63';
const GREEN_HIGH = '#739a70';
const TRUNK = '#6a5848';
const CONCRETE = '#8f8d85';
const SAND = '#d2c093';
/** Fred's Elves' lights: warm white, red, green, blue, amber. */
const LIGHTS = ['#fff1b0', '#e8483c', '#5fd16a', '#4aa8ff', '#ffc13b', '#e8483c', '#fff1b0'] as const;

type V = readonly [number, number, number];

/** Where Fred's trunk leaves the ledge, and how far it leans away from the road at the top, m. */
const TRUNK_LEAN_M = 0.3;
const TRUNK_TOP_M = 4.2;
const LEDGE = { x0: -0.85, x1: 0.55, y0: -0.55, y1: -0.02, z0: -0.85, z1: 1.9 } as const;
/** The young tree sprouted beside him. */
const SAPLING = { x: 0.1, z: 1.25 } as const;

class SoupBuilder {
  readonly soup: Soup = { pos: [], nrm: [], col: [] };
  private readonly colour = new Color();

  /**
   * One triangle of a convex solid whose middle is `centre`: wound so its normal points away from the
   * middle, whichever way round the caller listed its corners.
   */
  private tri(a: V, b: V, c: V, centre: V, colour: Color): void {
    const p = a;
    let q = b;
    let r = c;
    const n = (x: V, y: V, z: V): V => {
      const ux = y[0] - x[0];
      const uy = y[1] - x[1];
      const uz = y[2] - x[2];
      const vx = z[0] - x[0];
      const vy = z[1] - x[1];
      const vz = z[2] - x[2];
      return [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
    };
    let w = n(p, q, r);
    const mid: V = [(p[0] + q[0] + r[0]) / 3, (p[1] + q[1] + r[1]) / 3, (p[2] + q[2] + r[2]) / 3];
    if (w[0] * (mid[0] - centre[0]) + w[1] * (mid[1] - centre[1]) + w[2] * (mid[2] - centre[2]) < 0) {
      [q, r] = [r, q];
      w = n(p, q, r);
    }
    const len = Math.hypot(w[0], w[1], w[2]);
    if (len < 1e-9) return;
    for (const v of [p, q, r]) {
      this.soup.pos.push(v[0], v[1], v[2]);
      this.soup.nrm.push(w[0] / len, w[1] / len, w[2] / len);
      this.soup.col.push(colour.r, colour.g, colour.b);
    }
  }

  /** A frustum (or a cone, with a top radius of 0) between two centres, `sides` round, closed. */
  frustum(bottom: V, rBottom: number, top: V, rTop: number, sides: number, hex: string): void {
    const colour = this.colour.set(hex).clone();
    const centre: V = [(bottom[0] + top[0]) / 2, (bottom[1] + top[1]) / 2, (bottom[2] + top[2]) / 2];
    const ring = (c: V, r: number, k: number): V => {
      const phi = (k / sides) * Math.PI * 2;
      return [c[0] + Math.cos(phi) * r, c[1], c[2] + Math.sin(phi) * r];
    };
    for (let k = 0; k < sides; k++) {
      const b0 = ring(bottom, rBottom, k);
      const b1 = ring(bottom, rBottom, k + 1);
      if (rTop <= 0) {
        this.tri(b0, b1, top, centre, colour);
      } else {
        const t0 = ring(top, rTop, k);
        const t1 = ring(top, rTop, k + 1);
        this.tri(b0, b1, t1, centre, colour);
        this.tri(b0, t1, t0, centre, colour);
        this.tri(top, t0, t1, centre, colour);
      }
      this.tri(bottom, b1, b0, centre, colour);
    }
  }

  box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, hex: string): void {
    const colour = this.colour.set(hex).clone();
    const centre: V = [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2];
    const c = (x: number, y: number, z: number): V => [x, y, z];
    const faces: [V, V, V, V][] = [
      [c(x0, y0, z0), c(x1, y0, z0), c(x1, y1, z0), c(x0, y1, z0)],
      [c(x0, y0, z1), c(x1, y0, z1), c(x1, y1, z1), c(x0, y1, z1)],
      [c(x0, y0, z0), c(x0, y0, z1), c(x0, y1, z1), c(x0, y1, z0)],
      [c(x1, y0, z0), c(x1, y0, z1), c(x1, y1, z1), c(x1, y1, z0)],
      [c(x0, y0, z0), c(x1, y0, z0), c(x1, y0, z1), c(x0, y0, z1)],
      [c(x0, y1, z0), c(x1, y1, z0), c(x1, y1, z1), c(x0, y1, z1)],
    ];
    for (const [a, b, cc, d] of faces) {
      this.tri(a, b, cc, centre, colour);
      this.tri(a, cc, d, centre, colour);
    }
  }

  /** A small bipyramid: one string light. */
  light(at: V, r: number, hex: string): void {
    const colour = this.colour.set(hex).clone();
    const [x, y, z] = at;
    const ring: V[] = [
      [x + r, y, z],
      [x, y, z + r],
      [x - r, y, z],
      [x, y, z - r],
    ];
    for (let k = 0; k < 4; k++) {
      const a = ring[k] as V;
      const b = ring[(k + 1) % 4] as V;
      this.tri(a, b, [x, y + r * 1.3, z], at, colour);
      this.tri(b, a, [x, y - r * 1.3, z], at, colour);
    }
  }
}

/** The trunk's centre at height y: it leans a little away from the road as it climbs. */
const trunkAt = (y: number): V => [(y / TRUNK_TOP_M) * TRUNK_LEAN_M, y, 0];

/** The crown's three drooping tiers: base height, tip height, radius, colour. */
const TIERS = [
  { y0: FRED.crownBaseM, y1: 3.6, r: FRED.crownRadiusM, hex: GREEN_LOW },
  { y0: 3.0, y1: 4.4, r: 1.05, hex: GREEN_MID },
  { y0: 3.8, y1: FRED.heightM, r: 0.75, hex: GREEN_HIGH },
] as const;

/** Fred, in the landmark's own frame (see the header). Built fresh; the caller places a copy. */
export function fredSoup(): Soup {
  const b = new SoupBuilder();
  // The ledge he grows from, and the sand in the crack at his foot.
  b.box(LEDGE.x0, LEDGE.x1, LEDGE.y0, LEDGE.y1, LEDGE.z0, LEDGE.z1, CONCRETE);
  b.frustum([0, LEDGE.y1, 0], 0.6, [0, 0.2, 0], 0.18, 8, SAND);
  // The trunk, tapering and leaning.
  b.frustum(trunkAt(0.1), 0.17, trunkAt(TRUNK_TOP_M), 0.06, 8, TRUNK);
  // The crown: casuarina's feathery needles as three stacked, drooping cones, lighter towards the top.
  for (const t of TIERS) {
    const mid = trunkAt(t.y0);
    b.frustum([mid[0], t.y0, mid[2]], t.r, [trunkAt(t.y1)[0], t.y1, 0], 0, 9, t.hex);
  }
  // The younger tree that sprouted beside him.
  b.frustum([SAPLING.x, LEDGE.y1, SAPLING.z], 0.06, [SAPLING.x, 1, SAPLING.z], 0.03, 6, TRUNK);
  b.frustum([SAPLING.x, 0.55, SAPLING.z], 0.5, [SAPLING.x + 0.04, 1.9, SAPLING.z], 0, 7, GREEN_MID);
  // Fred's Elves' lights: on the big tree's tiers, round the side facing the road and the highway.
  LIGHTS.forEach((hex, i) => {
    const t = TIERS[i % TIERS.length] as (typeof TIERS)[number];
    const u = 0.25 + 0.5 * ((i * 0.37) % 1);
    const y = t.y0 + (t.y1 - t.y0) * u;
    const reach = t.r * (1 - u) * 1.03;
    const phi = Math.PI * (0.55 + 0.35 * i);
    const c = trunkAt(y);
    b.light([c[0] + Math.cos(phi) * reach, y, Math.sin(phi) * reach], 0.12, hex);
  });
  return b.soup;
}
