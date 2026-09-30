// The on-foot run-back (docs/architecture.md, "Crash tumble", hand-back): the rider runs to the
// parked bike in road coordinates (s, d), across a junction if need be, and the player can steer
// sideways to dodge traffic. Distances here are metres on the ground, not raw s.
import { atan2, clamp } from '../../core';
import { sRateFactor, type RoadNetwork, type RoadPos } from '../../road';
import { standingBand } from './body';

/** Within this many metres of the bike, the rider climbs back on. */
export const REMOUNT_M = 1;
/** Closer than this, steering no longer pulls the runner off line (so the run always ends). */
const DODGE_OFF_M = 3;
/** Sideways speed the player can add while running, m/s. */
const DODGE_MPS = 3.5;

/** The offset from `a` to `b` in `a`'s edge coordinates (s and d units), across one junction. */
export function roadDelta(road: RoadNetwork, a: RoadPos, b: RoadPos): { ds: number; dd: number } {
  if (a.edge === b.edge) return { ds: b.s - a.s, dd: b.d - a.d };
  const ea = road.edges[a.edge];
  const eb = road.edges[b.edge];
  if (ea && eb) {
    // Leaving through the `to` end (increasing s).
    if (ea.next?.edge === b.edge) {
      const flipped = ea.next.entersAt === 'to';
      const past = flipped ? eb.length - b.s : b.s;
      return { ds: ea.length - a.s + past, dd: (flipped ? -b.d : b.d) - a.d };
    }
    // Leaving through the `from` end (decreasing s).
    if (ea.prev?.edge === b.edge) {
      const flipped = ea.prev.entersAt === 'from';
      const past = flipped ? b.s : eb.length - b.s;
      return { ds: -(a.s + past), dd: (flipped ? -b.d : b.d) - a.d };
    }
  }
  // Not adjacent (a very long slide): aim through the world, in a's local frame.
  const wa = road.toWorld(a.edge, a.s, a.d, 0);
  const wb = road.toWorld(b.edge, b.s, b.d, 0);
  const f = road.frameAt(a.edge, a.s);
  const dx = wb.x - wa.x;
  const dz = wb.z - wa.z;
  return { ds: dx * f.tx + dz * f.tz, dd: -dx * f.tz + dz * f.tx };
}

/** Ground distance from a runner to the bike, in metres. */
export function runDistance(road: RoadNetwork, a: RoadPos, b: RoadPos): number {
  const { ds, dd } = roadDelta(road, a, b);
  const dsM = ds / sRateFactor(road.kappaAt(a.edge, a.s), a.d);
  return Math.sqrt(dsM * dsM + dd * dd);
}

export interface RunStep {
  /** Metres moved this tick. */
  moved: number;
  /** Heading offset from the travel direction, for render. */
  yaw: number;
}

/**
 * Moves a runner one tick toward the bike at `speedMps` (dt already scaled). `steer` (−1..1, the
 * runner's right is positive) adds a sideways dodge while the bike is still far. Mutates `pos`.
 */
export function stepRunner(
  road: RoadNetwork,
  pos: RoadPos,
  bike: RoadPos,
  speedMps: number,
  steer: number,
  dt: number,
  yaw: number,
): RunStep {
  const { ds, dd } = roadDelta(road, pos, bike);
  const factor = sRateFactor(road.kappaAt(pos.edge, pos.s), pos.d);
  const dsM = ds / factor;
  const dist = Math.sqrt(dsM * dsM + dd * dd);
  if (dist <= 1e-9 || dt <= 0) return { moved: 0, yaw };
  const step = Math.min(speedMps * dt, dist);
  const alongM = (dsM / dist) * step;
  let across = (dd / dist) * step;
  if (dist > DODGE_OFF_M && steer !== 0) {
    // The runner's right: +d when running toward increasing s, −d when running back.
    const facing = alongM >= 0 ? 1 : -1;
    across += clamp(steer, -1, 1) * DODGE_MPS * dt * facing;
  }
  const dir = pos.dir;
  pos.s += alongM * factor;
  const band = standingBand(road, pos.edge, pos.s < 0 ? 0 : pos.s);
  pos.d = clamp(pos.d + across, band.lo, band.hi);
  road.advance(pos);
  const inBand = standingBand(road, pos.edge, pos.s);
  pos.d = clamp(pos.d, inBand.lo, inBand.hi);
  // Face the way the runner moves: forward is the travel direction, right is the rider's right.
  const newYaw = atan2(across * dir, alongM * dir);
  return { moved: Math.sqrt(alongM * alongM + across * across), yaw: newYaw };
}
