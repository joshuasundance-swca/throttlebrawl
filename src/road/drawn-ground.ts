// The ground the road scene draws beside a road, from the network alone (the physical world, the maintainer,
// 2026-10-06: "consistent physics and gameplay is important here so players know what to expect and how to
// interact with the world"; what is drawn is what is met). Render's road scene draws a strip of ground past
// the verge of every tagged side (render/road-mesh.ts `buildRoadScene`, its land strip; `RoadScene.landReach`
// reads it back), and a structure planner that stands buildings only on drawn ground (downtown Portland's
// blocks, road/structures/downtown.ts, through road/land.ts) needs that reach before anything is drawn. This
// is the strip's width rule, moved here unchanged: the same 2 m samples, the same widths tried in the same
// order (the theme's wide strip, the usual strip, then narrower), the same keep-offs (another road at the
// strip's middle or past its shelf, a lower road under it, a rail span, a landmark beyond the usual strip,
// the inside of a tight turn), and the same narrow land that runs on to a neighbouring road's verge.
//
// The sim reads the rest of that ground too, what a rider out past an edge meets (road/beyond.ts `beyondAt`;
// the one live check of 2026-10-07 had a high fall sink through Chuckanut's grassy shelf): past the strip
// the terrain skirt and the shelf into the sea, the land under the roadside zones, a split zone painted off
// the road, a lake's bank, each by render's own rule (`sectionGroundOf`), and any road's ground under a world
// point (`groundUnderOf`). So this builds into the sim chunk; road/land.ts is the planners' lazy door to it.
// tests/sim/beyond-drawn.test.ts holds the whole of it to the drawn scene on every route network.
//
// One difference, by design: the strip reads the edge's own tags, features and barriers (the road files
// the network was made from), where render reads the road files it was handed (`RoadDressing`), and a
// road file with no `barriers` key at all is read as none here, as the network keeps it (render falls back
// to the bridge tags and the elevation rule). Every road file of the route networks carries the key;
// src/render/land-reach.test.ts holds this rule to the drawn scene's reach.
//
// Pure + - * / and Math.min/max/abs/floor/round/ceil (no trig), like the rest of road/.
import type { BakedBarrier } from './types';
import type { Edge, RoadNetwork } from './network';
import { themeAt, type LandTheme, type SideTheme } from './themes';
import { lakeWaterAt } from './water';

/** The drawn verge past the shoulder, m (render/road-mesh.ts VERGE_M). */
const VERGE_M = 0.6;
/** The road scene's sample step along an edge, m (render/road-mesh.ts STEP_M). */
const STEP_M = 2;
/** A road this high over the sea is a deck: no land beside it when untagged, m (road-mesh.ts ELEVATED_M). */
const ELEVATED_M = 2.5;
/** The usual strip past the verge, and its shelf into the sea, m (road-mesh.ts SCENERY_LAND_M, SCENERY_SHELF_M). */
export const LAND_STRIP_M = 24;
const SHELF_M = 4;
/** A wide strip keeps off a landmark beyond the usual strip from this far before it to this far after it, m. */
const LANDMARK_LEAD_M = 12;
/** Land widths tried between two roads too close for a shelf, and how far short of the other's verge, m. */
const GAP_WIDTHS = [12, 9, 6, 4, 2.5, 1.5] as const;
const GAP_MARGIN_M = 0.3;
/** On the inside of a turn, land and its shelf reach at most this share of the turn's radius. */
const FOLD = 0.85;
/** Another road is looked for under the strip this often across it, m; one this far below is buried, m. */
const PROBE_M = 4;
const BURIED_M = 1.5;
/** Land that ends at a drop (render/scenery.ts SEAWALL_LAND_M): only this wide, m. */
const SEAWALL_LAND_M: Readonly<Partial<Record<LandTheme, number>>> = { promenade: 11.4, bluff: 10, lake: 20 };
/** Land wider than the usual strip (render/scenery.ts WIDE_LAND_M), tried first, m. */
const WIDE_LAND_M: Readonly<Partial<Record<LandTheme, number>>> = { blocks: 60, oldtown: 72 };
/** How far across an edge's centre line a point may lie and still be looked up, m (render/overlap.ts). */
const LOCATE_REACH_M = 40;
/** The land's top over the road's surface, m (render/scenery.ts LAND_TOP_M). */
const LAND_TOP_M = -0.09;
/**
 * Land may stand at most this far over another road's asphalt, looked for this often across its strip and
 * this far past that road's edges and ends, m (render/road-mesh.ts LAND_OVER_ROAD_M, LAND_ROAD_PROBE_M,
 * LAND_ROAD_MARGIN_M: a link a little lower than this road, less than BURIED_M, ran under its grass).
 */
const LAND_OVER_ROAD_M = 0.05;
const LAND_ROAD_PROBE_M = 1;
const LAND_ROAD_MARGIN_M = 0.5;

/** The land's reach past the verge at s on a side of an edge, m (0 = no land). */
export type LandReach = (edge: number, side: -1 | 1, s: number) => number;

/** The road scene's samples along an edge: `round(length / 2)` equal steps. */
function samplesOf(e: Edge): number[] {
  const n = Math.max(1, Math.round(e.length / STEP_M));
  const out: number[] = [];
  for (let i = 0; i <= n; i++) out.push((e.length * i) / n);
  return out;
}

/** Which edges lie under a world point (render/overlap.ts `EdgeLocator`, the same projection). */
function locator(road: RoadNetwork) {
  const boxes = road.edges.map((e) => {
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < e.count; i++) {
      minX = Math.min(minX, e.x[i] ?? 0);
      maxX = Math.max(maxX, e.x[i] ?? 0);
      minZ = Math.min(minZ, e.z[i] ?? 0);
      maxZ = Math.max(maxZ, e.z[i] ?? 0);
    }
    return { minX, maxX, minZ, maxZ };
  });
  const project = (e: Edge, x: number, z: number) => {
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
  };
  /**
   * Whether another edge (not `except`) lies under the point within `span(edge, s, d)` of its d, the point
   * projecting at most `pastM` past that edge's ends.
   */
  return (
    x: number,
    z: number,
    except: number,
    span: (o: Edge, s: number, d: number) => readonly [number, number] | null,
    pastM = 0.25,
  ): boolean => {
    for (const o of road.edges) {
      if (o.index === except) continue;
      const b = boxes[o.index];
      if (
        !b ||
        x < b.minX - LOCATE_REACH_M ||
        x > b.maxX + LOCATE_REACH_M ||
        z < b.minZ - LOCATE_REACH_M ||
        z > b.maxZ + LOCATE_REACH_M
      )
        continue;
      const p = project(o, x, z);
      if (p.past > pastM || Math.abs(p.d) > LOCATE_REACH_M) continue;
      const sp = span(o, p.s, p.d);
      if (sp && p.d > sp[0] && p.d < sp[1]) return true;
    }
    return false;
  };
}

const sideHas = (side: string | undefined, want: 'left' | 'right') =>
  side === undefined || side === 'both' || side === want;

