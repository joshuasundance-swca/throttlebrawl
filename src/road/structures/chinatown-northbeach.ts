// San Francisco's Chinatown and North Beach, where everything stands (the maintainer, 2026-10-06, [decided]:
// "consistent physics and gameplay is important here so players know what to expect and how to interact with
// the world"; docs/architecture.md, "Physical world"). render/chinatown-northbeach.ts used to place these
// districts as it drew them; the placement is here now, moved unchanged (the same rules, the same hash
// streams, the same numbers), so the sim can meet what render draws:
//
// - `blocksLayout(road, seed)` is the one layout: every front, second row, balcony, bay, patio rail, side
//   street, lantern string, tree, bench, park building and the tower, with the choices the hash made for them
//   (a look is a number in 0..1 render turns into a colour). It reads the network's tags and features, the
//   seed (through `scatterHash`) and the tables below, and nothing that has loaded or been drawn (the old
//   input `dressing`, the road files plus a career's incident-site boards, is gone: a plan is the same in
//   every race of the same content and seed). Kept per network and seed.
// - `blocksPlanner` is the structures' planner for the layer (road/structures.ts `STRUCTURE_LAYERS`): the
//   solids of that layout, each at its drawn shape. Render draws the layout and the sim meets the plan; one
//   function made both, and scripts/structures-districts.test.ts holds the drawn corners to the boxes.
//
// What is a structure here: a piece whose longest side is at least `MIN_SOLID_M` (1.5 m): the buildings, their
// second rows, the balconies and bays, the patio rail, the side streets' fronts and end walls and the park's
// back row. Smaller pieces (a blade sign, a table, a chair, a planter, a bench, a tree's trunk, a post) are
// furniture-sized props, and sheets a rider passes under (an awning, a cornice, the lantern strings, a
// railing's one-sided panel) are drawn as before and not planned. The tower stands 90 m past the finish and
// 70 m out, past the reach of any flight: scenery, as are the park's trees, which stand past the band.
//
// Pure + - * / and core math, ids in the order added, no Math.random: the same network and seed give the same
// layout. A lazy chunk with the region's road data (docs/architecture.md, "Physical world"), never first load.
import type { RoadNetwork } from '../network';
import type { StructurePlanner, StructureSpec } from '../structures';
import { scatterHash, themeAt, type SideTag, type SideTheme } from '../themes';

/** The tags this layer plans. */
export const BLOCK_TAGS = ['lanterns', 'cafes', 'side-street', 'hill-park'] as const;

/** A building's depth from its front, m; the second row stands behind it. [default] */
export const DEPTH_M = 14;
export const BACK_DEPTH_M = 16;
/** The ground storey and each storey above it, m. */
export const GROUND_STOREY_M = 4.2;
export const STOREY_M = 3.3;
/** Every building's foot reaches this far under the lower end of its ground (the hills), m. */
export const FOOT_SINK_M = 6;
/** North Beach's cafe patio: from the rail on the hard edge back to the cafe fronts, m. */
export const PATIO_M = 2.8;
/** The lanterns: a string every so often across Chinatown's street, m. [default] */
export const STRING_EVERY_M = 11;
export const STRING_HEIGHT_M = 6.6;
/** A side street's reach from the road and its roadway's half width, m. */
export const SIDE_REACH_M = 90;
export const SIDE_ROAD_HALF_M = 4.2;
/** The hill's park: a tree every so often past the grass band, m. [default] */
const TREE_EVERY_M = 9;
/** The tower: how far past the finish crest it stands, out to its side, its height and radius, m. */
const TOWER_AHEAD_M = 90;
const TOWER_OUT_M = 70;
/** The park's back row of buildings stands this far past its grass, and clear of the tower's hill, m. */
const PARK_BACK_M = 24;
const TOWER_CLEAR_M = 75;
/** Static geometry merges per stretch of road this long, m. [default] */
export const STRETCH_M = 240;
/** A piece is a structure when its longest side is at least this, m [default]; smaller is a prop. */
export const MIN_SOLID_M = 1.5;

