// The camera reads the structures plan as data (the maintainer, 2026-10-06, [decided]: a road race in a
// physical world with honest edges; "consistent physics and gameplay is important here so players know what to
// expect"). The plan (road/structures.ts) is every building, landmark, wall, pier and shed beside the road,
// each an oriented box with a base and a roof; the sim meets it, render draws it, and here the eye is kept out
// of it: a camera on a roof is not pushed off the roof, and a camera beside a tower is not inside the tower.
//
// `src/camera` imports only types (boundaries.test.ts), so the few lines of footprint arithmetic road/structures.ts
// holds (`footContains`, `topAt`, the grid) are here again, over the same plan data; src/camera/solids.test.ts
// holds the two to each other on every kind of roof. Plain + - * / only, the plan's own grid for lookups.
import type { Structure, StructurePlan } from '../road';

/**
 * How close the eye may come to a solid face, m [default]: the renderer's near plane (0.3 m): closer, and the
 * face is cut away or drawn from the inside.
 */
export const EYE_CLEARANCE_M = 0.3;

/** How far from the arm's pivot a march samples the line of sight, m [default]: thinner than any structure. */
const MARCH_STEP_M = 0.25;

/** A structure's footprint, in its own frame: where a world point lies along `u` and `v`, m from its middle. */
function frameOf(st: Structure, x: number, z: number): { u: number; v: number } {
  const f = st.foot;
  const dx = x - f.x;
  const dz = z - f.z;
  return { u: dx * f.ux + dz * f.uz, v: dz * f.ux - dx * f.uz };
}

/**
 * A structure's top over the point of its footprint nearest (x, z), world y (the roof's own height where the
 * point is over it; the eave's or the edge's at the nearest point where it is beside it).
 */
export function topNearM(st: Structure, x: number, z: number): number {
  const f = st.foot;
  const { u, v } = frameOf(st, x, z);
  const cu = u > f.hu ? f.hu : u < -f.hu ? -f.hu : u;
  const cv = v > f.hv ? f.hv : v < -f.hv ? -f.hv : v;
  const roof = st.roof;
  if (roof.kind === 'flat') return st.baseY + roof.topM;
  const across = roof.ridge === 'u' ? cv / f.hv : cu / f.hu;
  const t = across < 0 ? -across : across;
  return st.baseY + roof.ridgeM - (roof.ridgeM - roof.eaveM) * t;
}

/** How far a point lies outside a footprint, m: 0 on it or inside (the nearest footprint point's distance). */
export function outsideM(st: Structure, x: number, z: number): number {
  const f = st.foot;
  const { u, v } = frameOf(st, x, z);
  const eu = (u < 0 ? -u : u) - f.hu;
  const ev = (v < 0 ? -v : v) - f.hv;
  const a = eu > 0 ? eu : 0;
  const b = ev > 0 ? ev : 0;
  return Math.sqrt(a * a + b * b);
}

/** The structures whose grid squares lie within `r` of (x, z), ascending id (the plan's own grid). */
export function solidsNear(plan: StructurePlan, x: number, z: number, r: number): Structure[] {
  const ids = new Set<number>();
  const i0 = Math.floor((x - r) / plan.cellM);
  const i1 = Math.floor((x + r) / plan.cellM);
  const j0 = Math.floor((z - r) / plan.cellM);
  const j1 = Math.floor((z + r) / plan.cellM);
  for (let i = i0; i <= i1; i++)
    for (let j = j0; j <= j1; j++) for (const id of plan.cells.get(`${i},${j}`) ?? []) ids.add(id);
  const out: Structure[] = [];
  for (const id of [...ids].sort((a, b) => a - b)) {
    const st = plan.items[id];
    if (st) out.push(st);
  }
  return out;
}

