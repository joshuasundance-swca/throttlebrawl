// Lane drops for riders (W-R; interview, 2026-10-02: "multi-lane highways (4-6 lanes, lane
// splitting)"). Where the road narrows ahead of a rider (a lane that ends, a highway into a two-lane
// road), the edge on that side comes in as a smooth funnel over `riders.laneDropTaperM` (90 m)
// instead of standing as a wall at the drop: a rider outside the funnel is eased in (no barrier
// event, no scrape, its heading's push toward that edge dropped), so it reaches the narrow road
// inside it. On roads whose width does not change near the rider nothing is computed and riding is
// exactly as before. Deterministic: road queries and + - * / only; the per-network table of edges
// with a width change on or beside them is derived once from the road data and never changes.
import type { TuningParamDecl, TuningValues } from '../../core';
import type { EdgeLink, RoadNetwork, RoadPos } from '../../road';
import { rideLimits } from '../ground';

export const FUNNEL_TUNING: readonly TuningParamDecl[] = [
  {
    id: 'riders.laneDropTaperM',
    group: 'steering',
    label: 'Lane drop: edge eases in over (0 off)',
    default: 90,
    min: 0,
    max: 250,
    step: 5,
    unit: 'm',
    affectsSim: true,
  },
];

/**
 * The limits the funnel eases a rider toward: the same riding limits the barrier rule holds it in
 * (sim/ground's `rideLimits`: the lanes' edges with `ground.offRoad` off, exactly the riders'
 * barrierLimits, and each verge band's outer edge with it on), so a rider out on the verge beside a
 * lane drop is never pulled back onto the road.
 */
export function ridingLimitsAt(
  road: RoadNetwork,
  params: TuningValues,
  halfWidthM: number,
): (edge: number, s: number) => { lo: number; hi: number } {
  return (edge, s) => {
    const l = rideLimits(road, params, edge, s, halfWidthM);
    return { lo: l.lo, hi: l.hi };
  };
}

/** How far apart the funnel samples the road ahead, m. */
const STEP_M = 5;

type Limits = { lo: number; hi: number };
type LimitsAt = (edge: number, s: number) => Limits;

/** The outer drivable edges of the lanes at (edge, s): what the barrier rule walls a rider inside. */
function outer(road: RoadNetwork, edge: number, s: number): Limits {
  let lo = 0;
  let hi = 0;
  for (const lane of road.lanesAt(edge, s)) {
    lo = Math.min(lo, lane.dCenterM - lane.widthM / 2);
    hi = Math.max(hi, lane.dCenterM + lane.widthM / 2);
  }
  return { lo, hi };
}

const changeTables = new WeakMap<RoadNetwork, Uint8Array>();

/**
 * Per edge, 1 when the road's width changes on it or where it joins a neighbour (so a funnel may be
 * needed near it), 0 when every lane section and every join keeps the same outer edges.
 */
function changeTable(road: RoadNetwork): Uint8Array {
  const known = changeTables.get(road);
  if (known) return known;
  const out = new Uint8Array(road.edges.length);
  const same = (a: Limits, b: Limits) => a.lo === b.lo && a.hi === b.hi;
  for (const e of road.edges) {
    const first = outer(road, e.index, 0);
    if (e.sections.some((sec) => !same(outer(road, e.index, sec.s0), first))) out[e.index] = 1;
    for (const [end, s] of [
      ['to', e.length],
      ['from', 0],
    ] as const) {
      const here = outer(road, e.index, s);
      for (const l of road.nextEdges(e.index, end)) {
        if (l.splitZone || l.dShift) continue; // a branch, not a narrowing of this road
        const there = outer(road, l.edge, l.entersAt === 'from' ? 0 : (road.edges[l.edge]?.length ?? 0));
        const flipped = l.entersAt === end;
        const mapped = flipped ? { lo: -there.hi, hi: -there.lo } : there;
        if (!same(mapped, here)) {
          out[e.index] = 1;
          out[l.edge] = 1;
        }
      }
    }
  }
  changeTables.set(road, out);
  return out;
}

