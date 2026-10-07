// Test helper: nothing drawn stands in the road (playtest 4's phone play, 2026-10-06: "in bridge city near
// shortcut(?) junctions in two places it seems like there's a building in the road lol. it seems you can
// drive right through it though"). The check looks at the drawn triangles, not at any one layer's plan: the
// space a rider rides through over every road of a network (every lane of every edge, branches, shortcuts,
// joins and leaves included) is a column over each half metre of asphalt, and no triangle of anything the
// renderer draws beside the road (a building, a landmark, a bridge's kit, a rail, a post) may cut it.
import {
  Box3,
  InstancedMesh,
  Matrix4,
  Mesh,
  Triangle,
  Vector3,
  type BufferGeometry,
  type Object3D,
} from 'three';
import { expect } from 'vitest';
import type { RoadNetwork } from '../road';
import { print, stillSceneOf } from './scene-cost.test-util';

/** The cell size of the road's point map, m. */
const CELL_M = 1;
/** How far apart the ride column's points are, along and across the road, m; each owns a box about this wide. */
const STEP_M = 0.5;
const HALF_M = 0.3;
/** The column's floor and top over the asphalt, m: a rider's knees to over the helmet. [default] */
export const RIDE_LOW_M = 0.5;
export const RIDE_HIGH_M = 2;
/**
 * How far in from the outermost lane's edge the column starts, m: a rail, a kerb or a post at the rim
 * is the road's edge, not something in the road (a point's box reaches HALF_M past it, more on a diagonal).
 * [default]
 */
export const RIM_M = 0.5;
/** A coarse grid over the fine one, so a triangle the size of a hill only visits the coarse cells with road. */
const COARSE = 16;
/** Values per point in RoadColumns.pts: x, y (the asphalt), z, edge, s, d. */
const PER = 7;

export interface RoadColumns {
  road: RoadNetwork;
  pts: Float64Array;
  cells: Map<number, number[]>;
  coarse: Set<number>;
  /** How many points the column stands on. */
  count: number;
}

const key = (i: number, j: number) => (i + 0x8000) * 0x10000 + (j + 0x8000);

/** The ride column over every lane of every edge of a network (branches, shortcuts, joins and leaves). */
export function roadColumns(road: RoadNetwork): RoadColumns {
  const raw: number[] = [];
  for (const e of road.edges) {
    for (let s = 0; s <= e.length + 1e-6; s += STEP_M) {
      let lo = 0;
      let hi = 0;
      for (const lane of road.lanesAt(e.index, s)) {
        lo = Math.min(lo, lane.dCenterM - lane.widthM / 2);
        hi = Math.max(hi, lane.dCenterM + lane.widthM / 2);
      }
      for (let d = lo + RIM_M; d <= hi - RIM_M + 1e-6; d += STEP_M) {
        const p = road.toWorld(e.index, s, d, 0);
        raw.push(p.x, p.y, p.z, e.index, s, d, Math.min(d - lo, hi - d));
      }
    }
  }
  const pts = Float64Array.from(raw);
  const cells = new Map<number, number[]>();
  const coarse = new Set<number>();
  const n = pts.length / PER;
  for (let q = 0; q < n; q++) {
    const x = pts[q * PER] ?? 0;
    const z = pts[q * PER + 2] ?? 0;
    // A point's box may reach into the cells beside its own.
    const is = new Set([Math.floor((x - HALF_M) / CELL_M), Math.floor((x + HALF_M) / CELL_M)]);
    const js = new Set([Math.floor((z - HALF_M) / CELL_M), Math.floor((z + HALF_M) / CELL_M)]);
    for (const i of is)
      for (const j of js) {
        const k = key(i, j);
        let list = cells.get(k);
        if (!list) {
          list = [];
          cells.set(k, list);
          coarse.add(key(Math.floor(i / COARSE), Math.floor(j / COARSE)));
        }
        list.push(q);
      }
  }
  return { road, pts, cells, coarse, count: n };
}

export interface RoadHit {
  /** The drawn part, as `group/mesh`. */
  part: string;
  edge: string;
  s: number;
  d: number;
  x: number;
  z: number;
  /** How high over the asphalt the triangle's lowest point is, m (0 when it reaches down past the column). */
  over: number;
  /** How far in from the outermost lane's edge the point is, m. */
  inset: number;
}

const tri = new Triangle();
const box = new Box3();
const a = new Vector3();
const b = new Vector3();
const c = new Vector3();
const m = new Matrix4();
const bb = new Box3();

export interface Near {
  x: number;
  z: number;
  reach: number;
}

