// Which road's lanes lie under a world point (the maintainer, 2026-10-06: "a road race in a physical world
// with honest edges"). Whatever stands beside a road (a street lamp, a planter, a billboard, a set piece's
// warning sign) must stand off the lanes of every road, not only its own: where two roads run close (a
// shortcut through a plaza, a branch leaving, a road beside another), a piece placed by one road's rule can
// stand on the other's lanes, where a rider rides into it (a solid thing in a lane) or through it (a ghost).
// The roads' own `project` searches one edge and its neighbours; this looks at every edge near the point,
// from a grid of their centre lines. Pure + - * / and core math, like the rest of road/.
import type { RoadNetwork } from './network';

/** A road whose lanes lie under a point: the edge, and the point's s and d on it. */
export interface LaneHit {
  edge: number;
  s: number;
  d: number;
}

/** The grid's cell, m, and how far round a point it looks for centre lines (wider than any road's half). */
const CELL_M = 16;
const LOOK_M = 32;
/** A road more than this far above or below the point is a bridge over it or a road under it, m. [default] */
export const LANES_UNDER_Y_M = 3;

interface Station {
  edge: number;
  s: number;
  x: number;
  z: number;
}

export class LanesUnder {
  private readonly cells = new Map<string, Station[]>();

  constructor(private readonly road: RoadNetwork) {
    for (const e of road.edges)
      for (let i = 0; i < e.count; i++) {
        const st = { edge: e.index, s: Math.min(e.length, i * e.spacing), x: e.x[i] ?? 0, z: e.z[i] ?? 0 };
        const k = `${Math.floor(st.x / CELL_M)},${Math.floor(st.z / CELL_M)}`;
        const list = this.cells.get(k);
        if (list) list.push(st);
        else this.cells.set(k, [st]);
      }
  }

  /**
   * The first road whose lanes, widened by `margin` past their outer edges, lie under (x, z) within
   * LANES_UNDER_Y_M of `y`; or null. `skip` passes over a hit (a piece's own road near its own spot).
   */
  at(
    x: number,
    y: number,
    z: number,
    margin: number,
    skip: (edge: number, s: number) => boolean = () => false,
  ): LaneHit | null {
    const road = this.road;
    const reach = Math.ceil(LOOK_M / CELL_M);
    const ci = Math.floor(x / CELL_M);
    const cj = Math.floor(z / CELL_M);
    const tried = new Set<string>();
    for (let i = ci - reach; i <= ci + reach; i++)
      for (let j = cj - reach; j <= cj + reach; j++)
        for (const st of this.cells.get(`${i},${j}`) ?? []) {
          if ((st.x - x) * (st.x - x) + (st.z - z) * (st.z - z) > LOOK_M * LOOK_M) continue;
          const e = road.edges[st.edge];
          if (!e) continue;
          // Square to the centre line from this station (a few steps along the tangent).
          let s = st.s;
          let d = 0;
          for (let k = 0; k < 4; k++) {
            const c = Math.max(0, Math.min(e.length, s));
            const f = road.frameAt(e.index, c);
            const ox = x - f.x;
            const oz = z - f.z;
            d = -ox * f.tz + oz * f.tx;
            s = c + ox * f.tx + oz * f.tz;
          }
          const past = s < 0 ? -s : s > e.length ? s - e.length : 0;
          if (past > 0.25) continue;
          s = Math.max(0, Math.min(e.length, s));
          const key = `${e.index}:${Math.round(s)}`;
          if (tried.has(key)) continue;
          tried.add(key);
          let lo = 0;
          let hi = 0;
          for (const lane of road.lanesAt(e.index, s)) {
            lo = Math.min(lo, lane.dCenterM - lane.widthM / 2);
            hi = Math.max(hi, lane.dCenterM + lane.widthM / 2);
          }
          if (d <= lo - margin || d >= hi + margin) continue;
          if (Math.abs(road.toWorld(e.index, s, d, 0).y - y) > LANES_UNDER_Y_M) continue;
          if (skip(e.index, s)) continue;
          return { edge: e.index, s, d };
        }
    return null;
  }
}

const finders = new WeakMap<RoadNetwork, LanesUnder>();

/** A network's lane finder, built once. */
export function lanesUnderOf(road: RoadNetwork): LanesUnder {
  let f = finders.get(road);
  if (!f) finders.set(road, (f = new LanesUnder(road)));
  return f;
}

/** How far a thing moves out per try while it looks for a spot off every road's lanes, m. */
const STAND_OFF_STEP_M = 0.25;

/**
 * Where across `edge` at s a thing `half` wide (across the road, round its middle) stands with all of it at least
 * `margin` off every road's lanes: from `d0` on out (`side` +1 is increasing d) a STAND_OFF_STEP_M at a time, at
 * most `maxMove` further; or null when no spot within that is clear.
 */
export function standOffLanes(
  road: RoadNetwork,
  edge: number,
  s: number,
  side: 1 | -1,
  d0: number,
  half: number,
  margin: number,
  maxMove: number,
): number | null {
  const finder = lanesUnderOf(road);
  const n = Math.max(1, Math.ceil((2 * half) / 0.5));
  for (let move = 0; move <= maxMove + 1e-6; move += STAND_OFF_STEP_M) {
    const d = d0 + side * move;
    let clear = true;
    for (let k = 0; k <= n && clear; k++) {
      const p = road.toWorld(edge, s, d - half + (k * 2 * half) / n, 0);
      if (finder.at(p.x, p.y, p.z, margin)) clear = false;
    }
    if (clear) return d;
  }
  return null;
}
