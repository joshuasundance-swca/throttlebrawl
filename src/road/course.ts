// The course and its edges (the maintainer, 2026-10-06, [decided]: a road race in a physical world with honest
// edges; "consistent physics and gameplay is important here so players know what to expect"). In bounds is the
// road, its verge band, any structure top (and anything standing on it, which is a structure too) and another
// road of the network; everything else is out, and crossing into it has one visible, consistent consequence (a
// quick reset with the time penalty), never an invisible wall (docs/product-spec.md, "World frame";
// docs/architecture.md, "Physical world").
//
// `courseAt` says what a rider at a point would come down on: the highest of those surfaces at or under his
// height, or nothing. Walls are the contact rules' business, not this query's: a rider inside a structure's
// solid gets what lies under it. It reads the road (its own band by the rider's (s, d), another road's by
// projecting the point onto it) and the structure plan (road/structures.ts). Nothing calls it yet (2026-10-06).
//
// Pure + - * / over the road's own queries, in edge and id order: the same network, plan and point give the same
// answer.
import { sRateFactor, type Edge, type RoadNetwork } from './network';
import { structuresAt, topAt, type StructurePlan } from './structures';

/**
 * A surface this little over a rider still counts as under him, m [default]: a rider resting on a top or the road
 * stands exactly on it, give or take the arithmetic.
 */
export const COURSE_STEP_M = 0.05;

/** What a rider at a point would come down on. */
export type CourseSpot =
  /** A road's lanes or its verge band, at that road's (s, d), and the surface's world height there. */
  | {
      readonly kind: 'road';
      readonly edge: number;
      readonly s: number;
      readonly d: number;
      readonly y: number;
    }
  /** A structure's top: its id in the plan and the top's world height there. */
  | { readonly kind: 'top'; readonly id: number; readonly y: number }
  /** Beyond the course. */
  | { readonly kind: 'out' };

const OUT: CourseSpot = { kind: 'out' };

/** The surface's height at (s, d) when it lies on the edge's lanes or verge band, else null. */
function bandHeight(road: RoadNetwork, edge: number, s: number, d: number): number | null {
  const left = road.vergeAt(edge, s, 'left').dOuter;
  const right = road.vergeAt(edge, s, 'right').dOuter;
  return d >= left && d <= right ? road.surfaceHeight(edge, s, d) : null;
}

/** Every edge's samples in a grid of squares as wide as the farthest band's edge from its sample, and a spacing. */
interface RoadIndex {
  cell: number;
  /** Per square: edge and sample index pairs, in edge then sample order. */
  cells: Map<string, number[]>;
}

const indexes = new WeakMap<RoadNetwork, RoadIndex>();

/**
 * The network's sample grid, built on first use. A point on a road or its band lies at most the band's reach
 * across and half a spacing along from one of that road's samples, so with squares that wide the 3 x 3 squares
 * round the point hold it.
 */
function indexOf(road: RoadNetwork): RoadIndex {
  const known = indexes.get(road);
  if (known) return known;
  let cell = 16;
  for (const e of road.edges) {
    for (let i = 0; i < e.count; i++) {
      const s = i * e.spacing < e.length ? i * e.spacing : e.length;
      const left = -road.vergeAt(e.index, s, 'left').dOuter;
      const right = road.vergeAt(e.index, s, 'right').dOuter;
      const reach = (left > right ? left : right) + e.spacing;
      if (reach > cell) cell = reach;
    }
  }
  const cells = new Map<string, number[]>();
  for (const e of road.edges) {
    for (let i = 0; i < e.count; i++) {
      const key = `${Math.floor((e.x[i] ?? 0) / cell)},${Math.floor((e.z[i] ?? 0) / cell)}`;
      const list = cells.get(key);
      if (list) list.push(e.index, i);
      else cells.set(key, [e.index, i]);
    }
  }
  const index = { cell, cells };
  indexes.set(road, index);
  return index;
}

/**
 * The foot of a world point on an edge from its sample `i`: Newton steps on s until the offset is square to the
 * road (as road/network.ts projects), d taken there; `along` is what is left along the road (about 0 for a foot
 * on the edge, not when the point lies past an end).
 */
