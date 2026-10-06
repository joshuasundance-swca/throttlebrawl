// The land the road scene draws beside each road, as a pure function of the network (the physical world,
// the maintainer, 2026-10-06; docs/architecture.md, "Physical world"). render/road-mesh.ts `buildRoadScene`
// lays a strip of ground from the drawn verge out past each tagged side, and narrows it or gives it up where
// another road, a rail, a tight bend or a landmark beyond is in the way; its `landReach` says how far the
// strip runs. A structure planner may never read render's drawn scene, so this module is that strip rule,
// moved here unchanged: the same samples, the same widths tried in the same order, the same tests of other
// roads (render/overlap.ts `EdgeLocator`, ported below), so a plan sizes its lots on the land render draws.
// src/road/structures/land.test.ts holds the two equal at every sample of the networks it reads.
//
// What it leaves out: the lake shore's bank (`RoadScene.landTop`), which needs the lake's water, a backdrop
// file render loads later; the reach does not depend on it.
//
// Pure + - * / and Math.min, max, round, floor, abs and sqrt (exact in IEEE arithmetic), like the rest of road/.
import type { Edge, RoadNetwork } from '../network';
import { themeAt, type LandTheme } from '../themes';
import type { BakedBarrier } from '../types';

/** The drawn verge past the drawn shoulder (render/road-mesh.ts VERGE_M), m. */
const VERGE_M = 0.6;
/** render/road-mesh.ts's sample step along an edge, m. */
const STEP_M = 2;
/** A road at least this high with no tags is railed and grows no land (road-mesh.ts ELEVATED_M), m. */
const ELEVATED_M = 2.5;
/** The usual strip, its shelf, and the narrower strips tried (road-mesh.ts SCENERY_LAND_M, SCENERY_SHELF_M), m. */
const SCENERY_LAND_M = 24;
const SCENERY_SHELF_M = 4;
/** Land widths tried where another road leaves no room for a shelf, and their margin (road-mesh.ts), m. */
const LAND_GAP_WIDTHS = [12, 9, 6, 4, 2.5, 1.5] as const;
const LAND_GAP_MARGIN_M = 0.3;
/** On the inside of a turn, land and its shelf reach at most this share of the turn's radius. */
const LAND_FOLD = 0.85;
/** A wide strip keeps off a landmark beyond the usual strip from this far before it to this far after it, m. */
const LANDMARK_LEAD_M = 12;
/** Another road is looked for across the strip every this many metres (road-mesh.ts STRIP_ROAD_PROBE_M). */
const STRIP_ROAD_PROBE_M = 4;
/** A road this far or more below another's height is one its land would bury (road-mesh.ts BURIED_M), m. */
const BURIED_M = 1.5;
/** render/scenery.ts BLUFF_LAND_M, LAKE_LAND_M, SEAWALL_LAND_M and WIDE_LAND_M (land.test.ts holds them equal). */
export const SEAWALL_LAND: Readonly<Partial<Record<LandTheme, number>>> = {
  promenade: 11.4,
  bluff: 10,
  lake: 20,
};
export const WIDE_LAND: Readonly<Partial<Record<LandTheme, number>>> = { blocks: 60, oldtown: 72 };

/** How far outside an edge's centre line a point may lie and still be looked up (render/overlap.ts REACH_M), m. */
const REACH_M = 40;

interface Box {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** Nearest point on one edge's centre line (render/overlap.ts `projectOnto`). */
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

/** Which edges lie under a world point (render/overlap.ts `EdgeLocator`, the same lookup). */
class EdgeLocator {
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

