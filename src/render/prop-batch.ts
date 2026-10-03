// One draw call for many small props (run W-T's draw-call headroom: the busiest live scenes, a Keys
// roadwork beside a speed trap, reached 109 of the 120 draw calls the perf check allows). The road
// events' props and the roadside smashables were one instanced mesh per shape, so a scene with
// cones, a barricade, an arrow board, two radar guns, a flagger and a cop cost a draw call per
// shape. A batch takes every item of a frame (a shape's vertex-coloured geometry and where it
// stands), writes them all into one buffer in world space, and draws them as ONE mesh on the same
// shared material. It rewrites the buffer only when the items changed (props standing still cost
// nothing per frame), and it culls as one: its bounds are the items' own.
// Presentation only.
import {
  Box3,
  BufferAttribute,
  BufferGeometry,
  DynamicDrawUsage,
  Matrix3,
  type InstancedMesh,
  Mesh,
  Sphere,
  Vector3,
  type Material,
  type Matrix4,
} from 'three';

const FIELDS = 17;

/**
 * Culls an instanced mesh whose instances move by their own bounds, recomputed now: a mesh whose
 * every instance is out of view (behind the camera, say) is not drawn, and nothing in view is cut.
 * For instances set every frame, where the geometry's own bounds would cull them wrongly.
 */
export function cullByInstances(mesh: InstancedMesh): void {
  if (mesh.count === 0) return;
  mesh.computeBoundingSphere();
  mesh.frustumCulled = true;
}

interface Source {
  geometries: BufferGeometry[];
  matrices: number[];
}

export class PropBatch {
  readonly mesh: Mesh;
  /** Each owner's items this frame (the event props and the smashables share one batch). */
  private readonly sources = new Map<string, Source>();
  private current: Source | null = null;
  private readonly geometries: BufferGeometry[] = [];
  private readonly matrices: number[] = [];
  /** The last written frame's items: geometry id, then the 16 matrix elements, per item. */
  private readonly written: number[] = [];
  private vertexCap = 0;
  private indexCap = 0;
  private rebuilds = 0;
  private readonly normalMatrix = new Matrix3();
  private readonly v = new Vector3();
  private readonly box = new Box3();
  /** One item's matrix while it is written (double precision: world positions are kilometres out). */
  private readonly e = new Float64Array(16);

  constructor(material: Material, name: string) {
    this.mesh = new Mesh(new BufferGeometry(), material);
    this.mesh.name = name;
    this.mesh.visible = false;
  }

  /** Starts an owner's list of items for this frame; the other owners' lists stand as they were. */
  begin(source = ''): void {
    let s = this.sources.get(source);
    if (!s) {
      s = { geometries: [], matrices: [] };
      this.sources.set(source, s);
    }
    s.geometries.length = 0;
    s.matrices.length = 0;
    this.current = s;
  }

  /** One item: an indexed geometry with `position`, `normal` and `color`, placed by `matrix`. */
  add(geometry: BufferGeometry, matrix: Matrix4): void {
    const s = this.current;
    if (!s) throw new Error('PropBatch: add() before begin()');
    s.geometries.push(geometry);
    s.matrices.push(geometry.id);
    for (const v of matrix.elements) s.matrices.push(v);
  }

  /** Ends an owner's list: rewrites the buffer if the items differ from the last written ones. */
  end(): void {
    this.current = null;
    // Reused lists: no allocation per frame.
    this.geometries.length = 0;
    this.matrices.length = 0;
    for (const s of this.sources.values()) {
      for (const g of s.geometries) this.geometries.push(g);
      for (const v of s.matrices) this.matrices.push(v);
    }
    const n = this.geometries.length;
    this.mesh.visible = n > 0;
    if (n === 0) {
      this.written.length = 0;
      return;
    }
    if (this.same()) return;
    this.write();
    this.written.length = 0;
    for (const v of this.matrices) this.written.push(v);
  }

  /** Items in the last frame, every owner's. */
  get count(): number {
    return this.geometries.length;
  }

  /** How many times the buffer was rewritten (tests: still props cost nothing per frame). */
  get writes(): number {
    return this.rebuilds;
  }

  /** Item `i` of the last frame: its geometry and where it stands (tests and the debug overlay). */
  item(i: number, into: Matrix4): BufferGeometry | null {
    const g = this.geometries[i];
    if (!g) return null;
    into.fromArray(this.matrices, i * FIELDS + 1);
    return g;
  }

