// The road network model and its queries (docs/architecture.md, "Road network"). Built once at
// load from baked samples, with core-safe maths only (+ - * / and sqrt), so every engine derives
// the same tables. Sign rules, defined here once:
//   s  metres along an edge from its `from` junction (0..L);
//   d  metres across, positive to the right when facing increasing s;
//   kappa positive when the road turns right (toward positive d);
//   bank positive when the surface tilts down toward positive d.
// World frame: x east, y up, z south. The right of a horizontal tangent (tx, tz) is (-tz, tx).
import { atan, cos, sin, type GroundSurface, type LaneInfo, type RoadSurface } from '../core';
import {
  bridgeTapers,
  taperLead,
  taperedWidth,
  type TaperAnchor,
  type TaperedVerge,
  type TaperTable,
} from './bridge-taper';
import {
  resolveCrossSection,
  resolveVerge,
  type CrossSection,
  type ResolvedVerge,
  type VergeSide,
} from './cross-section';
import {
  readConnector,
  type BakedBarrier,
  type BakedFeature,
  type BakedLaneSection,
  type BakedNetworkBundle,
  type BakedRoad,
  type BakedSplitZone,
  type BakedTag,
} from './types';

/** How a mover leaving one edge enters the next: at the next edge's `from` or `to` end. */
export interface EdgeLink {
  edge: number;
  entersAt: 'from' | 'to';
  /**
   * The lateral shift across the join: the next edge's d = σ·d + dShift, where σ is −1 when the
   * join flips orientation (to-to or from-from) and +1 otherwise. 0 (or absent) at pass-through
   * joins; measured from the geometry where a connector road starts off the centreline.
   */
  dShift?: number;
  /** A split zone on the edge being left: a mover whose d is inside it takes this link. */
  splitZone?: BakedSplitZone;
  /** The connector row id(s) this link comes from, for debugging and tools. */
  connector?: string;
}

