// A triangle soup for the backdrop: every far piece goes into one non-indexed geometry, so the whole
// horizon is one draw call. Positions are TRUE world positions (metres in the network frame); the
// backdrop's vertex shader (material.ts) pulls each vertex in along its own line of sight, so the
// picture is exact while the depth stays inside the camera's far plane.
import { Color } from 'three';

export type V3 = readonly [number, number, number];
export type Rgb = readonly [number, number, number];

/** Toward the sun, as the classic look lights the world (look.ts): low from the left-front. */
const SUN = (() => {
  const v = [-0.6, 1, 0.4];
  const n = Math.hypot(v[0]!, v[1]!, v[2]!);
  return [v[0]! / n, v[1]! / n, v[2]! / n] as const;
})();
/** The sun's horizontal direction, normalised. */
export const SUN_H = (() => {
  const n = Math.hypot(SUN[0], SUN[2]);
  return [SUN[0] / n, SUN[2] / n] as const;
})();

/** A display-sRGB hex colour as linear RGB (the working space the shader mixes in). */
export function rgb(hex: string): Rgb {
  const c = new Color(hex);
  return [c.r, c.g, c.b];
}

export const scale = (c: Rgb, k: number): Rgb => [c[0] * k, c[1] * k, c[2] * k];
export const mixRgb = (a: Rgb, b: Rgb, t: number): Rgb => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

/** Per-vertex extra haze by height: `amount` at `y0`, fading to none `fadeM` above it. */
export interface Gradient {
  y0: number;
  fadeM: number;
  amount: number;
}

export class Soup {
  readonly pos: number[] = [];
  readonly col: number[] = [];
  /** Per vertex: extra haze, floor flag, depth bias (m toward the eye, past the fog), follows-the-camera flag. */
  readonly info: number[] = [];
  /**
   * Per vertex: drift amplitude x and z (m), then a swing's angular speed (rad/s) and phase (rad),
   * or for a one-way glide (W-T) minus its rounds per second and its phase in rounds (glide()).
   */
  readonly motion: number[] = [];
  /** Per vertex: the rise (m) that goes with the drift (a pour falls, a seaplane comes down). */
  readonly lift: number[] = [];
  /**
   * Per vertex: the piece's `nearFadeM` (m; 0 for none): the vertex is never drawn nearer than the near
   * fog's end and comes out of the haze over this many metres past it (playtest 4, G1).
   */
  readonly fade: number[] = [];

  /** The current piece's near fade, m (set by the builder around each piece; begin() leaves it). */
  nearFade = 0;

  // The current piece's state, set before its triangles.
  haze = 0;
  floor = 0;
  bias = 0;
  follow = 0;
  drift: [number, number, number, number] = [0, 0, 0, 0];
  rise = 0;
  gradient: Gradient | null = null;
  /** Normals are turned to face away from this point (a solid's middle); null: no light shading. */
  inside: V3 | null = null;

  get triangles(): number {
    return this.pos.length / 9;
  }

  /** Resets the per-piece state. */
  begin(haze = 0): void {
    this.haze = haze;
    this.floor = 0;
    this.bias = 0;
    this.follow = 0;
    this.drift = [0, 0, 0, 0];
    this.rise = 0;
    this.gradient = null;
    this.inside = null;
  }

  private hazeAt(y: number): number {
    const g = this.gradient;
    const t = g ? g.amount * (1 - Math.min(1, Math.max(0, (y - g.y0) / g.fadeM))) : 0;
    return 1 - (1 - this.haze) * (1 - t);
  }

  /** One triangle; with `inside` set it is shaded by the sun on its outward face. */
  tri(a: V3, b: V3, c: V3, colour: Rgb, shade = 1): void {
    let k = shade;
    if (this.inside) {
      const ux = b[0] - a[0];
      const uy = b[1] - a[1];
      const uz = b[2] - a[2];
      const vx = c[0] - a[0];
      const vy = c[1] - a[1];
      const vz = c[2] - a[2];
      let nx = uy * vz - uz * vy;
      let ny = uz * vx - ux * vz;
      let nz = ux * vy - uy * vx;
      const n = Math.hypot(nx, ny, nz) || 1;
      nx /= n;
      ny /= n;
      nz /= n;
      const mx = (a[0] + b[0] + c[0]) / 3 - this.inside[0];
      const my = (a[1] + b[1] + c[1]) / 3 - this.inside[1];
      const mz = (a[2] + b[2] + c[2]) / 3 - this.inside[2];
      if (nx * mx + ny * my + nz * mz < 0) {
        nx = -nx;
        ny = -ny;
        nz = -nz;
      }
      k *= 0.68 + 0.42 * Math.max(0, nx * SUN[0] + ny * SUN[1] + nz * SUN[2]);
    }
    for (const p of [a, b, c]) {
      this.pos.push(p[0], p[1], p[2]);
      this.col.push(colour[0] * k, colour[1] * k, colour[2] * k);
      this.info.push(this.hazeAt(p[1]), this.floor, this.bias, this.follow);
      this.motion.push(...this.drift);
      this.lift.push(this.rise);
      this.fade.push(this.nearFade);
    }
  }

