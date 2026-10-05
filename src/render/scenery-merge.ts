// The road scene's still scenery, merged per block of the world (run W-S: the draw-call and
// triangle headroom). Palms, mangroves, shacks, poles, conifers, row houses, the sawmill and the
// islets used to draw as one instanced mesh per model variant per 256 m square: 21 to 41 draw calls
// a view on the hills, where a conifer cluster has four variants and a terrace four paints. Now every
// still prop standing in one SCENERY_BLOCK_M square (every road through it, both sides) is merged
// into ONE vertex-coloured mesh, as the roadside layer (roadside.ts) does it per stretch: built when
// the camera comes near, freed when it has gone.
//
// Far level of detail: each model variant also gets a far stand-in, a few stacked boxes in its own
// colours that keep its outline (a crown over a trunk, a tapering fir, a terrace's box), 20 to 30
// triangles against a palm's 420 to 492 or a house's 132 to 182. A block farther than `lodM` draws
// those; nearer, the real models. Both live in the block's one buffer, so switching is a draw range,
// not a rebuild.
//
// Atlas models (playtest 3, T12.1; atlas.ts): a block holding one carries UVs for all of it, the
// plain models on the atlas's white tile, and a far stand-in takes each picture's mean colour.
//
// Presentation only: what stands where is still scenery.ts's seeded scatter (the spots).
import {
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Group,
  Mesh,
  type BufferAttribute,
  type Material,
} from 'three';
import type { ScenerySpot } from './scenery';

/**
 * Each merged mesh holds the props standing in one square of the world this wide, m: every road
 * through it, both sides, so a hairpin's or a junction's roads share one. [default]
 */
export const SCENERY_BLOCK_M = 160;
/** Past this a block draws its far stand-ins, m (the `render.sceneryLodM` slider's default). [default] */
export const SCENERY_LOD_M = 200;
/** A block is built this far before it comes into range, one a frame. */
const PREFETCH_M = 80;
/** A built block farther than the draw distance plus this is freed, m. */
const KEEP_M = 160;
/** Room round a block's spots for the props themselves (a sawmill is 32 m long), m. */
const PROP_REACH_M = 18;

/** A geometry as flat triangles (position, normal, colour per corner), its far stand-in beside it. */
export interface FlatForm {
  pos: ArrayLike<number>;
  nrm: ArrayLike<number>;
  col: ArrayLike<number>;
  /** Vertices (three per triangle). */
  n: number;
  /**
   * Its atlas UVs (playtest 3, T12.1; atlas.ts), or absent: a merge that draws with the atlas puts
   * a form without them on the atlas's white tile.
   */
  uv?: ArrayLike<number> | null;
  /** The colours its far stand-in averages, when they differ from `col` (an atlas picture's mean). */
  fcol?: ArrayLike<number>;
}

const flatCache = new WeakMap<BufferGeometry, { near: FlatForm; far: FlatForm }>();

function attr(g: BufferGeometry, name: string): BufferAttribute | null {
  return (g.getAttribute(name) as BufferAttribute | undefined) ?? null;
}

/** The geometry as flat triangles: an indexed one is expanded, a missing colour is white. */
function flatten(g: BufferGeometry): FlatForm {
  const src = g.index ? g.toNonIndexed() : g;
  if (!attr(src, 'normal')) src.computeVertexNormals();
  const pos = attr(src, 'position')!.array;
  const nrm = attr(src, 'normal')!.array;
  const n = pos.length / 3;
  const col = attr(src, 'color')?.array ?? new Float32Array(n * 3).fill(1);
  const form: FlatForm = { pos, nrm, col, n };
  // Only an atlas model's UVs sample the atlas; a code-made box's own UVs would land anywhere on it.
  const uv = hasAtlasUv(g) ? attr(src, 'uv') : null;
  if (uv) form.uv = uv.array;
  const far = attr(src, 'farColor');
  if (far) form.fcol = far.array;
  return form;
}

/**
 * The region atlas's white tile's centre (atlas.ts): tile (0, 0) of a 1024 sheet of 128 px tiles
 * (tools/atlas: "Tile (0, 0) is the white tile, always"). A vertex that is not on an atlas surface
 * samples it, so it draws its own colour. It lives here, in the first load, so the merges need not
 * import the atlas chunk.
 */
