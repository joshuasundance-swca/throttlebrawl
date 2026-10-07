// Small geometry builders for primitive views: boxes merged into one vertex-coloured geometry (so a
// whole rider body is one draw call), and an accumulator for merged strips (so the whole road is a
// handful of draw calls, however many edges the network has).
import { BoxGeometry, BufferGeometry, Color, Float32BufferAttribute } from 'three';

export interface BoxPart {
  /** Width (x), height (y), depth (z), metres. */
  size: readonly [number, number, number];
  /** Centre, metres. Models face -z. */
  at: readonly [number, number, number];
  color: string;
  /** Rotation about x, radians, applied before the move. */
  rotX?: number;
  /** Rotation about y, radians, applied before the move. */
  rotY?: number;
  /**
   * Faces left out, in the box's own axes before it turns: ones nobody can see (a post's foot on
   * the ground, a rail's ends butted against the next panel's), or too thin to show far off.
   */
  omit?: readonly BoxFace[];
  /**
   * The solid this part is, when it is one (the physical world, road/structures: a wall, a deck, a roof a
   * rider can meet): its name in the structure plan. Never drawn differently; scripts/hitboxes.test.ts holds
   * the parts of one name to the plan's box for it.
   */
  solid?: string;
}

/** A box's faces, in three's BoxGeometry order (+x, -x, +y, -y, +z, -z). */
export type BoxFace = 'px' | 'nx' | 'py' | 'ny' | 'pz' | 'nz';
const BOX_FACES: readonly BoxFace[] = ['px', 'nx', 'py', 'ny', 'pz', 'nz'];

/** A box with some faces left out (none: the whole box), indexed, its normals per face. */
export function openBox(w: number, h: number, d: number, omit: readonly BoxFace[] = []): BufferGeometry {
  const g = new BoxGeometry(w, h, d);
  if (!omit.length) return g;
  const index = g.getIndex();
  if (!index) return g;
  const keep: number[] = [];
  for (const grp of g.groups) {
    if (omit.includes(BOX_FACES[grp.materialIndex ?? 0]!)) continue;
    for (let i = grp.start; i < grp.start + grp.count; i++) keep.push(index.getX(i));
  }
  g.setIndex(keep);
  g.clearGroups();
  return g;
}

/** Merges boxes into one indexed geometry with a per-vertex `color` attribute. */
export function mergeBoxes(parts: readonly BoxPart[]): BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const c = new Color();
  for (const part of parts) {
    const g = openBox(part.size[0], part.size[1], part.size[2], part.omit);
    if (part.rotX) g.rotateX(part.rotX);
    if (part.rotY) g.rotateY(part.rotY);
    g.translate(part.at[0], part.at[1], part.at[2]);
    const base = positions.length / 3;
    const pos = g.getAttribute('position');
    const nrm = g.getAttribute('normal');
    c.setStyle(part.color);
    for (let i = 0; i < pos.count; i++) {
      positions.push(pos.getX(i), pos.getY(i), pos.getZ(i));
      normals.push(nrm.getX(i), nrm.getY(i), nrm.getZ(i));
      colors.push(c.r, c.g, c.b);
    }
    const index = g.getIndex();
    if (index) for (let i = 0; i < index.count; i++) indices.push(base + index.getX(i));
    g.dispose();
  }
  const out = new BufferGeometry();
  out.setAttribute('position', new Float32BufferAttribute(positions, 3));
  out.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  out.setAttribute('color', new Float32BufferAttribute(colors, 3));
  out.setIndex(indices);
  out.computeBoundingSphere();
  return out;
}

export interface Point3 {
  x: number;
  y: number;
  z: number;
}

/** Metres from p to the segment a-b, in 3D. */
function toSegment(p: Point3, a: Point3, b: Point3): number {
  const ux = b.x - a.x;
  const uy = b.y - a.y;
  const uz = b.z - a.z;
  const len2 = ux * ux + uy * uy + uz * uz;
  const t =
    len2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * ux + (p.y - a.y) * uy + (p.z - a.z) * uz) / len2)) : 0;
  return Math.hypot(p.x - (a.x + ux * t), p.y - (a.y + uy * t), p.z - (a.z + uz * t));
}

/**
 * Playtest 4 run B (mustFix 1: two real routes drew frames over the triangle budget): which samples of a
 * strip (each a row of points across it: a pair, or every edge of a road's surfaces) to keep so that it
 * draws the same surface with fewer triangles. A sample is dropped when each of its points, and those of
 * every sample dropped since the last one kept, lies within `tolM` of the straight line between the same
 * points of the kept samples around it, and `same(i, j)` says sample j is built as sample i is (its
 * colour, which surfaces it has). So a straight, even stretch is one long quad, and a bend, a crest, a
 * change of width or of colour keeps every sample it needs. The first and last samples are always kept,
 * and no kept span is longer than `maxSpanM` (along the first points). [default] numbers are the callers'.
 */