/**
 * Whether the point (x, y, z) is inside a structure's solid padded by `pad` m all round: over its footprint
 * (padded), between its underside and its top, whichever of the two the point is nearer the roof of. A deck or a
 * lintel over the road is passed under (the point is below its underside), a roof is passed over.
 */
export function insideSolid(st: Structure, x: number, y: number, z: number, pad: number): boolean {
  if (outsideM(st, x, z) > pad) return false;
  return y >= st.baseY - pad && y <= topNearM(st, x, z) + pad;
}

/**
 * How far along the line of sight from `pivot` (the rider's body) to `eye` the eye may stay, 0 to 1: the share of
 * the arm before the first padded solid. A solid the pivot is already inside or beside, padded (the wall a rider
 * rubs, the roof he rides), is met unpadded, so he is never in a camera of zero length; one the pivot is inside
 * is no hindrance at all (the rider is in the sim's hands, never the camera's).
 */
export function armClear(
  plan: StructurePlan,
  pivot: { x: number; y: number; z: number },
  eye: { x: number; y: number; z: number },
  pad: number = EYE_CLEARANCE_M,
): number {
  return armClearAmong(armCandidates(plan, pivot, eye, pad), pivot, eye, pad);
}

/**
 * The solids that can be anywhere near the line of sight from `pivot` to `eye`: those whose footprint's bounding
 * circle comes within `pad` of the line over the ground and whose height span overlaps the line's. A broad phase,
 * so the march tests the handful of solids near the line and not all of a street's hundred parts.
 */
function armCandidates(
  plan: StructurePlan,
  pivot: { x: number; y: number; z: number },
  eye: { x: number; y: number; z: number },
  pad: number,
): Structure[] {
  const dx = eye.x - pivot.x;
  const dz = eye.z - pivot.z;
  const dd = dx * dx + dz * dz;
  const lo = Math.min(pivot.y, eye.y) - pad;
  const hi = Math.max(pivot.y, eye.y) + pad;
  const near = solidsNear(plan, (eye.x + pivot.x) / 2, (eye.z + pivot.z) / 2, Math.sqrt(dd) / 2 + pad + 1);
  const out: Structure[] = [];
  for (const st of near) {
    const f = st.foot;
    const top = st.roof.kind === 'flat' ? st.roof.topM : st.roof.ridgeM;
    if (st.baseY - pad > hi || st.baseY + top + pad < lo) continue;
    // The footprint's bounding circle against the segment, over the ground.
    const t = dd > 1e-12 ? Math.min(1, Math.max(0, ((f.x - pivot.x) * dx + (f.z - pivot.z) * dz) / dd)) : 0;
    const cx = pivot.x + dx * t - f.x;
    const cz = pivot.z + dz * t - f.z;
    const reach = Math.sqrt(f.hu * f.hu + f.hv * f.hv) + pad;
    if (cx * cx + cz * cz <= reach * reach) out.push(st);
  }
  return out;
}

/** `armClear` among the solids that can be near the line (`armCandidates`). */
function armClearAmong(
  near: readonly Structure[],
  pivot: { x: number; y: number; z: number },
  eye: { x: number; y: number; z: number },
  pad: number,
): number {
  const dx = eye.x - pivot.x;
  const dy = eye.y - pivot.y;
  const dz = eye.z - pivot.z;
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (!(len > 1e-6) || near.length === 0) return 1;
  // Each solid's own pad: none for one the pivot is within `pad` of (the wall he rubs); skipped if he is inside.
  const mine: { st: Structure; pad: number }[] = [];
  for (const st of near) {
    if (insideSolid(st, pivot.x, pivot.y, pivot.z, 0)) continue;
    mine.push({ st, pad: insideSolid(st, pivot.x, pivot.y, pivot.z, pad) ? 0 : pad });
  }
  if (mine.length === 0) return 1;
  const steps = Math.max(1, Math.ceil(len / MARCH_STEP_M));
  for (let k = 1; k <= steps; k++) {
    const t = k / steps;
    const x = pivot.x + dx * t;
    const y = pivot.y + dy * t;
    const z = pivot.z + dz * t;
    for (const m of mine) if (insideSolid(m.st, x, y, z, m.pad)) return (k - 1) / steps;
  }
  return 1;
}

