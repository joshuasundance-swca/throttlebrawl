// Every landmark's solid parts at their drawn heights (the physical world, the maintainer, 2026-10-06:
// everything a rider can reach is physical at its drawn shape, "landmarks too"). Render draws each landmark
// where landmark-places.ts puts it (render/landmarks.ts); this planner stands its parts there, as structures:
// - a kit node's parts are measured from the node render draws (landmark-parts.ts, held to the committed files
//   by scripts/structure-parts.test.ts): a building solid from its ground to its roofs, open work (a gate, a
//   truss, a lift tower) solid in each column from its lowest drawn point to its highest, so a landmark too big
//   or open to stand on is still solid below its parts' tops. What the road runs through or under (`overRoad`)
//   keeps only its parts over the deck: under the deck is under the course, met only by falling;
// - the composites render builds in code are built here from the same figures: the Golden Gate's towers (its
//   kit's tower, cut at the deck), its anchorages' stepped housings, its main cables and its suspender ropes;
//   Fred the Tree, Pigeon Key's island with its cottages and dock, the Twin Peaks summit lot (sheared to the
//   road's grade), and the cruise ship's top deck;
// - a rain cloud over a landmark (`cloudM`) is weather, not a solid.
// A figure render reads from a loaded kit (a bay's length, the Golden Gate's saddles) is a fixed number here
// (`LANDMARK_FIGURES`, held to the files' extras), so the plan is the same before and after the kits load.
//
// Pure + - * / and core math, like the rest of road/.
import { atan2, cos, PI, sin } from '../../core';
import type { RoadNetwork } from '../network';
import type { StructureClass, StructurePlanner, StructureSpec } from '../structures';
import { LANDMARK_PARTS } from './landmark-parts';
import { landmarkPlaces, type LandmarkPlace } from './landmark-places';

/** The figures render reads from the loaded kits, fixed (scripts/structure-parts.test.ts holds them to the files). */
export const LANDMARK_FIGURES = {
  /** A bay node runs from its origin along +Z this far (its `bay_m`); render places it by its middle. */
  bayM: {
    'pdx-landmarks#pdx_truss_bay': 40,
    'pdx-landmarks#pdx_lift_span': 64,
    'golden-gate#gg_bay': 15.24,
  } as Readonly<Record<string, number>>,
  /** The Golden Gate tower's top and its cable saddles' distance from the centre line (`top_m`, `cable_saddle_x_m`). */
  ggTopM: 225,
  ggSaddleXM: 17.5,
  /** How high over the deck the cable enters its anchorage (`cable_entry_m`). */
  ggCableEntryM: 6,
} as const;

/** render/landmarks.ts SUSPENSION: the bridge's figures the plan follows (scripts/structures-landmarks.test.ts). */
export const SUSPENSION_PLAN = {
  sideSpanM: 343,
  midClearM: 3,
  sideSag: 0.015,
  radiusNear: 0.5,
  ropeRadiusNear: 0.14,
  ropeMinM: 1.5,
  ropeTowerClearM: 12,
  ropeFootM: 1.1,
} as const;

/** render/gg-anchorage.ts ANCHORAGE: the housings' steps, over the deck. */
export const ANCHORAGE_PLAN = {
  halfWidthM: [2.9, 2.4, 1.9, 1.5],
  lengthM: [20, 15, 9.5, 4.5],
  topM: [1.1, 2.6, 4.2],
  capUnderM: 0.3,
  collar: { halfWidthM: 0.9, halfHeightM: 0.6, z0: -0.2, z1: 0.7 },
} as const;

/** render/pigeon-key.ts PIGEON_KEY: where the cottages and the dock stand on the island, and its top. */
export const PIGEON_KEY_PLAN = {
  topY: 0.8,
  buildings: [
    { node: 'pigeon_key_cottage_a', x: 1, z: -18, yaw: -PI / 2 },
    { node: 'pigeon_key_cottage_b', x: 1, z: 14, yaw: -PI / 2 },
    { node: 'pigeon_key_dock', x: 17, z: -18, yaw: -PI / 2 },
  ],
} as const;

