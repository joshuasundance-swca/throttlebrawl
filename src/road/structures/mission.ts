// San Francisco's Mission, where everything stands (the maintainer, 2026-10-06, [decided]: "consistent physics
// and gameplay is important here so players know what to expect and how to interact with the world";
// docs/architecture.md, "Physical world"). render/mission.ts used to place the mural district as it drew it; the
// placement is here now, moved unchanged (the same wall lines, the same hash streams, the same numbers):
//
// - `missionLayout(road, seed)` is the one layout: the district's wall lines (a run of tagged wall on one side
//   of a road, 2 m samples along the band's outer edge, joined across a corner for the mascot's wall) and, on
//   each line, its buildings (a run of the line, its front and back corner points, its height) or its mascot
//   wall, with the choices the hash made (a stucco colour and a motif are numbers in 0..1 render turns into
//   paint). It reads the network's tags and features, the seed (through `scatterHash`) and the tables below,
//   and nothing that has loaded or been drawn (the old input `dressing`, the road files plus a career's
//   incident-site boards, is gone; a plan is the same in every race of the same content and seed). Kept per
//   network and seed.
// - `missionPlanner` is the structures' planner for the layer (road/structures.ts `STRUCTURE_LAYERS`): the
//   solids of that layout at their drawn shape. A building follows the road's curve, so it is a run of boxes:
//   consecutive 2 m segments are one box while their front stays within `FOOT_TOL_M` of a straight chord, their
//   back too, and their roofs (which follow the road's grade) within `ROOF_TOL_M` of one flat height; a
//   steeper or tighter run breaks into more boxes, never fewer than one per 2 m. The mascot wall's scaffold
//   planks are structures too (a ledge 1.2 m wide, 2.5 m a bay, at 3.5, 7, 10.5 and 13.5 m up); its standards
//   and guard rails are thin posts and rails, drawn and not planned (a post is a prop).
//
// Pure + - * / and core math, ids in the order added, no Math.random. A lazy chunk with the region's road data
// (docs/architecture.md, "Physical world"), never the first load.
import type { RoadNetwork } from '../network';
import type { StructurePlanner, StructureSpec } from '../structures';
import { scatterHash } from '../themes';

/** The tags this layer plans. */
export const MISSION_TAGS = ['mascot-mural', 'murals', 'shopfronts'] as const;
export type MissionKind = 'mascot' | 'murals' | 'shopfronts';
const KIND_OF: Readonly<Record<string, MissionKind>> = {
  'mascot-mural': 'mascot',
  murals: 'murals',
  shopfronts: 'shopfronts',
};
const RANK: Readonly<Record<MissionKind, number>> = { mascot: 0, murals: 1, shopfronts: 2 };

/** Step along the road when a wall's front line is sampled, m. */
export const STEP_M = 2;
/** A wall's front stands this far past the verge's hard edge, m. */
const WALL_GAP_M = 0.05;
/** The mascot's wall stands this far past the hard edge: its scaffold stands between, m. */
export const SCAFFOLD_M = 1.6;
/** Buildings reach this far below the road, so a slope never shows a gap under them, m. */
export const SINK_M = 1.5;
/** The walls stop this far short of a landmark's footprint along the alley, m. */
const LANDMARK_GAP_M = 1;
/** A building's depth back from its front, m. */
export const DEPTH_M: Readonly<Record<MissionKind, number>> = { shopfronts: 14, murals: 12, mascot: 14 };
/** Building widths along the front, m: [least, spread]. */
const WIDTH_M: Readonly<Record<'shopfronts' | 'murals', readonly [number, number]>> = {
  shopfronts: [7, 6],
  murals: [8, 9],
};
/** Building heights, m: [least, spread]. The mascot's wall stands taller than the block. */
const HEIGHT_M: Readonly<Record<'shopfronts' | 'murals', readonly [number, number]>> = {
  shopfronts: [7.5, 4],
  murals: [5, 4],
};
export const MASCOT_HEIGHT_M = 14.5;
/** How far back up the approaching street the face is lined up from, m. */
const FACE_SIGHT_M = 150;
/** Share of alley walls painted, and of shopfronts with a mural over the upper floors. */
export const MURAL_SHARE = { murals: 0.72, shopfronts: 0.2 } as const;
/** A mural cell's side, m, and the mascot's scaffold: its bay, its plank heights, how far out its planks stand. */
export const CELL_M = 0.5;
export const SCAFFOLD_BAY_M = 2.5;
export const SCAFFOLD_PLANKS_M = [3.5, 7, 10.5, 13.5] as const;
export const PLANK_OUT_M = 0.75;
export const PLANK_HALF_WIDTH_M = 0.6;
export const PLANK_HALF_THICK_M = 0.05;

