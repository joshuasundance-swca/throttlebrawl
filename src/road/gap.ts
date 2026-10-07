// road/gap.ts: where a road has no surface, and where a rider who fell through it wakes (playtest
// 3; the maintainer, 2026-10-03: "the 7 mile bridge has an old road parallel to it. Jumps could let
// you get from one to the other"; round 3: "the real 80 m missing span is the big jump (a miss =
// splash, respawn on the highway)"). docs/architecture.md, "Jumps, ramps and airtime". The walls an
// airborne rider may fly over are no longer a flag here: every barrier is, above its top
// (road/beyond.ts, 2026-10-06).
//
// Pure queries over the network's data, + - * / only, like the rest of road/, so the sim reads them:
// sim/riders/gap.ts for the fall, sim/tumble for the bodies and the respawn.
import { sRateFactor, type RoadNetwork, type RoadPos } from './network';
import { gapParams, type BakedFeature } from './types';

/**
 * The `gap` feature whose box (s0..s1 × d0..d1, edges included) holds (s, d) on an edge, or null.
 * An edge's features are sorted by s0, so the scan stops at the first one starting past s.
 */
export function gapAt(road: RoadNetwork, edge: number, s: number, d: number): BakedFeature | null {
  const e = road.edges[edge];
  if (!e) return null;
  for (const f of e.features) {
    if (f.s0 > s) break;
    if (f.kind === 'gap' && s <= f.s1 && d >= f.d0 && d <= f.d1) return f;
  }
  return null;
}

/** The `gap` feature with this id on an edge, or null. */
export function gapById(road: RoadNetwork, edge: number, id: string): BakedFeature | null {
  for (const f of road.edges[edge]?.features ?? []) if (f.kind === 'gap' && f.id === id) return f;
  return null;
}

/** At most this many gaps in a row are stepped over to find ground to wake on. */
const FAR_SIDE_HOPS = 4;

/**
 * Where a rider who fell through gap `f` on `edge`, travelling `dir` along it, wakes on its far side
 * (`params.respawn: 'far'`): `params.respawnPastM` past the end it was heading for, at offset `d`,
 * carried across the road's end onto the next road (a dead end stops at the end). A wake-up spot
 * inside another gap moves on past that one too.
 */
export function gapFarSide(
  road: RoadNetwork,
  edge: number,
  f: BakedFeature,
  dir: 1 | -1,
  d: number,
): RoadPos {
  let pos: RoadPos = { edge, s: 0, d, dir };
  let gap: BakedFeature | null = f;
  for (let hop = 0; gap && hop < FAR_SIDE_HOPS; hop++) {
    const past = gapParams(gap).respawnPastM;
    pos = { edge: pos.edge, s: pos.dir > 0 ? gap.s1 + past : gap.s0 - past, d: pos.d, dir: pos.dir };
    road.advance(pos);
    gap = gapAt(road, pos.edge, pos.s, pos.d);
  }
  return pos;
}

/**
 * The nearest point to the world point (x, z) on any of `edges` (`params.respawn: 'main'`: the
 * route's main road nearest the splash): edge, s and d, dir 1. Null for no edges. Each edge is
 * searched over its samples, then refined as road.project does; ties go to the earlier edge listed.
 */
export function nearestOnEdges(
  road: RoadNetwork,
  edges: readonly number[],
  x: number,
  z: number,
): RoadPos | null {
  let best: RoadPos | null = null;
  let bestDist = Infinity;
  for (const idx of edges) {
    const e = road.edges[idx];
    if (!e) continue;
    let near = 0;
    let nearD2 = Infinity;
    for (let i = 0; i < e.count; i++) {
      const dx = x - (e.x[i] ?? 0);
      const dz = z - (e.z[i] ?? 0);
      const d2 = dx * dx + dz * dz;
      if (d2 < nearD2) {
        nearD2 = d2;
        near = i;
      }
    }
    let s = near * e.spacing;
    // A few Newton steps: move s until the offset is square to the tangent.
    for (let iter = 0; iter < 6; iter++) {
      s = s < 0 ? 0 : s > e.length ? e.length : s;
      const f = road.frameAt(idx, s);
      const ox = x - f.x;
      const oz = z - f.z;
      s += (ox * f.tx + oz * f.tz) * sRateFactor(f.kappa, -ox * f.tz + oz * f.tx);
    }
    s = s < 0 ? 0 : s > e.length ? e.length : s;
    const f = road.frameAt(idx, s);
    const ox = x - f.x;
    const oz = z - f.z;
    const d = -ox * f.tz + oz * f.tx;
    const along = ox * f.tx + oz * f.tz;
    const dist = d * d + along * along;
    if (dist < bestDist) {
      bestDist = dist;
      best = { edge: idx, s, d, dir: 1 };
    }
  }
  return best;
}