/** The rail spans of one side (render/road-mesh.ts `barriersFor` and `railedParts`, on the edge's own data). */
function railsOf(
  road: RoadNetwork,
  e: Edge,
  side: 'left' | 'right',
): { s0: number; s1: number; kind: string }[] {
  const bridges = e.tags.filter((t) => t.tag === 'bridge' && sideHas(t.side, side));
  const onBridge = (s: number) => bridges.some((t) => s >= t.s0 && s <= t.s1);
  const high = (s: number) => road.toWorld(e.index, s, 0, 0).y >= ELEVATED_M;
  const railed = (b: BakedBarrier): { s0: number; s1: number }[] => {
    const out: { s0: number; s1: number }[] = [];
    let start = -1;
    const last = Math.min(e.length, b.s1);
    for (let s = Math.max(0, b.s0); ; s = Math.min(last, s + 2)) {
      const yes = onBridge(s) || high(s);
      if (yes && start < 0) start = s;
      if (!yes && start >= 0) {
        out.push({ s0: start, s1: s });
        start = -1;
      }
      if (s >= last) break;
    }
    if (start >= 0) out.push({ s0: start, s1: last });
    return out;
  };
  return e.barriers
    .filter((b) => sideHas(b.side, side))
    .flatMap((b) =>
      (b.kind === 'rail' ? railed(b) : [{ s0: b.s0, s1: b.s1 }]).map((span) => ({ ...span, kind: b.kind })),
    );
}

/** One edge's land samples: their step, and one side's reach at sample i, worked out when first asked for. */
interface EdgeLand {
  step: number;
  n: number;
  reachAt: (side: -1 | 1, i: number) => number;
  skirtAt: (side: -1 | 1, i: number) => Skirt | null;
  /** Whether row i's land runs on to another road. */
  meetsAt: (side: -1 | 1, i: number) => boolean;
  /** The shelf from row i's strip edge into the sea, its run out, m (null: none, the land runs on or is skirted). */
  shelfAt: (side: -1 | 1, i: number) => number | null;
}

/**
 * The terrain skirt past a land strip (render/road-mesh.ts `skirtAt`; not on a tropical network, nor past land that
 * ends at a sheer drop or runs on to another road): a slope `run` m out from the strip's edge, from `top` (world y,
 * the strip edge's height) down to its flat ground at SKIRT_GROUND_Y, then `flat` m of that ground, then a shelf into
 * the sea.
 */
export interface Skirt {
  run: number;
  flat: number;
  top: number;
}

/** The skirt at s on a side of an edge, as the row of render's samples nearest s draws it, or null where none is. */
export type SkirtAt = (edge: number, side: -1 | 1, s: number) => Skirt | null;

/**
 * The terrain skirt's flat ground over the sea, its slope's run per metre down, and its shortest and longest run, m
 * (road-mesh.ts GROUND_Y, SKIRT_RUN_PER_M, SKIRT_RUN_M).
 */
const SKIRT_GROUND_Y = 0.25;
const SKIRT_RUN_PER_M = 2.2;
const SKIRT_RUN_M = [6, 90] as const;
/**
 * The flat ground's widths tried past the slope, m; no skirt ground within this of water, m; another road looked for
 * under it this often, m (road-mesh.ts SKIRT_FLAT_M, SKIRT_WATER_CLEAR_M, SKIRT_ROAD_PROBE_M).
 */
const SKIRT_FLAT_M = [70, 35, 12, 0] as const;
const SKIRT_WATER_CLEAR_M = 22;
const SKIRT_ROAD_PROBE_M = 8;
/** A network with any of these tags (or none at all) is tropical, with no skirt (render/scenery.ts `isTropical`). */
const TROPICAL_TAGS: ReadonlySet<string> = new Set(['palms', 'beach', 'mangrove', 'swamp']);

/** The shelf from a strip's edge (or its skirt's flat ground) down into the sea: its run, and its foot, m (road-mesh.ts SCENERY_SHELF_M, SEAWALL_SHELF_M, LAND_CAP_FOOT_Y). */
const SHELF_RUN_M = 4;
const SEAWALL_SHELF_M = 0.05;
const SHELF_FOOT_Y = -0.4;

/** The shelf past a strip at s on a side of an edge, as the row of render's samples nearest s draws it: its run, m, or null. */
export type ShelfAt = (edge: number, side: -1 | 1, s: number) => number | null;

interface LandOf {
  reach: LandReach;
  edge: LandReach;
  skirt: SkirtAt;
  shelf: ShelfAt;
  /** An edge's rows (render's samples), worked out as asked for. */
  rows: (edge: number) => EdgeLand | null;
}

const kept = new WeakMap<RoadNetwork, LandOf>();

/**
 * The land's reach past the verge for every edge of a network, by its road scene's rule: at s, the
 * narrower of the two samples either side (the strip between two samples is a quad as wide as its
 * narrower end). Each sample is worked out the first time it is asked for, then kept: the sim asks for a few
 * as a rider flies out past an edge (road/beyond.ts `beyondAt`), and a whole network at once would stall a
 * race (Lake Samish's takes about a second on the dev machine).
 */
export function landReachOf(road: RoadNetwork): LandReach {
  return landOf(road).reach;
}

/**
 * Where the drawn land's outer edge lies past the verge at s, m (0 = no land): the strip between two samples is a
 * quad, so its edge runs straight from one sample's reach to the next (where `landReachOf` takes the narrower).
 * What a rider out past the edge meets (road/beyond.ts `beyondAt`).
 */
export function landEdgeOf(road: RoadNetwork): LandReach {
  return landOf(road).edge;
}

/** The terrain skirt past each edge's land strip, by its road scene's rule (`Skirt`), worked out as asked for. */
export function skirtOf(road: RoadNetwork): SkirtAt {
  return landOf(road).skirt;
}

/** The shelf into the sea past each edge's land strip where it has no skirt (`ShelfAt`), worked out as asked for. */
export function shelfOf(road: RoadNetwork): ShelfAt {
  return landOf(road).shelf;
}

/**
 * Whether water lies within r of a world point, as the road scene looks for it before it lays the skirt (road-mesh.ts
 * `waterGrid`): points out over each water side, every 10 m along it.
 */
function waterNear(road: RoadNetwork): (x: number, z: number, r: number) => boolean {
  const CELL = 40;
  const key = (cx: number, cz: number) => (cx + 0x8000) * 0x10000 + (cz + 0x8000);
  const grid = new Map<number, { x: number; z: number }[]>();
  for (const e of road.edges) {
    if (!e.tags.some((t) => t.tag.startsWith('water'))) continue;
    for (let s = 0; s <= e.length; s += 10) {
      for (const side of [-1, 1] as const) {
        if (themeAt(e.tags, side < 0 ? 'left' : 'right', s) !== 'water') continue;
        const outer = side < 0 ? -e.dMin + VERGE_M : e.dMax + VERGE_M;
        for (const across of [4, 20, 45, 80, 130]) {
          const p = road.toWorld(e.index, s, side * (outer + across), 0);
          const k = key(Math.floor(p.x / CELL), Math.floor(p.z / CELL));
          const list = grid.get(k);
          if (list) list.push(p);
          else grid.set(k, [p]);
        }
      }
    }
  }
  return (x, z, r) => {
    const span = Math.ceil(r / CELL);
    const cx = Math.floor(x / CELL);
    const cz = Math.floor(z / CELL);
    for (let i = -span; i <= span; i++)
      for (let j = -span; j <= span; j++)
        for (const p of grid.get(key(cx + i, cz + j)) ?? []) {
          const dx = p.x - x;
          const dz = p.z - z;
          if (dx * dx + dz * dz < r * r) return true;
        }
    return false;
  };
}