/** A split zone as a query result: where on `edge` a rider's d picks the connector `toEdge`. */
export interface SplitZoneInfo extends BakedSplitZone {
  /** The edge the zone is on, and the end it leads out of. */
  edge: number;
  end: 'from' | 'to';
  /** The connector edge the zone picks. */
  toEdge: number;
  connector: string;
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
  /** Lane sections in s order, with their optional median and verge bands (W-Q cross-section). */
  sections: readonly BakedLaneSection[];
  /** What the lanes are made of: the road file's `surface`, asphalt when absent. */
  surface: RoadSurface;
  /** Outer drivable edges of the widest section, lanes and shoulders included (verges not included). */
  dMin: number;
  dMax: number;
  /** Features (ramps, roadside zones, cop spawns...), sorted by s0. */
  features: readonly BakedFeature[];
  /** Scenery tags over s ranges. */
  tags: readonly BakedTag[];
  barriers: readonly BakedBarrier[];
  fromJunction: string;
  toJunction: string;
  /**
   * Leaving through the `to` end (s > length): the default way on, the one a mover outside every
   * split zone takes. Null at a dead end.
   */
  next: EdgeLink | null;
  /** Leaving through the `from` end (s < 0): the default way on. Null at a dead end. */
  prev: EdgeLink | null;
  /** Every way on through the `to` end: the default first, then split-zone links. */
  nextLinks: readonly EdgeLink[];
  /** Every way on through the `from` end. */
  prevLinks: readonly EdgeLink[];
  /** Whether this edge is a junction's connector road. */
  isConnector: boolean;
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

/**
 * An edge near an edge end. This edge's s = sOffset + sSign · the neighbour's s, and its
 * d = sSign · the neighbour's d + dOffset.
 */
export interface RoadNeighbour {
  edge: number;
  sOffset: number;
  /** −1 when the two edges are joined the other way round (to-to or from-from). */
  sSign: 1 | -1;
  /** 0 at pass-through joins; nonzero where a connector road starts off the centreline. */
  dOffset: number;
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
  /** Every edge a mover can enter through one end: the default way on first, then split links. */
  nextEdges(edge: number, end: 'from' | 'to'): readonly EdgeLink[];
  /**
   * Carries an s that ran past an edge end into the next edge. Mutates pos. At a split, a mover
   * whose d is inside a connector's split zone takes that connector; any other takes the default
   * way on. d maps across the join (EdgeLink.dShift), so the world position is continuous.
   */
  advance(pos: RoadPos): AdvanceResult;
  /** Every split zone in the network, in edge order. */
  splitZones(): readonly SplitZoneInfo[];
  /** Nearest road position to a world point, searching the hint edge and its neighbours. */
  project(x: number, z: number, hintEdge?: number): RoadPos;
  /** Edges within range of s across an edge end, with the mapping of their s into this edge's. */
  neighbours(edge: number, s: number, range: number): readonly RoadNeighbour[];
  /** The edge's features, optionally of one kind, sorted by s0. */
  featuresOf(edge: number, kind?: string): readonly BakedFeature[];
  /**
   * The cross-section at s (W-Q): drive lanes per direction, the median, both verge bands (given or
   * derived from tags and barriers) and the lanes' surface.
   */
  crossSectionAt(edge: number, s: number): CrossSection;
  /**
   * One side's verge band at s: its surface, its outer edge kind and where it lies across the road
   * (`dInner` is the outermost lane's outer edge, `dOuter` the band's). A width of 0 means the road's
   * own edge is the edge. Near a bridge's end the band narrows into the deck (road/bridge-taper.ts),
   * and says so (`taper`).
   */
  vergeAt(edge: number, s: number, side: VergeSide): TaperedVerge;
  /**
   * The ground under (s, d): the road's surface on its lanes (a shoulder lane is `shoulder`), the
   * verge band's surface on a verge, or null past a verge's outer edge.
   */
  groundAt(edge: number, s: number, d: number): GroundSurface | null;
  /** The barrier on one side at s (left is negative d), or null. */
  barrierAt(
    edge: number,
    s: number,
    side: 'left' | 'right',
  ): { kind: 'rail' | 'wall'; heightM: number } | null;
  /**
   * RIDERS ONLY (playtest 1b): where the branches out of a split are drawn overlapping, a mover past its own edge's drivable band (the outer lane edges less
   * `margin`) whose world point lies inside a sibling branch's band moves onto that sibling. Its
   * world position is kept (pos is mutated: edge, s, d, and dir if the sibling runs the other way)
   * and the return value is the heading change to add to its yaw. Returns null, pos untouched, when
   * there is nothing to hand over to: then the barrier rule applies as before. Never called by
   * advance(), so traffic, which only advances, can never reach a shortcut this way. `allow`, when
   * given, limits the siblings it may move onto (a race passes its route's allowed edges).
   */
  handover(pos: RoadPos, margin: number, allow?: (edge: number) => boolean): number | null;
  /**
   * Which side of the edge a sibling branch lies on at s: +1 (toward +d), −1, or 0 for none. It is
   * nonzero inside a split zone (the zone's side) and along the stretches where handover() can
   * act. The steering assist reads it so it never pushes a rider away from a branch it is taking.
   */
  branchSideAt(edge: number, s: number): -1 | 0 | 1;
  /**
   * Where a mover's ground point lies on the drawn surface (between the outermost lane edges) of
   * another edge that `accept` takes, within `heightM` of the same height: that edge's position,
   * with dir the way along it closest to the mover's own heading. Null when it lies on none. Where
   * several qualify, the one it lies deepest inside wins (then the lowest edge index). Branch roads
   * cross or overlap other roads' asphalt near their junctions (a split, a merge, a rejoin bent
   * across the road); this lets a system that lives on some edges (traffic) find a rider who is
   * on one of them in the world but not by edge (run W-U fixes' re-check). Deterministic (+ - * /).
   */
  surfaceUnder(pos: RoadPos, heightM: number, accept: (edge: number) => boolean): RoadPos | null;
}

/** How far down each branch the handover looks for drawn overlap with its siblings, m [default]. */
const HANDOVER_SEARCH_M = 150;

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
    let dx: number;
    let dz: number;
    if (count >= 3 && (i === 0 || i === count - 1)) {
      // Ends: the second-order one-sided difference (−3p0 + 4p1 − p2), so the end tangent is as
      // true on a bend as the centred ones inside. Road ends meet at junctions, and a one-sided
      // chord there would tilt the frame by kappa × half a spacing: centimetres at the road edge.
      const k = i === 0 ? 1 : -1;
      const p0 = i;
      const p1 = i + k;
      const p2 = i + 2 * k;
      dx = k * (-3 * (x[p0] ?? 0) + 4 * (x[p1] ?? 0) - (x[p2] ?? 0));
      dz = k * (-3 * (z[p0] ?? 0) + 4 * (z[p1] ?? 0) - (z[p2] ?? 0));
    } else {
      const a = i === 0 ? 0 : i - 1;
      const b = i === count - 1 ? count - 1 : i + 1;
      dx = (x[b] ?? 0) - (x[a] ?? 0);
      dz = (z[b] ?? 0) - (z[a] ?? 0);
    }
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
    surface: road.surface ?? 'asphalt',
    dMin,
    dMax,
    features: [...(road.features ?? [])].sort((p, q) => p.s0 - q.s0),
    tags: road.tags ?? [],
    barriers: road.barriers ?? [],
    fromJunction: road.from,
    toJunction: road.to,
    next: null,
    prev: null,
    nextLinks: [],
    prevLinks: [],
    isConnector: false,
  };
}

