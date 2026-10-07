// Test helper: nothing drawn stands in the road (playtest 4's phone play, 2026-10-06: "in bridge city near
// shortcut(?) junctions in two places it seems like there's a building in the road lol. it seems you can
// drive right through it though"). The check looks at the drawn triangles, not at any one layer's plan: the
// space a rider rides through over every road of a network (every lane of every edge, branches, shortcuts,
// joins and leaves included) is a column over each half metre of asphalt, and no triangle of anything the
// renderer draws beside the road (a building, a landmark, a bridge's kit, a rail, a post, a sign, a board, the
// street furniture) may cut it. The maintainer, 2026-10-06: "a road race in a physical world with honest edges";
// nothing drawn in a lane may be a ghost. The road's own ground (its land, shoulders, verge band, decks and
// paint) is held to a height rule, not skipped by name: it may meet a road's edge, never stand over its ride
// column (GROUND, GROUND_OVER_M).
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
import { Boards, type BoardItem, type BoardSlot } from './boards';
import { createFlatLook } from './look';
import { print, signCatalog, stillSceneOf, track } from './scene-cost.test-util';

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
/** A ground triangle whose normal's upward share is at least this is near flat (under 60 degrees of slope). */
const FLAT_NY = 0.5;
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
      let lo = Infinity;
      let hi = -Infinity;
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
  /**
   * How high over the asphalt the triangle stands at the point, m (seen from above; its lowest point where it
   * does not lie over the point, as a wall; 0 when it reaches down past the asphalt).
   */
  over: number;
  /** How far in from the outermost lane's edge the point is, m. */
  inset: number;
}

const tri = new Triangle();
/**
 * The height of the triangle in `a`, `b`, `c` at (x, z), seen from above, or `low` where it does not lie over
 * that point (a wall, or a triangle that only clips the point's box).
 */
function heightAt(x: number, z: number, low: number): number {
  const d = (b.x - a.x) * (c.z - a.z) - (c.x - a.x) * (b.z - a.z);
  if (Math.abs(d) < 1e-9) return low;
  const u = ((x - a.x) * (c.z - a.z) - (c.x - a.x) * (z - a.z)) / d;
  const v = ((b.x - a.x) * (z - a.z) - (x - a.x) * (b.z - a.z)) / d;
  if (u < -1e-6 || v < -1e-6 || u + v > 1 + 1e-6) return low;
  return a.y + u * (b.y - a.y) + v * (c.y - a.y);
}
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
 * `into` by part and metre cell. `floorOf` says how high over the asphalt the column starts for a part (floorOf).
 */
