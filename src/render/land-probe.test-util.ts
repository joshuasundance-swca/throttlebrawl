// Test helper: does the drawn land close, or does a plate of it float? (Run W-O's skeptic: "row
// houses stand on flat land plates that float, with sky and bay under them, at the bridge ends". The
// gate's rays straight down hit the floating plate and passed.) It reads the built road scene's
// ground meshes into a grid of world triangles, so the many short rays a walk needs stay fast.
import { DoubleSide, Mesh, Ray, Vector3, type BufferGeometry, type Material, type Object3D } from 'three';
import type { RoadNetwork } from '../road';

/** Surfaces a rider could see as ground (not the sea, the markings or the scenery). */
const GROUND = /^road-(land|road|shoulder|shortcut|deck)/;
const CELL_M = 8;
const VERGE_M = 0.6;

interface Tri {
  a: Vector3;
  b: Vector3;
  c: Vector3;
  /** Drawn from both sides (a double-sided material). */
  both: boolean;
  name: string;
}

/** The scene's ground triangles in world space, bucketed by an 8 m grid in x and z. */
export class GroundTris {
  private readonly cells = new Map<string, Tri[]>();
  readonly count: number;

  constructor(group: Object3D, keep: RegExp = GROUND) {
    group.updateMatrixWorld(true);
    let n = 0;
    group.traverse((o) => {
      if (!(o instanceof Mesh) || !keep.test(o.name) || (o as { isInstancedMesh?: boolean }).isInstancedMesh)
        return;
      const mesh = o as Mesh<BufferGeometry, Material | Material[]>;
      const pos = mesh.geometry.getAttribute('position');
      const index = mesh.geometry.getIndex();
      const both = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material)?.side === DoubleSide;
      const v = (k: number) => new Vector3().fromBufferAttribute(pos, k).applyMatrix4(mesh.matrixWorld);
      const tris = index ? index.count / 3 : pos.count / 3;
      for (let t = 0; t < tris; t++) {
        const i = (k: number) => (index ? index.getX(t * 3 + k) : t * 3 + k);
        const tri: Tri = { a: v(i(0)), b: v(i(1)), c: v(i(2)), both, name: o.name };
        const x0 = Math.floor(Math.min(tri.a.x, tri.b.x, tri.c.x) / CELL_M);
        const x1 = Math.floor(Math.max(tri.a.x, tri.b.x, tri.c.x) / CELL_M);
        const z0 = Math.floor(Math.min(tri.a.z, tri.b.z, tri.c.z) / CELL_M);
        const z1 = Math.floor(Math.max(tri.a.z, tri.b.z, tri.c.z) / CELL_M);
        for (let cx = x0; cx <= x1; cx++)
          for (let cz = z0; cz <= z1; cz++) {
            const key = `${cx},${cz}`;
            const list = this.cells.get(key);
            if (list) list.push(tri);
            else this.cells.set(key, [tri]);
          }
        n++;
      }
    });
    this.count = n;
  }

  /**
   * The highest ground under (x, z) below `top`, or null over open sea, with how flat it is there
   * (`up`: the face normal's upward part, 1 = level, 0 = a wall).
   */
  heightAt(x: number, z: number, top = 1e4): { y: number; name: string; up: number } | null {
    const ray = new Ray(new Vector3(x, top, z), new Vector3(0, -1, 0));
    const hit = new Vector3();
    const n = new Vector3();
    let best: { y: number; name: string; up: number } | null = null;
    for (const t of this.cells.get(`${Math.floor(x / CELL_M)},${Math.floor(z / CELL_M)}`) ?? []) {
      // Seen from above: a front face, or either face of a double-sided one.
      if (!ray.intersectTriangle(t.a, t.b, t.c, !t.both, hit)) continue;
      if (best && hit.y <= best.y) continue;
      n.subVectors(t.b, t.a).cross(new Vector3().subVectors(t.c, t.a)).normalize();
      best = { y: hit.y, name: t.name, up: Math.abs(n.y) };
    }
    return best;
  }

  /** Distance to the first ground face a ray meets within `far`, as the renderer draws it. */
  firstHit(from: Vector3, dir: Vector3, far: number): number | null {
    const ray = new Ray(from.clone(), dir.clone().normalize());
    const seen = new Set<Tri>();
    const hit = new Vector3();
    let best: number | null = null;
    for (let u = 0; u <= far + CELL_M; u += CELL_M / 2) {
      const p = ray.at(Math.min(u, far), new Vector3());
      for (let i = -1; i <= 1; i++)
        for (let j = -1; j <= 1; j++) {
          for (const t of this.cells.get(`${Math.floor(p.x / CELL_M) + i},${Math.floor(p.z / CELL_M) + j}`) ??
            []) {
            if (seen.has(t)) continue;
            seen.add(t);
            if (!ray.intersectTriangle(t.a, t.b, t.c, !t.both, hit)) continue;
            const d = hit.distanceTo(ray.origin);
            if (d <= far && (best === null || d < best)) best = d;
          }
        }
    }
    return best;
  }
}