  /**
   * Sets a one-way glide for what follows (W-T): from `-(dx, rise, dz)` to `+(dx, rise, dz)` about
   * where it is built, once every `periodS`, starting `phase` (0..1) of the way through, thinning
   * into the haze at each end (the backdrop's vertex shader; `motionAt` mirrors it).
   */
  glide(dx: number, dz: number, rise: number, periodS: number, phase: number): void {
    this.drift = [dx, dz, -1 / Math.max(1, periodS), phase - Math.floor(phase)];
    this.rise = rise;
  }

  /** A convex polygon as a fan. */
  poly(pts: readonly V3[], colour: Rgb, shade = 1): void {
    for (let i = 1; i + 1 < pts.length; i++) this.tri(pts[0]!, pts[i]!, pts[i + 1]!, colour, shade);
  }

  /**
   * A rectangular frustum standing on (cx, y0, cz): its long axis along the horizontal unit (ux, uz),
   * half-sizes a (along) and b (across) at the foot and a1, b1 at the top, `h` tall. Four sides and
   * a top, shaded by the sun.
   */
  frustum(
    cx: number,
    y0: number,
    cz: number,
    ux: number,
    uz: number,
    a: number,
    b: number,
    h: number,
    colour: Rgb,
    a1 = a,
    b1 = b,
    top = true,
  ): void {
    const vx = -uz;
    const vz = ux;
    const corner = (s: number, t: number, y: number, ka: number, kb: number): V3 => [
      cx + ux * s * ka + vx * t * kb,
      y,
      cz + uz * s * ka + vz * t * kb,
    ];
    const lo = [
      corner(1, 1, y0, a, b),
      corner(-1, 1, y0, a, b),
      corner(-1, -1, y0, a, b),
      corner(1, -1, y0, a, b),
    ];
    const hi = [
      corner(1, 1, y0 + h, a1, b1),
      corner(-1, 1, y0 + h, a1, b1),
      corner(-1, -1, y0 + h, a1, b1),
      corner(1, -1, y0 + h, a1, b1),
    ];
    const saved = this.inside;
    this.inside = [cx, y0 + h / 2, cz];
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      this.poly([lo[i]!, lo[j]!, hi[j]!, hi[i]!], colour);
    }
    if (top) this.poly(hi, colour);
    this.inside = saved;
  }

  /** A round prism (n sides) standing on (cx, y0, cz), radius r0 at the foot and r1 at the top. */
  prism(
    cx: number,
    y0: number,
    cz: number,
    n: number,
    r0: number,
    r1: number,
    h: number,
    colour: Rgb,
    top = true,
  ): void {
    const saved = this.inside;
    this.inside = [cx, y0 + h / 2, cz];
    const at = (i: number, r: number, y: number): V3 => [
      cx + Math.cos((i / n) * Math.PI * 2) * r,
      y,
      cz + Math.sin((i / n) * Math.PI * 2) * r,
    ];
    for (let i = 0; i < n; i++) {
      this.poly([at(i, r0, y0), at(i + 1, r0, y0), at(i + 1, r1, y0 + h), at(i, r1, y0 + h)], colour);
      if (top) this.tri([cx, y0 + h, cz], at(i + 1, r1, y0 + h), at(i, r1, y0 + h), colour);
    }
    this.inside = saved;
  }

  /** A square beam between two points, `w` wide. */
  beam(p: V3, q: V3, w: number, colour: Rgb): void {
    const dx = q[0] - p[0];
    const dy = q[1] - p[1];
    const dz = q[2] - p[2];
    const len = Math.hypot(dx, dy, dz) || 1;
    const d = [dx / len, dy / len, dz / len];
    // Any vector not along the beam, then two perpendiculars.
    const ref = Math.abs(d[1]!) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    let ex = d[1]! * ref[2]! - d[2]! * ref[1]!;
    let ey = d[2]! * ref[0]! - d[0]! * ref[2]!;
    let ez = d[0]! * ref[1]! - d[1]! * ref[0]!;
    const en = Math.hypot(ex, ey, ez) || 1;
    ex /= en;
    ey /= en;
    ez /= en;
    const fx = d[1]! * ez - d[2]! * ey;
    const fy = d[2]! * ex - d[0]! * ez;
    const fz = d[0]! * ey - d[1]! * ex;
    const h = w / 2;
    const off = [
      [ex + fx, ey + fy, ez + fz],
      [-ex + fx, -ey + fy, -ez + fz],
      [-ex - fx, -ey - fy, -ez - fz],
      [ex - fx, ey - fy, ez - fz],
    ];
    const saved = this.inside;
    this.inside = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2];
    for (let i = 0; i < 4; i++) {
      const a = off[i]!;
      const b = off[(i + 1) % 4]!;
      this.poly(
        [
          [p[0] + a[0]! * h, p[1] + a[1]! * h, p[2] + a[2]! * h],
          [p[0] + b[0]! * h, p[1] + b[1]! * h, p[2] + b[2]! * h],
          [q[0] + b[0]! * h, q[1] + b[1]! * h, q[2] + b[2]! * h],
          [q[0] + a[0]! * h, q[1] + a[1]! * h, q[2] + a[2]! * h],
        ],
        colour,
      );
    }
    this.inside = saved;
  }

  /**
   * A low-poly blob (an icosahedron) centred at c with radii rx, ry, rz: a cloud puff. Colours run
   * from `under` at the blob's foot to `over` at its top, lit by the sun.
   */
  blob(
    c: V3,
    rx: number,
    ry: number,
    rz: number,
    over: Rgb,
    under: Rgb,
    yLo: number,
    yHi: number,
    spin = 0,
  ): void {
    const saved = this.inside;
    this.inside = c;
    // Turned about the vertical by `spin` turns, so neighbouring puffs show different facets.
    const cs = Math.cos(spin * Math.PI * 2);
    const sn = Math.sin(spin * Math.PI * 2);
    for (const f of ICO_FACES) {
      const p = f.map((i) => {
        const v = ICO[i]!;
        const vx = v[0] * cs - v[2] * sn;
        const vz = v[0] * sn + v[2] * cs;
        return [c[0] + vx * rx, c[1] + v[1] * ry, c[2] + vz * rz] as V3;
      });
      const cy = (p[0]![1] + p[1]![1] + p[2]![1]) / 3;
      const t = Math.min(1, Math.max(0, (cy - yLo) / Math.max(1, yHi - yLo)));
      this.tri(p[0]!, p[1]!, p[2]!, mixRgb(under, over, t));
    }
    this.inside = saved;
  }
}

