// Drizzle (the region build-out, W-O, the maintainer 2026-10-01: the Pacific Northwest's "fog and
// drizzle light"). Render only: the weather field stays reserved in the content schema and nothing
// here reaches the sim. A region turns it on with a `rain` colour in its palette (or an env weather
// of `rain` or `drizzle`). Thin streaks live in the camera's space, like the speed lines: they fall,
// and rush toward the camera with the rider's speed, so they read as rain whatever the road does.
// One draw call; the randomness is a fixed-seed generator so tests repeat.
import { InstancedMesh, Matrix4, MeshBasicMaterial, PlaneGeometry, Quaternion, Vector3 } from 'three';
import type { LookEnv, LookStyle } from './look';
import type { RenderParams } from './tuning';

/** The most streaks drawn at once (the `render.rainAmount` slider at its maximum). */
export const MAX_DROPS = 480;
/** The box of camera space the streaks fill, metres: across, up and down, and depth. */
const HALF_W = 9;
const TOP = 6;
const BOTTOM = -5;
const FAR_M = 26;
const NEAR_M = 1.2;
/** How fast drizzle falls, m/s, and the streak's length at that speed. [default] */
const FALL_MPS = 7.5;
/** The streaks' opacity: a drizzle, not a downpour. [default] */
const OPACITY = 0.32;

/** The rain colour a race's environment asks for, or null for a dry race. */
export function rainColourOf(env: LookEnv): string | null {
  const own = env.palette?.['rain'];
  if (own) return own;
  return env.weather === 'rain' || env.weather === 'drizzle' ? '#cfd8dc' : null;
}

interface Drop {
  x: number;
  y: number;
  z: number;
}

export class Rain {
  /** Add to the camera: the streaks are placed in its space. */
  readonly root: InstancedMesh;
  private readonly drops: Drop[] = [];
  private seed = 0x7a1e;
  private on = false;
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly pos = new Vector3();
  private readonly scale = new Vector3();

  constructor(
    private readonly look: LookStyle,
    private readonly params: RenderParams,
  ) {
    // A unit quad facing the camera (+z in its space), stretched per streak.
    this.root = new InstancedMesh(
      new PlaneGeometry(0.018, 1),
      look.material('streak', { overlay: true }),
      MAX_DROPS,
    );
    this.root.name = 'rain';
    this.root.frustumCulled = false;
    this.root.renderOrder = 998;
    this.root.visible = false;
    this.root.count = 0;
    for (let i = 0; i < MAX_DROPS; i++) this.drops.push({ x: 0, y: 0, z: 0 });
  }

  /** Turns the rain on in this colour, or off (null). */
  set(colour: string | null): void {
    this.on = colour !== null;
    if (!colour) return;
    // Its own overlay material: the speed lines own the plain white one and animate its opacity.
    const own = colour.toLowerCase() === '#ffffff' ? '#fefefe' : colour;
    const material = this.look.material('streak', { overlay: true, color: own }) as MeshBasicMaterial;
    material.opacity = OPACITY;
    this.root.material = material;
    for (const d of this.drops) this.spawn(d, NEAR_M + (FAR_M - NEAR_M) * this.rand(), true);
  }

  private rand(): number {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  private spawn(d: Drop, depth: number, anywhere: boolean): void {
    d.x = (this.rand() * 2 - 1) * HALF_W;
    d.y = anywhere ? BOTTOM + (TOP - BOTTOM) * this.rand() : TOP;
    d.z = -depth;
  }

  /** Moves the streaks for a frame: `speedMps` is the rider's speed and `dt` the frame time, s. */
  update(speedMps: number, dt: number): void {
    const count = this.on
      ? Math.max(0, Math.min(MAX_DROPS, Math.round((MAX_DROPS / 2) * this.params.rainAmount)))
      : 0;
    this.root.visible = count > 0;
    this.root.count = count;
    if (!count) return;
    const t = Math.max(0, Math.min(0.1, dt));
    const rush = Math.max(0, speedMps) * 0.6;
    const length = 0.35 + rush * 0.02;
    for (let i = 0; i < count; i++) {
      const d = this.drops[i];
      if (!d) continue;
      if (d.z === 0) this.spawn(d, NEAR_M + (FAR_M - NEAR_M) * this.rand(), true);
      d.y -= FALL_MPS * t;
      d.z += rush * t;
      if (d.y < BOTTOM) this.spawn(d, NEAR_M + (FAR_M - NEAR_M) * this.rand(), false);
      else if (d.z > -NEAR_M) this.spawn(d, FAR_M, true);
      this.pos.set(d.x, d.y, d.z);
      this.scale.set(1, length, 1);
      this.root.setMatrixAt(i, this.m.compose(this.pos, this.q, this.scale));
    }
    this.root.instanceMatrix.needsUpdate = true;
  }

  /** Streaks drawn by the last frame (0 = dry). */
  count(): number {
    return this.root.visible ? this.root.count : 0;
  }
}