const outside = (near: Near | null, x0: number, x1: number, z0: number, z1: number) =>
  !!near &&
  (x1 < near.x - near.reach ||
    x0 > near.x + near.reach ||
    z1 < near.z - near.reach ||
    z0 > near.z + near.reach);

/**
 * Every point of the column a drawn triangle of `root` cuts, within `near` (null: everywhere), into
 * `into` by part and metre cell. `skip` names the meshes that are the road and its ground themselves.
 */
export function hitsIn(
  cols: RoadColumns,
  root: Object3D,
  skip: (name: string) => boolean,
  near: Near | null,
  into: Map<string, RoadHit>,
): void {
  root.updateMatrixWorld(true);
  const label = root.name;
  const visit = (o: Object3D) => {
    if (!o.visible) return;
    if (o instanceof Mesh && !skip(o.name)) {
      const g = (o as Mesh<BufferGeometry>).geometry;
      const pos = g.getAttribute('position');
      if (pos && pos.itemSize === 3) {
        if (!g.boundingBox) g.computeBoundingBox();
        const inst = o instanceof InstancedMesh ? o.count : 1;
        for (let n = 0; n < inst; n++) {
          if (o instanceof InstancedMesh) {
            o.getMatrixAt(n, m);
            m.premultiply(o.matrixWorld);
          } else m.copy(o.matrixWorld);
          if (g.boundingBox) {
            bb.copy(g.boundingBox).applyMatrix4(m);
            if (outside(near, bb.min.x, bb.max.x, bb.min.z, bb.max.z)) continue;
          }
          trianglesOf(cols, g, m, `${label}/${o.name}`, near, into);
        }
      }
    }
    for (const ch of o.children) visit(ch);
  };
  visit(root);
}

function trianglesOf(
  cols: RoadColumns,
  g: BufferGeometry,
  mat: Matrix4,
  part: string,
  near: Near | null,
  into: Map<string, RoadHit>,
): void {
  const pos = g.getAttribute('position');
  const index = g.index;
  const start = Math.max(0, g.drawRange.start);
  const total = index ? index.count : pos.count;
  const end = Math.min(total, Number.isFinite(g.drawRange.count) ? start + g.drawRange.count : total);
  const vi = (k: number) => (index ? index.getX(k) : k);
  const pts = cols.pts;
  for (let k = start; k + 2 < end; k += 3) {
    a.fromBufferAttribute(pos, vi(k)).applyMatrix4(mat);
    b.fromBufferAttribute(pos, vi(k + 1)).applyMatrix4(mat);
    c.fromBufferAttribute(pos, vi(k + 2)).applyMatrix4(mat);
    const minX = Math.min(a.x, b.x, c.x);
    const maxX = Math.max(a.x, b.x, c.x);
    const minZ = Math.min(a.z, b.z, c.z);
    const maxZ = Math.max(a.z, b.z, c.z);
    if (!Number.isFinite(minX + maxX + minZ + maxZ) || outside(near, minX, maxX, minZ, maxZ)) continue;
    const minY = Math.min(a.y, b.y, c.y);
    const maxY = Math.max(a.y, b.y, c.y);
    const i0 = Math.floor(minX / CELL_M);
    const i1 = Math.floor(maxX / CELL_M);
    const j0 = Math.floor(minZ / CELL_M);
    const j1 = Math.floor(maxZ / CELL_M);
    tri.set(a, b, c);
    const visitCell = (i: number, j: number) => {
      const list = cols.cells.get(key(i, j));
      if (!list) return;
      for (const q of list) {
        const px = pts[q * PER] ?? 0;
        const py = pts[q * PER + 1] ?? 0;
        const pz = pts[q * PER + 2] ?? 0;
        const lo = py + RIDE_LOW_M;
        const hi = py + RIDE_HIGH_M;
        if (maxY < lo || minY > hi || maxX < px - HALF_M || minX > px + HALF_M) continue;
        if (maxZ < pz - HALF_M || minZ > pz + HALF_M) continue;
        const id = `${part}|${Math.floor(px / CELL_M)},${Math.floor(pz / CELL_M)}`;
        if (into.has(id)) continue;
        box.min.set(px - HALF_M, lo, pz - HALF_M);
        box.max.set(px + HALF_M, hi, pz + HALF_M);
        if (!box.intersectsTriangle(tri)) continue;
        into.set(id, {
          part,
          edge: cols.road.edges[pts[q * PER + 3] ?? 0]?.id ?? '',
          s: pts[q * PER + 4] ?? 0,
          d: pts[q * PER + 5] ?? 0,
          x: px,
          z: pz,
          over: Math.max(0, minY - py),
          inset: pts[q * PER + 6] ?? 0,
        });
      }
    };
    if ((i1 - i0 + 1) * (j1 - j0 + 1) > COARSE * COARSE * 4) {
      // A big triangle (a hill, the sea): only the coarse cells that hold road.
      for (let ci = Math.floor(i0 / COARSE); ci <= Math.floor(i1 / COARSE); ci++)
        for (let cj = Math.floor(j0 / COARSE); cj <= Math.floor(j1 / COARSE); cj++) {
          if (!cols.coarse.has(key(ci, cj))) continue;
          for (let i = Math.max(i0, ci * COARSE); i <= Math.min(i1, ci * COARSE + COARSE - 1); i++)
            for (let j = Math.max(j0, cj * COARSE); j <= Math.min(j1, cj * COARSE + COARSE - 1); j++)
              visitCell(i, j);
        }
    } else for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) visitCell(i, j);
  }
}

