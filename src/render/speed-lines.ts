// Speed lines (playtest 1, item 10, [decided]: "faster + stronger cues"). Thin white streaks rush
// past the edges of the view once the player is going fast, like wind whipping by: they live in
// the camera's space, start far ahead near the middle of the view and fly outward past the camera,
// so they read as motion whatever the road does. Faster riding makes them faster, longer and
// brighter. They stay out of the middle of the view, where the road ahead and oncoming traffic are.
// Purely visual; the randomness is a fixed-seed generator so tests repeat.
import {
  BoxGeometry,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  Quaternion,
  Vector3,
  type PerspectiveCamera,
} from 'three';
import { CALM_SHARE } from './calm';
import type { LookStyle } from './look';
import type { RenderParams } from './tuning';

/** The most lines drawn at once (the `render.streakCount` slider picks how many of them show). */
export const MAX_STREAKS = 64;
/** Depths (metres in front of the camera) where a line starts and where it is recycled. */
const FAR_M = 45;
const NEAR_M = 0.8;
/** At its start depth a line sits this far from the view's centre, as a fraction of the half-view. */
const START_RING = [0.35, 0.75] as const;
/** How much faster than the rider a line flies past (they are wind, not scenery). */
const RUSH = 1.4;

export interface SpeedLineCounts {
  /** The streaks' opacity this frame (0 = hidden). */
  level: number;
  /** Lines shown this frame. */
  lines: number;
}

interface Line {
  x: number;
  y: number;
  z: number;
}

/** 0..1: how far into the streaks' speed range a speed is. */
export function streakAmount(
  speedMps: number,
  p: Pick<RenderParams, 'streakFromMps' | 'streakFullMps'>,
): number {
  const span = p.streakFullMps - p.streakFromMps;
  if (!(span > 0) || !Number.isFinite(speedMps)) return speedMps >= p.streakFullMps ? 1 : 0;
  return Math.min(1, Math.max(0, (speedMps - p.streakFromMps) / span));
}

export class SpeedLines {
  /** Add to the camera: the lines are placed in its space. */
  readonly root: InstancedMesh;
  private readonly lines: Line[] = [];
  private seed = 0x5eed5;
  private level = 0;
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly pos = new Vector3();
  private readonly scale = new Vector3();

  constructor(
    look: LookStyle,
    private readonly params: RenderParams,
  ) {
    // A unit box along z, stretched per line by its streak length.
    const geo = new BoxGeometry(0.035, 0.035, 1);
    this.root = new InstancedMesh(geo, look.material('streak', { overlay: true }), MAX_STREAKS);
    this.root.name = 'speed-lines';
    this.root.frustumCulled = false;
    this.root.renderOrder = 999;
    this.root.visible = false;
    this.root.count = 0;
    for (let i = 0; i < MAX_STREAKS; i++) this.lines.push({ x: 0, y: 0, z: 0 });
  }

  private rand(): number {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  /** Places a line at a depth, in a ring around the view's centre (so it flies outward). */
  private spawn(l: Line, camera: PerspectiveCamera, depth: number): void {
    const halfH = Math.tan((camera.fov * Math.PI) / 360) * depth;
    const halfW = halfH * (camera.aspect || 1);
    const a = this.rand() * Math.PI * 2;
    const r = START_RING[0] + (START_RING[1] - START_RING[0]) * this.rand();
    l.x = Math.cos(a) * r * halfW;
    l.y = Math.sin(a) * r * halfH;
    l.z = -depth;
  }

  /**
   * Moves the lines for a frame: `speedMps` is the player's speed and `dt` the real frame time, s.
   * `camera` gives the view's shape (the lines are children of it).
   */
  update(speedMps: number, dt: number, camera: PerspectiveCamera): void {
    const amount = streakAmount(speedMps, this.params);
    const count = Math.max(0, Math.min(MAX_STREAKS, Math.round(this.params.streakCount)));
    const target = amount * this.params.streakOpacity * (this.params.reduceMotion ? CALM_SHARE : 1);
    // Fade rather than pop as the speed crosses the threshold.
    const step = Math.min(1, Math.max(0, dt) * 6);
    this.level += (target - this.level) * step;
    if (target === 0 && this.level < 0.01) this.level = 0;
    const show = this.level > 0 && count > 0;
    this.root.visible = show;
    (this.root.material as MeshBasicMaterial).opacity = this.level;
    if (!show) {
      this.root.count = 0;
      return;
    }
    const v = Math.max(0, speedMps) * RUSH;
    const length = Math.max(0.3, v * 0.06);
    for (let i = 0; i < count; i++) {
      const l = this.lines[i];
      if (!l) continue;
      // A fresh line is spread over the whole depth range, so the first frame is not a wall.
      if (l.z === 0) this.spawn(l, camera, NEAR_M + (FAR_M - NEAR_M) * this.rand());
      l.z += v * Math.max(0, dt);
      if (l.z > -NEAR_M) this.spawn(l, camera, FAR_M);
      this.pos.set(l.x, l.y, l.z - length / 2);
      this.scale.set(1, 1, length);
      this.root.setMatrixAt(i, this.m.compose(this.pos, this.q, this.scale));
    }
    this.root.count = count;
    this.root.instanceMatrix.needsUpdate = true;
  }

  /** Where line i is now, in camera space (tests). */
  lineAt(i: number): Readonly<Line> | undefined {
    return this.lines[i];
  }

  counts(): SpeedLineCounts {
    return { level: this.root.visible ? this.level : 0, lines: this.root.visible ? this.root.count : 0 };
  }
}