function landOf(road: RoadNetwork): LandOf {
  const known = kept.get(road);
  if (known) return known;
  const covered = locator(road);
  const w = (edge: number, s: number, d: number) => road.toWorld(edge, s, d, 0);
  const tagged = road.edges.some((e) => e.tags.length > 0);
  const tropical = !tagged || road.edges.some((e) => e.tags.some((t) => TROPICAL_TAGS.has(t.tag)));
  let nearWater: ((x: number, z: number, r: number) => boolean) | null = null;
  /** Per edge, once asked for. */
  const lazy: (EdgeLand | undefined)[] = [];
  const edgeLand = (index: number): EdgeLand | null => {
    const had = lazy[index];
    if (had) return had;
    const e = road.edges[index];
    if (!e) return null;
    const ss = samplesOf(e);
    const step = ss.length > 1 ? e.length / (ss.length - 1) : e.length;
    const rows: Record<-1 | 1, number[]> = { [-1]: ss.map(() => Number.NaN), [1]: ss.map(() => Number.NaN) };
    /** Whether a row's land runs on to another road (render's `meets`: no shelf, no skirt). */
    const meets: Record<-1 | 1, boolean[]> = { [-1]: ss.map(() => false), [1]: ss.map(() => false) };
    const skirts: Record<-1 | 1, (Skirt | null | undefined)[]> = { [-1]: [], [1]: [] };
    const tags = e.tags;
    const untagged = tags.length === 0;
    const theme = (side: -1 | 1, s: number): SideTheme => themeAt(tags, side < 0 ? 'left' : 'right', s);
    const outerOf = (side: -1 | 1) => (side < 0 ? -(e.dMin - VERGE_M) : e.dMax + VERGE_M);
    const rails = { [-1]: railsOf(road, e, 'left'), [1]: railsOf(road, e, 'right') };
    const otherRoadAt = (s: number, d: number, margin: number) => {
      const p = w(e.index, s, d);
      return covered(p.x, p.z, e.index, (o) => [o.dMin - VERGE_M - margin, o.dMax + VERGE_M + margin]);
    };
    const lowerRoadAt = (s: number, d: number, margin: number) => {
      const p = w(e.index, s, d);
      const top = w(e.index, s, 0).y - BURIED_M;
      return covered(p.x, p.z, e.index, (o, os) =>
        w(o.index, os, 0).y < top ? [o.dMin - VERGE_M - margin, o.dMax + VERGE_M + margin] : null,
      );
    };
    const stripClear = (s: number, side: -1 | 1, d0: number, d1: number) => {
      for (let d = d0; d < d1; d += PROBE_M) if (lowerRoadAt(s, side * d, 1)) return false;
      return true;
    };
    /** Whether the land strip from d0 out to d1 would stand over another road's edges by more than LAND_OVER_ROAD_M. */
    const landOverRoad = (s: number, side: -1 | 1, d0: number, d1: number): boolean => {
      for (let d = d0; d <= d1 + 1e-6; d += LAND_ROAD_PROBE_M) {
        const p = road.toWorld(e.index, s, side * d, LAND_TOP_M);
        const over = covered(
          p.x,
          p.z,
          e.index,
          (o, os, od) =>
            p.y - road.toWorld(o.index, os, od, 0).y > LAND_OVER_ROAD_M
              ? [o.dMin - LAND_ROAD_MARGIN_M, o.dMax + LAND_ROAD_MARGIN_M]
              : null,
          LAND_ROAD_MARGIN_M,
        );
        if (over) return true;
      }
      return false;
    };
    const landmarks = e.features.filter((f) => f.kind === 'landmark' && f.params?.['overRoad'] !== true);
    const landmarkBeyond = (side: -1 | 1, s: number, outer: number, width: number): boolean =>
      landmarks.some((f) => {
        if (Math.sign(f.d0 + f.d1) !== side) return false;
        if (s < Math.min(f.s0, f.s1) - LANDMARK_LEAD_M || s > Math.max(f.s0, f.s1) + LANDMARK_LEAD_M)
          return false;
        const near = Math.min(Math.abs(f.d0), Math.abs(f.d1));
        return near > outer + LAND_STRIP_M - 2 && near < outer + width + SHELF_M + 3;
      });
    const insideKappa = (side: -1 | 1, s: number): number => {
      let k = 0;
      for (let u = s - LAND_STRIP_M; u <= s + LAND_STRIP_M; u += STEP_M) {
        if (u < 0 || u > e.length) continue;
        k = Math.max(k, side * road.kappaAt(e.index, u));
      }
      return k;
    };
    /** One side's reach at sample s, by the road scene's rule, and whether it runs on to another road. */
    const work = (side: -1 | 1, s: number): [number, boolean] => {
      const outer = outerOf(side);
      const th = theme(side, s);
      const land =
        th !== 'none' &&
        th !== 'water' &&
        !rails[side].some((b) => b.kind === 'rail' && s >= b.s0 - 5 && s <= b.s1 + 5) &&
        !(untagged && w(e.index, s, 0).y >= ELEVATED_M);
      if (!land) return [0, false];
      const seawall = SEAWALL_LAND_M[th];
      const k = insideKappa(side, s);
      const room = k > 0 ? FOLD / k - outer - SHELF_M : Infinity;
      const wide = WIDE_LAND_M[th];
      const widths =
        seawall !== undefined
          ? [seawall, seawall / 2]
          : wide !== undefined
            ? [wide, (wide + LAND_STRIP_M) / 2, LAND_STRIP_M, 14, 6]
            : [LAND_STRIP_M, 14, 6];
      for (const width of widths) {
        if (width > room) continue;
        if (width > LAND_STRIP_M && landmarkBeyond(side, s, outer, width)) continue;
        const d = outer + width + SHELF_M;
        if (
          !otherRoadAt(s, side * d, 1) &&
          !otherRoadAt(s, side * (outer + width / 2), 1) &&
          stripClear(s, side, outer, d) &&
          !landOverRoad(s, side, outer, outer + width)
        )
          return [width, false];
      }
      for (const width of GAP_WIDTHS) {
        if (width > room) continue;
        if (
          !otherRoadAt(s, side * (outer + width), GAP_MARGIN_M) &&
          !otherRoadAt(s, side * (outer + width / 2), GAP_MARGIN_M) &&
          stripClear(s, side, outer, outer + width) &&
          !landOverRoad(s, side, outer, outer + width)
        )
          return [width, true];
      }
      return [0, false];
    };
    const reachAt = (side: -1 | 1, i: number): number => {
      const row = rows[side];
      const known = row[i];
      if (known === undefined) return 0;
      if (!Number.isNaN(known)) return known;
      const [r, runsOn] = work(side, ss[i] ?? 0);
      row[i] = r;
      meets[side][i] = runsOn;
      return r;
    };
    /** The skirt past row i's strip, or null (render's `skirtAt`, on its own rows). */
    const skirtAt = (side: -1 | 1, i: number): Skirt | null => {
      const had = skirts[side][i];
      if (had !== undefined) return had;
      const s = ss[i] ?? 0;
      const r = reachAt(side, i);
      let out: Skirt | null = null;
      if (
        !tropical &&
        r > 0 &&
        !meets[side][i] &&
        SEAWALL_LAND_M[theme(side, s) as LandTheme] === undefined
      ) {
        const outer = outerOf(side);
        const top = road.toWorld(e.index, s, side * (outer + r), LAND_TOP_M).y;
        const height = top - SKIRT_GROUND_Y;
        const k = insideKappa(side, s);
        const room = k > 0 ? FOLD / k - outer - r - SHELF_M : Infinity;
        const run = Math.min(SKIRT_RUN_M[1], Math.max(SKIRT_RUN_M[0], height * SKIRT_RUN_PER_M));
        const free = (d: number) => {
          if (otherRoadAt(s, side * d, 2)) return false;
          const p = w(e.index, s, side * d);
          nearWater ??= waterNear(road);
          return !nearWater(p.x, p.z, SKIRT_WATER_CLEAR_M);
        };
        const noRoad = (d0: number, d1: number) => {
          for (let d = d0 + SKIRT_ROAD_PROBE_M; d < d1; d += SKIRT_ROAD_PROBE_M)
            if (lowerRoadAt(s, side * d, 2)) return false;
          return true;
        };
        const foot = outer + r + run;
        if (!(run > room || !free(outer + r + run / 2) || !free(foot) || !noRoad(outer + r, foot))) {
          for (const flat of SKIRT_FLAT_M) {
            if (run + flat > room) continue;
            if (flat === 0 || (free(foot + flat / 2) && free(foot + flat) && noRoad(foot, foot + flat))) {
              out = { run, flat, top };
              break;
            }
          }
        }
      }
      skirts[side][i] = out;
      return out;
    };
    const shelfAt = (side: -1 | 1, i: number): number | null => {
      if (reachAt(side, i) <= 0 || meets[side][i] || skirtAt(side, i)) return null;
      return SEAWALL_LAND_M[theme(side, ss[i] ?? 0) as LandTheme] === undefined
        ? SHELF_RUN_M
        : SEAWALL_SHELF_M;
    };
    const meetsAt = (side: -1 | 1, i: number): boolean => reachAt(side, i) > 0 && (meets[side][i] ?? false);
    const made: EdgeLand = { step, n: ss.length, reachAt, skirtAt, meetsAt, shelfAt };
    lazy[index] = made;
    return made;
  };
  const reach: LandReach = (edge, side, s) => {
    const l = edgeLand(edge);
    if (!l) return 0;
    const i = Math.max(0, Math.min(l.n - 1, Math.floor(s / l.step)));
    return Math.min(l.reachAt(side, i), l.reachAt(side, Math.min(l.n - 1, i + 1)));
  };
  const outer: LandReach = (edge, side, s) => {
    const l = edgeLand(edge);
    if (!l) return 0;
    const i = Math.max(0, Math.min(l.n - 1, Math.floor(s / l.step)));
    const j = Math.min(l.n - 1, i + 1);
    const a = l.reachAt(side, i);
    const b = l.reachAt(side, j);
    const t = Math.max(0, Math.min(1, s / l.step - i));
    // Land stops at a row with none: no quad joins a row of land to one without. On a row itself, the quad before it
    // reaches it too.
    if (a <= 0) return 0;
    if (b <= 0) return t === 0 && i > 0 && l.reachAt(side, i - 1) > 0 ? a : 0;
    return a + (b - a) * t;
  };
  /** The two rows about s (the quad between them), and how far along it s lies; on a row, the quad before it too. */
  const rowsAbout = (l: EdgeLand, s: number): { i: number; j: number; t: number; before: number } => {
    const i = Math.max(0, Math.min(l.n - 1, Math.floor(s / l.step)));
    return { i, j: Math.min(l.n - 1, i + 1), t: Math.max(0, Math.min(1, s / l.step - i)), before: i - 1 };
  };
  const skirt: SkirtAt = (edge, side, s) => {
    const l = edgeLand(edge);
    if (!l) return null;
    // Render draws a slope only between two skirted rows (a fan from their feet), straight between them.
    const { i, j, t, before } = rowsAbout(l, s);
    const a = l.skirtAt(side, i);
    if (!a) return null;
    const b = l.skirtAt(side, j);
    if (!b) return t === 0 && before >= 0 && l.skirtAt(side, before) ? a : null;
    return {
      run: a.run + (b.run - a.run) * t,
      flat: a.flat + (b.flat - a.flat) * t,
      top: a.top + (b.top - a.top) * t,
    };
  };
  const shelf: ShelfAt = (edge, side, s) => {
    const l = edgeLand(edge);
    if (!l) return null;
    // A shelf hangs from the strip's edge between two rows of land that run on to no other road, where either has one.
    const { i, j } = rowsAbout(l, s);
    const a = l.shelfAt(side, i);
    const b = l.shelfAt(side, j);
    const edgeOk = (k: number) =>
      l.reachAt(side, k) > 0 && (l.shelfAt(side, k) !== null || l.skirtAt(side, k) !== null);
    if ((a === null && b === null) || !edgeOk(i) || !edgeOk(j)) return null;
    return a ?? b;
  };
  const out: LandOf = { reach, edge: outer, skirt, shelf, rows: edgeLand };
  kept.set(road, out);
  return out;
}

