/// <reference types="vite/client" />
// The geometry invariant sweeps' shared ground (quality-confidence rec 3, 2026-10-03: "one defect
// family escaped six times": pedestrians in the water, palms and poles over the sea, floating land
// plates, conifers over water, a land gap at a junction, backdrop floors over the near sea). Each
// sweep runs on every network a route in any region pack races on. The list comes from the packs'
// route files, never a hand-written list, so a new route or region is swept the day it lands.
import { DoubleSide, Mesh, Vector3, type BufferGeometry, type Material, type Object3D } from 'three';
import {
  createRoadNetwork,
  type BakedNetwork,
  type BakedRoad,
  type BakedRoute,
  type RoadNetwork,
} from '../../src/road';
import { createFlatLook } from '../../src/render/look';
import type { RoadDressing } from '../../src/render/road-mesh';

type Glob<T> = Record<string, T>;
const networkFiles: Glob<BakedNetwork> = import.meta.glob<BakedNetwork>(
  '/packs/*/regions/*/networks/*.json',
  {
    eager: true,
    import: 'default',
  },
);
const roadFiles: Glob<BakedRoad> = import.meta.glob<BakedRoad>('/packs/*/regions/*/roads/*.json', {
  eager: true,
  import: 'default',
});
const routeFiles: Glob<BakedRoute> = import.meta.glob<BakedRoute>('/packs/*/regions/*/routes/*.json', {
  eager: true,
  import: 'default',
});
const regionFiles: Glob<{ id: string; palette?: Record<string, string> }> = import.meta.glob<{
  id: string;
  palette?: Record<string, string>;
}>('/packs/*/regions/*/region.json', { eager: true, import: 'default' });

/** The examined lines, printed even when the tests pass. */
export const print = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

export const look = createFlatLook();

/** `/packs/<pack>/regions/<region>/...` */
const where = (path: string): { pack: string; region: string } => {
  const m = /\/packs\/([^/]+)\/regions\/([^/]+)\//.exec(path);
  if (!m) throw new Error(`not a region file: ${path}`);
  return { pack: m[1]!, region: m[2]! };
};

export interface RouteNetwork {
  /** The network id. */
  id: string;
  pack: string;
  region: string;
  /** The routes that race on it, `<pack>:<route>`. */
  routes: string[];
  /** Every road some route on it allows (pedestrians and cops spawn only on a route's roads). */
  allowed: Set<string>;
}