/** render/summit-lot.ts SUMMIT_LOT.halfAlongM: the lot's half length, over which render reads the road's grade. */
export const SUMMIT_LOT_HALF_ALONG_M = 34;

/** A placed frame: render's `matrixAt(x, y, z, yaw, scale)`, a turn about +Y and a uniform scale. */
interface Frame {
  x: number;
  y: number;
  z: number;
  yaw: number;
  scale: number;
}

/** What each placed part says about itself. */
interface Tag {
  rule: string;
  cls: StructureClass;
  model: string | null;
  edge: number;
  s: number;
  d: number;
}

/** A box in a frame's local metres: [x0, x1, z0, z1, y0, y1]. */
type Box = readonly [number, number, number, number, number, number];

/** A local box as a structure where a frame stands (+Z to (sin yaw, cos yaw), +X to (cos yaw, -sin yaw)). */
function placed(tag: Tag, f: Frame, b: Box): StructureSpec {
  const sy = sin(f.yaw);
  const cy = cos(f.yaw);
  const k = f.scale;
  const mx = ((b[0] + b[1]) / 2) * k;
  const mz = ((b[2] + b[3]) / 2) * k;
  return {
    ...tag,
    foot: {
      x: f.x + mx * cy + mz * sy,
      z: f.z - mx * sy + mz * cy,
      ux: cy,
      uz: -sy,
      hu: ((b[1] - b[0]) / 2) * k,
      hv: ((b[3] - b[2]) / 2) * k,
    },
    baseY: f.y + b[4] * k,
    roof: { kind: 'flat', topM: (b[5] - b[4]) * k },
  };
}

/** A measured source's parts (landmark-parts.ts). A source with no row is the plan's bug: it throws. */
function partsOf(id: string): Box[] {
  const row = LANDMARK_PARTS[id];
  if (!row)
    throw new Error(
      `structures: no parts for the landmark ${id} (measure it: scripts/structure-parts.test.ts)`,
    );
  const out: Box[] = [];
  for (let i = 0; i + 5 < row.length; i += 6)
    out.push([
      row[i] ?? 0,
      row[i + 1] ?? 0,
      row[i + 2] ?? 0,
      row[i + 3] ?? 0,
      row[i + 4] ?? 0,
      row[i + 5] ?? 0,
    ]);
  return out;
}