  private same(): boolean {
    const a = this.matrices;
    const b = this.written;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  private write(): void {
    let vertices = 0;
    let indices = 0;
    for (const g of this.geometries) {
      vertices += g.getAttribute('position').count;
      indices += g.index?.count ?? 0;
    }
    if (vertices > this.vertexCap || indices > this.indexCap) this.grow(vertices, indices);
    const geo = this.mesh.geometry;
    const pos = geo.getAttribute('position') as BufferAttribute;
    const nrm = geo.getAttribute('normal') as BufferAttribute;
    const col = geo.getAttribute('color') as BufferAttribute;
    const idx = geo.index as BufferAttribute;
    const P = pos.array as Float32Array;
    const N = nrm.array as Float32Array;
    const C = col.array as Float32Array;
    const I = idx.array as Uint32Array;
    const box = this.box.makeEmpty();
    const e = this.e;
    let vo = 0;
    let io = 0;
    this.geometries.forEach((g, k) => {
      for (let j = 0; j < 16; j++) e[j] = this.matrices[k * FIELDS + 1 + j] ?? 0;
      this.normalMatrix
        .set(e[0]!, e[4]!, e[8]!, e[1]!, e[5]!, e[9]!, e[2]!, e[6]!, e[10]!)
        .invert()
        .transpose();
      const n = this.normalMatrix.elements;
      const gp = g.getAttribute('position');
      const gn = g.getAttribute('normal');
      const gc = g.getAttribute('color');
      for (let i = 0; i < gp.count; i++) {
        const x = gp.getX(i);
        const y = gp.getY(i);
        const z = gp.getZ(i);
        const o = (vo + i) * 3;
        P[o] = e[0]! * x + e[4]! * y + e[8]! * z + e[12]!;
        P[o + 1] = e[1]! * x + e[5]! * y + e[9]! * z + e[13]!;
        P[o + 2] = e[2]! * x + e[6]! * y + e[10]! * z + e[14]!;
        box.expandByPoint(this.v.set(P[o], P[o + 1]!, P[o + 2]));
        const nx = gn.getX(i);
        const ny = gn.getY(i);
        const nz = gn.getZ(i);
        const tx = n[0] * nx + n[3] * ny + n[6] * nz;
        const ty = n[1] * nx + n[4] * ny + n[7] * nz;
        const tz = n[2] * nx + n[5] * ny + n[8] * nz;
        const len = Math.hypot(tx, ty, tz) || 1;
        N[o] = tx / len;
        N[o + 1] = ty / len;
        N[o + 2] = tz / len;
        C[o] = gc ? gc.getX(i) : 1;
        C[o + 1] = gc ? gc.getY(i) : 1;
        C[o + 2] = gc ? gc.getZ(i) : 1;
      }
      const gi = g.index;
      if (gi) for (let i = 0; i < gi.count; i++) I[io + i] = vo + gi.getX(i);
      vo += gp.count;
      io += gi?.count ?? 0;
    });
    for (const a of [pos, nrm, col]) {
      a.clearUpdateRanges();
      a.addUpdateRange(0, vo * 3);
      a.needsUpdate = true;
    }
    idx.clearUpdateRanges();
    idx.addUpdateRange(0, io);
    idx.needsUpdate = true;
    geo.setDrawRange(0, io);
    geo.boundingBox = box.clone();
    geo.boundingSphere = box.getBoundingSphere(new Sphere());
    this.rebuilds++;
  }

  /** A bigger buffer (doubling), as a new geometry: the old one's GPU buffers are freed. */
  private grow(vertices: number, indices: number): void {
    this.vertexCap = Math.max(256, vertices, this.vertexCap * 2);
    this.indexCap = Math.max(384, indices, this.indexCap * 2);
    const geo = new BufferGeometry();
    const attr = (size: number) => {
      const a = new BufferAttribute(new Float32Array(this.vertexCap * size), size);
      a.setUsage(DynamicDrawUsage);
      return a;
    };
    geo.setAttribute('position', attr(3));
    geo.setAttribute('normal', attr(3));
    geo.setAttribute('color', attr(3));
    const index = new BufferAttribute(new Uint32Array(this.indexCap), 1);
    index.setUsage(DynamicDrawUsage);
    geo.setIndex(index);
    this.mesh.geometry.dispose();
    this.mesh.geometry = geo;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
  }
}