/** Every network some route in some region pack races on, from the route files. */
export function routeNetworks(): RouteNetwork[] {
  const out = new Map<string, RouteNetwork>();
  for (const [path, route] of Object.entries(routeFiles)) {
    const { pack } = where(path);
    const net = Object.entries(networkFiles).find(
      ([p, n]) => n.id === route.network && where(p).pack === pack,
    );
    if (!net) throw new Error(`route ${pack}:${route.id} names network ${route.network}, not in its pack`);
    const key = `${pack}:${route.network}`;
    const entry = out.get(key) ?? {
      id: route.network,
      pack,
      region: where(net[0]).region,
      routes: [],
      allowed: new Set<string>(),
    };
    entry.routes.push(`${pack}:${route.id}`);
    for (const r of route.allowedRoads) entry.allowed.add(r);
    out.set(key, entry);
  }
  return [...out.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/** The number of route files in the packs (the sweeps assert they covered every one). */
export const routeFileCount = (): number => Object.keys(routeFiles).length;

export interface Track {
  id: string;
  road: RoadNetwork;
  dressing: RoadDressing;
  roads: BakedRoad[];
  palette: Record<string, string>;
}

const tracks = new Map<string, Track>();

/** A route network's road, built from its own pack's files (every road it names must be there). */
export function track(net: RouteNetwork): Track {
  const key = `${net.pack}:${net.id}`;
  const cached = tracks.get(key);
  if (cached) return cached;
  const network = Object.entries(networkFiles).find(
    ([p, n]) => n.id === net.id && where(p).pack === net.pack,
  )?.[1];
  if (!network) throw new Error(`no network ${key}`);
  const own = Object.entries(roadFiles).filter(([p]) => where(p).pack === net.pack);
  const roads = network.roads.map((id) => {
    const r = own.find(([, x]) => x.id === id)?.[1];
    if (!r) throw new Error(`network ${key} names road ${id}, not in its pack`);
    return r;
  });
  const dressing = Object.fromEntries(roads.map((r) => [r.id, r])) as unknown as RoadDressing;
  const region = Object.entries(regionFiles).find(([p]) => where(p).region === net.region)?.[1];
  const t: Track = {
    id: net.id,
    road: createRoadNetwork({ network, roads }),
    dressing,
    roads,
    palette: region?.palette ?? {},
  };
  tracks.set(key, t);
  return t;
}

/** A bridge tag covers (edge's road, s), with `pad` metres either side. */
export function onBridge(t: Track, edge: number, s: number, pad = 0): boolean {
  const e = t.road.edges[edge];
  const tags = (t.dressing[e?.id ?? '']?.tags ?? []) as readonly { s0: number; s1: number; tag: string }[];
  return tags.some((x) => x.tag === 'bridge' && s >= x.s0 - pad && s <= x.s1 + pad);
}

/**
 * The seeds: the fixed test seeds, every seed a skeptic named (scenery over the sea, the fresh-race
 * probes), and a spread of 32-bit seeds as the app's createRaceSeeds draws them (scenery-sweep's).
 */
export const NAMED_SEEDS: readonly number[] = [
  1, 2, 3, 7, 11, 2447605036, 3230531489, 4052564335, 1783423519, 2901547813, 3140025420, 849069689,
];
export const SPREAD_SEEDS: readonly number[] = Array.from(
  { length: 12 },
  (_, i) => Math.imul(i + 1, 0x9e3779b1) >>> 0 || 1,
);

/** Every mesh a rider could see as the ground or the sea, as road-mesh.ts names them. */
export const SURFACES =
  /^road-(land|water|road|shoulder|shortcut|deck|marking|splitZone|rampMark|boost|cableSlot)/;

const CELL_M = 8;
const cellKey = (cx: number, cz: number) => (cx + 0x8000) * 0x10000 + (cz + 0x8000);

/**
 * The surfaces of a built scene as world triangles on an 8 m grid, read straight down. It answers
 * exactly what land-probe.test-util.ts's GroundTris.heightAt does (the highest face under a point
 * that a ray from above meets: a front face, or either face of a double-sided one), without a
 * three.js Ray per query, so a sweep can ask a few million times. The land test checks the two agree.
 */
export class DownIndex {
  private readonly cells = new Map<number, number[]>();
  /** Per triangle: ax ay az bx by bz cx cy cz. */
  private readonly v: number[] = [];
  private readonly both: boolean[] = [];
  private readonly name: string[] = [];
  readonly count: number;

  constructor(groups: Object3D | readonly Object3D[], keep: RegExp = SURFACES) {
    const p = new Vector3();
    const list: readonly Object3D[] = 'isObject3D' in groups ? [groups] : groups;
    for (const group of list) this.add(group, keep, p);
    this.count = this.name.length;
  }

  private add(group: Object3D, keep: RegExp, p: Vector3): void {
    group.updateMatrixWorld(true);
    group.traverse((o) => {
      if (!(o instanceof Mesh) || (o as { isInstancedMesh?: boolean }).isInstancedMesh || !keep.test(o.name))
        return;
      const mesh = o as Mesh<BufferGeometry, Material | Material[]>;
      const pos = mesh.geometry.getAttribute('position');
      const index = mesh.geometry.getIndex();
      const both = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material)?.side === DoubleSide;
      const n = index ? index.count / 3 : pos.count / 3;
      for (let t = 0; t < n; t++) {
        const id = this.name.length;
        let x0 = Infinity;
        let x1 = -Infinity;
        let z0 = Infinity;
        let z1 = -Infinity;
        for (let k = 0; k < 3; k++) {
          p.fromBufferAttribute(pos, index ? index.getX(t * 3 + k) : t * 3 + k).applyMatrix4(
            mesh.matrixWorld,
          );
          this.v.push(p.x, p.y, p.z);
          x0 = Math.min(x0, p.x);
          x1 = Math.max(x1, p.x);
          z0 = Math.min(z0, p.z);
          z1 = Math.max(z1, p.z);
        }
        this.both.push(both);
        this.name.push(o.name);
        for (let cx = Math.floor(x0 / CELL_M); cx <= Math.floor(x1 / CELL_M); cx++)
          for (let cz = Math.floor(z0 / CELL_M); cz <= Math.floor(z1 / CELL_M); cz++) {
            const key = cellKey(cx, cz);
            const list = this.cells.get(key);
            if (list) list.push(id);
            else this.cells.set(key, [id]);
          }
      }
    });
  }

  /**
   * The highest surface under (x, z) at or below `top`, or null over nothing, with how flat it is
   * there (`up`: the face normal's upward part, 1 = level).
   */
  at(x: number, z: number, top = 1e4): { y: number; name: string; up: number } | null {
    const list = this.cells.get(cellKey(Math.floor(x / CELL_M), Math.floor(z / CELL_M)));
    if (!list) return null;
    const v = this.v;
    let best = -1;
    let bestY = -Infinity;
    let bestUp = 0;
    for (const t of list) {
      const o = t * 9;
      const ax = v[o]!;
      const ay = v[o + 1]!;
      const az = v[o + 2]!;
      const ex = v[o + 3]! - ax;
      const ey = v[o + 4]! - ay;
      const ez = v[o + 5]! - az;
      const fx = v[o + 6]! - ax;
      const fy = v[o + 7]! - ay;
      const fz = v[o + 8]! - az;
      // The face normal (e x f); a ray going down meets a front face when its normal points up.
      const ny = ez * fx - ex * fz;
      if (ny === 0 || (ny < 0 && !this.both[t])) continue;
      // (x, z) = a + u e + w f, solved in the ground plane.
      const px = x - ax;
      const pz = z - az;
      const det = ex * fz - ez * fx;
      const u = (px * fz - pz * fx) / det;
      const w = (ex * pz - ez * px) / det;
      if (u < 0 || w < 0 || u + w > 1) continue;
      const y = ay + u * ey + w * fy;
      if (y > top || y <= bestY) continue;
      const nx = ey * fz - ez * fy;
      const nz = ex * fy - ey * fx;
      best = t;
      bestY = y;
      bestUp = Math.abs(ny) / Math.hypot(nx, ny, nz);
    }
    return best < 0 ? null : { y: bestY, name: this.name[best]!, up: bestUp };
  }
}

/** A known violation: a stable key, and why it is allowed for now. The lists may only shrink. */
export interface KnownViolation {
  key: string;
  why: string;
}

/**
 * Splits found violations (by key) into the new ones (a failure) and the known ones still seen; a
 * known one no longer seen is stale and fails too, so a fix must also delete its entry.
 */
export function against(
  found: readonly string[],
  known: readonly KnownViolation[],
): { fresh: string[]; seen: string[]; stale: string[] } {
  const keys = new Set(known.map((k) => k.key));
  const got = new Set(found);
  return {
    fresh: [...got].filter((k) => !keys.has(k)),
    seen: [...got].filter((k) => keys.has(k)),
    stale: [...keys].filter((k) => !got.has(k)),
  };
}