export interface RoadPlace {
  part: string;
  edge: string;
  s0: number;
  s1: number;
  d: number;
  x: number;
  z: number;
  cells: number;
  /** The deepest a hit lies in from the outermost lane's edge, m. */
  inset: number;
}

/** Hits grouped into places: one per part, road and run of s (a building cuts many cells), sorted by road and s. */
export function placesOf(hits: Iterable<RoadHit>): RoadPlace[] {
  const sorted = [...hits].sort((p, q) => (p.edge === q.edge ? p.s - q.s : p.edge < q.edge ? -1 : 1));
  const out: RoadPlace[] = [];
  for (const h of sorted) {
    let last: RoadPlace | undefined;
    for (let n = out.length - 1; n >= 0 && !last; n--) {
      const p = out[n];
      if (p && p.part === h.part && p.edge === h.edge && h.s - p.s1 <= 6) last = p;
    }
    if (last) {
      last.s1 = Math.max(last.s1, h.s);
      last.cells++;
      if (h.inset > last.inset) {
        last.inset = h.inset;
        last.d = h.d;
      }
    } else
      out.push({
        part: h.part,
        edge: h.edge,
        s0: h.s,
        s1: h.s,
        d: h.d,
        x: h.x,
        z: h.z,
        cells: 1,
        inset: h.inset,
      });
  }
  return out;
}

export const placeLine = (p: RoadPlace) =>
  `${p.part} on ${p.edge} s ${p.s0.toFixed(0)}-${p.s1.toFixed(0)} d ${p.d.toFixed(1)} (x ${p.x.toFixed(0)}, z ${p.z.toFixed(0)}), ${p.cells} cells, ${p.inset.toFixed(1)} m into the lanes`;

const networkFiles = import.meta.glob<{ id: string }>('../../packs/*/regions/*/networks/*.json', {
  eager: true,
  import: 'default',
});
/** A pack's network ids, every one of them (the hand-made ones too), sorted. */
export const networksOf = (pack: string): string[] =>
  Object.entries(networkFiles)
    .filter(([path]) => path.includes(`/packs/${pack}/`))
    .map(([, n]) => n.id)
    .sort();

/** The meshes that are the road and its ground themselves (road-mesh.ts, verge.ts), and the backdrop. */
export const ROAD_ITSELF =
  /^(road-(road|shoulder|land|deck|marking|markingCenter|splitMark|splitZone|boostPad|shortcut|water)|verge-band|backdrop)$/;
/** How far apart the camera stands along every edge while the sweep looks, m, and how far round it it looks. */
const POSE_M = 60;
const LOOK_M = 80;

/**
 * Rides a camera along every edge of a network (every road, branches and connectors included) with every
 * still layer the renderer builds (scene-cost.test-util.ts's stillSceneOf), and collects each place where
 * a drawn triangle cuts the ride column. `extra` is drawn too (the negative control's planted building).
 */
export async function sweepNetwork(
  networkId: string,
  seed: number,
  extra?: (road: RoadNetwork) => Object3D,
): Promise<{ road: RoadNetwork; places: RoadPlace[]; points: number; poses: number }> {
  const { road, scene } = await stillSceneOf(networkId, seed);
  const cols = roadColumns(road);
  const planted = extra?.(road);
  const hits = new Map<string, RoadHit>();
  const skip = (name: string) => ROAD_ITSELF.test(name);
  let poses = 0;
  for (const e of road.edges) {
    for (let s = 0; s <= e.length + POSE_M - 1e-6; s += POSE_M) {
      const at = Math.min(s, e.length);
      const p = road.toWorld(e.index, at, 0, 0);
      const f = road.frameAt(e.index, at);
      scene.update(p.x, p.z, p.x + f.tx * 20, p.z + f.tz * 20);
      poses++;
      const near = { x: p.x, z: p.z, reach: LOOK_M };
      // The backdrop's vertex shader moves it (its geometry is not where it draws): it is the distance.
      for (const r of scene.roots()) if (r.name !== 'backdrop') hitsIn(cols, r, skip, near, hits);
      if (planted) hitsIn(cols, planted, () => false, near, hits);
    }
  }
  return { road, places: placesOf(hits.values()), points: cols.count, poses };
}

