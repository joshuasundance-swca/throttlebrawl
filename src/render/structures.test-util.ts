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
 * Points over every triangle of a geometry, no more than about `step` m apart, each through `place` (the
 * drawn transform): the drawn surface, not only its corners (a hipped roof's slope has no vertex in it).
 */
export function surfacePoints(
  g: BufferGeometry,
  step: number,
  place: (x: number, y: number, z: number) => DrawnPoint = (x, y, z) => ({ x, y, z }),
): DrawnPoint[] {
  const p = g.getAttribute('position');
  const idx = g.getIndex();
  const tris = idx ? idx.count / 3 : p.count / 3;
  const at = (i: number): [number, number, number] => {
    const j = idx ? idx.getX(i) : i;
    return [p.getX(j), p.getY(j), p.getZ(j)];
  };
  const out: DrawnPoint[] = [];
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
        out.push(
          place(
            a[0] + (b[0] - a[0]) * u + (c[0] - a[0]) * v,
            a[1] + (b[1] - a[1]) * u + (c[1] - a[1]) * v,
            a[2] + (b[2] - a[2]) * u + (c[2] - a[2]) * v,
          ),
        );
      }
  }
  return out;
}

/** A solid as the structure contract has it: a footprint, a base and a roof (road/structures.ts). */
export type Solid = Pick<StructureSpec, 'foot' | 'baseY' | 'roof'> & { name?: string };

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
  /** Points farther than the tolerance from every solid: [the point, how far]. */
  loose: [DrawnPoint, number][];
  /** The farthest any drawn point lies from every solid, m. */
  worst: number;
  /** Solids a face of which no drawn point inside it comes near: [name, the face, the gap], m. */
  slack: [string, string, number][];
}

/**
 * Whether solids hold a drawn shape: every point within `tol` of some solid (none of the drawing stands outside
 * them), and every face of every solid touched, within `slack`, by the drawn points inside it (no solid is bigger
 * than what it stands for, nor moved off it). A pitched roof's top face is its ridge.
 */
export function holds(
  solids: readonly Solid[],
  points: readonly DrawnPoint[],
  tol: number,
  slack: number,
): Holding {
  const loose: [DrawnPoint, number][] = [];
  let worst = 0;
  const bounds = solids.map(() => ({
    u0: Infinity,
    u1: -Infinity,
    v0: Infinity,
    v1: -Infinity,
    h0: Infinity,
    h1: -Infinity,
  }));
  for (const q of points) {
    let best = Infinity;
    solids.forEach((s, i) => {
      const off = outside(s, q);
      if (off < best) best = off;
      if (off <= 1e-6) {
        const { u, v, h } = local(s, q);
        const b = bounds[i];
        if (!b) return;
        b.u0 = Math.min(b.u0, u);
        b.u1 = Math.max(b.u1, u);
        b.v0 = Math.min(b.v0, v);
        b.v1 = Math.max(b.v1, v);
        b.h0 = Math.min(b.h0, h);
        b.h1 = Math.max(b.h1, h);
      }
    });
    if (best > tol) loose.push([q, best]);
    if (best > worst) worst = best;
  }
  const out: [string, string, number][] = [];
  solids.forEach((s, i) => {
    const b = bounds[i];
    if (!b) return;
    const top = s.roof.kind === 'flat' ? s.roof.topM : s.roof.ridgeM;
    const gaps: [string, number][] = [
      ['-u', b.u0 + s.foot.hu],
      ['+u', s.foot.hu - b.u1],
      ['-v', b.v0 + s.foot.hv],
      ['+v', s.foot.hv - b.v1],
      ['base', b.h0],
      ['top', top - b.h1],
    ];
    for (const [face, gap] of gaps) if (!(gap <= slack)) out.push([s.name ?? `#${i}`, face, gap]);
  });
  return { loose, worst, slack: out };
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