export const ATLAS_WHITE_UV = [0.0625, 0.0625] as const;

/** Marks a geometry whose `uv` samples the region atlas (models.ts sets it on an atlas model's variants). */
export function markAtlasUv(g: BufferGeometry): void {
  g.userData['atlasUv'] = true;
}

/** Whether a geometry's `uv` samples the region atlas (never a code-made shape's own UVs). */
export function hasAtlasUv(g: BufferGeometry): boolean {
  return g.userData['atlasUv'] === true && !!g.getAttribute('uv');
}

/** Writes a form's UVs into a merged buffer from vertex `o` (the white tile where it has none). Returns the next vertex. */
export function writeUv(out: Float32Array, o: number, form: FlatForm): number {
  if (form.uv) {
    out.set(form.uv, o * 2);
    return o + form.n;
  }
  for (let v = 0; v < form.n; v++, o++) {
    out[o * 2] = ATLAS_WHITE_UV[0];
    out[o * 2 + 1] = ATLAS_WHITE_UV[1];
  }
  return o;
}

/**
 * A far stand-in: the model cut into horizontal bands (three, or two for a small one), each drawn
 * as a box as wide as that band of the model and coloured its average (area-weighted) colour. A
 * band narrower than the one under it makes the box below taper to it, and the top box of a model
 * that narrows upward ends at 40% of its width, so a fir tapers and a palm keeps a crown on a trunk.
 * Returns the model itself when the stand-in would not save at least 40% of its triangles.
 */