export function hitsIn(
  cols: RoadColumns,
  root: Object3D,
  floorOf: (name: string) => number,
  near: Near | null,
  into: Map<string, RoadHit>,
  once?: Set<Object3D>,
): void {
  root.updateMatrixWorld(true);
  const label = root.name;
  const visit = (o: Object3D) => {
    if (!o.visible) return;
    if (o instanceof Mesh && !once?.has(o)) {
      const floor = floorOf(o.name);
      // The ground is built once and does not move: each of its meshes is looked at whole, the first time it
      // is drawn, not again at every pose (a network's land is most of its triangles).
      const whole = once !== undefined && floor < RIDE_LOW_M;
      if (whole) once.add(o);
      const where = whole ? null : near;
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
            if (outside(where, bb.min.x, bb.max.x, bb.min.z, bb.max.z)) continue;
          }
          trianglesOf(cols, g, m, `${label}/${o.name}`, floor, where, into);
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
  floor: number,
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
    // A ground triangle that lies near flat is held by its height over each point; a steep one (a bank, a
    // curtain, a wall) is a wall too, tested as anything else from a rider's knees up.
    const ux = b.x - a.x;
    const uy = b.y - a.y;
    const uz = b.z - a.z;
    const vx = c.x - a.x;
    const vy = c.y - a.y;
    const vz = c.z - a.z;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const wall = floor >= RIDE_LOW_M || Math.abs(ny) < FLAT_NY * Math.hypot(nx, ny, nz);
    // The box's reach along the triangle's normal: a box whose centre lies further off its plane misses it.
    const half = (RIDE_HIGH_M - RIDE_LOW_M) / 2;
    const reach = HALF_M * Math.abs(nx) + half * Math.abs(ny) + HALF_M * Math.abs(nz);
    const plane = nx * a.x + ny * a.y + nz * a.z;
    const visitCell = (i: number, j: number) => {
      const list = cols.cells.get(key(i, j));
      if (!list) return;
      for (const q of list) {
        const px = pts[q * PER] ?? 0;
        const py = pts[q * PER + 1] ?? 0;
        const pz = pts[q * PER + 2] ?? 0;
        const lo = py + floor;
        const hi = py + RIDE_HIGH_M;
        if (maxY < lo || minY > hi || maxX < px - HALF_M || minX > px + HALF_M) continue;
        if (maxZ < pz - HALF_M || minZ > pz + HALF_M) continue;
        // The ground's rule: its surface over the point itself (a box would reach uphill on a steep street).
        const y = floor < RIDE_LOW_M ? heightAt(px, pz, Number.NaN) : Number.NaN;
        let cut = y > lo && y <= hi;
        // Anything (the ground's walls and curtains too) through the column from a rider's knees up.
        if (
          !cut &&
          wall &&
          maxY >= py + RIDE_LOW_M &&
          Math.abs(nx * px + ny * (py + RIDE_LOW_M + half) + nz * pz - plane) <= reach
        ) {
          box.min.set(px - HALF_M, py + RIDE_LOW_M, pz - HALF_M);
          box.max.set(px + HALF_M, hi, pz + HALF_M);
          cut = box.intersectsTriangle(tri);
        }
        if (!cut) continue;
        const id = `${part}|${Math.floor(px / CELL_M)},${Math.floor(pz / CELL_M)}`;
        if (into.has(id)) continue;
        into.set(id, {
          part,
          edge: cols.road.edges[pts[q * PER + 3] ?? 0]?.id ?? '',
          s: pts[q * PER + 4] ?? 0,
          d: pts[q * PER + 5] ?? 0,
          x: px,
          z: pz,
          over: Math.max(0, (Number.isNaN(y) ? heightAt(px, pz, minY) : y) - py),
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
  /** The highest it stands over the asphalt at a hit, m (RoadHit.over). */
  over: number;
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
      last.over = Math.max(last.over, h.over);
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
        over: h.over,
      });
  }
  return out;
}

export const placeLine = (p: RoadPlace) =>
  `${p.part} on ${p.edge} s ${p.s0.toFixed(0)}-${p.s1.toFixed(0)} d ${p.d.toFixed(1)} (x ${p.x.toFixed(0)}, z ${p.z.toFixed(0)}), ${p.cells} cells, ${p.inset.toFixed(1)} m into the lanes, up to ${p.over.toFixed(2)} m over the asphalt`;

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

/**
 * The meshes that are the road and its ground themselves (road-mesh.ts, verge.ts): the asphalt, its paint, the
 * shoulders, the land, the decks, the water and the verge's band. [default] They are drawn at the road's own
 * level, so they are held to the ground rule: none may stand more than GROUND_OVER_M over any road's asphalt
 * anywhere in its ride column (land may meet a road's edge, never rise over its lanes: the 2026-10-06 live
 * check rode under Bridge City's grass). No part is skipped by name.
 */
export const GROUND =
  /^(road-(road|shoulder|land|deck|marking|markingCenter|splitMark|splitZone|boostPad|shortcut|water)|verge-band)$/;
/**
 * The ground rule's height, m [default]: a kerb's. Paint over a crest's chord stands up to 0.13 m over the
 * curved asphalt; the grass the live check rode under on Bridge City's morrison-out stood 0.14 to 1.07 m over it
 * (this check found it there at s 28 to 94, up to 1.09 m).
 */
export const GROUND_OVER_M = 0.15;
/** Where the column starts over the asphalt for a drawn part, m: the ground's rule, or a rider's knees. */
export const floorOf = (name: string): number => (GROUND.test(name) ? GROUND_OVER_M : RIDE_LOW_M);
/** How far apart the camera stands along every edge while the sweep looks, m, and how far round it it looks. */
const POSE_M = 60;
const LOOK_M = 80;

/** Stand-ins for the pooled board items, so every slot is built, not only those naming a region sign. */
const POOLED: Record<'signs' | 'billboards', BoardItem> = {
  signs: { ref: 'test:region/pool#sign', text: 'POOLED SIGN. A stand-in.', kind: 'sign' },
  billboards: { ref: 'test:region/pool#billboard', text: 'POOLED BOARD. A stand-in.', kind: 'billboard' },
};

/**
 * Every board slot of a network built (its region signs, and a stand-in for a pooled item, as the game fills a
 * pool): the still scene's boards are only the slots that name a region sign.
 */
function everyBoard(networkId: string, road: RoadNetwork): Object3D {
  const { dressing } = track(networkId);
  const boards = new Boards(createFlatLook());
  boards.build(
    road,
    (id) =>
      (dressing as unknown as Record<string, { features?: unknown } | undefined>)[id]?.features as
        readonly BoardSlot[] | undefined,
    { ...signCatalog(), pools: { signs: [POOLED.signs], billboards: [POOLED.billboards] } },
  );
  return boards.root;
}

/**
 * Rides a camera along every edge of a network (every road, branches and connectors included) with every
 * still layer the renderer builds (scene-cost.test-util.ts's stillSceneOf), and collects each place where
 * a drawn triangle cuts the ride column. `extra` is drawn too (the negative control's planted building).
 */
export async function sweepNetwork(
  networkId: string,
  seed: number,
  extra?: (road: RoadNetwork) => Object3D,
  floor: (name: string) => number = floorOf,
): Promise<{ road: RoadNetwork; places: RoadPlace[]; points: number; poses: number; boards: number }> {
  const { road, scene } = await stillSceneOf(networkId, seed);
  const cols = roadColumns(road);
  const planted = extra?.(road);
  const boards = everyBoard(networkId, road);
  const hits = new Map<string, RoadHit>();
  const once = new Set<Object3D>();
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
      for (const r of scene.roots()) if (r.name !== 'backdrop') hitsIn(cols, r, floor, near, hits, once);
      hitsIn(cols, boards, floor, near, hits, once);
      if (planted) hitsIn(cols, planted, floor, near, hits, once);
    }
  }
  return { road, places: placesOf(hits.values()), points: cols.count, poses, boards: boards.children.length };
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
 * Hits this check found that are not buildings, left to a follow-up: [network, part, the roads, the deepest in
 * (m), what it is]. A new road or a deeper cut fails; one that is gone is printed so its line can go. It is
 * empty (lane M1, 2026-10-06): the edge kit's lines went with polish J2 (`overlap.ts`), and the rest with the
 * road's ground yielding to a lower road's lanes (a shoulder, a verge band and a fascia: `clearReach`, overlap.ts)
 * and Switchback Street's hill starting past the stair alley (tools/road/tracks/sf-hills.ts). A hit that cannot be
 * fixed at its cause goes back here, with the reason.
 */
export const KNOWN: readonly (readonly [string, string, readonly string[], number, string])[] = [];

/** Sweeps a network and holds it: every place is allowed, known, or a failure (printed by road and s). */
export async function checkNetwork(networkId: string, seed: number): Promise<void> {
  const t0 = Date.now();
  const { places, points, poses, boards } = await sweepNetwork(networkId, seed);
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
    `[examined] ${networkId} seed ${seed}: ${points} column points over every lane of every road, ${poses} camera poses, ${boards} boards (every slot), ` +
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