/** A feature's box on the road: s0 to s1 along, d0 to d1 across (a landmark's footprint, a zone). */
interface FeatureBox {
  s0: number;
  s1: number;
  d0: number;
  d1: number;
}
/** Features nothing of this layer stands in. */
const KEEP_CLEAR = new Set(['billboard', 'boostPad', 'rampTruck', 'roadsideZone', 'copSpawn']);

/** A point on the ground, world metres. */
export interface Pt {
  x: number;
  z: number;
}
/**
 * A local frame on the ground: an origin, a unit `a` along a frontage and a unit `n` away from the street
 * (into the building). P(t, k) is t along, k in.
 */
export interface Frame2 {
  o: Pt;
  a: Pt;
  n: Pt;
}
/** The ground's height along a front: from `ya` at its first end to `yb` at its last, over `len` m of s. */
export interface GroundSpan {
  ya: number;
  yb: number;
  len: number;
}
/** The ground's height `t` m along a front (clamped to it). */
export const groundAt = (g: GroundSpan, t: number): number =>
  g.ya + ((g.yb - g.ya) * Math.max(0, Math.min(g.len, t))) / g.len;

/** What the test seam may override of a road's data: its tags and features (the game passes none). */
export interface BlocksOverride {
  readonly tags?: readonly SideTag[] | undefined;
  readonly features?: readonly (FeatureBox & { kind: string })[] | undefined;
}

/** A front-row building with its second row and its patio. */
export interface BlockFront {
  edge: number;
  side: -1 | 1;
  district: 'lanterns' | 'cafes';
  /** Its index in its run, with the run's start (the hash stream's `k + round(a)`). */
  k: number;
  s0: number;
  s1: number;
  /** Its front's distance from the centre line, m, and the hard edge's. */
  frontD: number;
  edgeD: number;
  f: Frame2;
  /** The front's length, m (the chord, which a bend makes shorter than s1 - s0). */
  len: number;
  ground: GroundSpan;
  storeys: number;
  /** The hash's 0..1 picks of its walls, accent and stripes (render turns them into colours). */
  wallU: number;
  accentU: number;
  stripesU: number | null;
  balconies: boolean;
  blade: boolean;
  bay: boolean;
  cafe: boolean;
  /** Its roof's height, and its foot's: the world heights of its top and its underside. */
  top: number;
  foot: number;
  back: { f: Frame2; len: number; top: number; foot: number; wallU: number };
  /** North Beach: the rail's frame, a cafe's tables (their `t` along the rail), or a run of planters. */
  railF: Frame2 | null;
  tables: number[];
  planters: boolean;
}

export interface BlockSideRow {
  /** The row's own frame (its front faces the side street). */
  g: Frame2;
  k: -1 | 1;
  lots: { t0: number; t1: number; storeys: number; top: number; wallU: number }[];
}
export interface BlockSideStreetSide {
  side: -1 | 1;
  /** t along the side street (away from the road), k across it. */
  f: Frame2;
  rows: BlockSideRow[];
  endTop: number;
  endWallU: number;
  endFaceU: number;
  /** Which district's walls line it. */
  chinatown: boolean;
  /** The side street's mouth, m from the centre line (the road's inner verge edge). */
  dEdge: number;
}
export interface BlockSideStreet {
  edge: number;
  s: number;
  half: number;
  /** The road's height there. */
  y: number;
  sides: BlockSideStreetSide[];
}
/** A lantern string across the street: where, how far to each facade, and whether it has gold lanterns. */
export interface BlockString {
  edge: number;
  s: number;
  left: number;
  right: number;
  y: number;
  gold: boolean;
}
export interface BlockTree {
  edge: number;
  s: number;
  side: -1 | 1;
  d: number;
  height: number;
  colourU: number;
}
export interface BlockBench {
  edge: number;
  side: -1 | 1;
  s: number;
  d: number;
}
export interface BlockParkRow {
  edge: number;
  side: -1 | 1;
  s0: number;
  s1: number;
  d: number;
  storeys: number;
  wallU: number;
  f: Frame2;
  len: number;
  /** The road's height at its higher end, and its top's and foot's world heights. */
  y: number;
  top: number;
  foot: number;
}
export interface BlockTower {
  edge: number;
  c: Pt;
  baseY: number;
  /** The mound's top, m: the crest's height plus 3. */
  topY: number;
}