export function farStandIn(near: FlatForm): FlatForm {
  const tris = near.n / 3;
  const bands = tris >= 100 ? 3 : 2;
  const boxTris = 10;
  if (bands * boxTris > tris * 0.6) return near;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (let i = 0; i < near.n; i++) {
    const y = near.pos[i * 3 + 1] ?? 0;
    y0 = Math.min(y0, y);
    y1 = Math.max(y1, y);
  }
  const h = Math.max(1e-3, y1 - y0);
  // An atlas picture far away is its tile's mean (atlas.ts `farColor`), so the switch does not flash.
  const tone = near.fcol ?? near.col;
  interface Band {
    x0: number;
    x1: number;
    z0: number;
    z1: number;
    lo: number;
    hi: number;
    r: number;
    g: number;
    b: number;
    area: number;
  }
  const bs: Band[] = Array.from({ length: bands }, () => ({
    x0: Infinity,
    x1: -Infinity,
    z0: Infinity,
    z1: -Infinity,
    lo: Infinity,
    hi: -Infinity,
    r: 0,
    g: 0,
    b: 0,
    area: 0,
  }));
  for (let t = 0; t < tris; t++) {
    const v = (k: number, c: number) => near.pos[(t * 3 + k) * 3 + c] ?? 0;
    const cy = (v(0, 1) + v(1, 1) + v(2, 1)) / 3;
    const band = bs[Math.min(bands - 1, Math.floor(((cy - y0) / h) * bands))]!;
    const ux = v(1, 0) - v(0, 0);
    const uy = v(1, 1) - v(0, 1);
    const uz = v(1, 2) - v(0, 2);
    const wx = v(2, 0) - v(0, 0);
    const wy = v(2, 1) - v(0, 1);
    const wz = v(2, 2) - v(0, 2);
    const area = 0.5 * Math.hypot(uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx) + 1e-9;
    for (let k = 0; k < 3; k++) {
      band.x0 = Math.min(band.x0, v(k, 0));
      band.x1 = Math.max(band.x1, v(k, 0));
      band.z0 = Math.min(band.z0, v(k, 2));
      band.z1 = Math.max(band.z1, v(k, 2));
      band.lo = Math.min(band.lo, v(k, 1));
      band.hi = Math.max(band.hi, v(k, 1));
      const c = (t * 3 + k) * 3;
      band.r += ((tone[c] ?? 1) * area) / 3;
      band.g += ((tone[c + 1] ?? 1) * area) / 3;
      band.b += ((tone[c + 2] ?? 1) * area) / 3;
    }
    band.area += area;
  }
  const used = bs.filter((b) => b.area > 0);
  const pos: number[] = [];
  const nrm: number[] = [];
  const col: number[] = [];
  const colour = new Color();
  // Each box spans its own height, from the top of the one under it, so the stack has no gaps.
  let floor = y0;
  used.forEach((b, i) => {
    const next = used[i + 1];
    const top = next ? Math.max(floor + 1e-3, Math.min(b.hi, next.lo + (next.hi - next.lo) * 0.25)) : y1;
    const cx = (b.x0 + b.x1) / 2;
    const cz = (b.z0 + b.z1) / 2;
    const hx = (b.x1 - b.x0) / 2;
    const hz = (b.z1 - b.z0) / 2;
    // The box's top: the next band's width where that is narrower (a taper), else its own; the
    // last box ends at 40% where the model narrows toward its top (a fir's point, a roof).
    let tx = hx;
    let tz = hz;
    let tcx = cx;
    let tcz = cz;
    if (next && next.x1 - next.x0 < b.x1 - b.x0 && next.z1 - next.z0 < b.z1 - b.z0) {
      tx = (next.x1 - next.x0) / 2;
      tz = (next.z1 - next.z0) / 2;
      tcx = (next.x0 + next.x1) / 2;
      tcz = (next.z0 + next.z1) / 2;
    } else if (!next && i > 0) {
      const under = used[i - 1]!;
      if (b.x1 - b.x0 < under.x1 - under.x0 && b.z1 - b.z0 < under.z1 - under.z0) {
        tx = hx * 0.4;
        tz = hz * 0.4;
      }
    }
    colour.setRGB(b.r / b.area, b.g / b.area, b.b / b.area);
    const lo = floor;
    const bottom = [
      [cx - hx, lo, cz - hz],
      [cx + hx, lo, cz - hz],
      [cx + hx, lo, cz + hz],
      [cx - hx, lo, cz + hz],
    ] as const;
    const upper = [
      [tcx - tx, top, tcz - tz],
      [tcx + tx, top, tcz - tz],
      [tcx + tx, top, tcz + tz],
      [tcx - tx, top, tcz + tz],
    ] as const;
    const face = (a: readonly number[], b2: readonly number[], c: readonly number[]) => {
      const ux = (b2[0] ?? 0) - (a[0] ?? 0);
      const uy = (b2[1] ?? 0) - (a[1] ?? 0);
      const uz = (b2[2] ?? 0) - (a[2] ?? 0);
      const wx = (c[0] ?? 0) - (a[0] ?? 0);
      const wy = (c[1] ?? 0) - (a[1] ?? 0);
      const wz = (c[2] ?? 0) - (a[2] ?? 0);
      let nx = uy * wz - uz * wy;
      let ny = uz * wx - ux * wz;
      let nz = ux * wy - uy * wx;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len;
      ny /= len;
      nz /= len;
      for (const p of [a, b2, c]) {
        pos.push(p[0] ?? 0, p[1] ?? 0, p[2] ?? 0);
        nrm.push(nx, ny, nz);
        col.push(colour.r, colour.g, colour.b);
      }
    };
    // Four sides, counter-clockwise seen from outside, then the top.
    for (let k = 0; k < 4; k++) {
      const a = bottom[k]!;
      const b2 = bottom[(k + 1) % 4]!;
      const c = upper[(k + 1) % 4]!;
      const d = upper[k]!;
      face(a, d, c);
      face(a, c, b2);
    }
    face(upper[0], upper[3], upper[2]);
    face(upper[0], upper[2], upper[1]);
    floor = top;
  });
  return { pos, nrm, col, n: pos.length / 3 };
}

/** The flat near form and the far stand-in of a geometry, made once per geometry. */
export function formsOf(g: BufferGeometry): { near: FlatForm; far: FlatForm } {
  let f = flatCache.get(g);
  if (!f) {
    const near = flatten(g);
    f = { near, far: farStandIn(near) };
    flatCache.set(g, f);
  }
  return f;
}

