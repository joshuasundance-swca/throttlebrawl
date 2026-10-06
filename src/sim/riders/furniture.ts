// Street furniture and solid hazards, met by a rider (playtest 4, the maintainer, 2026-10-05: street
// furniture is "solid but maybe forgiving to sides, brushes, etc"). The pieces stand where
// road/furniture.ts plans them (render draws the same plan); this module is the contact's geometry:
// - the bike is a capsule along its heading: its spine runs BIKE_SPINE_HALF_M either way of its centre
//   and its radius is the rider box's half width, so it is the rider box (2.0 by 0.8 m,
//   sim/riders/contact.ts) with round ends;
// - a piece is its drawn footprint: a circle (a pole, a trunk, a hydrant) or a box (a bench, a planter, a
//   parked car), in the road frame (s along, d across, metres);
// - a contact is the first moment along the tick's move that the two touch, and its normal points from
//   the piece to the bike there. The closing speed is the bike's velocity along that normal, and the one
//   rule for meeting something heavy decides (sim/traffic/contact-rule.ts, #552: at or over
//   `traffic.solidHitMps` it is a crash, under it a wobble). Square on, the normal is the bike's own
//   heading and the whole speed closes; a glance off the side or the round of the front closes only the
//   part of it along the normal, so it wobbles and the bike slides along the piece.
// Leaf module (core and road only), so sim/riders reads it without a cycle.
import { atan2, cos, sin, type TuningParamDecl } from '../../core';
import { planStreetFurniture, type FurnitureShape, type StreetFurniture } from '../../road';
import type { SimConfig } from '../types';
import { RIDER_CONTACT_HALF_WIDTH_M, RIDER_HALF_LENGTH_M } from './contact';

/** The switch: street furniture is met (1) or ridden through as before (0). */
export const FURNITURE_KEY = 'riders.furniture';

export const FURNITURE_TUNING: readonly TuningParamDecl[] = [
  {
    // Playtest 4 ("solid but forgiving"): riders meet the street furniture that stands on a sidewalk or a
    // plaza (road/furniture.ts). On by default [default]; a race whose tuning leaves it out (every
    // recording made before) rides through it, as before.
    id: FURNITURE_KEY,
    group: 'crashes',
    label: 'Street furniture is solid (0 off, 1 on)',
    default: 1,
    min: 0,
    max: 1,
    step: 1,
    unit: '',
    affectsSim: true,
    system: true,
  },
];

/** Whether this race's riders meet the street furniture. */
export function furnitureOn(params: Readonly<Record<string, number>>): boolean {
  return (params[FURNITURE_KEY] ?? 0) >= 0.5;
}

/** The bike's capsule: half its spine along its heading, and its radius, m. */
export const BIKE_RADIUS_M = RIDER_CONTACT_HALF_WIDTH_M;
export const BIKE_SPINE_HALF_M = RIDER_HALF_LENGTH_M - RIDER_CONTACT_HALF_WIDTH_M;

/**
 * A light piece ridden through (a meter, a bin, a board, a scooter): the parking meter's ride-through
 * from sim/smash (`KIND_SPEC['parking-meter']`: the speed kept and the heading kick, radians), so a
 * light piece costs what a smashable of its kind does. furniture.test.ts holds the two equal.
 */
export const LIGHT_SCRUB = 0.96;
export const LIGHT_KICK = 0.12;

/** The race's pieces (the plan for its network and seed). */
export function furnitureOf(config: SimConfig): readonly StreetFurniture[] {
  return planStreetFurniture(config.road, config.seed).items;
}

/** The pieces on an edge whose footprint may reach within `reach` of s. */
export function piecesNear(config: SimConfig, edge: number, s: number, reach: number): StreetFurniture[] {
  const plan = planStreetFurniture(config.road, config.seed);
  const list = plan.byEdge[edge];
  if (!list || list.length === 0) return [];
  const out: StreetFurniture[] = [];
  // Sorted by the footprint's low s: skip those whose low s is past s + reach; the rest are checked.
  const hi = s + reach;
  const lo = s - reach - 2 * plan.reachS;
  for (const it of list) {
    const low = it.shape.s - it.shape.reachS;
    if (low > hi) break;
    if (low + 2 * it.shape.reachS < lo) continue;
    if (Math.abs(it.shape.s - s) <= reach + it.shape.reachS) out.push(it);
  }
  return out;
}