/** Everything the layer places, in the order it places it. */
export interface BlocksLayout {
  fronts: BlockFront[];
  sideStreets: BlockSideStreet[];
  strings: BlockString[];
  trees: BlockTree[];
  benches: BlockBench[];
  parkRows: BlockParkRow[];
  tower: BlockTower | null;
}

const sqrt = (v: number) => Math.sqrt(v);
const dist = (x: number, z: number) => sqrt(x * x + z * z);

const pt = (p: { x: number; z: number }): Pt => ({ x: p.x, z: p.z });
/** A frame point: t along, k in. */
export const frameAt = (f: Frame2, t: number, k: number): Pt => ({
  x: f.o.x + f.a.x * t + f.n.x * k,
  z: f.o.z + f.a.z * t + f.n.z * k,
});

/** The tags and features this layer reads of an edge: its own, or the test seam's. */
function readEdge(
  road: RoadNetwork,
  over: Readonly<Record<string, BlocksOverride>> | undefined,
  index: number,
): { tags: readonly SideTag[]; features: readonly (FeatureBox & { kind: string })[] } | null {
  const e = road.edges[index];
  if (!e) return null;
  const o = over?.[e.id];
  return { tags: o?.tags ?? e.tags, features: o?.features ?? e.features };
}

/** The frame of a frontage from s0 to s1 on a side of an edge, its front `d` out (the front's left end first). */
export function frontFrame(
  road: RoadNetwork,
  edge: number,
  side: -1 | 1,
  s0: number,
  s1: number,
  d: number,
): { f: Frame2; width: number } {
  const e = road.edges[edge];
  const len = e ? e.length : 0;
  const w = (s: number, dd: number) => road.toWorld(edge, Math.max(0, Math.min(len, s)), dd, 0);
  // Seen from the street, a right-side front runs with s and a left-side one against it.
  const [sa, sb] = side > 0 ? [s0, s1] : [s1, s0];
  const p0 = w(sa, side * d);
  const p1 = w(sb, side * d);
  const width = dist(p1.x - p0.x, p1.z - p0.z) || 1;
  const a = { x: (p1.x - p0.x) / width, z: (p1.z - p0.z) / width };
  const inward = w((s0 + s1) / 2, side * (d + 1));
  const mid = w((s0 + s1) / 2, side * d);
  let n = { x: a.z, z: -a.x };
  if (n.x * (inward.x - mid.x) + n.z * (inward.z - mid.z) < 0) n = { x: -n.x, z: -n.z };
  return { f: { o: pt(p0), a, n }, width };
}

function pick(u: number, count: number): number {
  return Math.min(count - 1, Math.floor(u * count));
}
export const pickOf = <T>(list: readonly T[], u: number): T => list[pick(u, list.length)] as T;

