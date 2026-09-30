// The road network model and its queries (docs/architecture.md, "Road network"). Built once at
// load from baked samples, with core-safe maths only (+ - * / and sqrt), so every engine derives
// the same tables. Sign rules, defined here once:
//   s  metres along an edge from its `from` junction (0..L);
//   d  metres across, positive to the right when facing increasing s;
//   kappa positive when the road turns right (toward positive d);
//   bank positive when the surface tilts down toward positive d.
// World frame: x east, y up, z south. The right of a horizontal tangent (tx, tz) is (-tz, tx).
import { cos, sin, type LaneInfo } from '../core';
import type { BakedBarrier, BakedFeature, BakedNetworkBundle, BakedRoad, BakedTag } from './types';

/** How a mover leaving one edge enters the next: at the next edge's `from` or `to` end. */
export interface EdgeLink {
  edge: number;
  entersAt: 'from' | 'to';
}

export interface Edge {
  index: number;
  id: string;
  length: number;
  spacing: number;
  /** Number of samples (intervals + 1). */
  count: number;
  x: Float64Array;
  y: Float64Array;
  z: Float64Array;
  kappa: Float64Array;
  grade: Float64Array;
  bank: Float64Array;
  /** Unit horizontal tangent per sample. */
  tx: Float64Array;
  tz: Float64Array;
  sections: readonly { s0: number; lanes: readonly LaneInfo[] }[];
  /** Outer drivable edges of the widest section, lanes and shoulders included. */
  dMin: number;
  dMax: number;
  /** Features (ramps, roadside zones, cop spawns...), sorted by s0. */
  features: readonly BakedFeature[];
  /** Scenery tags over s ranges. */
  tags: readonly BakedTag[];
  barriers: readonly BakedBarrier[];
  fromJunction: string;
  toJunction: string;
  /** Leaving through the `to` end (s > length). Null at a dead end. */
  next: EdgeLink | null;
  /** Leaving through the `from` end (s < 0). Null at a dead end. */
  prev: EdgeLink | null;
}

/** A mover's road position. Plain mutable data, so sim state can hold it directly. */
export interface RoadPos {
  edge: number;
  s: number;
  d: number;
  /** Travel direction relative to increasing s. */
  dir: 1 | -1;
}

export interface WorldPoint {
  x: number;
  y: number;
  z: number;
}

export interface RoadFrame extends WorldPoint {
  /** Unit horizontal tangent (direction of increasing s). */
  tx: number;
  tz: number;
  kappa: number;
  grade: number;
  bank: number;
}

export type AdvanceResult = 'ok' | 'deadEnd';

/** An edge near an edge end. This edge's s = sOffset + sSign · the neighbour's s. */
export interface RoadNeighbour {
  edge: number;
  sOffset: number;
  /** −1 when the two edges are joined the other way round (to-to or from-from). */
  sSign: 1 | -1;
}

/** Rates of a mover on a curved road (per second), from curvedRoadRates. */
export interface CurvedRates {
  /** ds/dt, signed: negative for a mover travelling toward decreasing s (dir −1). */
  ds: number;
  /** dd/dt. */
  dd: number;
  /** The road turning under the mover: add to its own turn rate to get d(yaw)/dt. */
  yawDrift: number;
}

export interface RoadNetwork {
  readonly id: string;
  readonly edges: readonly Edge[];
  edgeIndex(id: string): number;
  toWorld(edge: number, s: number, d: number, h: number): WorldPoint;
  frameAt(edge: number, s: number): RoadFrame;
  surfaceHeight(edge: number, s: number, d: number): number;
  lanesAt(edge: number, s: number): readonly LaneInfo[];
  kappaAt(edge: number, s: number): number;
  nextEdges(edge: number, end: 'from' | 'to'): readonly EdgeLink[];
  /** Carries an s that ran past an edge end into the next edge. Mutates pos. */
  advance(pos: RoadPos): AdvanceResult;
  /** Nearest road position to a world point, searching the hint edge and its neighbours. */
  project(x: number, z: number, hintEdge?: number): RoadPos;
  /** Edges within range of s across an edge end, with the mapping of their s into this edge's. */
  neighbours(edge: number, s: number, range: number): readonly RoadNeighbour[];
  /** The edge's features, optionally of one kind, sorted by s0. */
  featuresOf(edge: number, kind?: string): readonly BakedFeature[];
  /** The barrier on one side at s (left is negative d), or null. */
  barrierAt(
    edge: number,
    s: number,
    side: 'left' | 'right',
  ): { kind: 'rail' | 'wall'; heightM: number } | null;
}

