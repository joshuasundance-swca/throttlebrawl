// Pedestrians keep a supporting floor separately from their intentional hop/dive arc.
// The floor's previous height is necessary at bridges: the highest face at a world point
// can be another deck. Plain groundY state carries that continuity and is world-hashed.
import { groundUnderOf, roadBandHeight, sectionGroundOf, terrainAt, type RoadNetwork } from '../../road';

/** A person's maximum supported step, and the longest interval examined along a path, metres. */
const STEP_M = 0.25;
const PROBE_M = 0.25;
type Position = { edge: number; s: number; d: number };
type Body = { lengthM: number; widthM: number };

function dry(road: RoadNetwork, pos: Position, y: number): boolean {
  const p = road.toWorld(pos.edge, pos.s, pos.d, 0);
  const face = terrainAt(road.terrain, p.x, p.z);
  return face?.surface !== 'water' || face.y < y - 1e-6;
}

/** The authored spot's own road/zone/source support, never another road above or below it. */
export function initialPedGround(road: RoadNetwork, pos: Position): number | null {
  const y = roadBandHeight(road, pos.edge, pos.s, pos.d) ?? sectionGroundOf(road)(pos.edge, pos.s, pos.d);
  return y !== null && dry(road, pos, y) ? y : null;
}

/** One connected step: reject missing ground, water, a drop or an unrelated deck. */
function support(road: RoadNetwork, pos: Position, previous: number): number | null {
  const p = road.toWorld(pos.edge, pos.s, pos.d, 0);
  const y = groundUnderOf(road)(p.x, p.z, previous + STEP_M);
  return y !== null && previous - y <= STEP_M && dry(road, pos, y) ? y : null;
}

/** Longitudinal/lateral footprint, not just the happy centre point. */
function bodySupport(road: RoadNetwork, pos: Position, previous: number, body: Body): number | null {
  const y = support(road, pos, previous);
  if (y === null) return null;
  for (const ds of [-body.lengthM / 2, 0, body.lengthM / 2])
    for (const dd of [-body.widthM / 2, 0, body.widthM / 2])
      if (ds !== 0 || dd !== 0)
        if (support(road, { edge: pos.edge, s: pos.s + ds, d: pos.d + dd }, y) === null) return null;
  return y;
}

/**
 * Furthest continuously supported point toward a target. A dive is at most 3.5 m and
 * ordinary walking asks only for a tick's distance; this never scans a whole route.
 * All queries reuse the road module's spatial/ground caches.
 */
export function supportedPedMove(
  road: RoadNetwork,
  from: Position,
  to: { s: number; d: number },
  groundY: number,
  body: Body,
): { s: number; d: number; y: number } {
  const ds = to.s - from.s,
    dd = to.d - from.d;
  const n = Math.max(1, Math.ceil(Math.sqrt(ds * ds + dd * dd) / PROBE_M));
  let last = { s: from.s, d: from.d, y: groundY };
  for (let i = 1; i <= n; i++) {
    const s = from.s + ds * (i / n),
      d = from.d + dd * (i / n);
    const y = bodySupport(road, { edge: from.edge, s, d }, last.y, body);
    if (y === null) break;
    last = { s, d, y };
  }
  return last;
}