/**
 * Whether a road-aligned box (centre s, d; half sizes along and across) overlaps a street piece's
 * footprint box (sim/smash keeps its props out of the street's furniture with it).
 */
export function furnitureOverlaps(
  config: SimConfig,
  edge: number,
  s: number,
  d: number,
  halfS: number,
  halfD: number,
): boolean {
  return piecesNear(config, edge, s, halfS).some(
    (it) =>
      Math.abs(it.shape.s - s) < halfS + it.shape.reachS &&
      Math.abs(it.shape.d - d) < halfD + it.shape.reachD,
  );
}

/** The bike's spine at a pose: its two ends in the road frame. */
export interface Spine {
  as: number;
  ad: number;
  bs: number;
  bd: number;
}

/** The spine of a bike centred at (s, d) heading `yaw` off its direction of travel `dir`. */
export function spineAt(s: number, d: number, dir: 1 | -1, yaw: number): Spine {
  const hs = dir * cos(yaw) * BIKE_SPINE_HALF_M;
  const hd = dir * sin(yaw) * BIKE_SPINE_HALF_M;
  return { as: s - hs, ad: d - hd, bs: s + hs, bd: d + hd };
}

/** The distance from a footprint to a spine, and the unit normal from the footprint to it there. */
export interface Gap {
  dist: number;
  ns: number;
  nd: number;
}

/** A point's distance to a shape (a circle or a box), and the unit vector from the shape to it. */
function pointGap(shape: FurnitureShape, ps: number, pd: number): Gap {
  const rs = ps - shape.s;
  const rd = pd - shape.d;
  if (shape.r > 0) {
    const len = Math.sqrt(rs * rs + rd * rd);
    if (len < 1e-9) return { dist: -shape.r, ns: 1, nd: 0 };
    return { dist: len - shape.r, ns: rs / len, nd: rd / len };
  }
  // In the box's own axes: u along (us, ud), v along (-ud, us).
  const u = rs * shape.us + rd * shape.ud;
  const v = -rs * shape.ud + rd * shape.us;
  const ou = Math.abs(u) - shape.hu;
  const ov = Math.abs(v) - shape.hv;
  if (ou <= 0 && ov <= 0) {
    // Inside: out by the nearer face.
    const su = u < 0 ? -1 : 1;
    const sv = v < 0 ? -1 : 1;
    if (ou > ov) return { dist: ou, ns: su * shape.us, nd: su * shape.ud };
    return { dist: ov, ns: -sv * shape.ud, nd: sv * shape.us };
  }
  const cu = ou > 0 ? (u < 0 ? -1 : 1) * ou : 0;
  const cv = ov > 0 ? (v < 0 ? -1 : 1) * ov : 0;
  const len = Math.sqrt(cu * cu + cv * cv);
  const nu = cu / len;
  const nv = cv / len;
  return { dist: len, ns: nu * shape.us - nv * shape.ud, nd: nu * shape.ud + nv * shape.us };
}

/** The point of a spine at t (0 its rear end, 1 its front). */
const along = (sp: Spine, t: number): [number, number] => [
  sp.as + (sp.bs - sp.as) * t,
  sp.ad + (sp.bd - sp.ad) * t,
];

/**
 * The gap between a footprint and a spine (the spine's nearest point, so the capsule's surface is
 * `dist - BIKE_RADIUS_M` off the piece). A point's distance to a convex shape is convex along a
 * segment, so a fixed number of golden-section steps finds its least (deterministic: + - * / and sqrt).
 */