/** A run of boxes is one box while its front and back stay this near a straight line, m [default]. */
export const FOOT_TOL_M = 0.1;
/** ... and its roof (the road's grade) stays this near one flat height, m [default]. */
export const ROOF_TOL_M = 0.25;

/** A point in the world, metres. */
export interface P3 {
  x: number;
  y: number;
  z: number;
}

/** What the test seam may override of a road's data: its tags and features (the game passes none). */
export interface MissionOverride {
  readonly tags?: readonly { s0: number; s1: number; side?: string | undefined; tag: string }[] | undefined;
  readonly features?:
    | readonly {
        kind: string;
        s0: number;
        s1: number;
        d0: number;
        d1: number;
        params?: Readonly<Record<string, unknown>> | undefined;
      }[]
    | undefined;
}

/** One wall's front line: points along the road on one side, the way in toward the road, and u. */
export interface WallLine {
  kind: MissionKind;
  side: -1 | 1;
  /** Where each point was sampled (edge index, s) and the d of the front. */
  edges: number[];
  ss: number[];
  ds: number[];
  /** Front points at road height (the road's centre height at that s). */
  pts: P3[];
  /** Unit horizontal vectors from each point toward the road. */
  ins: { x: number; z: number }[];
  /** Arc length along the front, m. */
  us: number[];
}

/** One building of the district (a run of a wall line), or the mascot's wall. */
export interface MissionBuild {
  /** Its line (the index in `lines`) and its place in it (the hash stream's `k`; 0 for the mascot's wall). */
  li: number;
  k: number;
  kind: MissionKind;
  edge: number;
  s: number;
  side: -1 | 1;
  u0: number;
  u1: number;
  height: number;
  /** Its stucco, and its mural's motif if it is painted (0..1 picks render turns into a colour and a motif). */
  stuccoU: number;
  painted: boolean;
  motifU: number;
  /** The footprint's front and back corner points, one pair per 2 m of the line (the road's height). */
  front: P3[];
  back: P3[];
}

/** The mascot's wall: the mural's extent along the wall and up from the road, its corner and face, its scaffold. */
export interface MissionMascot {
  li: number;
  ua: number;
  ub: number;
  ya: number;
  yb: number;
  uCorner: number;
  uFace: number;
}

export interface MissionLayout {
  lines: WallLine[];
  /** Every building, in the order render draws them: line by line, each line's run from its start. */
  builds: MissionBuild[];
  mascots: MissionMascot[];
}

const sqrt = (v: number) => Math.sqrt(v);
const dist = (x: number, z: number) => sqrt(x * x + z * z);

/** A point on a wall line at u (clamped), with the way toward the road there. */
export function lineAt(
  line: WallLine,
  u: number,
): { x: number; y: number; z: number; ix: number; iz: number } {
  const us = line.us;
  const n = us.length;
  if (n < 2) {
    const p = line.pts[0] ?? { x: 0, y: 0, z: 0 };
    const i = line.ins[0] ?? { x: 0, z: 1 };
    return { x: p.x, y: p.y, z: p.z, ix: i.x, iz: i.z };
  }
  let lo = 0;
  let hi = n - 1;
  const uu = Math.max(0, Math.min(us[n - 1] ?? 0, u));
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if ((us[mid] ?? 0) <= uu) lo = mid;
    else hi = mid;
  }
  const u0 = us[lo] ?? 0;
  const u1 = us[hi] ?? u0;
  const t = u1 > u0 ? (uu - u0) / (u1 - u0) : 0;
  const a = line.pts[lo] as P3;
  const b = line.pts[hi] as P3;
  const ia = line.ins[lo] as { x: number; z: number };
  const ib = line.ins[hi] as { x: number; z: number };
  const ix = ia.x + (ib.x - ia.x) * t;
  const iz = ia.z + (ib.z - ia.z) * t;
  const il = dist(ix, iz) || 1;
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
    ix: ix / il,
    iz: iz / il,
  };
}