/** Which kind of structure a landmark is. */
function classOf(id: string): StructureClass {
  if (id.startsWith('pdx-landmarks#pdx_') && /truss|lift|bascule/.test(id)) return 'bridge';
  if (id === 'keys-landmarks#mallory_pier' || id === 'seven-mile-kit#pigeon_key_dock') return 'pier';
  return 'landmark';
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** One landmark's parts. */
function landmarkParts(road: RoadNetwork, at: LandmarkPlace, out: StructureSpec[]): void {
  const f = at.feature;
  const id = `${at.kit}#${at.node}`;
  const tag = (rule: string, cls: StructureClass): Tag => ({
    rule,
    cls,
    model: id,
    edge: at.edge,
    s: (f.s0 + f.s1) / 2,
    d: (f.d0 + f.d1) / 2,
  });
  const frame: Frame = { x: at.x, y: at.y, z: at.z, yaw: at.yaw, scale: at.scale };
  if (id === 'golden-gate#gg_bridge') return goldenGate(road, at, tag, out);
  if (id === 'keys-landmarks#fred_the_tree') {
    for (const b of partsOf('soup#fred')) out.push(placed(tag('soup#fred', 'landmark'), frame, b));
    return;
  }
  if (id === 'seven-mile-kit#pigeon_key') return pigeonKey(at, tag, out);
  if (id === 'sf-landmarks#summit_lot') return summitLot(road, at, tag, out);
  // A single node, a bay placed by its middle (render's `single`).
  const bay = LANDMARK_FIGURES.bayM[id];
  const shift = bay !== undefined ? bay / 2 : 0;
  const cls = classOf(id);
  for (const b of partsOf(id))
    out.push(placed(tag(id, cls), frame, [b[0], b[1], b[2] - shift, b[3] - shift, b[4], b[5]]));
  // The cruise ship's top deck (render's EXTRAS): its funnel, mast, lifeboats and slides.
  if (id === 'keys-landmarks#cruise_ship')
    for (const b of partsOf('soup#cruise-top'))
      out.push(placed(tag('soup#cruise-top', 'landmark'), frame, b));
}

/** Fred's and the summit lot's frames have no special rule; Pigeon Key's island and its buildings do. */
function pigeonKey(
  at: LandmarkPlace,
  tag: (rule: string, cls: StructureClass) => Tag,
  out: StructureSpec[],
): void {
  const f = at.feature;
  // Built for a left-hand landmark; a right-hand one turns round (render's `pigeonKey`). It stands on the sea.
  const flip = f.d0 + f.d1 > 0 ? PI : 0;
  const island: Frame = { x: at.x, y: 0, z: at.z, yaw: at.yaw + flip, scale: 1 };
  for (const b of partsOf('soup#pigeon-island'))
    out.push(placed(tag('soup#pigeon-island', 'landmark'), island, b));
  const sy = sin(island.yaw);
  const cy = cos(island.yaw);
  for (const b of PIGEON_KEY_PLAN.buildings) {
    const dock = b.node === 'pigeon_key_dock';
    const frame: Frame = {
      x: island.x + b.x * cy + b.z * sy,
      y: dock ? 0 : PIGEON_KEY_PLAN.topY,
      z: island.z - b.x * sy + b.z * cy,
      yaw: island.yaw + b.yaw,
      scale: 1,
    };
    const id = `seven-mile-kit#${b.node}`;
    for (const box of partsOf(id)) out.push(placed(tag(id, classOf(id)), frame, box));
  }
}

/** The Twin Peaks summit lot: its soup sheared to the road's grade between its ends (render's `summitLot`). */
function summitLot(
  road: RoadNetwork,
  at: LandmarkPlace,
  tag: (rule: string, cls: StructureClass) => Tag,
  out: StructureSpec[],
): void {
  const hz = SUMMIT_LOT_HALF_ALONG_M * at.scale;
  const heightAt = (z: number): number => {
    const p = road.project(at.x + sin(at.yaw) * z, at.z + cos(at.yaw) * z, at.edge);
    return road.toWorld(at.edge, p.s, p.d, 0).y;
  };
  // The rise per metre of the lot's own +Z: a part rises with its z, so its base and top span its rise.
  const g = (heightAt(hz) - heightAt(-hz)) / (2 * hz) / at.scale;
  const frame: Frame = { x: at.x, y: at.y, z: at.z, yaw: at.yaw, scale: at.scale };
  for (const b of partsOf('soup#summit-lot')) {
    const r0 = g * b[2];
    const r1 = g * b[3];
    out.push(
      placed(tag('soup#summit-lot', 'landmark'), frame, [
        b[0],
        b[1],
        b[2],
        b[3],
        b[4] + Math.min(r0, r1),
        b[5] + Math.max(r0, r1),
      ]),
    );
  }
}

/** A point of the bridge, world metres. */
interface P3 {
  x: number;
  y: number;
  z: number;
}

/** A local point through a frame. */
const through = (f: Frame, x: number, y: number, z: number): P3 => {
  const sy = sin(f.yaw);
  const cy = cos(f.yaw);
  return {
    x: f.x + (x * cy + z * sy) * f.scale,
    y: f.y + y * f.scale,
    z: f.z + (-x * sy + z * cy) * f.scale,
  };
};

/** A cable's segments as boxes along their run: no longer than this, m. */
const CABLE_PIECE_M = 8;

/**
 * The Golden Gate (render's `suspensionBridge`): the towers (the kit's tower, its parts over the deck), the
 * anchorages' housings at each end, the two main cables from anchorage to saddle to saddle to anchorage, and a
 * suspender rope from each down to the deck's edge at every bay. The deck's edge (the kit's bays) lies wholly
 * under the deck: under the course.
 */
function goldenGate(
  road: RoadNetwork,
  at: LandmarkPlace,
  tag: (rule: string, cls: StructureClass) => Tag,
  out: StructureSpec[],
): void {
  const S = SUSPENSION_PLAN;
  const F = LANDMARK_FIGURES;
  const f = at.feature;
  const e = at.edge;
  const given = f.params?.['sideSpanM'];
  const side = finite(given) && given > 0 ? given : S.sideSpanM;
  if (!(f.s1 - f.s0 - 2 * side > 0)) return;
  const baseGiven = f.params?.['baseY'];
  const baseY = finite(baseGiven) ? baseGiven : 0;
  const at2 = (s: number, d: number) => road.toWorld(e, s, d, 0);
  const yawAt = (s: number) => {
    const fr = road.frameAt(e, s);
    return atan2(fr.tx, fr.tz);
  };
  const sT = [f.s0 + side, f.s1 - side] as const;
  // The towers: from the waterline, kept over the deck (the road's surface at the tower).
  const towers = sT.map((s): Frame => {
    const p = at2(s, 0);
    return { x: p.x, y: baseY, z: p.z, yaw: yawAt(s), scale: 1 };
  });
  towers.forEach((t, i) => {
    const deck = at2(sT[i] ?? 0, 0).y - baseY;
    for (const b of partsOf('golden-gate#gg_tower_lod0')) {
      if (b[5] <= deck + 0.05) continue;
      out.push(
        placed(tag('golden-gate#gg_tower_lod0', 'bridge'), t, [
          b[0],
          b[1],
          b[2],
          b[3],
          Math.max(b[4], deck),
          b[5],
        ]),
      );
    }
  });
  // The anchorages: the origin where the cables enter, at the deck's height, the housings behind it (-Z); the far
  // end turned round to face the span. Each housing's steps stand solid from the deck to their tops.
  const anchors = [f.s0, f.s1].map((s, i): Frame => {
    const p = at2(s, 0);
    return { x: p.x, y: p.y, z: p.z, yaw: yawAt(s) + (i === 0 ? 0 : PI), scale: 1 };
  });
  const A = ANCHORAGE_PLAN;
  const tops = [...A.topM, F.ggCableEntryM - A.capUnderM];
  for (const a of anchors)
    for (const sigma of [-1, 1]) {
      const x0 = sigma * F.ggSaddleXM;
      tops.forEach((top, k) => {
        const half = A.halfWidthM[k] ?? 0;
        out.push(
          placed(tag('golden-gate#gg_anchorage', 'bridge'), a, [
            x0 - half,
            x0 + half,
            -(A.lengthM[k] ?? 0),
            0.4,
            0,
            top,
          ]),
        );
      });
      const c = A.collar;
      out.push(
        placed(tag('golden-gate#gg_anchorage', 'bridge'), a, [
          x0 - c.halfWidthM,
          x0 + c.halfWidthM,
          c.z0,
          c.z1,
          F.ggCableEntryM - c.halfHeightM,
          F.ggCableEntryM + c.halfHeightM,
        ]),
      );
    }
  // The main cables: each three parabolas, hung from the saddles on the towers' tops.
  interface Span {
    a: P3;
    b: P3;
    sag: number;
  }
  const len = (p: P3, q: P3) =>
    Math.sqrt((q.x - p.x) * (q.x - p.x) + (q.y - p.y) * (q.y - p.y) + (q.z - p.z) * (q.z - p.z));
  const deckMid = at2((sT[0] + sT[1]) / 2, 0).y;
  const cables: { sigma: number; spans: Span[] }[] = [];
  for (const sigma of [-1, 1]) {
    const [t0, t1] = towers.map((t) => through(t, sigma * F.ggSaddleXM, F.ggTopM, 0)) as [P3, P3];
    const [a0, a1] = anchors.map((a, i) =>
      through(a, (i === 0 ? sigma : -sigma) * F.ggSaddleXM, F.ggCableEntryM, 0),
    ) as [P3, P3];
    const mainSag = Math.max(1, (t0.y + t1.y) / 2 - (deckMid + S.midClearM));
    cables.push({
      sigma,
      spans: [
        { a: a0, b: t0, sag: len(a0, t0) * S.sideSag },
        { a: t0, b: t1, sag: mainSag },
        { a: t1, b: a1, sag: len(t1, a1) * S.sideSag },
      ],
    });
  }
  const pointAt = (sp: Span, u: number): P3 => ({
    x: sp.a.x + (sp.b.x - sp.a.x) * u,
    y: sp.a.y + (sp.b.y - sp.a.y) * u - sp.sag * 4 * u * (1 - u),
    z: sp.a.z + (sp.b.z - sp.a.z) * u,
  });
  const r = S.radiusNear;
  for (const { spans } of cables)
    for (const sp of spans) {
      const run = Math.sqrt((sp.b.x - sp.a.x) * (sp.b.x - sp.a.x) + (sp.b.z - sp.a.z) * (sp.b.z - sp.a.z));
      const n = Math.max(1, Math.ceil(run / CABLE_PIECE_M));
      const ux = (sp.b.x - sp.a.x) / run;
      const uz = (sp.b.z - sp.a.z) / run;
      for (let k = 0; k < n; k++) {
        const p = pointAt(sp, k / n);
        const q = pointAt(sp, (k + 1) / n);
        // The parabola's lowest point between them, if it lies inside the piece.
        const uMin = (4 * sp.sag - (sp.b.y - sp.a.y)) / (8 * sp.sag);
        let lo = Math.min(p.y, q.y);
        let hi = Math.max(p.y, q.y);
        if (uMin > k / n && uMin < (k + 1) / n) {
          const m = pointAt(sp, uMin).y;
          lo = Math.min(lo, m);
          hi = Math.max(hi, m);
        }
        out.push({
          ...tag('golden-gate#gg_bridge/cable', 'bridge'),
          foot: { x: (p.x + q.x) / 2, z: (p.z + q.z) / 2, ux, uz, hu: run / n / 2 + r, hv: r },
          baseY: lo - r,
          roof: { kind: 'flat', topM: hi - lo + 2 * r },
        });
      }
    }
  // The suspender ropes: one at every bay from each cable straight down to the deck's edge.
  const bayM = F.bayM['golden-gate#gg_bay'] ?? 15.24;
  const count = Math.floor((f.s1 - f.s0) / bayM);
  for (let i = 0; i < count; i++) {
    const s = f.s0 + (i + 0.5) * bayM;
    const k = s < sT[0] ? 0 : s < sT[1] ? 1 : 2;
    if (Math.min(Math.abs(s - sT[0]), Math.abs(s - sT[1])) < S.ropeTowerClearM) continue;
    for (const { sigma, spans } of cables) {
      const sp = spans[k];
      if (!sp) continue;
      const foot = at2(s, -sigma * F.ggSaddleXM);
      const abx = sp.b.x - sp.a.x;
      const abz = sp.b.z - sp.a.z;
      const along = ((foot.x - sp.a.x) * abx + (foot.z - sp.a.z) * abz) / (abx * abx + abz * abz);
      const cable = pointAt(sp, Math.min(1, Math.max(0, along)));
      const bottom = foot.y + S.ropeFootM;
      if (cable.y - bottom < S.ropeMinM) continue;
      const rr = S.ropeRadiusNear;
      out.push({
        ...tag('golden-gate#gg_bridge/rope', 'bridge'),
        foot: { x: cable.x, z: cable.z, ux: 1, uz: 0, hu: rr, hv: rr },
        baseY: bottom,
        roof: { kind: 'flat', topM: cable.y - bottom },
      });
    }
  }
}

/** One placed landmark's structures. */
export function placeStructures(road: RoadNetwork, at: LandmarkPlace): StructureSpec[] {
  const out: StructureSpec[] = [];
  landmarkParts(road, at, out);
  return out;
}

/** Every landmark's structures on a network, in the road's order. */
export function landmarkStructures(road: RoadNetwork): StructureSpec[] {
  const out: StructureSpec[] = [];
  for (const at of landmarkPlaces(road)) landmarkParts(road, at, out);
  return out;
}

/** The `landmarks` layer's planner (road/structures.ts `STRUCTURE_LAYERS`). The seed moves nothing of it. */
export const planner: StructurePlanner = {
  plan(road, _seed, sink) {
    for (const spec of landmarkStructures(road)) sink.add(spec);
  },
};