/** Plans the districts of a network: fronts, strings, side streets, the park and the tower. */
function layBlocks(
  road: RoadNetwork,
  seed: number,
  over: Readonly<Record<string, BlocksOverride>> | undefined,
): BlocksLayout {
  const out: BlocksLayout = {
    fronts: [],
    sideStreets: [],
    strings: [],
    trees: [],
    benches: [],
    parkRows: [],
    tower: null,
  };
  let towerAt: { edge: number; s: number; side: -1 | 1 } | null = null;
  const parkRow: {
    edge: number;
    side: -1 | 1;
    s0: number;
    s1: number;
    d: number;
    storeys: number;
    wallU: number;
  }[] = [];
  for (const e of road.edges) {
    const read = readEdge(road, over, e.index);
    if (!read) continue;
    const tags = read.tags;
    if (!tags.some((t) => (BLOCK_TAGS as readonly string[]).includes(t.tag))) continue;
    const features = read.features.filter((f) => KEEP_CLEAR.has(f.kind));
    // The landmarks (the Dragon Gate over the street, the church by the park): their footprints are
    // closed to the districts, as a staged scene's is, and an `overRoad` one too, since its posts stand
    // where the fronts would.
    const landmarks = read.features.filter((f) => f.kind === 'landmark');
    const h = (k: number, side: number, salt: number) =>
      scatterHash(seed, 7019 + e.index * 613, k, side * 41 + salt);
    const w = (s: number, d: number, y = 0) =>
      road.toWorld(e.index, Math.max(0, Math.min(e.length, s)), d, y);
    const theme = (side: -1 | 1, s: number): SideTheme => themeAt(tags, side < 0 ? 'left' : 'right', s);
    /** The sim's hard (or soft) edge on a side at s: the verge band's outer edge, as a distance. */
    const edgeAt = (side: -1 | 1, s: number) =>
      Math.abs(road.vergeAt(e.index, Math.max(0, Math.min(e.length, s)), side < 0 ? 'left' : 'right').dOuter);
    const runs = (side: -1 | 1, want: SideTheme): [number, number][] => {
      const found: [number, number][] = [];
      let start = -1;
      for (let s = 0; s <= e.length + 1e-6; s += 2) {
        const here = theme(side, Math.min(s, e.length)) === want;
        if (here && start < 0) start = s;
        if ((!here || s + 2 > e.length + 1e-6) && start >= 0) {
          found.push([start, here ? e.length : s - 2]);
          start = -1;
        }
      }
      return found;
    };
    const boxHit = (f: FeatureBox, side: -1 | 1, s0: number, s1: number, a0: number, a1: number) => {
      const lo = Math.min(f.d0 * side, f.d1 * side);
      const hi = Math.max(f.d0 * side, f.d1 * side);
      return Math.min(f.s0, f.s1) - 1 < s1 && Math.max(f.s0, f.s1) + 1 > s0 && lo - 1 < a1 && hi + 1 > a0;
    };
    /** Nothing of the scene's own (a sign, a pad, a zone, a lot) is in the way. */
    const clearOfScene = (side: -1 | 1, s0: number, s1: number, a0: number, a1: number) =>
      !features.some((f) => boxHit(f, side, s0, s1, a0, a1));
    /** Also nothing of a landmark's, with a metre to spare (a tree, a bench). */
    const clearOf = (side: -1 | 1, s0: number, s1: number, a0: number, a1: number) =>
      clearOfScene(side, s0, s1, a0, a1) && !landmarks.some((f) => boxHit(f, side, s0, s1, a0, a1));
    /** The first landmark ahead of `from` (and short of `to`) whose footprint reaches a0..a1 out on a side. */
    const landmarkAhead = (
      side: -1 | 1,
      from: number,
      to: number,
      a0: number,
      a1: number,
    ): { s0: number; s1: number } | null => {
      let found: { s0: number; s1: number } | null = null;
      for (const f of landmarks) {
        const lo = Math.min(f.d0 * side, f.d1 * side);
        const hi = Math.max(f.d0 * side, f.d1 * side);
        const s0 = Math.min(f.s0, f.s1);
        const s1 = Math.max(f.s0, f.s1);
        if (s1 <= from || s0 >= to || lo >= a1 || hi <= a0) continue;
        if (!found || s0 < found.s0) found = { s0, s1 };
      }
      return found;
    };
    const frame = (side: -1 | 1, s0: number, s1: number, d: number) =>
      frontFrame(road, e.index, side, s0, s1, d);
    const groundAlong = (side: -1 | 1, s0: number, s1: number): GroundSpan => {
      const [sa, sb] = side > 0 ? [s0, s1] : [s1, s0];
      return { ya: w(sa, 0).y, yb: w(sb, 0).y, len: Math.abs(s1 - s0) || 1 };
    };

    // Side streets: one per span (both sides share it).
    const seen = new Set<number>();
    for (const t of tags) {
      if (t.tag !== 'side-street') continue;
      const s = (t.s0 + t.s1) / 2;
      if (seen.has(s)) continue;
      seen.add(s);
      const half = (t.s1 - t.s0) / 2;
      const y = w(s, 0).y;
      const street: BlockSideStreet = { edge: e.index, s, half, y, sides: [] };
      for (const side of [-1, 1] as const) {
        const edge = road.vergeAt(e.index, s, side < 0 ? 'left' : 'right').dInner;
        const o = w(s, side * Math.abs(edge));
        const outward = w(s, side * (Math.abs(edge) + 1));
        const n0 = { x: outward.x - o.x, z: outward.z - o.z };
        const nl = dist(n0.x, n0.z) || 1;
        const a0 = w(s + 1, side * Math.abs(edge));
        const al = dist(a0.x - o.x, a0.z - o.z) || 1;
        // Frame: t along the side street (away from the road), k across it.
        const f: Frame2 = {
          o: pt(o),
          a: { x: n0.x / nl, z: n0.z / nl },
          n: { x: (a0.x - o.x) / al, z: (a0.z - o.z) / al },
        };
        const sideOut: BlockSideStreetSide = {
          side,
          f,
          rows: [],
          endTop: y + GROUND_STOREY_M + STOREY_M * 3,
          endWallU: h(3, side, 14),
          endFaceU: h(4, side, 14),
          chinatown: theme(side, s - half - 3) === 'lanterns',
          dEdge: Math.abs(edge),
        };
        // Buildings line it from behind the corner buildings out, and one closes its far end.
        for (const k of [-1, 1] as const) {
          const row: BlockSideRow = {
            g: {
              o: frameAt(f, 0, k * half),
              a: f.a,
              n: k > 0 ? f.n : { x: -f.n.x, z: -f.n.z },
            },
            k,
            lots: [],
          };
          let cursor = DEPTH_M + 4;
          for (let i = 0; cursor < SIDE_REACH_M - 8; i++) {
            const wd = 8 + 5 * h(i + Math.round(s), side * 3 + k, 11);
            const t0 = cursor;
            const t1 = Math.min(SIDE_REACH_M, cursor + wd);
            cursor = t1 + 0.3;
            const storeys = 3 + Math.floor(h(i, side * 3 + k, 12) * 3);
            const top = y + GROUND_STOREY_M + STOREY_M * (storeys - 1) + 0.8;
            row.lots.push({ t0, t1, storeys, top, wallU: h(i, k, 13) });
          }
          sideOut.rows.push(row);
        }
        street.sides.push(sideOut);
      }
      out.sideStreets.push(street);
    }

    for (const side of [-1, 1] as const) {
      for (const district of ['lanterns', 'cafes'] as const) {
        for (const [a, b] of runs(side, district)) {
          // The front row, shoulder to shoulder.
          let cursor = a + 0.4;
          for (let k = 0; ; k++) {
            const u = h(k + Math.round(a), side, 1);
            let width = district === 'lanterns' ? 6 + 4 * u : 7 + 4.5 * u;
            // A landmark's footprint ahead (the Dragon Gate across the street): the row closes up to it,
            // 0.3 m short, with a building at least 5 m wide (the last one takes the room that is left),
            // and starts again 0.3 m past it.
            const reach = edgeAt(side, cursor) + (district === 'cafes' ? PATIO_M : 0);
            const lm = landmarkAhead(side, cursor, b, reach, reach + DEPTH_M + 0.5 + BACK_DEPTH_M);
            if (lm) {
              const room = lm.s0 - 0.3 - cursor;
              if (room < 5) {
                cursor = Math.max(cursor, lm.s1 + 0.3);
                continue;
              }
              if (room < width + 5.3) width = room;
            }
            if (cursor + width > b - 0.3) {
              width = b - 0.3 - cursor;
              if (width < 5) break;
            }
            const s0 = cursor;
            const s1 = cursor + width;
            cursor = s1 + 0.25;
            const edgeD = edgeAt(side, (s0 + s1) / 2);
            const frontD = district === 'cafes' ? edgeD + PATIO_M : edgeD;
            if (!clearOfScene(side, s0, s1, frontD, frontD + DEPTH_M)) continue;
            const { f, width: len } = frame(side, s0, s1, frontD);
            const ground = groundAlong(side, s0, s1);
            const v = (salt: number) => h(k + Math.round(a), side, salt);
            const cafe = district === 'cafes' && v(2) < 0.6;
            const storeys = district === 'lanterns' ? 3 + Math.floor(v(3) * 3) : 3 + Math.floor(v(3) * 2);
            const g0 = groundAt(ground, 0);
            const g1 = groundAt(ground, len);
            // The second row behind it: a plain box, a different height.
            const back = frame(side, s0, s1, frontD + DEPTH_M + 0.5);
            const front: BlockFront = {
              edge: e.index,
              side,
              district,
              k,
              s0,
              s1,
              frontD,
              edgeD,
              f,
              len,
              ground,
              storeys,
              wallU: v(4),
              accentU: v(5),
              stripesU: district === 'cafes' ? v(6) : null,
              balconies: district === 'lanterns' && v(7) < 0.55,
              blade: district === 'lanterns' && v(8) < 0.4,
              bay: district === 'cafes' && v(9) < 0.6,
              cafe,
              top: Math.max(g0, g1) + GROUND_STOREY_M + STOREY_M * (storeys - 1) + 0.9,
              foot: Math.min(g0, g1) - FOOT_SINK_M,
              back: {
                f: back.f,
                len: back.width,
                top: groundAt(ground, len) + GROUND_STOREY_M + STOREY_M * (1 + Math.floor(v(10) * 4)),
                foot: Math.min(groundAt(ground, 0), groundAt(ground, len)) - FOOT_SINK_M,
                wallU: v(11),
              },
              railF: null,
              tables: [],
              planters: false,
            };
            // North Beach: the cafe patio behind the rail. A cafe gets two or three tables and
            // their chairs; the rail and its planters run along every front.
            if (district === 'cafes') {
              front.railF = frame(side, s0, s1, edgeD).f;
              if (cafe) {
                const count = 2 + (v(12) < 0.5 ? 1 : 0);
                for (let i = 0; i < count; i++) {
                  const t = 1.6 + i * 2.6;
                  if (t > len - 1.2) break;
                  front.tables.push(t);
                }
              } else if (v(13) < 0.7) front.planters = true;
            }
            out.fronts.push(front);
          }

          // Chinatown: lantern strings across the street, where both sides are lantern fronts.
          if (district === 'lanterns' && side > 0) {
            for (let k = 0; ; k++) {
              const s = a + 5 + k * STRING_EVERY_M + (h(k, 0, 20) - 0.5) * 3;
              if (s > b - 3) break;
              if (theme(-1, s) !== 'lanterns') continue;
              // None through a landmark that spans the street (the gate's lintel and side roofs).
              if (landmarks.some((f) => f.d0 < 0 && f.d1 > 0 && s > f.s0 - 1.5 && s < f.s1 + 1.5)) continue;
              out.strings.push({
                edge: e.index,
                s,
                left: edgeAt(-1, s),
                right: edgeAt(1, s),
                y: w(s, 0).y,
                gold: h(k, 1, 21) < 0.2,
              });
            }
          }
        }
      }

      // The hill's park: trees and benches past the grass band; the tower's spot.
      for (const [a, b] of runs(side, 'park')) {
        for (let k = 0; ; k++) {
          const s = a + 4 + k * TREE_EVERY_M + (h(k, side, 30) - 0.5) * 4;
          if (s > b - 2) break;
          const edgeD = edgeAt(side, s);
          for (const row of [0, 1] as const) {
            if (row === 1 && h(k, side, 31) < 0.4) continue;
            const d = edgeD + 1.5 + row * 7 + h(k, side, 32 + row) * 3;
            if (!clearOf(side, s - 2, s + 2, d - 2, d + 2)) continue;
            out.trees.push({
              edge: e.index,
              s,
              side,
              d,
              height: 6 + 5 * h(k, side, 34 + row),
              colourU: h(k, side, 36 + row),
            });
          }
          if (h(k, side, 40) < 0.35) {
            const d = edgeD + 0.9;
            if (clearOf(side, s + 2, s + 4.5, d - 0.5, d + 1))
              out.benches.push({ edge: e.index, side, s, d });
          }
        }
        // The city behind the park: a row of plain buildings past the trees, so the park is a park
        // in the city, not the edge of the world (kept once the tower's spot is known).
        for (let k = 0; ; k++) {
          const s0 = a + 6 + k * 16 + h(k, side, 50) * 3;
          const s1 = s0 + 10 + 4 * h(k, side, 51);
          if (s1 > b - 2) break;
          const d = edgeAt(side, (s0 + s1) / 2) + PARK_BACK_M;
          if (landmarks.some((f) => boxHit(f, side, s0, s1, d, d + DEPTH_M))) continue;
          parkRow.push({
            edge: e.index,
            side,
            s0,
            s1,
            d,
            storeys: 2 + Math.floor(h(k, side, 52) * 3),
            wallU: h(k, side, 53),
          });
        }
        if (side < 0) towerAt = { edge: e.index, s: b, side };
      }
    }
  }

  // The tower on the hill: past the finish crest on the last park's left, on its mound.
  const at: { edge: number; s: number; side: -1 | 1 } | null = towerAt;
  if (at) {
    const e = road.edges[at.edge];
    if (e) {
      // The crest of that road: its highest point along it.
      let crestS = 0;
      let crestY = -Infinity;
      for (let s = 0; s <= e.length; s += 4) {
        const y = road.toWorld(e.index, s, 0, 0).y;
        if (y > crestY) {
          crestY = y;
          crestS = s;
        }
      }
      const s = Math.min(e.length, crestS + TOWER_AHEAD_M);
      const c = road.toWorld(e.index, s, at.side * TOWER_OUT_M, 0);
      out.tower = {
        edge: e.index,
        c: pt(c),
        baseY: road.toWorld(e.index, s, 0, 0).y - 6,
        topY: crestY + 3,
      };
    }
  }
  // The buildings behind the parks, clear of the tower's hill.
  for (const r of parkRow) {
    const e = road.edges[r.edge];
    if (!e) continue;
    const w = (s: number, d: number) => road.toWorld(r.edge, Math.max(0, Math.min(e.length, s)), d, 0);
    const mid = w((r.s0 + r.s1) / 2, r.side * r.d);
    if (out.tower && dist(mid.x - out.tower.c.x, mid.z - out.tower.c.z) < TOWER_CLEAR_M) continue;
    const { f, width } = frontFrame(road, r.edge, r.side, r.s0, r.s1, r.d);
    const y = Math.max(w(r.s0, 0).y, w(r.s1, 0).y);
    out.parkRows.push({
      ...r,
      f,
      len: width,
      y,
      top: y + GROUND_STOREY_M + STOREY_M * (r.storeys - 1) + 0.8,
      foot: Math.min(w(r.s0, 0).y, w(r.s1, 0).y) - FOOT_SINK_M,
    });
  }
  return out;
}