interface Block {
  spots: ScenerySpot[];
  geos: BufferGeometry[];
  material: Material;
  cx: number;
  cz: number;
  radius: number;
  mesh: Mesh | null;
  /** Vertices of the near models; the far stand-ins follow them in the buffer. */
  nearN: number;
  farN: number;
  /** Triangles of the near models and of the far stand-ins (for the counts). */
  nearTris: number;
  farTris: number;
}

/** One still prop to merge: its spot, the geometry it draws with and the material it needs. */
export interface MergeItem {
  spot: ScenerySpot;
  geometry: BufferGeometry;
  material: Material;
}

export interface MergedSceneryCounts {
  blocks: number;
  built: number;
  /** Meshes, triangles and props the last update drew, and how many of those meshes drew far. */
  meshes: number;
  triangles: number;
  far: number;
}

/** The still scenery of a road scene, merged per block and drawn near the camera. */
export class MergedScenery {
  readonly group = new Group();
  private readonly blocks: Block[] = [];
  private shown = { meshes: 0, triangles: 0, far: 0 };

  /**
   * `items`: the still props. `doubleSided`: the material a block draws with when its props need
   * different ones (the palms' fronds draw both faces): a closed model looks the same either way,
   * so one block is one draw call whatever it holds. `blockM`: the blocks' size (a sparse layer, run
   * W-U's places, merges bigger squares for fewer draw calls).
   */
  constructor(items: readonly MergeItem[], doubleSided?: Material, blockM = SCENERY_BLOCK_M) {
    this.group.name = 'road-scenery-merged';
    const byKey = new Map<string, MergeItem[]>();
    for (const it of items) {
      const key = `${Math.floor(it.spot.p.x / blockM)},${Math.floor(it.spot.p.z / blockM)}`;
      const list = byKey.get(key);
      if (list) list.push(it);
      else byKey.set(key, [it]);
    }
    for (const list of byKey.values()) {
      const cx = list.reduce((a, it) => a + it.spot.p.x, 0) / list.length;
      const cz = list.reduce((a, it) => a + it.spot.p.z, 0) / list.length;
      // A prop longer than the usual room (a 41 m bridge bay) says how far it reaches from its origin.
      const radius = Math.max(
        ...list.map(
          (it) =>
            Math.hypot(it.spot.p.x - cx, it.spot.p.z - cz) + Math.max(PROP_REACH_M, it.spot.reachM ?? 0),
        ),
      );
      let nearN = 0;
      let farN = 0;
      for (const it of list) {
        const f = formsOf(it.geometry);
        nearN += f.near.n;
        farN += f.far.n;
      }
      const materials = new Set(list.map((it) => it.material));
      this.blocks.push({
        spots: list.map((it) => it.spot),
        geos: list.map((it) => it.geometry),
        material: materials.size > 1 && doubleSided ? doubleSided : list[0]!.material,
        cx,
        cz,
        radius,
        mesh: null,
        nearN,
        farN,
        nearTris: nearN / 3,
        farTris: farN / 3,
      });
    }
  }

  /** Triangles of every block at full detail (the scene's static count). */
  get triangles(): number {
    return this.blocks.reduce((n, s) => n + s.nearTris, 0);
  }

  get count(): number {
    return this.blocks.length;
  }

  /**
   * Builds, shows, switches and frees blocks by their distance from the camera. A block is
   * built a little before it comes into range, at most `builds` of them per call (the renderer:
   * one a frame, so no frame pays for many). Returns the props drawn.
   */
  update(cameraX: number, cameraZ: number, drawM: number, lodM = SCENERY_LOD_M, builds = 1): number {
    const wanted: { s: Block; dist: number }[] = [];
    for (const s of this.blocks) {
      const dist = Math.hypot(s.cx - cameraX, s.cz - cameraZ) - s.radius;
      if (!s.mesh && dist < drawM + PREFETCH_M) wanted.push({ s, dist });
    }
    if (wanted.length && builds > 0) {
      wanted.sort((a, b) => a.dist - b.dist);
      for (const w of wanted.slice(0, builds)) this.build(w.s);
    }
    let props = 0;
    const shown = { meshes: 0, triangles: 0, far: 0 };
    for (const s of this.blocks) {
      const mesh = s.mesh;
      if (!mesh) continue;
      const dist = Math.hypot(s.cx - cameraX, s.cz - cameraZ) - s.radius;
      if (dist < drawM) {
        const far = dist > lodM;
        mesh.geometry.setDrawRange(far ? s.nearN : 0, far ? s.farN : s.nearN);
        mesh.visible = true;
        props += s.spots.length;
        shown.meshes++;
        shown.triangles += far ? s.farTris : s.nearTris;
        if (far) shown.far++;
      } else {
        mesh.visible = false;
        if (dist > drawM + KEEP_M) this.free(s);
      }
    }
    this.shown = shown;
    return props;
  }

