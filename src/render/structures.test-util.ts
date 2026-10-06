// Shared by the structure plans' tests (road/structures/: the Old Town fronts and the landmarks): the
// networks as the game builds them, the landmark kits as the game bakes them, and a printer for the
// examined lines.
import type { BufferGeometry } from 'three';
import { assetIndex, createPackLibrary } from '../content';
import {
  createRoadNetwork,
  type BakedNetwork,
  type BakedRoad,
  type RoadNetwork,
  type StructureSpec,
} from '../road';
import { readGlb } from './glb';
import { bakeLandmarkKit, landmarkKitAsset, type LandmarkKit, type LandmarkKitId } from './models';
import type { RoadDressing } from './road-mesh';

/** The examined lines, printed even when the tests pass (console.log is not). */
const stdout = (globalThis as unknown as { process: { stdout: { write(s: string): void } } }).process.stdout;
export const print = (line: string) => stdout.write(`${line}\n`);

const networkFiles = import.meta.glob<BakedNetwork>('../../packs/*/regions/*/networks/*.json', {
  eager: true,
  import: 'default',
});
const roadFiles = import.meta.glob<BakedRoad>('../../packs/*/regions/*/roads/*.json', {
  eager: true,
  import: 'default',
});

/** Every network id the packs ship, sorted. */
export const NETWORK_IDS: readonly string[] = Object.values(networkFiles)
  .map((n) => n.id)
  .sort();

/** A network as the game builds it, and its road files as the renderer's dressing. */
export function track(id: string): { road: RoadNetwork; dressing: RoadDressing } {
  const [path, network] = Object.entries(networkFiles).find(([, n]) => n.id === id) ?? [];
  if (!network || !path) throw new Error(`no network ${id}`);
  const pack = /packs\/([^/]+)\//.exec(path)?.[1] ?? '';
  const roads = Object.entries(roadFiles)
    .filter(([p, r]) => p.includes(`/packs/${pack}/`) && network.roads.includes(r.id))
    .map(([, r]) => r);
  const dressing = Object.fromEntries(roads.map((r) => [r.id, r])) as unknown as RoadDressing;
  return { road: createRoadNetwork({ network, roads }), dressing };
}

/** A point of drawn geometry, in the world (or a model's own frame). */
export interface DrawnPoint {
  x: number;
  y: number;
  z: number;
}

/**
 * Each point over every triangle of a geometry, no more than about `step` m apart, to `each`: the drawn surface,
 * not only its corners (a hipped roof's slope has no vertex in it). No list: a big landmark has millions.
 */
export function eachSurfacePoint(
  g: BufferGeometry,
  step: number,
  each: (x: number, y: number, z: number) => void,
): void {
  const p = g.getAttribute('position');
  const idx = g.getIndex();
  const tris = idx ? idx.count / 3 : p.count / 3;
  const at = (i: number): [number, number, number] => {
    const j = idx ? idx.getX(i) : i;
    return [p.getX(j), p.getY(j), p.getZ(j)];
  };
  for (let t = 0; t < tris; t++) {
    const a = at(t * 3);
    const b = at(t * 3 + 1);
    const c = at(t * 3 + 2);
    const span = Math.max(
      Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]),
      Math.hypot(a[0] - c[0], a[1] - c[1], a[2] - c[2]),
      Math.hypot(b[0] - c[0], b[1] - c[1], b[2] - c[2]),
    );
    const n = Math.max(1, Math.ceil(span / step));
    for (let i = 0; i <= n; i++)
      for (let j = 0; j <= n - i; j++) {
        const u = i / n;
        const v = j / n;
        each(
          a[0] + (b[0] - a[0]) * u + (c[0] - a[0]) * v,
          a[1] + (b[1] - a[1]) * u + (c[1] - a[1]) * v,
          a[2] + (b[2] - a[2]) * u + (c[2] - a[2]) * v,
        );
      }
  }
}

/** The points of `eachSurfacePoint`, each through `place` (the drawn transform), as a list (a model's worth). */
export function surfacePoints(
  g: BufferGeometry,
  step: number,
  place: (x: number, y: number, z: number) => DrawnPoint = (x, y, z) => ({ x, y, z }),
): DrawnPoint[] {
  const out: DrawnPoint[] = [];
  eachSurfacePoint(g, step, (x, y, z) => out.push(place(x, y, z)));
  return out;
}

/**
 * A solid as the structure contract has it: a footprint, a base and a roof (road/structures.ts). `freeBase` says
 * its base is not where the drawing ends (a building solid from its ground under a roof drawn high up).
 */
export type Solid = Pick<StructureSpec, 'foot' | 'baseY' | 'roof'> & { name?: string; freeBase?: boolean };

/** A point in a solid's frame: along its u and v axes from its middle, and its height over its base. */
function local(s: Solid, q: DrawnPoint): { u: number; v: number; h: number } {
  const dx = q.x - s.foot.x;
  const dz = q.z - s.foot.z;
  return { u: dx * s.foot.ux + dz * s.foot.uz, v: dz * s.foot.ux - dx * s.foot.uz, h: q.y - s.baseY };
}

/** The roof's height over the base at a point of the footprint (its edges and past them, clamped). */
function roofAt(s: Solid, u: number, v: number): number {
  const r = s.roof;
  if (r.kind === 'flat') return r.topM;
  const across = r.ridge === 'u' ? Math.abs(v) / s.foot.hv : Math.abs(u) / s.foot.hu;
  return r.ridgeM - (r.ridgeM - r.eaveM) * Math.min(1, across);
}