const kept = new WeakMap<RoadNetwork, Map<number, BlocksLayout>>();

/**
 * The layout of a network for a seed, once (kept). `over` is a test seam, a control that plans the same roads
 * with other tags or features; the game passes none, and an overridden layout is never kept.
 */
export function blocksLayout(
  road: RoadNetwork,
  seed: number,
  over?: Readonly<Record<string, BlocksOverride>>,
): BlocksLayout {
  if (over) return layBlocks(road, seed, over);
  let bySeed = kept.get(road);
  if (!bySeed) kept.set(road, (bySeed = new Map<number, BlocksLayout>()));
  let layout = bySeed.get(seed);
  if (!layout) bySeed.set(seed, (layout = layBlocks(road, seed, undefined)));
  return layout;
}

/** A footprint from a frame: t0..t1 along, k0..k1 in. */
function footOf(f: Frame2, t0: number, t1: number, k0: number, k1: number) {
  const c = frameAt(f, (t0 + t1) / 2, (k0 + k1) / 2);
  return { x: c.x, z: c.z, ux: f.a.x, uz: f.a.z, hu: (t1 - t0) / 2, hv: (k1 - k0) / 2 };
}

/** A flat-topped solid: its footprint, from `baseY` up to the world height `top`. */
function solid(
  rule: string,
  cls: StructureSpec['cls'],
  edge: number,
  s: number,
  d: number,
  foot: StructureSpec['foot'],
  baseY: number,
  top: number,
): StructureSpec {
  return { rule, cls, model: null, edge, s, d, foot, baseY, roof: { kind: 'flat', topM: top - baseY } };
}