/**
 * The grid of every edge's samples that finds the roads whose ground may lie under a world point: its cell, m, and
 * how far about the point it looks, m: a road's ground reaches out past its lanes by its widest land strip (72 m),
 * its skirt's longest slope and flat ground (90 and 70 m) and the shelf off them (4 m).
 */
const NEAR_CELL_M = 64;
const NEAR_REACH_M = 260;
/** A point this far or less past an edge's end still lies on its ground, m (render/overlap.ts, as `locator`). */
const NEAR_PAST_M = 0.25;
/** Along its own edge, a point this near the asking cross-section is that section's own, m. */
const OWN_SECTION_M = 2;
/** This many exact world points are kept before they are let go. */
const GROUND_KEPT = 4096;

/**
 * The highest ground a road draws under a world point (x, z), at or under `top`, world y, or null. `own` is the
 * asking road's own cross-section (its edge and s), left out: its own ground there is its own to read.
 */
export type GroundUnder = (
  x: number,
  z: number,
  top: number,
  own?: { edge: number; s: number },
) => number | null;

const groundKept = new WeakMap<RoadNetwork, GroundUnder>();

interface GroundPoint {
  x: number;
  y: number;
  z: number;
  s: number;
}
type GroundTriangle = readonly [GroundPoint, GroundPoint, GroundPoint];

