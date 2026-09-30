// Where two roads' drawn surfaces overlap (playtest 1b). At a split the shortcut leaves the main
// road sideways, so for tens of metres both are drawn over the same ground. The road builder uses
// this to clip the shortcut against the main road, keep delineator posts off other roads' lanes and
// keep land strips off the asphalt. It is presentation only: the sim decides with its own queries.
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

/** Looks up which edges lie under a world point. Built once per road scene. */
export class EdgeLocator {
  private readonly boxes: Box[];

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
}