function footOn(road: RoadNetwork, e: Edge, x: number, z: number, i: number) {
  let s = i * e.spacing;
  let d = 0;
  let along = 0;
  for (let iter = 0; iter < 24; iter++) {
    s = s < 0 ? 0 : s > e.length ? e.length : s;
    const f = road.frameAt(e.index, s);
    const ox = x - f.x;
    const oz = z - f.z;
    d = -ox * f.tz + oz * f.tx;
    along = ox * f.tx + oz * f.tz;
    if (along < 1e-10 && along > -1e-10) break;
    const next = s + along * sRateFactor(f.kappa, d);
    if ((next <= 0 && s === 0) || (next >= e.length && s === e.length)) break;
    s = next;
  }
  return { s, d, along };
}

/**
 * The roads whose lanes or band lie under a world point, other than the rider's own spot: each pass of an edge
 * near the point (a run of its samples there; a road that loops past twice has two) projected onto, in edge then
 * sample order.
 */
function roadsUnder(
  road: RoadNetwork,
  x: number,
  z: number,
  own: { edge: number; s: number },
): { edge: number; s: number; d: number; y: number }[] {
  const index = indexOf(road);
  const ix = Math.floor(x / index.cell);
  const iz = Math.floor(z / index.cell);
  const near: number[][] = [];
  for (let dx = -1; dx <= 1; dx++)
    for (let dz = -1; dz <= 1; dz++) {
      const list = index.cells.get(`${ix + dx},${iz + dz}`);
      if (!list) continue;
      for (let j = 0; j < list.length; j += 2) {
        const e = list[j] ?? 0;
        (near[e] ??= []).push(list[j + 1] ?? 0);
      }
    }
  const out: { edge: number; s: number; d: number; y: number }[] = [];
  near.forEach((samples, edge) => {
    const e = road.edges[edge];
    if (!e) return;
    samples.sort((p, q) => p - q);
    // Each run of neighbouring samples is one pass of the road by the point: its nearest sample starts the foot.
    let best = -1;
    let bestD2 = Infinity;
    const flush = () => {
      if (best < 0) return;
      const p = footOn(road, e, x, z, best);
      best = -1;
      bestD2 = Infinity;
      if (p.along > 1e-3 || p.along < -1e-3) return; // past an end of it
      if (edge === own.edge && p.s - own.s < 1 && own.s - p.s < 1) return; // the rider's own spot
      const y = bandHeight(road, edge, p.s, p.d);
      if (y !== null) out.push({ edge, s: p.s, d: p.d, y });
    };
    for (let k = 0; k < samples.length; k++) {
      const i = samples[k] ?? 0;
      if (k > 0 && i - (samples[k - 1] ?? 0) > 1) flush();
      const ox = x - (e.x[i] ?? 0);
      const oz = z - (e.z[i] ?? 0);
      const d2 = ox * ox + oz * oz;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = i;
      }
    }
    flush();
  });
  return out;
}

/**
 * What a rider at a road position (its own edge, s and d, possibly past the band) and world height `y` would come
 * down on: the highest of its own road there, another road of the network under it and a structure's top under
 * it, at or under `y` (+ COURSE_STEP_M); on a tie its own road, then another road (lowest edge), then a top
 * (lowest id). Out when there is none.
 */
export function courseAt(
  road: RoadNetwork,
  plan: StructurePlan,
  pos: { readonly edge: number; readonly s: number; readonly d: number },
  y: number,
): CourseSpot {
  const limit = y + COURSE_STEP_M;
  const e = road.edges[pos.edge];
  if (!e) return OUT;
  const s = pos.s < 0 ? 0 : pos.s > e.length ? e.length : pos.s;
  let best: CourseSpot = OUT;
  let bestY = -Infinity;
  const own = bandHeight(road, pos.edge, s, pos.d);
  if (own !== null && own <= limit) {
    best = { kind: 'road', edge: pos.edge, s: pos.s, d: pos.d, y: own };
    bestY = own;
  }
  const w = road.toWorld(pos.edge, s, pos.d, 0);
  for (const r of roadsUnder(road, w.x, w.z, { edge: pos.edge, s })) {
    if (r.y <= limit && r.y > bestY) {
      best = { kind: 'road', ...r };
      bestY = r.y;
    }
  }
  for (const st of structuresAt(plan, w.x, w.z)) {
    const top = topAt(st, w.x, w.z);
    if (top !== null && top <= limit && top > bestY) {
      best = { kind: 'top', id: st.id, y: top };
      bestY = top;
    }
  }
  return best;
}