  counts(): MergedSceneryCounts {
    return {
      blocks: this.blocks.length,
      built: this.blocks.filter((s) => s.mesh).length,
      ...this.shown,
    };
  }

  dispose(): void {
    for (const s of this.blocks) this.free(s);
    this.group.removeFromParent();
  }

  private free(s: Block): void {
    if (!s.mesh) return;
    s.mesh.geometry.dispose();
    s.mesh.removeFromParent();
    s.mesh = null;
  }

  private build(s: Block): void {
    const total = s.nearN + s.farN;
    const pos = new Float32Array(total * 3);
    const nrm = new Float32Array(total * 3);
    const col = new Float32Array(total * 3);
    // A block holding an atlas model carries UVs for all of it (the others on the white tile).
    const uv = s.geos.some(hasAtlasUv) ? new Float32Array(total * 2) : null;
    let o = 0;
    for (const pass of ['near', 'far'] as const) {
      s.spots.forEach((spot, i) => {
        const f = formsOf(s.geos[i]!)[pass];
        if (uv) writeUv(uv, o, f);
        // Turned about the vertical and scaled: x' = x cos + z sin, z' = z cos - x sin.
        const cos = Math.cos(spot.turn);
        const sin = Math.sin(spot.turn);
        const k = spot.size;
        // A bridge bay's slope shears it up along its +Z (y' = y + slope z): horizontal lengths and
        // upright piers are kept, and the deck rises with the road.
        const slope = spot.slope ?? 0;
        for (let v = 0; v < f.n; v++, o++) {
          const x = f.pos[v * 3] ?? 0;
          const z = f.pos[v * 3 + 2] ?? 0;
          pos[o * 3] = spot.p.x + k * (x * cos + z * sin);
          pos[o * 3 + 1] = spot.p.y + k * ((f.pos[v * 3 + 1] ?? 0) + slope * z);
          pos[o * 3 + 2] = spot.p.z + k * (z * cos - x * sin);
          const nx = f.nrm[v * 3] ?? 0;
          const ny = f.nrm[v * 3 + 1] ?? 0;
          const nz = f.nrm[v * 3 + 2] ?? 0;
          // A shear moves a normal by the inverse transpose: n' = (nx, ny, nz - slope ny), renormalised.
          const sz = slope === 0 ? nz : nz - slope * ny;
          const norm = slope === 0 ? 1 : Math.hypot(nx, ny, sz) || 1;
          nrm[o * 3] = (nx * cos + sz * sin) / norm;
          nrm[o * 3 + 1] = ny / norm;
          nrm[o * 3 + 2] = (sz * cos - nx * sin) / norm;
          col[o * 3] = f.col[v * 3] ?? 1;
          col[o * 3 + 1] = f.col[v * 3 + 1] ?? 1;
          col[o * 3 + 2] = f.col[v * 3 + 2] ?? 1;
        }
      });
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new Float32BufferAttribute(nrm, 3));
    geo.setAttribute('color', new Float32BufferAttribute(col, 3));
    if (uv) geo.setAttribute('uv', new Float32BufferAttribute(uv, 2));
    geo.computeBoundingSphere();
    const mesh = new Mesh(geo, s.material);
    mesh.name = 'road-scenery';
    mesh.matrixAutoUpdate = false;
    mesh.visible = false;
    this.group.add(mesh);
    s.mesh = mesh;
  }
}