export interface OpenLandEnd {
  edge: string;
  /** The last s with the high ground, and the side and the distance past the verge walked. */
  s: number;
  side: -1 | 1;
  across: number;
  /** Metres the ground dropped in one step. */
  drop: number;
}

/** Distances past the verge a walk follows: the land strip (to 24 m) and the skirt's slope. */
export const WALK_ACROSS_M = [2, 10, 20, 35, 60] as const;
const STEP_M = 2;
const DROP_M = 2;
const LOOK_PAST_M = 6;
/** cos 35 degrees: ground at least this level counts as a plate a walk looks under. */
const PLATE_UP = 0.82;

/**
 * Land that ends in mid-air. Walks each side of every road at a few distances past the verge, 2 m
 * at a time, reading the ground's height straight down. Where it drops more than 2 m in one step,
 * a ray from the low step, 1 m under the high ground, looks back under it to 6 m past the high
 * step. Closed ground (a slope, a bank, a cap) stops that ray; a plate that ends in mid-air lets it
 * through: that is the sky the camera saw under the houses.
 */
export function openLandEnds(
  road: RoadNetwork,
  ground: GroundTris,
): { probes: number; drops: number; open: OpenLandEnd[] } {
  let probes = 0;
  let drops = 0;
  const open: OpenLandEnd[] = [];
  for (const e of road.edges) {
    const n = Math.max(1, Math.round(e.length / STEP_M));
    for (const side of [-1, 1] as const) {
      const outer = side < 0 ? -e.dMin + VERGE_M : e.dMax + VERGE_M;
      for (const across of WALK_ACROSS_M) {
        const d = side * (outer + across);
        const pts: { s: number; p: Vector3; g: number; up: number; land: boolean }[] = [];
        // Half a step off the land's own rows, so no ray lands on a seam between two quads.
        for (let i = 0; i < n; i++) {
          const s = (e.length * (i + 0.5)) / n;
          const w = road.toWorld(e.index, s, d, 0);
          const h = ground.heightAt(w.x, w.z, w.y + 60);
          probes++;
          // Over open sea the ground is the sea itself, at y = 0.
          pts.push({
            s,
            p: new Vector3(w.x, w.y, w.z),
            g: h?.y ?? 0,
            up: h?.up ?? 0,
            land: !!h?.name.startsWith('road-land'),
          });
        }
        for (let i = 0; i < pts.length; i++) {
          const hi = pts[i]!;
          // A plate of land: ground flatter than about 35 degrees (the strip, a skirt, the flat). A
          // shelf's cliff face is not a plate, and where it twists it reads as one only by accident;
          // a bridge's deck and a railed road's catwalk stand over the water by design.
          if (!hi.land || hi.up < PLATE_UP) continue;
          for (const j of [i - 1, i + 1]) {
            const lo = pts[j];
            if (!lo || hi.g - lo.g <= DROP_M) continue;
            drops++;
            const y = hi.g - 1;
            const from = new Vector3(lo.p.x, y, lo.p.z);
            const to = new Vector3(hi.p.x, y, hi.p.z);
            const dir = to.clone().sub(from);
            // Where the land narrows, its shelf twists between two rows and the cap stands a row or
            // two on, so the look goes 6 m past the high step: an open plate shows far more.
            const far = dir.length() + LOOK_PAST_M;
            if (ground.firstHit(from, dir, far) === null)
              open.push({ edge: e.id, s: hi.s, side, across, drop: hi.g - lo.g });
          }
        }
      }
    }
  }
  return { probes, drops, open };
}