/** The index of the line point at or before u. */
export const indexAt = (line: WallLine, u: number) => {
  let i = 0;
  while (i + 1 < line.us.length && (line.us[i + 1] ?? 0) <= u) i++;
  return i;
};

/** The district's runs of tagged wall: each side of each road, joined across a corner for a mascot. */
function wallLines(
  road: RoadNetwork,
  over: Readonly<Record<string, MissionOverride>> | undefined,
): WallLine[] {
  const out: WallLine[] = [];
  for (const e of road.edges) {
    const o = over?.[e.id];
    const tags: readonly { s0: number; s1: number; side?: string | undefined; tag: string }[] =
      o?.tags ?? e.tags;
    if (!tags.some((t) => KIND_OF[t.tag])) continue;
    // A landmark beside the alley (playtest 4, P4-19, M3: the mission chapel) stands in the wall's place: the
    // walls on its side stop short of its footprint, a few metres each way.
    const landmarks = (o?.features ?? e.features).filter((f) => f.kind === 'landmark');
    for (const side of [-1, 1] as const) {
      const name = side < 0 ? 'left' : 'right';
      const kindAt = (s: number): MissionKind | null => {
        if (
          landmarks.some((f) => {
            // Playtest 4, run C: a landmark that says `params.sightM` also opens its side of the alley that far
            // before it (the downtown's rule), so its front is seen down the street and not only from beside it.
            const sight = Number(f.params?.['sightM']);
            const before = Math.max(LANDMARK_GAP_M, Number.isFinite(sight) ? sight : 0);
            return (
              Math.min(f.d0, f.d1) * side > 0 &&
              s > Math.min(f.s0, f.s1) - before &&
              s < Math.max(f.s0, f.s1) + LANDMARK_GAP_M
            );
          })
        )
          return null;
        let best: MissionKind | null = null;
        for (const t of tags) {
          if (s < t.s0 || s > t.s1 || (t.side !== undefined && t.side !== 'both' && t.side !== name))
            continue;
          // Where two meet, the first in MISSION_TAGS wins (the mascot's wall over an alley's).
          const k = KIND_OF[t.tag];
          if (k && (best === null || RANK[k] < RANK[best])) best = k;
        }
        return best;
      };
      const n = Math.max(1, Math.round(e.length / STEP_M));
      let line: WallLine | null = null;
      for (let k = 0; k <= n; k++) {
        const s = (e.length * k) / n;
        const kind = kindAt(s === e.length ? s - 1e-6 : s);
        if (!kind || (line && line.kind !== kind)) {
          if (line && line.pts.length > 1) out.push(line);
          line = null;
        }
        if (!kind) continue;
        if (!line) line = { kind, side, edges: [], ss: [], ds: [], pts: [], ins: [], us: [] };
        const verge = road.vergeAt(e.index, s, name);
        const d = side * (Math.abs(verge.dOuter) + (kind === 'mascot' ? SCAFFOLD_M : WALL_GAP_M));
        const p = road.toWorld(e.index, s, d, 0);
        const c = road.toWorld(e.index, s, 0, 0);
        const il = dist(c.x - p.x, c.z - p.z) || 1;
        const last = line.pts[line.pts.length - 1];
        line.us.push(last ? (line.us[line.us.length - 1] ?? 0) + dist(p.x - last.x, p.z - last.z) : 0);
        line.pts.push({ x: p.x, y: c.y, z: p.z });
        line.ins.push({ x: (c.x - p.x) / il, z: (c.z - p.z) / il });
        line.edges.push(e.index);
        line.ss.push(s);
        line.ds.push(d);
      }
      if (line && line.pts.length > 1) out.push(line);
    }
  }
  // A mascot wall that runs round a corner onto the next road is one wall.
  const joined: WallLine[] = [];
  for (const l of out) {
    // The same side's mascot wall that ran to the end of the road before this one.
    const prev =
      l.kind === 'mascot' && (l.ss[0] ?? 1) <= 1e-6
        ? joined.find((j) => {
            const last = road.edges[j.edges[j.edges.length - 1] ?? -1];
            return (
              j.kind === 'mascot' &&
              j.side === l.side &&
              !!last &&
              l.edges[0] === last.index + 1 &&
              (j.ss[j.ss.length - 1] ?? 0) >= last.length - 1e-6
            );
          })
        : undefined;
    if (prev) {
      const base = prev.us[prev.us.length - 1] ?? 0;
      for (let i = 1; i < l.pts.length; i++) {
        prev.pts.push(l.pts[i] as P3);
        prev.ins.push(l.ins[i] as { x: number; z: number });
        prev.us.push(base + (l.us[i] ?? 0));
        prev.edges.push(l.edges[i] as number);
        prev.ss.push(l.ss[i] as number);
        prev.ds.push(l.ds[i] as number);
      }
      continue;
    }
    joined.push(l);
  }
  return joined;
}