/** Terrain is drawn in world-space triangles, not at the projection onto a curved centre line. */
function terrainUnderOf(
  road: RoadNetwork,
): (edge: number, x: number, z: number) => { y: number; s: number } | null {
  const perEdge = new Map<number, Map<string, GroundTriangle[]>>();
  const cellM = 16;
  const cell = (x: number, z: number) => `${Math.floor(x / cellM)},${Math.floor(z / cellM)}`;
  const rowsOf = landOf(road).rows;
  const make = (edge: number) => {
    const grid = new Map<string, GroundTriangle[]>();
    const ed = road.edges[edge];
    const rows = rowsOf(edge);
    if (!ed || !rows) return grid;
    const tri = (a: GroundPoint, b: GroundPoint, c: GroundPoint) => {
      const t: GroundTriangle = [a, b, c];
      for (
        let x = Math.floor(Math.min(a.x, b.x, c.x) / cellM);
        x <= Math.floor(Math.max(a.x, b.x, c.x) / cellM);
        x++
      ) {
        for (
          let z = Math.floor(Math.min(a.z, b.z, c.z) / cellM);
          z <= Math.floor(Math.max(a.z, b.z, c.z) / cellM);
          z++
        ) {
          const key = `${x},${z}`;
          const list = grid.get(key);
          if (list) list.push(t);
          else grid.set(key, [t]);
        }
      }
    };
    const quad = (a: readonly [GroundPoint, GroundPoint], b: readonly [GroundPoint, GroundPoint]) => {
      tri(a[0], a[1], b[0]);
      tri(a[1], b[1], b[0]);
    };
    const point = (i: number, side: -1 | 1, across: number, y: number) => {
      const p = road.toWorld(edge, i * rows.step, side * across, 0);
      return { x: Math.fround(p.x), y: Math.fround(y), z: Math.fround(p.z), s: i * rows.step };
    };
    const strip = (
      pairs: readonly (readonly [GroundPoint, GroundPoint] | null)[],
      thin = true,
      flip = false,
    ) => {
      let last: readonly [GroundPoint, GroundPoint] | null = null;
      for (let i = 0; i < pairs.length; i++) {
        const row = pairs[i];
        if (!row) {
          last = null;
          continue;
        }
        if (thin && i % 3 !== 0 && i < pairs.length - 1 && pairs[i - 1] && pairs[i + 1]) continue;
        if (last) quad(flip ? [last[1], last[0]] : last, flip ? [row[1], row[0]] : row);
        last = row;
      }
    };
    for (const side of [-1, 1] as const) {
      const outer = side > 0 ? ed.dMax + VERGE_M : VERGE_M - ed.dMin;
      for (const f of ed.features) {
        if (f.kind !== 'roadsideZone') continue;
        const zoneSide = f.d0 + f.d1 < 0 ? -1 : 1;
        const railed = railsOf(road, ed, side < 0 ? 'left' : 'right').some((b) => b.s0 < f.s1 && b.s1 > f.s0);
        if (side !== zoneSide && railed) continue;
        const far = Math.max(Math.abs(f.d0), Math.abs(f.d1));
        const reach = Math.max(outer, side === zoneSide ? far + ZONE_DIVE_M : ed.dMax + ZONE_FAR_M);
        const start = Math.max(0, f.s0 - ZONE_TAPER_M);
        const end = Math.min(ed.length, f.s1 + ZONE_TAPER_M);
        const pairs: (readonly [GroundPoint, GroundPoint])[] = [];
        for (let s = start; ; s = Math.min(end, s + STEP_M)) {
          const outside = s < f.s0 ? f.s0 - s : s > f.s1 ? s - f.s1 : 0;
          const width = outer + (reach - outer) * Math.max(0, 1 - outside / ZONE_TAPER_M);
          const p = (across: number): GroundPoint => {
            const at = road.toWorld(edge, s, side * across, ZONE_LIFT_M);
            return { x: Math.fround(at.x), y: Math.fround(at.y), z: Math.fround(at.z), s };
          };
          pairs.push([p(outer), p(width)]);
          if (s >= end) break;
        }
        strip(pairs, false, side < 0);
      }
      strip(
        Array.from({ length: rows.n }, (_, i) => {
          const r = rows.reachAt(side, i);
          if (r <= 0 || themeAt(ed.tags, side > 0 ? 'right' : 'left', i * rows.step) === 'lake') return null;
          const a = road.toWorld(edge, i * rows.step, side * outer, LAND_TOP_M);
          const b = road.toWorld(edge, i * rows.step, side * (outer + r), LAND_TOP_M);
          return [point(i, side, outer, a.y), point(i, side, outer + r, b.y)] as const;
        }),
        false,
        side < 0,
      );
      const slopes = Array.from({ length: rows.n }, (_, i): readonly [GroundPoint, GroundPoint] | null => {
        const k = rows.skirtAt(side, i);
        if (!k) return null;
        const r = rows.reachAt(side, i);
        return [point(i, side, outer + r, k.top), point(i, side, outer + r + k.run, SKIRT_GROUND_Y)];
      });
      const kept = slopes.map(
        (row, i) => !!row && !(i % 3 !== 0 && i < slopes.length - 1 && slopes[i - 1] && slopes[i + 1]),
      );
      for (let a = 0; a < slopes.length; a++) {
        const ra = slopes[a];
        if (!ra || !kept[a]) continue;
        let b = a + 1;
        while (b < slopes.length && slopes[b] && !kept[b]) b++;
        const rb = slopes[b];
        if (!rb) continue;
        const mid = Math.floor((a + b) / 2);
        for (let j = a; j < b; j++) tri(slopes[j]![0], slopes[j + 1]![0], j < mid ? ra[1] : rb[1]);
        tri(ra[1], rb[1], slopes[mid]![0]);
      }
      strip(
        Array.from({ length: rows.n }, (_, i) => {
          const k = rows.skirtAt(side, i);
          if (!k || k.flat <= 0) return null;
          const from = outer + rows.reachAt(side, i) + k.run;
          return [
            point(i, side, from, SKIRT_GROUND_Y),
            point(i, side, from + k.flat, SKIRT_GROUND_Y),
          ] as const;
        }),
        true,
        side < 0,
      );
    }
    return grid;
  };
  return (edge, x, z) => {
    let grid = perEdge.get(edge);
    if (!grid) {
      grid = make(edge);
      perEdge.set(edge, grid);
    }
    let best: { y: number; s: number } | null = null;
    for (const [a, b, c] of grid.get(cell(x, z)) ?? []) {
      const det = (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z);
      if (Math.abs(det) < 1e-9) continue;
      const u = ((b.z - c.z) * (x - c.x) + (c.x - b.x) * (z - c.z)) / det;
      const v = ((c.z - a.z) * (x - c.x) + (a.x - c.x) * (z - c.z)) / det;
      if (u < -1e-8 || v < -1e-8 || u + v > 1 + 1e-8) continue;
      const y = u * a.y + v * b.y + (1 - u - v) * c.y;
      if (best === null || y > best.y) best = { y, s: u * a.s + v * b.s + (1 - u - v) * c.s };
    }
    return best;
  };
}

