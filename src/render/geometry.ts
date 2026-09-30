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
}

/** Merges boxes into one indexed geometry with a per-vertex `color` attribute. */
export function mergeBoxes(parts: readonly BoxPart[]): BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const c = new Color();
  for (const part of parts) {
    const g = new BoxGeometry(part.size[0], part.size[1], part.size[2]);
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
  readonly chunks = new Map<string, StripAccumulator>();
  private last: [Point3, Point3] | null = null;
  private key = '';

  constructor(private readonly keyOf: (x: number, z: number) => string) {}

  private acc(key: string): StripAccumulator {
    let a = this.chunks.get(key);
    if (!a) this.chunks.set(key, (a = new StripAccumulator()));
    return a;
  }

  pair(a: Point3, b: Point3): void {
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

  breakStrip(): void {
    if (this.last) this.acc(this.key).breakStrip();
    this.last = null;
  }

  /** A single quad, in the chunk of its centre. */
  quad(a0: Point3, b0: Point3, a1: Point3, b1: Point3): void {
    this.breakStrip();
    const key = this.keyOf((a0.x + b0.x + a1.x + b1.x) / 4, (a0.z + b0.z + a1.z + b1.z) / 4);
    this.acc(key).quad(a0, b0, a1, b1);
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