/** Lays out the mural district of a network: its wall lines, buildings and mascot walls. */
function layMission(
  road: RoadNetwork,
  seed: number,
  over: Readonly<Record<string, MissionOverride>> | undefined,
): MissionLayout {
  const lines = wallLines(road, over);
  const builds: MissionBuild[] = [];
  const mascots: MissionMascot[] = [];

  /** A building's box over u0..u1 of a line: its front and back corner points, where it stands. */
  const footprint = (line: WallLine, u0: number, u1: number, depth: number) => {
    const i0 = indexAt(line, u0);
    const i1 = indexAt(line, u1);
    const us = [u0];
    for (let i = i0 + 1; i <= i1; i++)
      if ((line.us[i] ?? 0) > u0 + 0.05 && (line.us[i] ?? 0) < u1 - 0.05) us.push(line.us[i] ?? 0);
    us.push(u1);
    const mid = Math.min(line.pts.length - 1, Math.max(0, indexAt(line, (u0 + u1) / 2)));
    const edge = line.edges[mid] ?? 0;
    const s = line.ss[mid] ?? 0;
    const front: P3[] = [];
    const back: P3[] = [];
    for (const u of us) {
      const p = lineAt(line, u);
      const j = Math.min(line.pts.length - 1, indexAt(line, u));
      const e = line.edges[j] ?? 0;
      const ss = line.ss[j] ?? 0;
      const dd = Math.abs(line.ds[j] ?? 0);
      // On the inside of a bend the back is held short of the bend's centre.
      const k = road.kappaAt(e, ss);
      const inner = k * line.side > 0;
      const room = inner && Math.abs(k) > 1e-6 ? 1 / Math.abs(k) - dd - 1 : Infinity;
      const dep = Math.max(2, Math.min(depth, room));
      front.push({ x: p.x, y: p.y, z: p.z });
      back.push({ x: p.x - p.ix * dep, y: p.y, z: p.z - p.iz * dep });
    }
    return { front, back, edge, s };
  };

  lines.forEach((line, li) => {
    const total = line.us[line.us.length - 1] ?? 0;
    const h = (k: number, salt: number) => scatterHash(seed, 7919 + li * 131, k, salt);
    if (line.kind === 'mascot') {
      // One tall wall the length of the run, the mascot over all of it, and its scaffold.
      const built = footprint(line, 0, total, DEPTH_M.mascot);
      builds.push({
        li,
        k: 0,
        kind: 'mascot',
        edge: built.edge,
        s: built.s,
        side: line.side,
        u0: 0,
        u1: total,
        height: MASCOT_HEIGHT_M,
        stuccoU: 0,
        painted: true,
        motifU: 0,
        front: built.front,
        back: built.back,
      });
      // The corner: where the line passes from one road onto the next.
      let uCorner = total / 2;
      for (let i = 1; i < line.edges.length; i++)
        if (line.edges[i] !== line.edges[i - 1]) {
          uCorner = line.us[i] ?? uCorner;
          break;
        }
      const ua = CELL_M;
      const ub = ua + Math.floor((total - 2 * CELL_M) / CELL_M) * CELL_M;
      const ya = 0.6;
      const yb = ya + Math.floor((MASCOT_HEIGHT_M - 1.2) / CELL_M) * CELL_M;
      // The face: where the wall crosses the approaching street's centre line.
      const e0 = line.edges[0] ?? 0;
      const sight = road.frameAt(e0, Math.max(0, (line.ss[0] ?? 0) - FACE_SIGHT_M));
      let uFace = uCorner;
      let bestAcross = Infinity;
      line.pts.forEach((p, i) => {
        const across = Math.abs((p.x - sight.x) * -sight.tz + (p.z - sight.z) * sight.tx);
        if (across < bestAcross) {
          bestAcross = across;
          uFace = line.us[i] ?? uFace;
        }
      });
      mascots.push({ li, ua, ub, ya, yb, uCorner, uFace });
      return;
    }
    // Buildings of their own widths along the run; the last takes what is left.
    const [wMin, wSpread] = WIDTH_M[line.kind];
    const [hMin, hSpread] = HEIGHT_M[line.kind];
    let u = 0;
    let k = 0;
    while (u < total - 0.5) {
      let w = wMin + h(k, 1) * wSpread;
      if (total - (u + w) < wMin * 0.6) w = total - u;
      const u0 = u;
      const u1 = Math.min(total, u + w);
      u = u1;
      const height = hMin + h(k, 2) * hSpread;
      const painted = h(k, 4) < MURAL_SHARE[line.kind] && u1 - u0 >= 4;
      const built = footprint(line, u0, u1, DEPTH_M[line.kind]);
      builds.push({
        li,
        k,
        kind: line.kind,
        edge: built.edge,
        s: built.s,
        side: line.side,
        u0,
        u1,
        height,
        stuccoU: h(k, 3),
        painted,
        motifU: h(k, 5),
        front: built.front,
        back: built.back,
      });
      k++;
    }
  });
  return { lines, builds, mascots };
}