/** 1 / (1 − kappa·d), with the denominator clamped to at least 0.1 (curved-road kinematics). */
export function sRateFactor(kappa: number, d: number): number {
  const den = 1 - kappa * d;
  return 1 / (den < 0.1 ? 0.1 : den);
}

/**
 * The curved-road kinematics (docs/architecture.md, "Coordinates") for a mover at speed v,
 * offset d, travel direction dir and yaw (its heading offset from its own direction of travel,
 * positive to its right), on road curvature kappa:
 *   ds/dt = dir · v·cos(yaw) / (1 − kappa·d), denominator clamped to at least 0.1;
 *   dd/dt = dir · v·sin(yaw);
 *   d(yaw)/dt = own turn rate + yawDrift, with yawDrift = −dir · kappa · |ds/dt|.
 * For dir −1 the mover's right is −d and the road turns the other way under it, hence the signs.
 * Writes into `out` (no allocation) and returns it.
 */
export function curvedRoadRates(
  kappa: number,
  d: number,
  dir: 1 | -1,
  speed: number,
  yaw: number,
  out: CurvedRates,
): CurvedRates {
  const along = speed * cos(yaw) * sRateFactor(kappa, d);
  out.ds = dir * along;
  out.dd = dir * speed * sin(yaw);
  out.yawDrift = -dir * kappa * along;
  return out;
}

function column(road: BakedRoad, name: string): Float64Array {
  const data = road.samples.data[name];
  if (!data) throw new Error(`road ${road.id}: samples have no ${name} column`);
  return Float64Array.from(data);
}

function buildEdge(road: BakedRoad, index: number): Edge {
  const x = column(road, 'x');
  const y = column(road, 'y');
  const z = column(road, 'z');
  const kappa = column(road, 'kappa');
  const grade = column(road, 'grade');
  const bank = road.samples.data['bankRad'] ? column(road, 'bankRad') : new Float64Array(x.length);
  const count = x.length;
  if (count < 2) throw new Error(`road ${road.id}: needs at least two samples`);
  const tx = new Float64Array(count);
  const tz = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    const a = i === 0 ? 0 : i - 1;
    const b = i === count - 1 ? count - 1 : i + 1;
    const dx = (x[b] ?? 0) - (x[a] ?? 0);
    const dz = (z[b] ?? 0) - (z[a] ?? 0);
    const len = Math.sqrt(dx * dx + dz * dz) || 1;
    tx[i] = dx / len;
    tz[i] = dz / len;
  }
  let dMin = 0;
  let dMax = 0;
  for (const section of road.laneSections) {
    for (const lane of section.lanes) {
      dMin = Math.min(dMin, lane.dCenterM - lane.widthM / 2);
      dMax = Math.max(dMax, lane.dCenterM + lane.widthM / 2);
    }
  }
  const sections = [...road.laneSections].sort((p, q) => p.s0 - q.s0);
  return {
    index,
    id: road.id,
    length: road.lengthM,
    spacing: road.sampleSpacingM,
    count,
    x,
    y,
    z,
    kappa,
    grade,
    bank,
    tx,
    tz,
    sections,
    dMin,
    dMax,
    features: [...(road.features ?? [])].sort((p, q) => p.s0 - q.s0),
    tags: road.tags ?? [],
    barriers: road.barriers ?? [],
    fromJunction: road.from,
    toJunction: road.to,
    next: null,
    prev: null,
  };
}