/**
 * Where the roads draw ground under a world point (the physical world, 2026-10-06: what is drawn is what is met):
 * each edge's cross-section there (`sectionGroundOf`: its surface out to its verge, its zones' land, its land strip,
 * its skirt and gentle shelf), at its height. A rider out past his own road's edge meets it (road/beyond.ts
 * `beyondAt`): the land inside a junction's corner, the ground between a road and its slip road, a key's land
 * beside a causeway, the hill below a bridge's end. The edges about the point are found on a grid of every edge's
 * samples, built when first asked for, and each is projected from its nearest sample, as `locator` does. A point's
 * ground is kept for the exact world point, so a flight and the forecasts of it ask
 * again for nothing. Pure + - * / and Math.floor/round/min/max.
 */
export function groundUnderOf(road: RoadNetwork, lakeLevel: number | null = null): GroundUnder {
  const known = groundKept.get(road);
  if (known) return known;
  const key = (cx: number, cz: number) => (cx + 0x8000) * 0x10000 + (cz + 0x8000);
  let cells: Map<number, number[]> | null = null;
  const build = () => {
    const m = new Map<number, number[]>();
    for (const e of road.edges) {
      for (let i = 0; i < e.count; i++) {
        const k = key(Math.floor((e.x[i] ?? 0) / NEAR_CELL_M), Math.floor((e.z[i] ?? 0) / NEAR_CELL_M));
        const list = m.get(k);
        if (list) list.push(e.index, i);
        else m.set(k, [e.index, i]);
      }
    }
    return m;
  };
  const section = sectionGroundOf(road, lakeLevel);
  const terrain = terrainUnderOf(road);
  const land = landEdgeOf(road);
  const zones = zoneReachOf(road);
  const painted = splitPaintOf(road);
  const skirts = skirtOf(road);
  const span = Math.ceil(NEAR_REACH_M / NEAR_CELL_M);
  /** Every edge's ground under a point: edge, s, y, and whether it is a world-space triangle. */
  const found = new Map<string, number[]>();
  const groundsAt = (x: number, z: number): number[] => {
    const id = `${x},${z}`;
    const had = found.get(id);
    if (had) return had;
    cells ??= build();
    const cx = Math.floor(x / NEAR_CELL_M);
    const cz = Math.floor(z / NEAR_CELL_M);
    // The nearest sample of each edge about the point.
    const nearest = new Map<number, { i: number; d2: number }>();
    for (let a = -span; a <= span; a++) {
      for (let b = -span; b <= span; b++) {
        const list = cells.get(key(cx + a, cz + b));
        if (!list) continue;
        for (let j = 0; j < list.length; j += 2) {
          const e = list[j] ?? -1;
          const i = list[j + 1] ?? 0;
          const ed = road.edges[e];
          if (!ed) continue;
          const ox = x - (ed.x[i] ?? 0);
          const oz = z - (ed.z[i] ?? 0);
          const d2 = ox * ox + oz * oz;
          const prev = nearest.get(e);
          if (!prev || d2 < prev.d2 || (d2 === prev.d2 && i < prev.i)) nearest.set(e, { i, d2 });
        }
      }
    }
    const out: number[] = [];
    for (const e of [...nearest.keys()].sort((p, q) => p - q)) {
      const ed = road.edges[e];
      const near = nearest.get(e);
      if (!ed || !near || near.d2 > NEAR_REACH_M * NEAR_REACH_M) continue;
      let s = near.i * ed.spacing;
      let d = 0;
      for (let iter = 0; iter < 3; iter++) {
        const clamped = Math.min(ed.length, Math.max(0, s));
        const f = road.frameAt(e, clamped);
        const ox = x - f.x;
        const oz = z - f.z;
        d = -ox * f.tz + oz * f.tx;
        s = clamped + ox * f.tx + oz * f.tz;
      }
      const past = s < 0 ? -s : s > ed.length ? s - ed.length : 0;
      s = Math.min(ed.length, Math.max(0, s));
      const side = d > 0 ? 1 : -1;
      const outer = side > 0 ? ed.dMax + VERGE_M : VERGE_M - ed.dMin;
      const strip = land(e, side, s);
      const inStrip = Math.abs(d) <= outer + strip || Math.abs(d) <= zones(e, side, s) || painted(e, s, d);
      const sectionY =
        (inStrip || skirts(e, side, s) === null) && past <= NEAR_PAST_M ? section(e, s, d) : null;
      const face = terrain(e, x, z);
      const y = typeof sectionY === 'number' ? sectionY : null;
      if (face !== null && (y === null || face.y > y)) out.push(e, face.s, face.y, 1);
      else if (y !== null) out.push(e, s, y, 0);
    }
    if (found.size >= GROUND_KEPT) found.clear();
    found.set(id, out);
    return out;
  };
  const under: GroundUnder = (x, z, top, own) => {
    const grounds = groundsAt(x, z);
    let best: number | null = null;
    for (let j = 0; j < grounds.length; j += 4) {
      const e = grounds[j] ?? -1;
      const y = grounds[j + 2] ?? -Infinity;
      // The asking road's own cross-section (another part of its edge, a switchback's other leg, is ground like any).
      if (
        own &&
        !grounds[j + 3] &&
        e === own.edge &&
        Math.abs((grounds[j + 1] ?? 0) - own.s) <= OWN_SECTION_M
      )
        continue;
      if (y <= top && (best === null || y > best)) best = y;
    }
    return best;
  };
  groundKept.set(road, under);
  return under;
}

/**
 * The land render lays under each roadside zone (render/road-mesh.ts, "Land under the roadside zones": playtest 1b,
 * pedestrians stood in the water), m: out to this far past the zone's far edge on its side, and this far past the
 * lanes on the other (unless a rail stops anyone crossing), tapering into the verge over this length past each end
 * of the zone (road-mesh.ts LAND_DIVE_M, LAND_FAR_M, LAND_TAPER_M). Beside a railed road it is a walkway, a fishing
 * catwalk on the bridge.
 */
const ZONE_DIVE_M = 4.5;
const ZONE_FAR_M = 7;
const ZONE_TAPER_M = 8;
/** The zones' land lies this far under the road's surface (road-mesh.ts LAND_LIFT_M). */
const ZONE_LIFT_M = -0.06;

/** How far from the centre line a road's roadside-zone land reaches at s on a side, m (0 = none). */
export type ZoneReach = (edge: number, side: -1 | 1, s: number) => number;

