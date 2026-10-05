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

  /** Every ground face under (x, z) below `top`, highest first (what stacks there, as seen from above). */
  allAt(x: number, z: number, top = 1e4): { y: number; name: string }[] {
    const ray = new Ray(new Vector3(x, top, z), new Vector3(0, -1, 0));
    const hit = new Vector3();
    const out: { y: number; name: string }[] = [];
    for (const t of this.cells.get(`${Math.floor(x / CELL_M)},${Math.floor(z / CELL_M)}`) ?? []) {
      if (ray.intersectTriangle(t.a, t.b, t.c, !t.both, hit)) out.push({ y: hit.y, name: t.name });
    }
    return out.sort((a, b) => b.y - a.y);
  }

  /** Every face's three corners, for a test that samples what the scene draws (not where rays land). */
  triangles(): { a: Vector3; b: Vector3; c: Vector3; name: string }[] {
    const seen = new Set<Tri>();
    for (const list of this.cells.values()) for (const t of list) seen.add(t);
    return [...seen].map((t) => ({ a: t.a, b: t.b, c: t.c, name: t.name }));
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
/** How far inside each road's end a junction's land is read, m (off the end row's own seam). */
const JOIN_IN_M = 0.25;
/** cos 35 degrees: ground at least this level counts as a plate a walk looks under. */
const PLATE_UP = 0.82;

/** One point of a walk: where it stands, the ground's height there, how flat it is, and if it is land. */
interface WalkPt {
  s: number;
  p: Vector3;
  g: number;
  up: number;
  land: boolean;
}

/**
 * Land that ends in mid-air. Walks each side of every road at a few distances past the verge, 2 m
 * at a time, reading the ground's height straight down. Where it drops more than 2 m in one step,
 * a ray from the low step, 1 m under the high ground, looks back under it to 6 m past the high
 * step. Closed ground (a slope, a bank, a cap) stops that ray; a plate that ends in mid-air lets it
 * through: that is the sky the camera saw under the houses.
 *
 * The walk also steps across every junction, from one road's last point to the joined road's first
 * on the same side (run W-P's roadside verifier: a ledge where Twin Peaks' Upper Market joins
 * Portola had sky under it, and a walk that stopped at each road's end never looked there).
 */
export function openLandEnds(
  road: RoadNetwork,
  ground: GroundTris,
): { probes: number; drops: number; open: OpenLandEnd[]; joins: number } {
  let probes = 0;
  let drops = 0;
  let joins = 0;
  const open: OpenLandEnd[] = [];
  const walks = new Map<string, WalkPt[]>();
  const key = (edge: number, side: -1 | 1, across: number) => `${edge}|${side}|${across}`;
  const look = (edge: string, hi: WalkPt, lo: WalkPt, side: -1 | 1, across: number) => {
    // A plate of land: ground flatter than about 35 degrees (the strip, a skirt, the flat). A
    // shelf's cliff face is not a plate, and where it twists it reads as one only by accident;
    // a bridge's deck and a railed road's catwalk stand over the water by design.
    if (!hi.land || hi.up < PLATE_UP || hi.g - lo.g <= DROP_M) return;
    drops++;
    const y = hi.g - 1;
    const from = new Vector3(lo.p.x, y, lo.p.z);
    const to = new Vector3(hi.p.x, y, hi.p.z);
    const dir = to.clone().sub(from);
    // Where the land narrows, its shelf twists between two rows and the cap stands a row or
    // two on, so the look goes 6 m past the high step: an open plate shows far more.
    const far = dir.length() + LOOK_PAST_M;
    if (ground.firstHit(from, dir, far) === null)
      open.push({ edge, s: hi.s, side, across, drop: hi.g - lo.g });
  };
  /** The ground straight down at (s, d) of an edge. Over open sea it is the sea itself, at y = 0. */
  const at = (edge: number, s: number, d: number): WalkPt => {
    const w = road.toWorld(edge, s, d, 0);
    const h = ground.heightAt(w.x, w.z, w.y + 60);
    return {
      s,
      p: new Vector3(w.x, w.y, w.z),
      g: h?.y ?? 0,
      up: h?.up ?? 0,
      land: !!h?.name.startsWith('road-land'),
    };
  };
  for (const e of road.edges) {
    const n = Math.max(1, Math.round(e.length / STEP_M));
    for (const side of [-1, 1] as const) {
      const outer = side < 0 ? -e.dMin + VERGE_M : e.dMax + VERGE_M;
      for (const across of WALK_ACROSS_M) {
        const d = side * (outer + across);
        const pts: WalkPt[] = [];
        // Half a step off the land's own rows, so no ray lands on a seam between two quads.
        for (let i = 0; i < n; i++) {
          const s = (e.length * (i + 0.5)) / n;
          pts.push(at(e.index, s, d));
          probes++;
        }
        walks.set(key(e.index, side, across), pts);
        for (let i = 0; i < pts.length; i++)
          for (const j of [i - 1, i + 1]) {
            const lo = pts[j];
            if (lo) look(e.id, pts[i]!, lo, side, across);
          }
      }
    }
  }
  // Across each junction: this road's last point against the joined road's first one, at the same
  // place across (a join that flips the road's direction swaps the sides; a connector's start can
  // sit off the centreline by its dShift). Each road's own end looks at the joined road's end.
  for (const e of road.edges) {
    for (const [end, links] of [
      ['to', e.nextLinks],
      ['from', e.prevLinks],
    ] as const)
      for (const l of links) {
        const o = road.edges[l.edge];
        if (!o || o.index === e.index) continue;
        const flip = end === l.entersAt ? -1 : 1;
        const oHalf = o.length / Math.max(1, Math.round(o.length / STEP_M)) / 2;
        const os = l.entersAt === 'from' ? oHalf : o.length - oHalf;
        for (const side of [-1, 1] as const)
          for (const across of WALK_ACROSS_M) {
            const mine = walks.get(key(e.index, side, across));
            if (!mine?.length) continue;
            const a = end === 'to' ? mine[mine.length - 1]! : mine[0]!;
            const d = side * ((side < 0 ? -e.dMin : e.dMax) + VERGE_M + across);
            const od = flip * d + (l.dShift ?? 0);
            const b = at(o.index, os, od);
            probes++;
            joins++;
            look(e.id, a, b, side, across);
            look(o.id, b, a, od < 0 ? -1 : 1, across);
            // Where both roads have land here at the same height, the land between their two end
            // rows is drawn too: on the outside of a turn the rows fan apart, and the wedge between
            // them showed the sky as a thin line (run W-P, Upper Market into Portola).
            const a2 = at(e.index, end === 'to' ? e.length - JOIN_IN_M : JOIN_IN_M, d);
            const b2 = at(o.index, l.entersAt === 'from' ? JOIN_IN_M : o.length - JOIN_IN_M, od);
            probes += 2;
            // A shelf's foot under the sea (y below 0) is not a plate that could show the sky (run W-U:
            // the Mangrove Boardwalk's split, 35 m out, met two shelf feet across open water).
            if (!a2.land || !b2.land || a2.g <= 0 || b2.g <= 0 || Math.abs(a2.g - b2.g) > 1) continue;
            const mx = (a2.p.x + b2.p.x) / 2;
            const mz = (a2.p.z + b2.p.z) / 2;
            const low = Math.min(a2.g, b2.g);
            const mid = ground.heightAt(mx, mz, Math.max(a2.g, b2.g) + 60);
            if (!mid || mid.y < low - 1)
              open.push({ edge: e.id, s: a2.s, side, across, drop: low - (mid?.y ?? 0) });
          }
      }
  }
  return { probes, drops, open, joins };
}