/**
 * A point that is inside a solid, moved out by the shortest way: up over its top, down under its underside, or out
 * through one of its four faces, to `pad` m from it; again if that lands in another, a few times at most. Where
 * the point is in no solid it is returned as it is. For the eye of a rider the sim has left inside a building (a
 * crashed body against a balcony's slab: the sim holds a body's line by the band, not by the solid), whose arm has
 * no clear side to be cut from.
 */
export function escapeSolids(
  plan: StructurePlan,
  p: { x: number; y: number; z: number },
  pad: number = EYE_CLEARANCE_M,
): { x: number; y: number; z: number } {
  let { x, y, z } = p;
  for (let round = 0; round < 4; round++) {
    const st = solidsNear(plan, x, z, 0).find((s) => insideSolid(s, x, y, z, 0));
    if (!st) break;
    const f = st.foot;
    const { u, v } = frameOf(st, x, z);
    const up = topNearM(st, x, z) + pad;
    const down = st.baseY - pad;
    // Each way out as a new point and how far it is.
    const out: { x: number; y: number; z: number; cost: number }[] = [
      { x, y: up, z, cost: up - y },
      { x, y: down, z, cost: y - down },
    ];
    for (const su of [-1, 1] as const) {
      const nu = su * (f.hu + pad);
      out.push({
        x: f.x + nu * f.ux - v * f.uz,
        y,
        z: f.z + nu * f.uz + v * f.ux,
        cost: Math.abs(nu - u),
      });
    }
    for (const sv of [-1, 1] as const) {
      const nv = sv * (f.hv + pad);
      out.push({
        x: f.x + u * f.ux - nv * f.uz,
        y,
        z: f.z + u * f.uz + nv * f.ux,
        cost: Math.abs(nv - v),
      });
    }
    let best = out[0];
    for (const o of out) if (best && o.cost < best.cost) best = o;
    if (!best) break;
    x = best.x;
    y = best.y;
    z = best.z;
  }
  return { x, y, z };
}

/**
 * Turns the view toward the rider until he is no more than `maxRad` off its axis, the look point kept at its
 * distance: the eye, once the solids have lowered it or cut its arm, is not where the aim was made for (a flight's
 * tip looks at the road far below, and an eye brought down to his height sees him above that), so the aim follows
 * him. A rider already within `maxRad` of the axis leaves the pose as it is.
 */
export function keepInView<
  P extends { x: number; y: number; z: number; lookX: number; lookY: number; lookZ: number },
>(pose: P, pivot: { x: number; y: number; z: number }, maxRad: number): P {
  const ax = pose.lookX - pose.x;
  const ay = pose.lookY - pose.y;
  const az = pose.lookZ - pose.z;
  const rx = pivot.x - pose.x;
  const ry = pivot.y - pose.y;
  const rz = pivot.z - pose.z;
  const la = Math.sqrt(ax * ax + ay * ay + az * az);
  const lr = Math.sqrt(rx * rx + ry * ry + rz * rz);
  if (!(la > 1e-6) || !(lr > 1e-6)) return pose;
  const cos = (ax * rx + ay * ry + az * rz) / (la * lr);
  const phi = Math.acos(cos > 1 ? 1 : cos < -1 ? -1 : cos);
  if (!(phi > maxRad)) return pose;
  // Toward him by the excess, as a blend of the two unit directions (small angles), and back to the look's length.
  const t = (phi - maxRad) / phi;
  const dx = (ax / la) * (1 - t) + (rx / lr) * t;
  const dy = (ay / la) * (1 - t) + (ry / lr) * t;
  const dz = (az / la) * (1 - t) + (rz / lr) * t;
  const dl = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (!(dl > 1e-9)) return pose;
  return {
    ...pose,
    lookX: pose.x + (dx / dl) * la,
    lookY: pose.y + (dy / dl) * la,
    lookZ: pose.z + (dz / dl) * la,
  };
}