const kept = new WeakMap<RoadNetwork, Map<number, MissionLayout>>();

/**
 * The layout of a network for a seed, once (kept). `over` is a test seam, a control that plans the same roads
 * with other tags or features; the game passes none, and an overridden layout is never kept.
 */
export function missionLayout(
  road: RoadNetwork,
  seed: number,
  over?: Readonly<Record<string, MissionOverride>>,
): MissionLayout {
  if (over) return layMission(road, seed, over);
  let bySeed = kept.get(road);
  if (!bySeed) kept.set(road, (bySeed = new Map<number, MissionLayout>()));
  let layout = bySeed.get(seed);
  if (!layout) bySeed.set(seed, (layout = layMission(road, seed, undefined)));
  return layout;
}

/** One box of a building: the run of its segments it covers and the box's footprint, base and top. */
export interface WallBox {
  /** Its first and last front points (indices into the building's `front`). */
  i0: number;
  i1: number;
  foot: StructureSpec['foot'];
  baseY: number;
  top: number;
}

/**
 * A building as a run of boxes: consecutive segments are one box while the front stays within `FOOT_TOL_M` of
 * the chord from the run's first front point to its last, the back within `2 * FOOT_TOL_M` of one line parallel
 * to it, and the roof (front height + building height) within `ROOF_TOL_M` of one flat height. One segment is
 * always a box.
 */