/**
 * What may cut the column without being a building in the road: [part, the deepest it may reach in from the
 * outermost lane's edge (m), why]. [default]
 */
const ALLOWED: readonly (readonly [string, number, string])[] = [
  ['road/road-rampTrucks', Infinity, 'a ramp truck stands in the road to be ridden up'],
  [
    'road-roadside/road-roadside',
    1.5,
    "the roadside's shrubs (the Keys' seagrape, the verge shrubs) lean over the shoulder's outer edge",
  ],
  ['road/road-scenery', 1, "a conifer's lowest boughs over the shoulder's outer edge"],
];

/**
 * Hits this check found on 2026-10-06 that are not buildings, left to follow-ups (lane polish-g G1's
 * report lists each by road and s): [network, part, the roads, the deepest in (m), what it is]. A new
 * road or a deeper cut fails; one that is gone is printed so its line can go. The edge kit's lines (a verge's
 * fence, brush and hedge, a guardrail, a bridge's rail, posts and bays across a sibling road's lanes) are all
 * gone (polish J2, `overlap.ts`).
 */
export const KNOWN: readonly (readonly [string, string, readonly string[], number, string])[] = [
  [
    'keys-m1',
    'boards/',
    ['m1-tarpon-flats'],
    5.5,
    "Sandbar Flats' billboard (sign-sandbar-advised) stands on Tarpon Flats",
  ],
  [
    'keys-m1',
    'boards/board-panel',
    ['m1-tarpon-flats'],
    5.5,
    "Sandbar Flats' billboard (sign-sandbar-advised) stands on Tarpon Flats",
  ],
  [
    'sf-downtown',
    'road-downtown/road-downtown',
    ['c-dt-plaza-in', 'sf-dt-plaza-cut'],
    4,
    "Campus Yard's lamps, hydrants and a planter on the Plaza Cut's lanes",
  ],
  [
    'sf-hills',
    'boards/',
    ['sf-park-cut', 'sf-stair-alley'],
    1.5,
    "Switchback Street's and Fogline Climb's billboards on the stair alley's and park cut's lanes",
  ],
  ['sf-hills', 'road/road-brick', ['sf-stair-alley'], 2.5, "the stair alley's brick courses"],
  ['sf-hills', 'road/road-brickCourse', ['sf-stair-alley'], 2.5, "the stair alley's brick courses"],
];

/** Sweeps a network and holds it: every place is allowed, known, or a failure (printed by road and s). */
export async function checkNetwork(networkId: string, seed: number): Promise<void> {
  const t0 = Date.now();
  const { places, points, poses } = await sweepNetwork(networkId, seed);
  const held: RoadPlace[] = [];
  const allowed = new Map<string, number>();
  const known = new Map<number, number>();
  for (const p of places) {
    const rule = ALLOWED.find(([part, deepest]) => part === p.part && p.inset <= deepest + 1e-6);
    if (rule) {
      allowed.set(rule[0], (allowed.get(rule[0]) ?? 0) + 1);
      continue;
    }
    const k = KNOWN.findIndex(
      ([net, part, roads, deepest]) =>
        net === networkId && part === p.part && roads.includes(p.edge) && p.inset <= deepest + 1e-6,
    );
    if (k >= 0) {
      known.set(k, (known.get(k) ?? 0) + 1);
      continue;
    }
    held.push(p);
  }
  print(
    `[examined] ${networkId} seed ${seed}: ${points} column points over every lane of every road, ${poses} camera poses, ` +
      `${places.length} places cut (${Date.now() - t0} ms); allowed ${[...allowed].map(([k, n]) => `${k} ${n}`).join(', ') || 'none'}`,
  );
  for (const [k, row] of KNOWN.entries()) {
    if (row[0] !== networkId) continue;
    const n = known.get(k) ?? 0;
    print(
      `  known follow-up, ${row[1]}: ${n} places (${row[4]})${n === 0 ? ': gone, remove this line' : ''}`,
    );
  }
  for (const p of held) print(`  IN THE ROAD: ${placeLine(p)}`);
  expect(held.map(placeLine), `${networkId} seed ${seed}: drawn in the ride column`).toEqual([]);
}
