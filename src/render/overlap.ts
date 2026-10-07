// Where two roads' drawn surfaces overlap (playtest 1b). At a split the shortcut leaves the main
// road sideways, so for tens of metres both are drawn over the same ground. The road builder uses
// this to clip the shortcut against the main road, keep delineator posts off other roads' lanes and
// keep land strips off the asphalt, and (polish J2) keeps every piece of a road's edge kit (verge fence,
// brush, hedge, guardrail, bridge rail and posts, bridge bays) off another road's lanes. It is
// presentation only: the sim decides with its own queries.
import type { Edge, RoadNetwork } from '../road';

export interface EdgeHit {
  edge: number;
  s: number;
  /** Lateral offset on that edge (left negative). */
  d: number;
}

interface Box {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** How far outside an edge's centre line a point may lie and still be looked up, m. */
const REACH_M = 40;

/** Nearest point on one edge's centre line: s, d and how far past an end the point lies. */
function projectOnto(
  road: RoadNetwork,
  e: Edge,
  x: number,
  z: number,
): { s: number; d: number; past: number } {
  let best = 0;
  let bestD2 = Infinity;
  for (let i = 0; i < e.count; i++) {
    const dx = x - (e.x[i] ?? 0);
    const dz = z - (e.z[i] ?? 0);
    const d2 = dx * dx + dz * dz;
    if (d2 < bestD2) {
      bestD2 = d2;
      best = i;
    }
  }
  return projectFrom(road, e, x, z, best);
}

/** The same, starting from the centre line's vertex `best` (the nearest one). */
function projectFrom(
  road: RoadNetwork,
  e: Edge,
  x: number,
  z: number,
  best: number,
): { s: number; d: number; past: number } {
  let s = best * e.spacing;
  let d = 0;
  for (let iter = 0; iter < 3; iter++) {
    const clamped = Math.min(e.length, Math.max(0, s));
    const f = road.frameAt(e.index, clamped);
    const ox = x - f.x;
    const oz = z - f.z;
    d = -ox * f.tz + oz * f.tx;
    s = clamped + ox * f.tx + oz * f.tz;
  }
  const past = s < 0 ? -s : s > e.length ? s - e.length : 0;
  return { s: Math.min(e.length, Math.max(0, s)), d, past };
}

/** The cell size of the vertex map `onLanes` searches, m. */
const VERTEX_CELL_M = 16;

/** The d span of all of an edge's lanes at s (drive, shoulder and shortcut alike), as the ride column reads it. */
export function laneExtentAt(road: RoadNetwork, edge: number, s: number): readonly [number, number] {
  let lo = 0;
  let hi = 0;
  for (const lane of road.lanesAt(edge, s)) {
    lo = Math.min(lo, lane.dCenterM - lane.widthM / 2);
    hi = Math.max(hi, lane.dCenterM + lane.widthM / 2);
  }
  return [lo, hi];
}

/** Looks up which edges lie under a world point. Built once per road scene. */
export class EdgeLocator {
  private readonly boxes: Box[];
  /** The centre line's vertices by cell (built on the first `onLanes`): edge * VERTEX_STRIDE + vertex. */
  private vertexCells: Map<number, number[]> | undefined;
  /** How far from a vertex a point can lie and still be inside the lanes beside it, m. */
  private laneReach = 0;

  constructor(private readonly road: RoadNetwork) {
    this.boxes = road.edges.map((e) => {
      const box = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
      for (let i = 0; i < e.count; i++) {
        box.minX = Math.min(box.minX, e.x[i] ?? 0);
        box.maxX = Math.max(box.maxX, e.x[i] ?? 0);
        box.minZ = Math.min(box.minZ, e.z[i] ?? 0);
        box.maxZ = Math.max(box.maxZ, e.z[i] ?? 0);
      }
      return box;
    });
  }

