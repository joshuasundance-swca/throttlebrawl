// What a flat mark lies on, on a roof (the maintainer, 2026-10-06, [decided]: a road race in a physical world with
// honest edges; "consistent physics and gameplay is important here so players know what to expect"). A rider can
// ride a roof, a pitched one a slope, and a crash can rest on one; the blob shadow under him and the chalk mark of
// his touch-down were laid flat at one height, so on a slope one end sank into the roof, and a body down on a roof
// threw its shadow on the road inside the building. The structures plan (road/structures.ts) is the roof the sim
// meets: the same top at every point, so the mark is where the roof is.
//
// `fitRoof` finds the roof under a point (the highest top no more than a step over the caster) and fits the plane
// of its top under an oval of the mark's size, from four points round the oval. An oval that would hang over the
// roof's edge is drawn smaller, so no part of it floats in the air past the eave; one that cannot fit even small is
// a small flat oval at the centre's top. Pure arithmetic, no three.js.
import { structuresAt, topAt, type Structure, type StructurePlan } from '../road';

/** A roof under a mark: its height under the mark's centre, the plane's normal, and how much of the mark fits. */
export interface RoofFit {
  /** World height of the roof under the centre, m. */
  y: number;
  /** The unit normal of the roof's plane under the mark (0, 1, 0 on a flat roof). */
  nx: number;
  ny: number;
  nz: number;
  /** 1 when the whole mark lies on the roof, less when it is drawn smaller to stay on it. */
  scale: number;
  /** The roof's structure. */
  roof: Structure;
}

/** How far over the caster's height a top may be and still be under him (a kerb's play), m [default]. */
export const ROOF_REACH_M = 0.3;

/**
 * The least a structure's footprint is across, either way, to be a roof a mark lies on, m [default]: the sim's
 * rule of thumb for a top that holds a bike (tests/sim/structures-solid.test.ts reads the same two metres).
 */
export const MIN_ROOF_M = 2;

/** The sizes tried, whole to smallest, as shares of the mark [default]. */
const FIT_SCALES: readonly number[] = [1, 0.7, 0.45];

/**
 * The roof under (x, z) for a caster at height `y`: the highest structure top no more than `ROOF_REACH_M` over `y`
 * under that point, fitted under an oval `lengthM` along `heading` (the camera's convention: forward is
 * (-sin h, -cos h), right is (cos h, -sin h)) by `widthM` across. Null when no top stands under him: the road, or
 * a ground beside a building, or under a deck.
 */
export function fitRoof(
  plan: StructurePlan,
  x: number,
  y: number,
  z: number,
  heading: number,
  lengthM: number,
  widthM: number,
): RoofFit | null {
  let roof: Structure | null = null;
  let top = -Infinity;
  for (const st of structuresAt(plan, x, z)) {
    // A top too small to hold a bike (a post, a bike rack, a café table) is no roof: a rider flying over it
    // casts no shadow on it, so the shadow does not jump up onto it for the frame he is above it.
    if (2 * st.foot.hu < MIN_ROOF_M || 2 * st.foot.hv < MIN_ROOF_M) continue;
    const t = topAt(st, x, z);
    if (t === null || t > y + ROOF_REACH_M) continue;
    if (t > top) {
      top = t;
      roof = st;
    }
  }
  if (!roof) return null;
  const fx = -Math.sin(heading);
  const fz = -Math.cos(heading);
  const rx = Math.cos(heading);
  const rz = -Math.sin(heading);
  for (const k of FIT_SCALES) {
    const hl = (lengthM * k) / 2;
    const hw = (widthM * k) / 2;
    const front = topAt(roof, x + fx * hl, z + fz * hl);
    const back = topAt(roof, x - fx * hl, z - fz * hl);
    const right = topAt(roof, x + rx * hw, z + rz * hw);
    const left = topAt(roof, x - rx * hw, z - rz * hw);
    if (front === null || back === null || right === null || left === null) continue;
    const along = (front - back) / (2 * hl);
    const across = (right - left) / (2 * hw);
    const gx = along * fx + across * rx;
    const gz = along * fz + across * rz;
    const n = Math.sqrt(gx * gx + 1 + gz * gz);
    return { y: top, nx: -gx / n, ny: 1 / n, nz: -gz / n, scale: k, roof };
  }
  const smallest = FIT_SCALES[FIT_SCALES.length - 1] ?? 0.45;
  return { y: top, nx: 0, ny: 1, nz: 0, scale: smallest, roof };
}