/** Builds the network. Road ids are numbered in the order of the network file's `roads` list. */
export function createRoadNetwork(bundle: BakedNetworkBundle): RoadNetwork {
  const byId = new Map(bundle.roads.map((r) => [r.id, r]));
  const edges: Edge[] = bundle.network.roads.map((id, i) => {
    const road = byId.get(id);
    if (!road) throw new Error(`network ${bundle.network.id}: road ${id} is missing`);
    return buildEdge(road, i);
  });
  const indexOf = new Map(edges.map((e) => [e.id, e.index]));
  const edgeIndex = (id: string): number => {
    const i = indexOf.get(id);
    if (i === undefined) throw new Error(`network ${bundle.network.id}: no road ${id}`);
    return i;
  };

  // Pass-through junctions: exactly two road ends and no connectors. Lanes carry over by id
  // (M1 roads share one lane layout). Junctions with connectors (splits and merges) are road-1
  // and road-2's; until then their ends stay unlinked, like dead ends.
  for (const j of bundle.network.junctions) {
    if (j.ends.length !== 2 || j.connectors.length > 0) continue;
    const [a, b] = j.ends;
    if (!a || !b) continue;
    const ea = edges[edgeIndex(a.road)];
    const eb = edges[edgeIndex(b.road)];
    if (!ea || !eb) continue;
    const link = (from: Edge, end: 'from' | 'to', to: Edge, toEnd: 'from' | 'to') => {
      const l: EdgeLink = { edge: to.index, entersAt: toEnd };
      if (end === 'to') from.next = l;
      else from.prev = l;
    };
    link(ea, a.end, eb, b.end);
    link(eb, b.end, ea, a.end);
  }

  const edgeAt = (edge: number): Edge => {
    const e = edges[edge];
    if (!e) throw new Error(`no edge ${edge}`);
    return e;
  };

  /** Sample index and fraction for s on an edge (s is clamped to the edge). */
  const locate = (e: Edge, s: number): [number, number] => {
    const u = (s < 0 ? 0 : s > e.length ? e.length : s) / e.spacing;
    let i = Math.floor(u);
    if (i > e.count - 2) i = e.count - 2;
    return [i, u - i];
  };
  const at = (arr: Float64Array, i: number, t: number): number => {
    const a = arr[i] ?? 0;
    return a + ((arr[i + 1] ?? a) - a) * t;
  };

  const frameAt = (edge: number, s: number): RoadFrame => {
    const e = edgeAt(edge);
    const [i, t] = locate(e, s);
    let tx = at(e.tx, i, t);
    let tz = at(e.tz, i, t);
    const len = Math.sqrt(tx * tx + tz * tz) || 1;
    tx /= len;
    tz /= len;
    return {
      x: at(e.x, i, t),
      y: at(e.y, i, t),
      z: at(e.z, i, t),
      tx,
      tz,
      kappa: at(e.kappa, i, t),
      grade: at(e.grade, i, t),
      bank: at(e.bank, i, t),
    };
  };

  const surfaceHeight = (edge: number, s: number, d: number): number => {
    const f = frameAt(edge, s);
    return f.y - d * f.bank;
  };

  const toWorld = (edge: number, s: number, d: number, h: number): WorldPoint => {
    const f = frameAt(edge, s);
    return { x: f.x - f.tz * d, y: f.y - d * f.bank + h, z: f.z + f.tx * d };
  };

  const lanesAt = (edge: number, s: number): readonly LaneInfo[] => {
    const e = edgeAt(edge);
    let lanes = e.sections[0]?.lanes ?? [];
    for (const section of e.sections) if (section.s0 <= s) lanes = section.lanes;
    return lanes;
  };

  const kappaAt = (edge: number, s: number): number => {
    const e = edgeAt(edge);
    const [i, t] = locate(e, s);
    return at(e.kappa, i, t);
  };

  const nextEdges = (edge: number, end: 'from' | 'to'): readonly EdgeLink[] => {
    const e = edgeAt(edge);
    const l = end === 'to' ? e.next : e.prev;
    return l ? [l] : [];
  };

  const advance = (pos: RoadPos): AdvanceResult => {
    for (let guard = 0; guard < 16; guard++) {
      const e = edgeAt(pos.edge);
      let exitEnd: 'from' | 'to';
      let over: number;
      if (pos.s > e.length) {
        exitEnd = 'to';
        over = pos.s - e.length;
      } else if (pos.s < 0) {
        exitEnd = 'from';
        over = -pos.s;
      } else {
        return 'ok';
      }
      const link = exitEnd === 'to' ? e.next : e.prev;
      if (!link) {
        pos.s = exitEnd === 'to' ? e.length : 0;
        return 'deadEnd';
      }
      const target = edgeAt(link.edge);
      pos.edge = target.index;
      pos.s = link.entersAt === 'from' ? over : target.length - over;
      // Joining end to end the same way round keeps d and dir; to-to or from-from flips both.
      if (link.entersAt === exitEnd) {
        pos.d = -pos.d;
        pos.dir = pos.dir === 1 ? -1 : 1;
      }
    }
    return 'ok';
  };

  const projectOnEdge = (e: Edge, x: number, z: number): { s: number; d: number; dist2: number } => {
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
    const dx = x - (e.x[best] ?? 0);
    const dz = z - (e.z[best] ?? 0);
    const tx = e.tx[best] ?? 1;
    const tz = e.tz[best] ?? 0;
    let s = best * e.spacing + dx * tx + dz * tz;
    let d = 0;
    let along = 0;
    // A few Newton steps: move s until the offset is square to the tangent.
    for (let iter = 0; iter < 4; iter++) {
      s = s < 0 ? 0 : s > e.length ? e.length : s;
      const f = frameAt(e.index, s);
      const ox = x - f.x;
      const oz = z - f.z;
      d = -ox * f.tz + oz * f.tx;
      along = ox * f.tx + oz * f.tz;
      s += along * sRateFactor(f.kappa, d);
    }
    s = s < 0 ? 0 : s > e.length ? e.length : s;
    return { s, d, dist2: d * d + along * along };
  };

  const project = (x: number, z: number, hintEdge?: number): RoadPos => {
    const candidates = new Set<number>();
    if (hintEdge !== undefined && edges[hintEdge]) {
      candidates.add(hintEdge);
      for (const l of [edgeAt(hintEdge).next, edgeAt(hintEdge).prev]) if (l) candidates.add(l.edge);
    } else {
      for (const e of edges) candidates.add(e.index);
    }
    let best: RoadPos = { edge: 0, s: 0, d: 0, dir: 1 };
    let bestDist = Infinity;
    for (const idx of [...candidates].sort((p, q) => p - q)) {
      const r = projectOnEdge(edgeAt(idx), x, z);
      if (r.dist2 < bestDist) {
        bestDist = r.dist2;
        best = { edge: idx, s: r.s, d: r.d, dir: 1 };
      }
    }
    return best;
  };

  const neighbours = (edge: number, s: number, range: number): readonly RoadNeighbour[] => {
    const e = edgeAt(edge);
    const out: RoadNeighbour[] = [];
    // Pass-through neighbours, either way round. road-2 adds the connector edges at junctions.
    if (e.next && e.length - s <= range) {
      // Past our `to` end: entering their `from` end runs with us, their `to` end against us.
      const other = edgeAt(e.next.edge);
      out.push(
        e.next.entersAt === 'from'
          ? { edge: other.index, sOffset: e.length, sSign: 1 }
          : { edge: other.index, sOffset: e.length + other.length, sSign: -1 },
      );
    }
    if (e.prev && s <= range) {
      const other = edgeAt(e.prev.edge);
      out.push(
        e.prev.entersAt === 'to'
          ? { edge: other.index, sOffset: -other.length, sSign: 1 }
          : { edge: other.index, sOffset: 0, sSign: -1 },
      );
    }
    return out;
  };

  const featuresOf = (edge: number, kind?: string): readonly BakedFeature[] => {
    const all = edgeAt(edge).features;
    return kind === undefined ? all : all.filter((f) => f.kind === kind);
  };

  const barrierAt = (
    edge: number,
    s: number,
    side: 'left' | 'right',
  ): { kind: 'rail' | 'wall'; heightM: number } | null => {
    for (const b of edgeAt(edge).barriers) {
      if (s >= b.s0 && s <= b.s1 && (b.side === side || b.side === 'both')) {
        return { kind: b.kind, heightM: b.heightM };
      }
    }
    return null;
  };

  return {
    id: bundle.network.id,
    edges,
    edgeIndex,
    toWorld,
    frameAt,
    surfaceHeight,
    lanesAt,
    kappaAt,
    nextEdges,
    advance,
    project,
    neighbours,
    featuresOf,
    barrierAt,
  };
}