const zoneKept = new WeakMap<RoadNetwork, ZoneReach>();

/**
 * The land under a road's roadside zones (`ZONE_DIVE_M`), by render's rule: at road height (4 cm under the verge,
 * road-mesh.ts LAND_LIFT_M) from the drawn verge out to the zone's far edge plus a dive on its side, and to
 * ZONE_FAR_M past the lanes on the other side unless a rail stands there; a quad between render's rows, which run
 * every STEP_M from ZONE_TAPER_M before the zone, so its edge is taken straight between them. The widest of a
 * side's zones at s.
 */
export function zoneReachOf(road: RoadNetwork): ZoneReach {
  const known = zoneKept.get(road);
  if (known) return known;
  const perEdge: (
    { s0: number; s1: number; a: number; side: -1 | 1; inner: number; reach: number }[] | undefined
  )[] = [];
  const zonesOf = (index: number) => {
    const had = perEdge[index];
    if (had) return had;
    const e = road.edges[index];
    const out: { s0: number; s1: number; a: number; side: -1 | 1; inner: number; reach: number }[] = [];
    if (e) {
      const rails = { [-1]: railsOf(road, e, 'left'), [1]: railsOf(road, e, 'right') };
      for (const f of e.features) {
        if (f.kind !== 'roadsideZone') continue;
        const zoneSide = f.d0 + f.d1 < 0 ? -1 : 1;
        const far = Math.max(Math.abs(f.d0), Math.abs(f.d1));
        for (const side of [-1, 1] as const) {
          const railed = rails[side].some((b) => b.s0 < f.s1 && b.s1 > f.s0);
          if (side !== zoneSide && railed) continue;
          const inner = side < 0 ? VERGE_M - e.dMin : e.dMax + VERGE_M;
          const reach = Math.max(inner, side === zoneSide ? far + ZONE_DIVE_M : e.dMax + ZONE_FAR_M);
          out.push({ s0: f.s0, s1: f.s1, a: Math.max(0, f.s0 - ZONE_TAPER_M), side, inner, reach });
        }
      }
    }
    perEdge[index] = out;
    return out;
  };
  const at: ZoneReach = (edge, side, s) => {
    const e = road.edges[edge];
    if (!e) return 0;
    let best = 0;
    for (const z of zonesOf(edge)) {
      if (z.side !== side) continue;
      const b = Math.min(e.length, z.s1 + ZONE_TAPER_M);
      if (s < z.a || s > b) continue;
      const width = (u: number) => {
        const outside = u < z.s0 ? z.s0 - u : u > z.s1 ? u - z.s1 : 0;
        return z.inner + (z.reach - z.inner) * Math.max(0, 1 - outside / ZONE_TAPER_M);
      };
      // Render's rows: from a, every STEP_M, and the last at b.
      const r0 = Math.min(b, z.a + Math.floor((s - z.a) / STEP_M) * STEP_M);
      const r1 = Math.min(b, r0 + STEP_M);
      const t = r1 > r0 ? (s - r0) / (r1 - r0) : 0;
      best = Math.max(best, width(r0) + (width(r1) - width(r0)) * t);
    }
    return best;
  };
  zoneKept.set(road, at);
  return at;
}

/**
 * Where render paints a split zone's fill (road-mesh.ts, "The split zone"; secret roads' zones are not painted): on
 * its edge from s0 to s1, across the zone clamped to the lanes' edges, or across the whole zone where that leaves
 * less than ZONE_MIN_PAINT_M (a zone off the road), ZONE_FILL_LIFT_M over the road's surface.
 */
const ZONE_MIN_PAINT_M = 0.3;
const ZONE_FILL_LIFT_M = 0.015;

/** Whether a split zone's fill is painted at (edge, s, d). */
export type SplitPaintAt = (edge: number, s: number, d: number) => boolean;

const splitKept = new WeakMap<RoadNetwork, SplitPaintAt>();

export function splitPaintOf(road: RoadNetwork): SplitPaintAt {
  const known = splitKept.get(road);
  if (known) return known;
  const secret = (index: number) => road.edges[index]?.tags.some((t) => t.tag === 'secret') ?? false;
  const zones = road.splitZones().filter((z) => !secret(z.toEdge));
  const at: SplitPaintAt = (edge, s, d) => {
    for (const z of zones) {
      if (z.edge !== edge) continue;
      const len = road.edges[edge]?.length ?? 0;
      if (s < Math.max(0, z.s0) || s > Math.min(len, z.s1)) continue;
      const zLo = Math.min(z.d0, z.d1);
      const zHi = Math.max(z.d0, z.d1);
      let lo = 0;
      let hi = 0;
      for (const l of road.lanesAt(edge, s)) {
        lo = Math.min(lo, l.dCenterM - l.widthM / 2);
        hi = Math.max(hi, l.dCenterM + l.widthM / 2);
      }
      const cLo = Math.max(zLo, lo);
      const cHi = Math.min(zHi, hi);
      const [a, b] = cHi - cLo >= ZONE_MIN_PAINT_M ? [cLo, cHi] : [zLo, zHi];
      if (d >= a && d <= b) return true;
    }
    return false;
  };
  splitKept.set(road, at);
  return at;
}

/**
 * A ground drawn as a slope holds a bike (and is met as ground) only up to this rise per metre out (a slope under 27
 * degrees; the terrain skirt's is 1 in 2.2); a steeper one, the shelf off a high strip, is a face to fall past.
 */
const GENTLE = 0.5;
/** A lake's bank: the land at the road's height this far past the verge, then the shore this far over the water where the land stands this far over that (render/scenery.ts LAKE_BANK_M, LAKE_SHORE_OVER_M; road-mesh.ts LAKE_WALL_MIN_M). */
const LAKE_BANK_M = 4.2;
const LAKE_SHORE_OVER_M = 0.3;
const LAKE_WALL_MIN_M = 0.5;
/** Where a lake's bank begins or ends, its wall grows this many metres per metre along the road (road-mesh.ts LAKE_RAMP_M_PER_M). */
const LAKE_RAMP_M_PER_M = 0.5;

/** The highest ground one edge's cross-section draws at (s, d), world y, or null where it draws none there. */
export type SectionGround = (edge: number, s: number, d: number) => number | null;

const sectionKept = new WeakMap<RoadNetwork, SectionGround>();

/**
 * The ground one edge's cross-section draws (render/road-mesh.ts `buildRoadScene`, row by row): its surface out to
 * its drawn verge (none over a gap's hole); a split zone's fill painted off the road; the land under its roadside
 * zones; its land strip (`landEdgeOf`), a lake's bank and shore where `lakeLevel` is the network's lake (the land at
 * the road's height LAKE_BANK_M past the verge, then the shore just over the water); past the strip its terrain
 * skirt (`skirtOf`: the slope, its flat ground and the shelf off it) or its shelf into the sea (`shelfOf`), where
 * gentle enough to hold a bike (GENTLE). Pure + - * / and Math.min/max.
 */
