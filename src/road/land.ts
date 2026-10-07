// How far the land beside a road reaches past its verge (the physical world, the maintainer, 2026-10-06:
// "consistent physics and gameplay is important here so players know what to expect and how to interact
// with the world"). Render's road scene draws a strip of ground past the verge of every tagged side
// (render/road-mesh.ts `buildRoadScene`, its land strip; `RoadScene.landReach` reads it back), and a
// structure planner that stands buildings only on drawn ground (downtown Portland's blocks,
// road/structures/downtown.ts) needs that reach before anything is drawn, from the network alone. This is
// the strip's width rule, moved here unchanged: the same 2 m samples, the same widths tried in the same
// order (the theme's wide strip, the usual strip, then narrower), the same keep-offs (another road at the
// strip's middle or past its shelf, a lower road under it, a rail span, a landmark beyond the usual strip,
// the inside of a tight turn), and the same narrow land that runs on to a neighbouring road's verge.
//
// One difference, by design: the strip reads the edge's own tags, features and barriers (the road files
// the network was made from), where render reads the road files it was handed (`RoadDressing`), and a
// road file with no `barriers` key at all is read as none here, as the network keeps it (render falls back
// to the bridge tags and the elevation rule). Every road file of the networks that use this carries the
// key; land.test.ts holds this rule to the drawn scene's reach on them.
//
// Pure + - * / and Math.min/max/abs/floor/round (no trig), like the rest of road/.
import type { BakedBarrier } from './types';
import type { Edge, RoadNetwork } from './network';
import { themeAt, type LandTheme, type SideTheme } from './themes';

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
function railsOf(road: RoadNetwork, e: Edge, side: 'left' | 'right'): { s0: number; s1: number }[] {
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
    .flatMap((b) => (b.kind === 'rail' ? railed(b) : [{ s0: b.s0, s1: b.s1 }]));
}

const kept = new WeakMap<RoadNetwork, LandReach>();

/**
 * The land's reach past the verge for every edge of a network, by its road scene's rule: at s, the
 * narrower of the two samples either side (the strip between two samples is a quad as wide as its
 * narrower end). Computed once per network.
 */
export function landReachOf(road: RoadNetwork): LandReach {
  const known = kept.get(road);
  if (known) return known;
  const covered = locator(road);
  const w = (edge: number, s: number, d: number) => road.toWorld(edge, s, d, 0);
  const reach: { step: number; rows: Record<-1 | 1, number[]> }[] = [];
  for (const e of road.edges) {
    const ss = samplesOf(e);
    const step = ss.length > 1 ? e.length / (ss.length - 1) : e.length;
    const rows: Record<-1 | 1, number[]> = { [-1]: [], [1]: [] };
    reach[e.index] = { step, rows };
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
    for (const side of [-1, 1] as const) {
      const outer = outerOf(side);
      const out = rows[side];
      for (const s of ss) {
        const th = theme(side, s);
        const land =
          th !== 'none' &&
          th !== 'water' &&
          !rails[side].some((b) => s >= b.s0 - 5 && s <= b.s1 + 5) &&
          !(untagged && w(e.index, s, 0).y >= ELEVATED_M);
        let r = 0;
        if (land) {
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
            ) {
              r = width;
              break;
            }
          }
          if (r === 0) {
            for (const width of GAP_WIDTHS) {
              if (width > room) continue;
              if (
                !otherRoadAt(s, side * (outer + width), GAP_MARGIN_M) &&
                !otherRoadAt(s, side * (outer + width / 2), GAP_MARGIN_M) &&
                stripClear(s, side, outer, outer + width) &&
                !landOverRoad(s, side, outer, outer + width)
              ) {
                r = width;
                break;
              }
            }
          }
        }
        out.push(r);
      }
    }
  }
  const at: LandReach = (edge, side, s) => {
    const l = reach[edge];
    if (!l) return 0;
    const row = l.rows[side];
    const n = row.length;
    const i = Math.max(0, Math.min(n - 1, Math.floor(s / l.step)));
    return Math.min(row[i] ?? 0, row[Math.min(n - 1, i + 1)] ?? 0);
  };
  kept.set(road, at);
  return at;
}