/** How far a point lies outside a solid, m (0 inside). */
export function outside(s: Solid, q: DrawnPoint): number {
  const { u, v, h } = local(s, q);
  const top = roofAt(s, u, v);
  return Math.max(0, Math.abs(u) - s.foot.hu, Math.abs(v) - s.foot.hv, -h, h - top);
}

export interface Holding {
  /** Points farther than the tolerance from every solid (the first thousand): [the point, how far]. */
  loose: [DrawnPoint, number][];
  /** How many points lie farther than the tolerance from every solid. */
  looseCount: number;
  /** The farthest any drawn point lies from every solid, m. */
  worst: number;
  /** Solids a face of which no drawn point inside it comes near: [name, the face, the gap], m. */
  slack: [string, string, number][];
}

/**
 * Whether solids hold a drawn shape, a point at a time (`add`, then `result`): every point within `tol` of some
 * solid (none of the drawing stands outside them), and every face of every solid touched, within `slack`, by the
 * drawn points in it or within `slack` of it (no solid is bigger than what it stands for, nor moved off it). A
 * pitched roof's top face is its ridge.
 */
export class Hold {
  private readonly loose: [DrawnPoint, number][] = [];
  private looseCount = 0;
  private worst = 0;
  private readonly bounds: { u0: number; u1: number; v0: number; v1: number; h0: number; h1: number }[];
  /** A grid of the solids' ground bounds (each grown by the tolerance), so a point asks only those near it. */
  private readonly grid = new Map<string, number[]>();
  private static readonly CELL = 8;

  constructor(
    private readonly solids: readonly Solid[],
    private readonly tol: number,
    private readonly slack: number,
  ) {
    this.bounds = solids.map(() => ({
      u0: Infinity,
      u1: -Infinity,
      v0: Infinity,
      v1: -Infinity,
      h0: Infinity,
      h1: -Infinity,
    }));
    const C = Hold.CELL;
    const grow = Math.max(tol, slack);
    solids.forEach((s, i) => {
      const f = s.foot;
      const ex = f.hu * Math.abs(f.ux) + f.hv * Math.abs(f.uz) + grow;
      const ez = f.hu * Math.abs(f.uz) + f.hv * Math.abs(f.ux) + grow;
      for (let a = Math.floor((f.x - ex) / C); a <= Math.floor((f.x + ex) / C); a++)
        for (let b = Math.floor((f.z - ez) / C); b <= Math.floor((f.z + ez) / C); b++) {
          const k = `${a},${b}`;
          const list = this.grid.get(k);
          if (list) list.push(i);
          else this.grid.set(k, [i]);
        }
    });
  }

  add(x: number, y: number, z: number): void {
    const q = { x, y, z };
    let best = Infinity;
    for (const i of this.grid.get(`${Math.floor(x / Hold.CELL)},${Math.floor(z / Hold.CELL)}`) ?? []) {
      const s = this.solids[i];
      if (!s) continue;
      const off = outside(s, q);
      if (off < best) best = off;
      // The drawing in it, or at its faces within the slack: what its faces must come near.
      if (off <= this.slack) {
        const { u, v, h } = local(s, q);
        const b = this.bounds[i];
        if (!b) continue;
        b.u0 = Math.min(b.u0, u);
        b.u1 = Math.max(b.u1, u);
        b.v0 = Math.min(b.v0, v);
        b.v1 = Math.max(b.v1, v);
        b.h0 = Math.min(b.h0, h);
        b.h1 = Math.max(b.h1, h);
      }
    }
    if (best > this.tol) {
      this.looseCount++;
      if (this.loose.length < 1000) this.loose.push([q, best]);
    }
    if (best > this.worst) this.worst = best;
  }

  result(): Holding {
    const out: [string, string, number][] = [];
    this.solids.forEach((s, i) => {
      const b = this.bounds[i];
      if (!b) return;
      const top = s.roof.kind === 'flat' ? s.roof.topM : s.roof.ridgeM;
      const gaps: [string, number][] = [
        ['-u', b.u0 + s.foot.hu],
        ['+u', s.foot.hu - b.u1],
        ['-v', b.v0 + s.foot.hv],
        ['+v', s.foot.hv - b.v1],
        ['base', s.freeBase ? 0 : b.h0],
        ['top', top - b.h1],
      ];
      for (const [face, gap] of gaps) if (!(gap <= this.slack)) out.push([s.name ?? `#${i}`, face, gap]);
    });
    return { loose: this.loose, looseCount: this.looseCount, worst: this.worst, slack: out };
  }
}

/** `Hold` over a list of points. */
export function holds(
  solids: readonly Solid[],
  points: readonly DrawnPoint[],
  tol: number,
  slack: number,
): Holding {
  const hold = new Hold(solids, tol, slack);
  for (const q of points) hold.add(q.x, q.y, q.z);
  return hold.result();
}

/** A landmark kit baked from its committed file, as the game bakes it (models.ts `bakeLandmarkKit`). */
export async function landmarkKit(id: LandmarkKitId): Promise<LandmarkKit> {
  const mod: string = 'node:fs';
  const fs = (await import(/* @vite-ignore */ mod)) as { readFileSync(p: string): Uint8Array };
  const row = assetIndex(createPackLibrary().registry()).find((r) => r.id === landmarkKitAsset(id));
  if (!row) throw new Error(`no asset row for the landmark kit ${id}`);
  const buf = fs.readFileSync(`packs/${row.packId}/assets/${row.id}.glb`);
  const data = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  return bakeLandmarkKit(id, readGlb(data));
}