export function wallBoxes(b: Pick<MissionBuild, 'front' | 'back' | 'height'>): WallBox[] {
  const { front, back, height } = b;
  const out: WallBox[] = [];
  const m = front.length - 1;
  let i0 = 0;
  while (i0 < m) {
    let i1 = i0 + 1;
    // The run's axes: along the chord and a quarter turn from it.
    const frame = (j: number) => {
      const o = front[i0] as P3;
      const e = front[j] as P3;
      const len = dist(e.x - o.x, e.z - o.z) || 1;
      return { o, ux: (e.x - o.x) / len, uz: (e.z - o.z) / len };
    };
    const fits = (j: number): boolean => {
      const { o, ux, uz } = frame(j);
      let hiMin = Infinity;
      let hiMax = -Infinity;
      let bMin = Infinity;
      let bMax = -Infinity;
      for (let i = i0; i <= j; i++) {
        const f = front[i] as P3;
        const g = back[i] as P3;
        const vf = (f.z - o.z) * ux - (f.x - o.x) * uz;
        if (Math.abs(vf) > FOOT_TOL_M) return false;
        const vb = (g.z - o.z) * ux - (g.x - o.x) * uz;
        if (vb < bMin) bMin = vb;
        if (vb > bMax) bMax = vb;
        const y = f.y + height;
        if (y < hiMin) hiMin = y;
        if (y > hiMax) hiMax = y;
      }
      return bMax - bMin <= 2 * FOOT_TOL_M && (hiMax - hiMin) / 2 <= ROOF_TOL_M;
    };
    while (i1 < m && fits(i1 + 1)) i1++;
    const { o, ux, uz } = frame(i1);
    let tMin = Infinity;
    let tMax = -Infinity;
    let vMin = Infinity;
    let vMax = -Infinity;
    let hiMin = Infinity;
    let hiMax = -Infinity;
    let lo = Infinity;
    for (let i = i0; i <= i1; i++) {
      for (const p of [front[i] as P3, back[i] as P3]) {
        const t = (p.x - o.x) * ux + (p.z - o.z) * uz;
        const v = (p.z - o.z) * ux - (p.x - o.x) * uz;
        if (t < tMin) tMin = t;
        if (t > tMax) tMax = t;
        if (v < vMin) vMin = v;
        if (v > vMax) vMax = v;
      }
      const y = (front[i] as P3).y;
      if (y + height < hiMin) hiMin = y + height;
      if (y + height > hiMax) hiMax = y + height;
      if (y - SINK_M < lo) lo = y - SINK_M;
    }
    // The box's axes are the contract's: u along the chord, v = (-uz, ux).
    const tc = (tMin + tMax) / 2;
    const vc = (vMin + vMax) / 2;
    out.push({
      i0,
      i1,
      foot: {
        x: o.x + ux * tc - uz * vc,
        z: o.z + uz * tc + ux * vc,
        ux,
        uz,
        hu: Math.max(1e-3, (tMax - tMin) / 2),
        hv: Math.max(1e-3, (vMax - vMin) / 2),
      },
      baseY: lo,
      top: (hiMin + hiMax) / 2,
    });
    i0 = i1;
  }
  return out;
}

/** The solids of a layout, in the order the layout holds them (the planner adds them in this order). */
export function missionSolids(layout: MissionLayout): StructureSpec[] {
  const out: StructureSpec[] = [];
  for (const b of layout.builds) {
    const line = layout.lines[b.li] as WallLine;
    const rule = b.kind === 'mascot' ? 'mascot-wall' : b.kind === 'murals' ? 'alley-wall' : 'shopfront';
    for (const box of wallBoxes(b)) {
      const j = Math.min(line.pts.length - 1, indexAt(line, (b.u0 + b.u1) / 2));
      out.push({
        rule,
        cls: 'building',
        model: null,
        edge: b.edge,
        s: b.s,
        d: line.ds[j] ?? 0,
        foot: box.foot,
        baseY: box.baseY,
        roof: { kind: 'flat', topM: box.top - box.baseY },
      });
    }
  }
  // The mascot's scaffold: a plank a bay long and 1.2 m wide at each height, between the wall and the band.
  for (const m of layout.mascots) {
    const line = layout.lines[m.li] as WallLine;
    const w = m.ub - m.ua;
    const nb = Math.max(1, Math.round(w / SCAFFOLD_BAY_M));
    for (let i = 0; i < nb; i++) {
      const q = lineAt(line, m.ua + (w * i) / nb + w / nb / 2);
      const j = Math.min(line.pts.length - 1, indexAt(line, m.ua + (w * i) / nb + w / nb / 2));
      for (const y of SCAFFOLD_PLANKS_M)
        out.push({
          rule: 'scaffold-plank',
          cls: 'building',
          model: null,
          edge: line.edges[j] ?? 0,
          s: line.ss[j] ?? 0,
          d: line.ds[j] ?? 0,
          // The wall's own axes (box() in render/mission.ts: +Z toward the road, +X along (iz, -ix)).
          foot: {
            x: q.x + q.ix * PLANK_OUT_M,
            z: q.z + q.iz * PLANK_OUT_M,
            ux: q.iz,
            uz: -q.ix,
            hu: w / nb / 2,
            hv: PLANK_HALF_WIDTH_M,
          },
          baseY: q.y + y - PLANK_HALF_THICK_M,
          roof: { kind: 'flat', topM: 2 * PLANK_HALF_THICK_M },
        });
    }
  }
  return out;
}

/** The layer's planner: the solids of the layout, for the plan (`STRUCTURE_LAYERS`' `mission`). */
export const missionPlanner: StructurePlanner = {
  plan(road, seed, sink) {
    for (const spec of missionSolids(missionLayout(road, seed))) sink.add(spec);
  },
};