/** The shares of the eye's height over the pivot tried under a ceiling, highest first [default]. */
const HEIGHT_SHARES: readonly number[] = [1, 0.6, 0.3, 0];

/**
 * How much of the eye's height over the pivot it may keep, 0 to 1: the highest of `HEIGHT_SHARES` (1: as it is, 0:
 * level with the pivot) at which the whole arm is clear, or, where none is, the one whose arm is clear the
 * furthest. A rider thrown under a balcony has the balcony's slab over his head, and an eye 2.6 m up and back is
 * above or inside it: it comes down under it, as a camera under a ceiling does, before the arm is cut short.
 */
export function eyeHeightShare(
  plan: StructurePlan,
  pivot: { x: number; y: number; z: number },
  eye: { x: number; y: number; z: number },
  pad: number = EYE_CLEARANCE_M,
): number {
  let best = 1;
  let reach = -1;
  // The same ground line at every height: the solids near it are found once, for the full height.
  const near = armCandidates(plan, pivot, eye, pad);
  for (const h of HEIGHT_SHARES) {
    const clear = armClearAmong(near, pivot, { x: eye.x, y: pivot.y + (eye.y - pivot.y) * h, z: eye.z }, pad);
    if (clear >= 1) return h;
    if (clear > reach + 1e-9) {
      reach = clear;
      best = h;
    }
  }
  return best;
}

/**
 * The world height of the highest structure top a body at (x, y, z) rests on: a top within `within` m under it
 * (and no more than `over` m over it), or null. A body flung through the air above a roof rests on nothing.
 */
export function standingOn(
  plan: StructurePlan,
  x: number,
  y: number,
  z: number,
  within = 0.9,
  over = 0.35,
): number | null {
  let best: number | null = null;
  for (const st of solidsNear(plan, x, z, 0)) {
    if (outsideM(st, x, z) > 0) continue;
    const top = topNearM(st, x, z);
    if (top > y + over || top < y - within) continue;
    if (best === null || top > best) best = top;
  }
  return best;
}

/**
 * Where an eye that is within `pad` of a solid's face must stand: pushed straight away from the nearest face,
 * horizontally, to `pad` from it. Null when the eye is clear, or inside a footprint (the rider is in the sim's
 * hands). One push, never more than `maxM` (the helmet eye's own reach).
 */
export function pushedClear(
  plan: StructurePlan,
  x: number,
  y: number,
  z: number,
  pad: number = EYE_CLEARANCE_M,
  maxM = 0.5,
): { x: number; z: number } | null {
  let best: { x: number; z: number; need: number } | null = null;
  for (const st of solidsNear(plan, x, z, pad + 1)) {
    if (!insideSolid(st, x, y, z, pad)) continue;
    const f = st.foot;
    const { u, v } = frameOf(st, x, z);
    const cu = u > f.hu ? f.hu : u < -f.hu ? -f.hu : u;
    const cv = v > f.hv ? f.hv : v < -f.hv ? -f.hv : v;
    // The nearest footprint point, and the way out from it.
    const nx = f.x + cu * f.ux - cv * f.uz;
    const nz = f.z + cu * f.uz + cv * f.ux;
    const ex = x - nx;
    const ez = z - nz;
    const dist = Math.sqrt(ex * ex + ez * ez);
    if (!(dist > 1e-6)) continue;
    const need = pad - dist;
    if (need > 0 && (best === null || need > best.need)) best = { x: ex / dist, z: ez / dist, need };
  }
  if (!best) return null;
  const move = Math.min(best.need, maxM);
  return { x: x + best.x * move, z: z + best.z * move };
}