  /** Whether another edge's span (in its own d) covers the point. */
  covered(
    x: number,
    z: number,
    except: number,
    span: (edge: Edge, s: number) => readonly [number, number] | null,
  ): boolean {
    for (const e of this.road.edges) {
      if (e.index === except) continue;
      const b = this.boxes[e.index];
      if (!b || x < b.minX - REACH_M || x > b.maxX + REACH_M || z < b.minZ - REACH_M || z > b.maxZ + REACH_M)
        continue;
      const p = projectOnto(this.road, e, x, z);
      if (p.past > 0.25 || Math.abs(p.d) > REACH_M) continue;
      const sp = span(e, p.s);
      if (sp && p.d > sp[0] && p.d < sp[1]) return true;
    }
    return false;
  }
}

/** render/road-mesh.ts `samplesOf`: an edge's samples, about STEP_M apart, both ends included. */
function samplesOf(e: Edge): number[] {
  const n = Math.max(1, Math.round(e.length / STEP_M));
  const out: number[] = [];
  for (let i = 0; i <= n; i++) out.push((e.length * i) / n);
  return out;
}

const sideHas = (side: string | undefined, want: 'left' | 'right') =>
  side === undefined || side === 'both' || side === want;

/** render/road-mesh.ts `railedParts`: a rail is drawn only where a bridge tag covers it or the road stands high. */
function railedParts(
  road: RoadNetwork,
  e: Edge,
  side: 'left' | 'right',
  b: BakedBarrier,
): { s0: number; s1: number }[] {
  const bridges = e.tags.filter((t) => t.tag === 'bridge' && sideHas(t.side, side));
  const onBridge = (s: number) => bridges.some((t) => s >= t.s0 && s <= t.s1);
  const onDrop = (s: number) => road.toWorld(e.index, s, 0, 0).y >= ELEVATED_M;
  const out: { s0: number; s1: number }[] = [];
  let start = -1;
  const last = Math.min(e.length, b.s1);
  for (let s = Math.max(0, b.s0); ; s = Math.min(last, s + 2)) {
    const yes = onBridge(s) || onDrop(s);
    if (yes && start < 0) start = s;
    if (!yes && start >= 0) {
      out.push({ s0: start, s1: s });
      start = -1;
    }
    if (s >= last) break;
  }
  if (start >= 0) out.push({ s0: start, s1: last });
  return out;
}

/**
 * render/road-mesh.ts `barriersFor` for a road file that carries its barriers (every road file does: a baked
 * road always writes the key): its walls, and its rails where they are drawn.
 */
function barriersFor(road: RoadNetwork, e: Edge, side: 'left' | 'right'): { s0: number; s1: number }[] {
  return e.barriers
    .filter((b) => sideHas(b.side, side))
    .flatMap((b) => (b.kind === 'rail' ? railedParts(road, e, side, b) : [{ s0: b.s0, s1: b.s1 }]));
}

/** An edge's land: its sample step and the reach at each sample, per side. */
interface EdgeLand {
  step: number;
  reach: Record<-1 | 1, number[]>;
}

/** The land of every edge, as render/road-mesh.ts lays it. */
function landOf(road: RoadNetwork): EdgeLand[] {
  const locator = new EdgeLocator(road);
  const out: EdgeLand[] = [];
  for (const e of road.edges) {
    const ss = samplesOf(e);
    const w = (s: number, d: number) => road.toWorld(e.index, s, d, 0);
    const tags = e.tags;
    const untagged = tags.length === 0;
    const sideName = (side: -1 | 1) => (side < 0 ? 'left' : 'right');
    const rails = { [-1]: barriersFor(road, e, 'left'), [1]: barriersFor(road, e, 'right') } as Record<
      -1 | 1,
      { s0: number; s1: number }[]
    >;
    const outerL = e.dMin - VERGE_M;
    const outerR = e.dMax + VERGE_M;
    const outerOf = (side: -1 | 1) => (side < 0 ? -outerL : outerR);
    const otherRoadAt = (s: number, d: number, margin: number) => {
      const p = w(s, d);
      return locator.covered(p.x, p.z, e.index, (o) => [
        o.dMin - VERGE_M - margin,
        o.dMax + VERGE_M + margin,
      ]);
    };
    const lowerRoadAt = (s: number, d: number, margin: number) => {
      const p = w(s, d);
      const top = w(s, 0).y - BURIED_M;
      return locator.covered(p.x, p.z, e.index, (o, os) =>
        road.toWorld(o.index, os, 0, 0).y < top
          ? [o.dMin - VERGE_M - margin, o.dMax + VERGE_M + margin]
          : null,
      );
    };
    const stripClear = (s: number, side: -1 | 1, d0: number, d1: number) => {
      for (let d = d0; d < d1; d += STRIP_ROAD_PROBE_M) if (lowerRoadAt(s, side * d, 1)) return false;
      return true;
    };
    const landmarks = e.features.filter((f) => f.kind === 'landmark' && f.params?.['overRoad'] !== true);
    const landmarkBeyond = (side: -1 | 1, s: number, outer: number, width: number): boolean =>
      landmarks.some((f) => {
        if (Math.sign(f.d0 + f.d1) !== side) return false;
        if (s < Math.min(f.s0, f.s1) - LANDMARK_LEAD_M || s > Math.max(f.s0, f.s1) + LANDMARK_LEAD_M)
          return false;
        const near = Math.min(Math.abs(f.d0), Math.abs(f.d1));
        return near > outer + SCENERY_LAND_M - 2 && near < outer + width + SCENERY_SHELF_M + 3;
      });
    const insideKappa = (side: -1 | 1, s: number): number => {
      let k = 0;
      for (let u = s - SCENERY_LAND_M; u <= s + SCENERY_LAND_M; u += STEP_M) {
        if (u < 0 || u > e.length) continue;
        k = Math.max(k, side * road.kappaAt(e.index, u));
      }
      return k;
    };
    const step = ss.length > 1 ? e.length / (ss.length - 1) : e.length;
    const reach: Record<-1 | 1, number[]> = { [-1]: [], [1]: [] };
    for (const side of [-1, 1] as const) {
      const outer = outerOf(side);
      for (const s of ss) {
        const th = themeAt(tags, sideName(side), s);
        const land =
          th !== 'none' &&
          th !== 'water' &&
          !rails[side].some((b) => s >= b.s0 - 5 && s <= b.s1 + 5) &&
          !(untagged && w(s, 0).y >= ELEVATED_M);
        let r = 0;
        if (land) {
          const seawall = SEAWALL_LAND[th];
          const k = insideKappa(side, s);
          const room = k > 0 ? LAND_FOLD / k - outer - SCENERY_SHELF_M : Infinity;
          const wide = WIDE_LAND[th];
          const widths =
            seawall !== undefined
              ? [seawall, seawall / 2]
              : wide !== undefined
                ? [wide, (wide + SCENERY_LAND_M) / 2, SCENERY_LAND_M, 14, 6]
                : [SCENERY_LAND_M, 14, 6];
          for (const width of widths) {
            if (width > room) continue;
            if (width > SCENERY_LAND_M && landmarkBeyond(side, s, outer, width)) continue;
            const d = outer + width + SCENERY_SHELF_M;
            if (
              !otherRoadAt(s, side * d, 1) &&
              !otherRoadAt(s, side * (outer + width / 2), 1) &&
              stripClear(s, side, outer, d)
            ) {
              r = width;
              break;
            }
          }
          if (r === 0) {
            for (const width of LAND_GAP_WIDTHS) {
              if (width > room) continue;
              if (
                !otherRoadAt(s, side * (outer + width), LAND_GAP_MARGIN_M) &&
                !otherRoadAt(s, side * (outer + width / 2), LAND_GAP_MARGIN_M) &&
                stripClear(s, side, outer, outer + width)
              ) {
                r = width;
                break;
              }
            }
          }
        }
        reach[side].push(r);
      }
    }
    out[e.index] = { step, reach };
  }
  return out;
}

/** How far the drawn land reaches past an edge's drawn verge at s on a side, m (render's `RoadScene.landReach`). */
export type LandReach = (edge: number, side: -1 | 1, s: number) => number;

const kept = new WeakMap<RoadNetwork, LandReach>();

/** The land reach of a network, worked out once and kept (render/road-mesh.ts `RoadScene.landReach`, the same rule). */
export function landReachOf(road: RoadNetwork): LandReach {
  const known = kept.get(road);
  if (known) return known;
  const land = landOf(road);
  const fn: LandReach = (edge, side, s) => {
    const l = land[edge];
    if (!l) return 0;
    const rows = l.reach[side];
    const n = rows.length;
    const i = Math.max(0, Math.min(n - 1, Math.floor(s / l.step)));
    return Math.min(rows[i] ?? 0, rows[Math.min(n - 1, i + 1)] ?? 0);
  };
  kept.set(road, fn);
  return fn;
}