// ---- Another road's lanes near a point: the drawn edge kit's clearance (polish J2) ----
// Render keeps every piece of a road's edge kit (a verge's fence, ferns and hedge, a guard rail, a bridge's rail)
// off another road's lanes where two roads overlap (render/overlap.ts `EdgeLocator.onLanes`), so where a piece is
// left out the sim's edge must hold nothing either (the maintainer, 2026-10-06: "never an invisible wall"). This is
// the same rule, the same arithmetic, on the map (heights aside, as render's): tests/sim/no-invisible-walls.test.ts
// holds the two equal.

/** The cell of the vertex map `lanesNear` searches, m (render/overlap.ts's own). */
const VERTEX_CELL_M = 16;
const VERTEX_STRIDE = 1 << 24;
const vertexKey = (i: number, j: number) => (i + 0x8000) * 0x10000 + (j + 0x8000);

/** Every edge's centre-line vertices by cell, and how far from a vertex a point inside its lanes can lie. */
interface VertexIndex {
  cells: Map<number, number[]>;
  reach: number;
}

const vertexIndexes = new WeakMap<RoadNetwork, VertexIndex>();

function vertexIndexOf(road: RoadNetwork): VertexIndex {
  const known = vertexIndexes.get(road);
  if (known) return known;
  const cells = new Map<number, number[]>();
  let reach = 0;
  for (const e of road.edges) {
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
  const index = { cells, reach: reach + VERTEX_CELL_M / 2 };
  vertexIndexes.set(road, index);
  return index;
}

/** A world point's s and d on an edge from its vertex `best` (three steps), and how far past an end it lies. */
function projectFrom(road: RoadNetwork, e: Edge, x: number, z: number, best: number) {
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

/**
 * Whether a world point stands over the lanes of any edge but `except` (every drive, shoulder and shortcut lane),
 * widened by `margin` m each side: render's rule for keeping a road's edge kit off another road's lanes.
 */
export function lanesNear(road: RoadNetwork, x: number, z: number, except: number, margin = 0): boolean {
  const index = vertexIndexOf(road);
  const reach = index.reach + margin;
  const i0 = Math.floor((x - reach) / VERTEX_CELL_M);
  const i1 = Math.floor((x + reach) / VERTEX_CELL_M);
  const j0 = Math.floor((z - reach) / VERTEX_CELL_M);
  const j1 = Math.floor((z + reach) / VERTEX_CELL_M);
  // The nearest vertex of each edge with one near the point.
  const nearest = new Map<number, { i: number; d2: number }>();
  for (let i = i0; i <= i1; i++) {
    for (let j = j0; j <= j1; j++) {
      for (const v of index.cells.get(vertexKey(i, j)) ?? []) {
        const edge = Math.floor(v / VERTEX_STRIDE);
        if (edge === except) continue;
        const e = road.edges[edge];
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
    const e = road.edges[edge];
    if (!e) continue;
    const p = projectFrom(road, e, x, z, i);
    if (p.past > 0.25) continue;
    let lo = Infinity;
    let hi = -Infinity;
    for (const lane of road.lanesAt(edge, p.s)) {
      lo = Math.min(lo, lane.dCenterM - lane.widthM / 2);
      hi = Math.max(hi, lane.dCenterM + lane.widthM / 2);
    }
    if (lo === Infinity) lo = hi = 0;
    if (p.d > lo - margin && p.d < hi + margin) return true;
  }
  return false;
}