export function sectionGroundOf(road: RoadNetwork, lakeLevel: number | null = null): SectionGround {
  const known = sectionKept.get(road);
  if (known) return known;
  const land = landEdgeOf(road);
  const zones = zoneReachOf(road);
  const painted = splitPaintOf(road);
  const skirt = skirtOf(road);
  const shelf = shelfOf(road);
  const rows = landOf(road).rows;
  /** A row's bank (render's lake bank, road-mesh.ts): the plateau's height and its wall's full drop, or null. */
  const banks = new Map<string, { plateau: number; drop: number } | null>();
  const bankAt = (e: number, side: -1 | 1, i: number): { plateau: number; drop: number } | null => {
    const id = `${e},${side},${i}`;
    const had = banks.get(id);
    if (had !== undefined) return had;
    let out: { plateau: number; drop: number } | null = null;
    const l = rows(e);
    const ed = road.edges[e];
    if (lakeLevel !== null && l && ed && i >= 0 && i < l.n) {
      const s = i * l.step;
      const r = l.reachAt(side, i);
      if (
        r > LAKE_BANK_M + 2 &&
        !l.meetsAt(side, i) &&
        themeAt(ed.tags, side > 0 ? 'right' : 'left', s) === 'lake'
      ) {
        const verge = side > 0 ? ed.dMax + VERGE_M : VERGE_M - ed.dMin;
        const plateau = road.toWorld(e, s, side * (verge + LAKE_BANK_M), LAND_TOP_M).y;
        const mid = road.toWorld(e, s, side * (verge + (LAKE_BANK_M + r) / 2), 0);
        const far = road.toWorld(e, s, side * (verge + r + 1), 0);
        const water = lakeWaterAt(road.id, mid.x, mid.z);
        if (water !== null && lakeWaterAt(road.id, far.x, far.z) !== null) {
          const drop = plateau - (water + LAKE_SHORE_OVER_M);
          if (drop >= LAKE_WALL_MIN_M) out = { plateau, drop };
        }
      }
    }
    banks.set(id, out);
    return out;
  };
  /**
   * The shore's height at row i: where the bank begins or ends its wall grows from none at LAKE_RAMP_M_PER_M along
   * the road (road-mesh.ts: rows to the nearest row without a bank, the road's ends not counting as one).
   */
  const shoreRow = (e: number, side: -1 | 1, i: number): number | null => {
    const b = bankAt(e, side, i);
    const l = rows(e);
    if (!b || !l) return null;
    let toNone = Infinity;
    for (const dir of [-1, 1]) {
      for (let k = 1; i + dir * k >= 0 && i + dir * k < l.n; k++) {
        if (!bankAt(e, side, i + dir * k)) {
          toNone = Math.min(toNone, k);
          break;
        }
      }
    }
    return b.plateau - Math.min(b.drop, LAKE_RAMP_M_PER_M * Math.max(0, toNone - 1) * l.step);
  };
  /** The shore's height at s, straight between the rows about it, or null where either has no bank. */
  const shoreAt = (e: number, side: -1 | 1, s: number): number | null => {
    const l = rows(e);
    if (!l || lakeLevel === null) return null;
    const i = Math.max(0, Math.min(l.n - 1, Math.floor(s / l.step)));
    const j = Math.min(l.n - 1, i + 1);
    const t = Math.max(0, Math.min(1, s / l.step - i));
    const a = shoreRow(e, side, i);
    const b = shoreRow(e, side, j);
    if (a === null) return null;
    if (b === null) return t === 0 ? a : null;
    return a + (b - a) * t;
  };
  const at: SectionGround = (e, s, d) => {
    const ed = road.edges[e];
    if (!ed) return null;
    const lo = ed.dMin - VERGE_M;
    const hi = ed.dMax + VERGE_M;
    if (d >= lo && d <= hi) return holeIn(road, e, s) ? null : road.toWorld(e, s, d, 0).y;
    const side = d > 0 ? 1 : -1;
    const out = side > 0 ? d - hi : lo - d;
    const y = (h: number) => road.toWorld(e, s, d, h).y;
    let best: number | null = null;
    const take = (v: number) => {
      if (best === null || v > best) best = v;
    };
    if (painted(e, s, d)) take(y(ZONE_FILL_LIFT_M));
    if (side * d <= zones(e, side, s)) take(y(ZONE_LIFT_M));
    const r = land(e, side, s);
    if (r <= 0) return best;
    const edgeD = side * ((side > 0 ? hi : -lo) + r);
    if (out <= r) {
      // A lake's bank (Lake Samish): the land at the road's height to the bank, then the shore just over the water.
      if (out > LAKE_BANK_M) {
        const shore = shoreAt(e, side, s);
        if (shore !== null) {
          take(shore);
          return best;
        }
      }
      take(y(LAND_TOP_M));
      return best;
    }
    const past = out - r;
    const top = road.toWorld(e, s, edgeD, LAND_TOP_M).y;
    const k = skirt(e, side, s);
    if (k) {
      if (past <= k.run) take(k.top - ((k.top - SKIRT_GROUND_Y) * past) / k.run);
      else if (past <= k.run + k.flat) take(SKIRT_GROUND_Y);
      else if (past <= k.run + k.flat + SHELF_RUN_M)
        take(SKIRT_GROUND_Y - ((SKIRT_GROUND_Y - SHELF_FOOT_Y) * (past - k.run - k.flat)) / SHELF_RUN_M);
      return best;
    }
    const run = shelf(e, side, s);
    if (run !== null && past <= run && top - SHELF_FOOT_Y <= GENTLE * run)
      take(top - ((top - SHELF_FOOT_Y) * past) / run);
    return best;
  };
  sectionKept.set(road, at);
  return at;
}

/**
 * Whether a `gap` takes the whole road away at (edge, s): its box covers the drive lanes (within half a metre of
 * their edges), where render breaks the road's strips (road-mesh.ts `gapSpans`; road/beyond.ts `holeAt` is the same
 * rule). A gap that leaves the lanes is drawn over.
 */
function holeIn(road: RoadNetwork, edge: number, s: number): boolean {
  const e = road.edges[edge];
  if (!e) return false;
  for (const f of e.features) {
    if (f.kind !== 'gap') continue;
    const s0 = Math.max(0, Math.min(f.s0, f.s1));
    const s1 = Math.min(e.length, Math.max(f.s0, f.s1));
    if (s1 - s0 < 0.05 || s <= s0 || s >= s1) continue;
    let lo = Infinity;
    let hi = -Infinity;
    for (const lane of road.lanesAt(edge, (s0 + s1) / 2)) {
      if (lane.kind !== 'drive') continue;
      lo = Math.min(lo, lane.dCenterM - lane.widthM / 2);
      hi = Math.max(hi, lane.dCenterM + lane.widthM / 2);
    }
    if (!(lo < hi)) {
      lo = e.dMin;
      hi = e.dMax;
    }
    if (Math.min(f.d0, f.d1) <= lo + 0.5 && Math.max(f.d0, f.d1) >= hi - 0.5) return true;
  }
  return false;
}