export function keptSamples(
  rows: readonly (readonly Point3[])[],
  tolM: number,
  maxSpanM: number,
  same: (i: number, j: number) => boolean = () => true,
): number[] {
  const n = rows.length;
  if (n <= 2) return rows.map((_, i) => i);
  const kept = [0];
  let i = 0;
  while (i < n - 1) {
    let j = i + 1;
    // Reach as far as the straight strip from sample i still passes within tolM of every sample skipped.
    while (j + 1 < n) {
      const k = j + 1;
      const ri = rows[i]!;
      const rk = rows[k]!;
      if (!same(i, k) || ri.length !== rk.length || !ri[0] || !rk[0]) break;
      if (Math.hypot(rk[0].x - ri[0].x, rk[0].z - ri[0].z) > maxSpanM) break;
      let fits = true;
      for (let m = i + 1; m < k && fits; m++) {
        const rm = rows[m]!;
        fits = same(i, m) && rm.length === ri.length;
        for (let p = 0; p < rm.length && fits; p++) fits = toSegment(rm[p]!, ri[p]!, rk[p]!) <= tolM;
      }
      if (!fits) break;
      j = k;
    }
    kept.push(j);
    i = j;
  }
  return kept;
}

/**
 * Accumulates triangle strips into one geometry. A strip is a run of point pairs; `pair(a, b)`
 * adds the next pair and `breakStrip()` ends the run, so a strip can pause where a span ends.
 */
export class StripAccumulator {
  private readonly positions: number[] = [];
  private readonly indices: number[] = [];
  private open = false;

  pair(a: Point3, b: Point3): void {
    const k = this.positions.length / 3;
    this.positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
    if (this.open) this.indices.push(k - 2, k - 1, k, k - 1, k + 1, k);
    this.open = true;
  }

  breakStrip(): void {
    this.open = false;
  }

  /** A single quad, as its own strip. */
  quad(a0: Point3, b0: Point3, a1: Point3, b1: Point3): void {
    this.breakStrip();
    this.pair(a0, b0);
    this.pair(a1, b1);
    this.breakStrip();
  }

  /** A single triangle (counter-clockwise seen from its front), as its own strip. */
  tri(a: Point3, b: Point3, c: Point3): void {
    this.breakStrip();
    const k = this.positions.length / 3;
    this.positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    this.indices.push(k, k + 1, k + 2);
  }

  get triangleCount(): number {
    return this.indices.length / 3;
  }

  get isEmpty(): boolean {
    return this.indices.length === 0;
  }

  build(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(this.positions, 3));
    g.setIndex(this.indices);
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
}

/**
 * Strips split into square world chunks (M2: per-chunk road meshes, so the renderer can cull what
 * the camera cannot see). Same interface as StripAccumulator. Each quad of a strip belongs to the
 * chunk of its far pair: where a strip crosses into a new chunk, that chunk's strip starts from the
 * last pair, so the surface stays continuous and no quad is drawn twice.
 */
export class ChunkedStrips {
  private readonly parts = new Map<string, StripAccumulator>();
  private last: [Point3, Point3] | null = null;
  private key = '';
  /** With `simplify`: the open strip's pairs, held until it breaks, then drawn with keptSamples. */
  private readonly held: [Point3, Point3][] = [];

  /**
   * `simplify` (playtest 4 run B, mustFix 1): draw each strip with only the pairs its shape needs
   * (keptSamples). Only for a layer drawn over another surface and sharing no edge with one (a painted
   * line, a cable slot): a strip that meets another vertex for vertex would open a seam.
   */
  constructor(
    private readonly keyOf: (x: number, z: number) => string,
    private readonly simplify?: { tolM: number; maxSpanM: number },
  ) {}

  pair(a: Point3, b: Point3): void {
    if (this.simplify) this.held.push([a, b]);
    else this.put(a, b);
  }

  breakStrip(): void {
    if (this.held.length > 0) {
      const pairs = this.held.splice(0);
      for (const k of keptSamples(pairs, this.simplify!.tolM, this.simplify!.maxSpanM))
        this.put(pairs[k]![0], pairs[k]![1]);
    }
    if (this.last) this.acc(this.key).breakStrip();
    this.last = null;
  }

  /** Each chunk's strips (an open simplified strip is drawn first). */
  get chunks(): ReadonlyMap<string, StripAccumulator> {
    if (this.held.length > 0) this.breakStrip();
    return this.parts;
  }

  private acc(key: string): StripAccumulator {
    let a = this.parts.get(key);
    if (!a) this.parts.set(key, (a = new StripAccumulator()));
    return a;
  }

  private put(a: Point3, b: Point3): void {
    const key = this.keyOf((a.x + b.x) / 2, (a.z + b.z) / 2);
    if (!this.last) {
      const acc = this.acc(key);
      acc.breakStrip();
      acc.pair(a, b);
    } else if (key !== this.key) {
      this.acc(this.key).breakStrip();
      const acc = this.acc(key);
      acc.breakStrip();
      acc.pair(this.last[0], this.last[1]);
      acc.pair(a, b);
    } else {
      this.acc(key).pair(a, b);
    }
    this.key = key;
    this.last = [a, b];
  }

  /** A single quad, in the chunk of its centre. */
  quad(a0: Point3, b0: Point3, a1: Point3, b1: Point3): void {
    this.breakStrip();
    const key = this.keyOf((a0.x + b0.x + a1.x + b1.x) / 4, (a0.z + b0.z + a1.z + b1.z) / 4);
    this.acc(key).quad(a0, b0, a1, b1);
  }

  /** A single triangle, in the chunk of its centre. */
  tri(a: Point3, b: Point3, c: Point3): void {
    this.breakStrip();
    this.acc(this.keyOf((a.x + b.x + c.x) / 3, (a.z + b.z + c.z) / 3)).tri(a, b, c);
  }

  get triangleCount(): number {
    let n = 0;
    for (const a of this.chunks.values()) n += a.triangleCount;
    return n;
  }

  get isEmpty(): boolean {
    for (const a of this.chunks.values()) if (!a.isEmpty) return false;
    return true;
  }
}