/** Mutable view used while linking. */
type LinkingEdge = Edge & { nextLinks: EdgeLink[]; prevLinks: EdgeLink[]; isConnector: boolean };

/** Builds the network. Road ids are numbered in the order of the network file's `roads` list. */
export function createRoadNetwork(bundle: BakedNetworkBundle): RoadNetwork {
  const byId = new Map(bundle.roads.map((r) => [r.id, r]));
  const edges: LinkingEdge[] = bundle.network.roads.map((id, i) => {
    const road = byId.get(id);
    if (!road) throw new Error(`network ${bundle.network.id}: road ${id} is missing`);
    return buildEdge(road, i) as LinkingEdge;
  });
  const indexOf = new Map(edges.map((e) => [e.id, e.index]));
  const edgeIndex = (id: string): number => {
    const i = indexOf.get(id);
    if (i === undefined) throw new Error(`network ${bundle.network.id}: no road ${id}`);
    return i;
  };

  const addLink = (from: LinkingEdge, end: 'from' | 'to', l: EdgeLink) => {
    const list = end === 'to' ? from.nextLinks : from.prevLinks;
    const same = list.find((o) => o.edge === l.edge && o.entersAt === l.entersAt);
    if (!same) {
      list.push(l);
      return;
    }
    if (l.connector) same.connector = same.connector ? `${same.connector}+${l.connector}` : l.connector;
    if (l.splitZone && !same.splitZone) same.splitZone = l.splitZone;
  };

  // Pass-through junctions: exactly two road ends and no connectors. The two ends join directly,
  // lanes carry over by id and d carries over unchanged (dShift 0).
  for (const j of bundle.network.junctions) {
    if (j.ends.length !== 2 || j.connectors.length > 0) continue;
    const [a, b] = j.ends;
    if (!a || !b) continue;
    const ea = edges[edgeIndex(a.road)];
    const eb = edges[edgeIndex(b.road)];
    if (!ea || !eb) continue;
    addLink(ea, a.end, { edge: eb.index, entersAt: b.end });
    addLink(eb, b.end, { edge: ea.index, entersAt: a.end });
  }

  // Junctions with connectors (road-2): each row joins its `from` road end to the connector road's
  // `from` end, and the connector's `to` end to its `to` road end. d maps by the geometry: the
  // lateral offset of one road's end point in the other's end frame (+ - * / only).
  const endFrame = (e: Edge, end: 'from' | 'to') => {
    const i = end === 'from' ? 0 : e.count - 1;
    return { x: e.x[i] ?? 0, z: e.z[i] ?? 0, tx: e.tx[i] ?? 1, tz: e.tz[i] ?? 0 };
  };
  const join = (
    a: LinkingEdge,
    aEnd: 'from' | 'to',
    b: LinkingEdge,
    bEnd: 'from' | 'to',
    extra: Partial<EdgeLink>,
  ) => {
    const sigma = aEnd === bEnd ? -1 : 1;
    const fa = endFrame(a, aEnd);
    const fb = endFrame(b, bEnd);
    // Lateral offset of b's end point in a's frame (right normal of (tx, tz) is (−tz, tx)), and back.
    const dAB = -(fb.x - fa.x) * fa.tz + (fb.z - fa.z) * fa.tx;
    const dBA = -(fa.x - fb.x) * fb.tz + (fa.z - fb.z) * fb.tx;
    addLink(a, aEnd, { edge: b.index, entersAt: bEnd, dShift: -sigma * dAB, ...extra });
    addLink(b, bEnd, {
      edge: a.index,
      entersAt: aEnd,
      dShift: -sigma * dBA,
      ...(extra.connector ? { connector: extra.connector } : {}),
    });
  };
  for (const j of bundle.network.junctions) {
    for (const raw of j.connectors) {
      const row = readConnector(raw);
      if (!row) continue; // the road lint reports malformed rows
      const c = edges[edgeIndex(row.road)];
      const a = edges[edgeIndex(row.from.road)];
      const b = edges[edgeIndex(row.to.road)];
      if (!c || !a || !b) continue;
      c.isConnector = true;
      join(a, row.from.end, c, 'from', {
        connector: row.id,
        ...(row.splitZone ? { splitZone: { ...row.splitZone } } : {}),
      });
      join(c, 'to', b, row.to.end, { connector: row.id });
    }
  }

  // The default way on through each end: the first link without a split zone, preferring edges
  // that carry no shortcut lane, then the lowest edge index. Split links follow it.
  const hasShortcut = (e: Edge | undefined) =>
    !!e && e.sections.some((sec) => sec.lanes.some((l) => l.kind === 'shortcut'));
  for (const e of edges) {
    for (const list of [e.nextLinks, e.prevLinks]) {
      list.sort(
        (p, q) =>
          Number(!!p.splitZone) - Number(!!q.splitZone) ||
          Number(hasShortcut(edges[p.edge])) - Number(hasShortcut(edges[q.edge])) ||
          p.edge - q.edge,
      );
    }
    const first = (list: EdgeLink[]) => {
      const l = list[0];
      return l && !l.splitZone ? l : null;
    };
    e.next = first(e.nextLinks);
    e.prev = first(e.prevLinks);
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

  const sectionAt = (e: Edge, s: number): BakedLaneSection => {
    let found = e.sections[0] ?? { s0: 0, lanes: [] };
    for (const section of e.sections) if (section.s0 <= s) found = section;
    return found;
  };

  const lanesAt = (edge: number, s: number): readonly LaneInfo[] => sectionAt(edgeAt(edge), s).lanes;

  // Bridge tapers (road/bridge-taper.ts, playtest 4): each verge band narrows into a bridge's end
  // rather than stopping square at it. Built once from the untapered bands; most edges have none.
  const tapers: TaperTable = bridgeTapers(edges, (edge, side, s) => {
    const e = edgeAt(edge);
    return resolveVerge(e, sectionAt(e, s), side, s).widthM;
  });
  const NO_ANCHORS: readonly TaperAnchor[] = [];
  /** A resolved band under its edge's bridge tapers (the same object where no taper reaches s). */
  const tapered = (edge: number, v: ResolvedVerge, s: number): TaperedVerge => {
    const anchors = tapers[edge]?.[v.side === 'left' ? 0 : 1] ?? NO_ANCHORS;
    if (anchors.length === 0) return v;
    const w = taperedWidth(v.widthM, anchors, s);
    if (w >= v.widthM) {
      // The deck's own edge just past a taper's end still says so: a rider eased in along the taper
      // is a tick's travel behind it there, and finishes sliding in rather than meeting the rail.
      return taperLead(anchors, s) ? { ...v, taper: true } : v;
    }
    const width = w > 0 ? w : 0;
    return {
      ...v,
      widthM: width,
      dOuter: v.side === 'left' ? v.dInner - width : v.dInner + width,
      taper: true,
    };
  };

  const crossSectionAt = (edge: number, s: number): CrossSection => {
    const e = edgeAt(edge);
    const cs = resolveCrossSection(e, sectionAt(e, s), s);
    return { ...cs, left: tapered(edge, cs.left, s), right: tapered(edge, cs.right, s) };
  };

  const vergeAt = (edge: number, s: number, side: VergeSide): TaperedVerge => {
    const e = edgeAt(edge);
    return tapered(edge, resolveVerge(e, sectionAt(e, s), side, s), s);
  };

  const groundAt = (edge: number, s: number, d: number): GroundSurface | null => {
    const e = edgeAt(edge);
    const section = sectionAt(e, s);
    for (const lane of section.lanes) {
      const half = lane.widthM / 2;
      if (d >= lane.dCenterM - half && d <= lane.dCenterM + half) {
        return lane.kind === 'shoulder' ? 'shoulder' : e.surface;
      }
    }
    const v = tapered(edge, resolveVerge(e, section, d < 0 ? 'left' : 'right', s), s);
    const inside = d < 0 ? d >= v.dOuter && d <= v.dInner : d <= v.dOuter && d >= v.dInner;
    // Between lanes (a median's gap) the road's own surface stands in.
    if (d < 0 ? d > v.dInner : d < v.dInner) return e.surface;
    return inside && v.widthM > 0 ? v.surface : null;
  };

  const kappaAt = (edge: number, s: number): number => {
    const e = edgeAt(edge);
    const [i, t] = locate(e, s);
    return at(e.kappa, i, t);
  };

  const nextEdges = (edge: number, end: 'from' | 'to'): readonly EdgeLink[] => {
    const e = edgeAt(edge);
    return end === 'to' ? e.nextLinks : e.prevLinks;
  };

  /** The link a mover at lateral d takes out of an edge end: a matching split zone, else the default. */
  const pickLink = (e: Edge, end: 'from' | 'to', d: number): EdgeLink | null => {
    for (const l of end === 'to' ? e.nextLinks : e.prevLinks) {
      const z = l.splitZone;
      if (z && d >= z.d0 && d <= z.d1) return l;
    }
    return end === 'to' ? e.next : e.prev;
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
      const link = pickLink(e, exitEnd, pos.d);
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
      // A connector road that starts off the centreline shifts d, so the world position holds.
      if (link.dShift) pos.d += link.dShift;
    }
    return 'ok';
  };

  const zones: SplitZoneInfo[] = [];
  for (const e of edges) {
    for (const [end, list] of [
      ['to', e.nextLinks],
      ['from', e.prevLinks],
    ] as const) {
      for (const l of list) {
        if (!l.splitZone) continue;
        zones.push({ ...l.splitZone, edge: e.index, end, toEdge: l.edge, connector: l.connector ?? '' });
      }
    }
  }

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
      const h = edgeAt(hintEdge);
      for (const l of [...h.nextLinks, ...h.prevLinks]) candidates.add(l.edge);
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

  // ---- The rider-only handover between overlapping branches (playtest 1b) ----
  // The branches leaving a split (the main connector and the shortcut's, and the roads after them)
  // are drawn overlapping for a stretch, but each edge walls its own movers in. The tables below
  // record, for each edge, the stretches where its drawn surface overlaps a sibling branch's;
  // handover() moves a rider across inside them. Built once, deterministic (+ - * / sqrt).
  // [default] Splits only, the diagnosed wall: a merge's two roads overlap too, but both lead to the
  // same road a few metres on, so the wall there costs a rider little; it is a follow-up.

  /** The drawn surface's outer edges at (edge, s): the outermost lane edges, 0 on a side with none. */
  const outerAt = (edge: number, s: number): { lo: number; hi: number } => {
    let lo = 0;
    let hi = 0;
    for (const lane of lanesAt(edge, s)) {
      lo = Math.min(lo, lane.dCenterM - lane.widthM / 2);
      hi = Math.max(hi, lane.dCenterM + lane.widthM / 2);
    }
    return { lo, hi };
  };

  /**
   * The foot of a world point on an edge, searching only samples within [sLo, sHi]: the nearest
   * sample, then Newton steps on s until the offset is square to the tangent, with d taken at the
   * final s. `along` is what is left over along the tangent: about 0 for a foot inside the edge,
   * nonzero when the point lies past an end (s is clamped there).
   */
  const projectNear = (e: Edge, x: number, z: number, sLo: number, sHi: number) => {
    const i0 = Math.max(0, Math.floor(sLo / e.spacing));
    const i1 = Math.min(e.count - 1, Math.ceil(sHi / e.spacing));
    let best = i0;
    let bestD2 = Infinity;
    for (let i = i0; i <= i1; i++) {
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
    let along = 0;
    for (let iter = 0; iter < 24; iter++) {
      s = s < 0 ? 0 : s > e.length ? e.length : s;
      const f = frameAt(e.index, s);
      const ox = x - f.x;
      const oz = z - f.z;
      d = -ox * f.tz + oz * f.tx;
      along = ox * f.tx + oz * f.tz;
      if (along < 1e-10 && along > -1e-10) break;
      const next = s + along * sRateFactor(f.kappa, d);
      if ((next <= 0 && s === 0) || (next >= e.length && s === e.length)) break; // past an end
      s = next;
    }
    return { s, d, along };
  };

  /** One edge's overlap with one sibling: the s stretch on each, and the side the sibling is on. */
  interface Overlap {
    s0: number;
    s1: number;
    partner: number;
    /** Where to look for the rider's foot on the partner. */
    p0: number;
    p1: number;
    side: 1 | -1;
  }
  const overlaps = new Map<number, Overlap[]>();

  /** A branch walked away from a junction end: each edge with the s range within the search. */
  const branchFrom = (first: EdgeLink): { edge: number; s0: number; s1: number }[] => {
    const out: { edge: number; s0: number; s1: number }[] = [];
    let link: EdgeLink | null = first;
    let left = HANDOVER_SEARCH_M;
    while (link && left > 0 && out.length < 4) {
      const e = edgeAt(link.edge);
      if (out.some((o) => o.edge === e.index)) break;
      const span = Math.min(left, e.length);
      out.push(
        link.entersAt === 'from'
          ? { edge: e.index, s0: 0, s1: span }
          : { edge: e.index, s0: e.length - span, s1: e.length },
      );
      left -= e.length;
      link = link.entersAt === 'from' ? e.next : e.prev;
    }
    return out;
  };

  const addOverlaps = (
    x: { edge: number; s0: number; s1: number },
    y: { edge: number; s0: number; s1: number },
  ): void => {
    const ex = edgeAt(x.edge);
    const ey = edgeAt(y.edge);
    let s0 = Infinity;
    let s1 = -Infinity;
    let p0 = Infinity;
    let p1 = -Infinity;
    let side: 1 | -1 | 0 = 0;
    for (let i = Math.floor(x.s0 / ex.spacing); i * ex.spacing <= x.s1 && i < ex.count; i++) {
      const s = i * ex.spacing;
      const own = outerAt(x.edge, s);
      for (const sd of [1, -1] as const) {
        if (side !== 0 && sd !== side) continue;
        const w = toWorld(x.edge, s, sd > 0 ? own.hi : own.lo, 0);
        const p = projectNear(ey, w.x, w.z, y.s0, y.s1);
        if (p.along > 1e-3 || p.along < -1e-3) continue;
        const theirs = outerAt(y.edge, p.s);
        if (p.d < theirs.lo || p.d > theirs.hi) continue;
        side = sd;
        s0 = Math.min(s0, s);
        s1 = Math.max(s1, s);
        p0 = Math.min(p0, p.s);
        p1 = Math.max(p1, p.s);
      }
    }
    if (side === 0) return;
    const pad = 10; // the rider's point sits up to a band's margin past the drawn edge
    const list = overlaps.get(x.edge) ?? [];
    list.push({
      s0: Math.max(0, s0 - ex.spacing),
      s1: Math.min(ex.length, s1 + ex.spacing),
      partner: y.edge,
      p0: Math.max(0, p0 - pad),
      p1: Math.min(ey.length, p1 + pad),
      side,
    });
    overlaps.set(x.edge, list);
  };

  for (const e of edges) {
    for (const list of [e.nextLinks, e.prevLinks]) {
      if (list.length < 2 || !list.some((l) => l.splitZone)) continue;
      const branches = list.map(branchFrom);
      for (let i = 0; i < branches.length; i++) {
        for (let j = 0; j < branches.length; j++) {
          if (i === j) continue;
          for (const x of branches[i] ?? []) for (const y of branches[j] ?? []) addOverlaps(x, y);
        }
      }
    }
  }
  for (const list of overlaps.values()) list.sort((p, q) => p.partner - q.partner || p.s0 - q.s0);

  const handover = (pos: RoadPos, margin: number, allow?: (edge: number) => boolean): number | null => {
    const list = overlaps.get(pos.edge);
    if (!list) return null;
    const own = outerAt(pos.edge, pos.s);
    if (pos.d >= own.lo + margin && pos.d <= own.hi - margin) return null;
    let w: WorldPoint | null = null;
    for (const o of list) {
      if (pos.s < o.s0 || pos.s > o.s1) continue;
      if ((pos.d > 0 ? 1 : -1) !== o.side || (allow && !allow(o.partner))) continue;
      w ??= toWorld(pos.edge, pos.s, pos.d, 0);
      const p = projectNear(edgeAt(o.partner), w.x, w.z, o.p0, o.p1);
      if (p.along > 1e-6 || p.along < -1e-6) continue;
      const band = outerAt(o.partner, p.s);
      if (p.d < band.lo + margin || p.d > band.hi - margin) continue;
      const fx = frameAt(pos.edge, pos.s);
      const fy = frameAt(o.partner, p.s);
      const dot = fx.tx * fy.tx + fx.tz * fy.tz;
      const dir: 1 | -1 = dot >= 0 ? pos.dir : pos.dir === 1 ? -1 : 1;
      // The heading change: the angle from the sibling's direction of travel to ours, measured
      // toward the right (the right of (tx, tz) is (−tz, tx)). Both sides flip with dir.
      const k = pos.dir * dir;
      const across = k * (-fx.tx * fy.tz + fx.tz * fy.tx);
      const ahead = k * dot;
      pos.edge = o.partner;
      pos.s = p.s;
      pos.d = p.d;
      pos.dir = dir;
      return atan(across / ahead);
    }
    return null;
  };

  const branchSideAt = (edge: number, s: number): -1 | 0 | 1 => {
    for (const z of zones) {
      if (z.edge === edge && s >= z.s0 && s <= z.s1) return z.d0 + z.d1 >= 0 ? 1 : -1;
    }
    for (const o of overlaps.get(edge) ?? []) if (s >= o.s0 && s <= o.s1) return o.side;
    return 0;
  };

  // ---- Where a mover lies on another road's surface (run W-U fixes' re-check) ----
  // A grid of every edge's samples, built on first use, finds the edges near a world point. A point
  // on an edge's drawn surface is at most its half-width across and half a spacing along from one of
  // its samples, so a cell that size and its 8 neighbours always hold that sample.
  let grid: { cell: number; cells: Map<string, number[]> } | null = null;
  const sampleGrid = () => {
    let cell = 16;
    for (const e of edges) {
      cell = Math.max(cell, Math.max(-e.dMin, e.dMax) + e.spacing);
    }
    const cells = new Map<string, number[]>();
    for (const e of edges) {
      for (let i = 0; i < e.count; i++) {
        const key = `${Math.floor((e.x[i] ?? 0) / cell)},${Math.floor((e.z[i] ?? 0) / cell)}`;
        const list = cells.get(key);
        if (list) list.push(e.index, i);
        else cells.set(key, [e.index, i]);
      }
    }
    return { cell, cells };
  };

  const surfaceUnder = (pos: RoadPos, heightM: number, accept: (edge: number) => boolean): RoadPos | null => {
    grid ??= sampleGrid();
    const w = toWorld(pos.edge, pos.s, pos.d, 0);
    const ix = Math.floor(w.x / grid.cell);
    const iz = Math.floor(w.z / grid.cell);
    // The nearest sample of each candidate edge.
    const nearest = new Map<number, { i: number; d2: number }>();
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const list = grid.cells.get(`${ix + dx},${iz + dz}`);
        if (!list) continue;
        for (let j = 0; j < list.length; j += 2) {
          const e = list[j] ?? -1;
          const i = list[j + 1] ?? 0;
          if (e === pos.edge || !accept(e)) continue;
          const ed = edgeAt(e);
          const ox = w.x - (ed.x[i] ?? 0);
          const oz = w.z - (ed.z[i] ?? 0);
          const d2 = ox * ox + oz * oz;
          const had = nearest.get(e);
          if (!had || d2 < had.d2 || (d2 === had.d2 && i < had.i)) nearest.set(e, { i, d2 });
        }
      }
    }
    let best: RoadPos | null = null;
    let deepest = -1;
    for (const e of [...nearest.keys()].sort((p, q) => p - q)) {
      const ed = edgeAt(e);
      const i = nearest.get(e)?.i ?? 0;
      const p = projectNear(ed, w.x, w.z, (i - 1) * ed.spacing, (i + 1) * ed.spacing);
      if (p.along > 1e-3 || p.along < -1e-3) continue; // past an end of it
      const b = outerAt(e, p.s);
      const inside = Math.min(p.d - b.lo, b.hi - p.d);
      if (inside < 0 || inside <= deepest) continue;
      const y = toWorld(e, p.s, p.d, 0).y;
      if (y - w.y > heightM || w.y - y > heightM) continue;
      const fx = frameAt(pos.edge, pos.s);
      const fy = frameAt(e, p.s);
      const dot = fx.tx * fy.tx + fx.tz * fy.tz;
      deepest = inside;
      best = { edge: e, s: p.s, d: p.d, dir: dot >= 0 ? pos.dir : pos.dir === 1 ? -1 : 1 };
    }
    return best;
  };

  const neighbours = (edge: number, s: number, range: number): readonly RoadNeighbour[] => {
    const e = edgeAt(edge);
    const out: RoadNeighbour[] = [];
    // Every edge joined at a near end, either way round, connector roads included. A link's
    // dShift maps our d into theirs (theirs = σ·ours + dShift), so ours = σ·theirs − σ·dShift.
    if (e.length - s <= range) {
      // Past our `to` end: entering their `from` end runs with us, their `to` end against us.
      for (const l of e.nextLinks) {
        const other = edgeAt(l.edge);
        out.push(
          l.entersAt === 'from'
            ? { edge: other.index, sOffset: e.length, sSign: 1, dOffset: l.dShift ? -l.dShift : 0 }
            : { edge: other.index, sOffset: e.length + other.length, sSign: -1, dOffset: l.dShift ?? 0 },
        );
      }
    }
    if (s <= range) {
      for (const l of e.prevLinks) {
        const other = edgeAt(l.edge);
        out.push(
          l.entersAt === 'to'
            ? { edge: other.index, sOffset: -other.length, sSign: 1, dOffset: l.dShift ? -l.dShift : 0 }
            : { edge: other.index, sOffset: 0, sSign: -1, dOffset: l.dShift ?? 0 },
        );
      }
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
    splitZones: () => zones,
    project,
    neighbours,
    featuresOf,
    crossSectionAt,
    vergeAt,
    groundAt,
    barrierAt,
    handover,
    branchSideAt,
    surfaceUnder,
  };
}