/**
 * Whether an edge with a width change lies within `taperM` ahead of pos along the default ways on
 * (branches aside): the cheap test that leaves every road without one exactly as before.
 */
function changeWithin(road: RoadNetwork, taperM: number, pos: RoadPos): boolean {
  const table = changeTable(road);
  let edge = pos.edge;
  let dir = pos.dir;
  let e = road.edges[edge];
  if (!e) return false;
  let reach = dir === 1 ? e.length - pos.s : pos.s;
  for (let hops = 0; hops < 16; hops++) {
    if (table[edge]) return true;
    if (reach >= taperM) return false;
    const link: EdgeLink | null = dir === 1 ? e.next : e.prev;
    if (!link) return false;
    edge = link.edge;
    dir = link.entersAt === 'from' ? 1 : -1;
    e = road.edges[edge];
    if (!e) return false;
    reach += e.length;
  }
  return false;
}

/** Bisection steps that place a width change between two samples (5 m / 2^8: about 2 cm). */
const REFINE_STEPS = 8;
/**
 * The funnel is fully in this far before the change, m: more than a tick's travel at any speed, so a
 * rider crosses the change already inside the narrower road.
 */
const LEAD_M = 2;

/**
 * A rider's limits where the road narrows within `taperM` ahead in its travel direction, or null
 * when nothing narrows (then the barrier rule applies as before). `limitsAt` gives the barrier
 * limits at a road position (the outer lane edges less half a bike). At a change x metres ahead
 * that brings an edge in to k, the edge here is k + (now - k) · x / taperM: it reaches k exactly at
 * the change (x is found to about 2 cm), and moves smoothly as the rider rides on.
 */
export function funnelLimits(
  road: RoadNetwork,
  taperM: number,
  pos: RoadPos,
  limitsAt: LimitsAt,
): Limits | null {
  if (!(taperM > 0)) return null;
  if (!changeWithin(road, taperM, pos)) return null;
  const now = limitsAt(pos.edge, pos.s);
  /** The limits x metres ahead, in the rider's frame, or null past a dead end. */
  const at = (x: number): Limits | null => {
    const p: RoadPos = { edge: pos.edge, s: pos.s + pos.dir * x, d: 0, dir: pos.dir };
    if (road.advance(p) === 'deadEnd') return null;
    const l = limitsAt(p.edge, p.s);
    // Back into the rider's frame: d there = σ·d here + shift, where `p.d` is the image of 0.
    return p.dir !== pos.dir ? { lo: -(l.hi - p.d), hi: -(l.lo - p.d) } : { lo: l.lo - p.d, hi: l.hi - p.d };
  };
  /** Where between a and b (a wide, b narrowed on that side) the edge first comes in. */
  const refine = (a: number, b: number, narrowed: (l: Limits) => boolean): number => {
    let lo = a;
    let hi = b;
    for (let i = 0; i < REFINE_STEPS; i++) {
      const mid = (lo + hi) / 2;
      const l = at(mid);
      if (!l || narrowed(l)) hi = mid;
      else lo = mid;
    }
    return hi;
  };
  let lo = now.lo;
  let hi = now.hi;
  let narrower = false;
  let prev = now;
  for (let x = STEP_M; x <= taperM; x += STEP_M) {
    const k = at(x);
    if (!k) break;
    if (k.hi < prev.hi) {
      const edge = prev.hi;
      const xc = Math.max(0, refine(x - STEP_M, x, (l) => l.hi < edge) - LEAD_M);
      const e = k.hi + (now.hi - k.hi) * (xc / taperM);
      if (e < hi) {
        hi = e;
        narrower = true;
      }
    }
    if (k.lo > prev.lo) {
      const edge = prev.lo;
      const xc = Math.max(0, refine(x - STEP_M, x, (l) => l.lo > edge) - LEAD_M);
      const e = k.lo + (now.lo - k.lo) * (xc / taperM);
      if (e > lo) {
        lo = e;
        narrower = true;
      }
    }
    prev = k;
  }
  return narrower ? { lo, hi } : null;
}