  /** Every edge (but `except`) whose centre line the point projects onto, within REACH_M across. */
  at(x: number, z: number, except: number): EdgeHit[] {
    const out: EdgeHit[] = [];
    for (const e of this.road.edges) {
      if (e.index === except) continue;
      const b = this.boxes[e.index];
      if (
        !b ||
        x < b.minX - REACH_M ||
        x > b.maxX + REACH_M ||
        z < b.minZ - REACH_M ||
        z > b.maxZ + REACH_M
      ) {
        continue;
      }
      const p = projectOnto(this.road, e, x, z);
      if (p.past > 0.25 || Math.abs(p.d) > REACH_M) continue;
      out.push({ edge: e.index, s: p.s, d: p.d });
    }
    return out;
  }

  /**
   * Whether another edge draws a surface under the point: inside `span(edge, s)` (in that edge's d)
   * of any edge but `except`. `filter` limits which edges count.
   */
  covered(
    x: number,
    z: number,
    except: number,
    span: (edge: Edge, s: number) => readonly [number, number] | null,
    filter: (edge: Edge) => boolean = () => true,
  ): boolean {
    for (const h of this.at(x, z, except)) {
      const e = this.road.edges[h.edge];
      if (!e || !filter(e)) continue;
      const sp = span(e, h.s);
      if (sp && h.d > sp[0] && h.d < sp[1]) return true;
    }
    return false;
  }

  /**
   * Whether a point stands over the lanes of any edge but `except` (every drive, shoulder and shortcut
   * lane), widened by `margin` m on each side. This is how a road's edge kit (a verge's fence, brush
   * and hedge, a guardrail, a bridge's rail and bays) keeps off a sibling road's lanes where two roads
   * overlap at a split or a join: a piece that lies there is drawn across a road the rider rides.
   */
  onLanes(x: number, z: number, except: number, margin = 0): boolean {
    const cells = (this.vertexCells ??= this.indexVertices());
    const reach = this.laneReach + margin;
    const i0 = Math.floor((x - reach) / VERTEX_CELL_M);
    const i1 = Math.floor((x + reach) / VERTEX_CELL_M);
    const j0 = Math.floor((z - reach) / VERTEX_CELL_M);
    const j1 = Math.floor((z + reach) / VERTEX_CELL_M);
    // The nearest vertex of each edge with one near the point.
    const nearest = new Map<number, { i: number; d2: number }>();
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        for (const v of cells.get(vertexKey(i, j)) ?? []) {
          const edge = Math.floor(v / VERTEX_STRIDE);
          if (edge === except) continue;
          const e = this.road.edges[edge];
          if (!e) continue;
          const k = v - edge * VERTEX_STRIDE;
          const dx = x - (e.x[k] ?? 0);
          const dz = z - (e.z[k] ?? 0);
          const d2 = dx * dx + dz * dz;
          const at = nearest.get(edge);
          if (!at || d2 < at.d2) nearest.set(edge, { i: k, d2 });
        }
      }
    }
    for (const [edge, { i }] of nearest) {
      const e = this.road.edges[edge];
      if (!e) continue;
      const p = projectFrom(this.road, e, x, z, i);
      if (p.past > 0.25) continue;
      const [lo, hi] = laneExtentAt(this.road, edge, p.s);
      if (p.d > lo - margin && p.d < hi + margin) return true;
    }
    return false;
  }

  private indexVertices(): Map<number, number[]> {
    const cells = new Map<number, number[]>();
    let reach = 0;
    for (const e of this.road.edges) {
      reach = Math.max(reach, Math.abs(e.dMin), Math.abs(e.dMax), e.spacing);
      for (let k = 0; k < e.count; k++) {
        const key = vertexKey(
          Math.floor((e.x[k] ?? 0) / VERTEX_CELL_M),
          Math.floor((e.z[k] ?? 0) / VERTEX_CELL_M),
        );
        const list = cells.get(key);
        if (list) list.push(e.index * VERTEX_STRIDE + k);
        else cells.set(key, [e.index * VERTEX_STRIDE + k]);
      }
    }
    // A point inside an edge's lanes lies within the lanes' half width of its centre line, and its nearest
    // vertex within half a vertex spacing along it.
    this.laneReach = reach + VERTEX_CELL_M / 2;
    return cells;
  }
}

const VERTEX_STRIDE = 1 << 24;
const vertexKey = (i: number, j: number) => (i + 0x8000) * 0x10000 + (j + 0x8000);