export function spineGap(shape: FurnitureShape, sp: Spine): Gap {
  let a = 0;
  let b = 1;
  const g = 0.6180339887498949;
  let c = b - g * (b - a);
  let d = a + g * (b - a);
  let fc = pointGap(shape, ...along(sp, c)).dist;
  let fd = pointGap(shape, ...along(sp, d)).dist;
  for (let i = 0; i < 28; i++) {
    if (fc < fd) {
      b = d;
      d = c;
      fd = fc;
      c = b - g * (b - a);
      fc = pointGap(shape, ...along(sp, c)).dist;
    } else {
      a = c;
      c = d;
      fc = fd;
      d = a + g * (b - a);
      fd = pointGap(shape, ...along(sp, d)).dist;
    }
  }
  let best = pointGap(shape, ...along(sp, (a + b) / 2));
  for (const t of [0, 1]) {
    const q = pointGap(shape, ...along(sp, t));
    if (q.dist < best.dist) best = q;
  }
  return best;
}

/** A contact found along a tick's move (with a street piece, or a solid hazard). */
export interface FurnitureHit<T extends { shape: FurnitureShape } = StreetFurniture> {
  piece: T;
  /** How far along the move the two first touch (0 at its start, 1 at its end). */
  t: number;
  /** The unit normal from the piece to the bike there. */
  ns: number;
  nd: number;
  /** Whether they were already touching at the move's start. */
  held: boolean;
}

/**
 * The first piece a bike moving from (s0, d0) to (s1, d1) on one edge (heading `yaw`, travelling `dir`)
 * touches, and where; null for none. `pieces` are the candidates (`piecesNear`, or the solid hazards).
 */
export function firstTouch<T extends { shape: FurnitureShape }>(
  pieces: readonly T[],
  s0: number,
  d0: number,
  s1: number,
  d1: number,
  dir: 1 | -1,
  yaw: number,
): FurnitureHit<T> | null {
  let best: FurnitureHit<T> | null = null;
  for (const piece of pieces) {
    const end = spineGap(piece.shape, spineAt(s1, d1, dir, yaw));
    if (end.dist >= BIKE_RADIUS_M) continue;
    const start = spineGap(piece.shape, spineAt(s0, d0, dir, yaw));
    if (start.dist < BIKE_RADIUS_M) {
      // Already touching as the move starts (sliding along it, or put down against it): held, normal now.
      const hit = { piece, t: 0, ns: end.ns, nd: end.nd, held: true };
      if (!best) best = hit;
      continue;
    }
    // Bisect the move for the moment the capsule first touches it.
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 14; i++) {
      const mid = (lo + hi) / 2;
      const g = spineGap(piece.shape, spineAt(s0 + (s1 - s0) * mid, d0 + (d1 - d0) * mid, dir, yaw));
      if (g.dist < BIKE_RADIUS_M) hi = mid;
      else lo = mid;
    }
    const at = spineGap(piece.shape, spineAt(s0 + (s1 - s0) * lo, d0 + (d1 - d0) * lo, dir, yaw));
    if (!best || best.held || lo < best.t) best = { piece, t: lo, ns: at.ns, nd: at.nd, held: false };
  }
  return best;
}

/**
 * The closing speed of a bike (speed `v`, heading `yaw` off its direction of travel `dir`) along a
 * contact normal (from the piece to the bike): how fast it moves into the piece, m/s; 0 moving away.
 */
export function closingMps(v: number, dir: 1 | -1, yaw: number, ns: number, nd: number): number {
  const vs = dir * v * cos(yaw);
  const vd = dir * v * sin(yaw);
  const c = -(vs * ns + vd * nd);
  return c > 0 ? c : 0;
}

/**
 * The bike's speed and heading after it slides along a piece: its velocity less the part into the
 * piece along the normal. The heading stays off its direction of travel by less than a quarter turn
 * (a bike slides along a piece or stops against it; it never turns back).
 */
export function slideAlong(
  v: number,
  dir: 1 | -1,
  yaw: number,
  ns: number,
  nd: number,
): { speed: number; yaw: number } {
  const vs = dir * v * cos(yaw);
  const vd = dir * v * sin(yaw);
  const into = vs * ns + vd * nd;
  if (into >= 0) return { speed: v, yaw };
  let ws = vs - into * ns;
  const wd = vd - into * nd;
  if (ws * dir < 0) ws = 0;
  const speed = Math.sqrt(ws * ws + wd * wd);
  if (speed < 1e-6) return { speed: 0, yaw };
  return { speed, yaw: atan2(dir * wd, dir * ws) };
}