const G = (1 + Math.sqrt(5)) / 2;
const ICO: readonly V3[] = (
  [
    [-1, G, 0],
    [1, G, 0],
    [-1, -G, 0],
    [1, -G, 0],
    [0, -1, G],
    [0, 1, G],
    [0, -1, -G],
    [0, 1, -G],
    [G, 0, -1],
    [G, 0, 1],
    [-G, 0, -1],
    [-G, 0, 1],
  ] as const
).map((v) => {
  const n = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / n, v[1] / n, v[2] / n] as V3;
});
const ICO_FACES: readonly (readonly [number, number, number])[] = [
  [0, 11, 5],
  [0, 5, 1],
  [0, 1, 7],
  [0, 7, 10],
  [0, 10, 11],
  [1, 5, 9],
  [5, 11, 4],
  [11, 10, 2],
  [10, 7, 6],
  [7, 1, 8],
  [3, 9, 4],
  [3, 4, 2],
  [3, 2, 6],
  [3, 6, 8],
  [3, 8, 9],
  [4, 9, 5],
  [2, 4, 11],
  [6, 2, 10],
  [8, 6, 7],
  [9, 8, 1],
];

/** A small seeded generator (mulberry32): placement only, never the sim's RNG. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A string's 32-bit FNV-1a hash: a piece's fixed seed comes from its id. */
export function hashOf(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