/** The solids of a layout, in the order the layout holds them (the planner adds them in this order). */
export function blocksSolids(layout: BlocksLayout): StructureSpec[] {
  const out: StructureSpec[] = [];
  for (const b of layout.fronts) {
    const s = (b.s0 + b.s1) / 2;
    const d = b.side * b.frontD;
    out.push(
      solid(
        `${b.district}-front`,
        'building',
        b.edge,
        s,
        d,
        footOf(b.f, 0, b.len, 0, DEPTH_M),
        b.foot,
        b.top,
      ),
    );
    out.push(
      solid(
        'back-row',
        'building',
        b.edge,
        s,
        b.side * (b.frontD + DEPTH_M + 0.5),
        footOf(b.back.f, 0, b.back.len, 0, BACK_DEPTH_M),
        b.back.foot,
        b.back.top,
      ),
    );
    const g0 = groundAt(b.ground, 0);
    const g1 = groundAt(b.ground, b.len);
    const gy = (g0 + g1) / 2 + 0.35;
    if (b.balconies)
      for (let st = 1; st < b.storeys; st++) {
        const y0 = gy + GROUND_STOREY_M + STOREY_M * (st - 1) + 0.75;
        out.push(
          solid(
            'balcony',
            'building',
            b.edge,
            s,
            d,
            footOf(b.f, b.len * 0.12, b.len * 0.88, -0.95, 0),
            y0 - 0.2,
            y0 - 0.05,
          ),
        );
      }
    if (b.bay && b.storeys > 2) {
      const c = b.len / 2;
      out.push(
        solid(
          'bay-window',
          'building',
          b.edge,
          s,
          d,
          footOf(b.f, c - 1.7, c + 1.7, -0.85, 0),
          gy + GROUND_STOREY_M + 0.4,
          b.top - 1.3,
        ),
      );
    }
    if (b.railF) {
      const lo = Math.min(g0, g1) - 0.2;
      const hi = Math.max(g0, g1) + 0.9;
      out.push(
        solid('patio-rail', 'wall', b.edge, s, b.side * b.edgeD, footOf(b.railF, 0, b.len, 0, 0.1), lo, hi),
      );
    }
  }
  for (const street of layout.sideStreets)
    for (const sd of street.sides) {
      for (const row of sd.rows)
        for (const lot of row.lots)
          out.push(
            solid(
              'side-street',
              'building',
              street.edge,
              street.s,
              sd.side * sd.dEdge,
              footOf(row.g, lot.t0, lot.t1, 0, DEPTH_M),
              street.y - FOOT_SINK_M,
              lot.top,
            ),
          );
      out.push(
        solid(
          'side-street-end',
          'building',
          street.edge,
          street.s,
          sd.side * sd.dEdge,
          footOf(sd.f, SIDE_REACH_M, SIDE_REACH_M + DEPTH_M, -street.half - 2, street.half + 2),
          street.y - FOOT_SINK_M,
          sd.endTop,
        ),
      );
    }
  for (const r of layout.parkRows)
    out.push(
      solid(
        'park-back',
        'building',
        r.edge,
        (r.s0 + r.s1) / 2,
        r.side * r.d,
        footOf(r.f, 0, r.len, 0, DEPTH_M),
        r.foot,
        r.top,
      ),
    );
  return out;
}

/** The layer's planner: the solids of the layout, for the plan (`STRUCTURE_LAYERS`' `chinatown-northbeach`). */
export const blocksPlanner: StructurePlanner = {
  plan(road, seed, sink) {
    for (const spec of blocksSolids(blocksLayout(road, seed))) sink.add(spec);
  },
};
