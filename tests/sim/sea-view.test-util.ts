// What the sea shows on the phone's screen to a rider on a road (playtest 4, run C's fix check: "the Keys flats
// still read as one turquoise"). A test hands over a road, a place on it and a time of day; the camera settles
// behind the rider as the app builds it, and the frame is worked out the way the app draws it:
//   - what the land hides: every triangle of the road scene (the deck, the road, the shoulders, the land
//     strips, the rails, and the scenery the scene builds itself at full roadside density: trees, posts) is
//     rasterised into a depth buffer, and a sea pixel counts only where no triangle stands in front of the
//     sea's own depth (the beaches take most of the near sea from a chase camera). Not counted: the model-based
//     roadside props (RoadsideLayer), traffic, riders and the HUD, so the real frame shows a little less sea;
//   - the colour the player SEES there: the water's colour times the mesh's vertex tint (laid by the lattice's
//     bilinear weights), through the ink water shader's exposure, the scene's haze at the pixel's depth, and the
//     film grade (`seenSea`).
// Test-only: nothing here ships. It lives in tests/ because the camera and the render module may not import
// each other.
import {
  Color,
  Matrix4,
  PerspectiveCamera,
  Vector3,
  type BufferAttribute,
  type Group,
  type InstancedMesh,
  type Mesh,
} from 'three';
import type { RoadNetwork } from '../../src/road';
import { createFlatLook, MIN_THREAT_DRAW_M } from '../../src/render/look';
import { kodachromeGrade } from '../../src/render/looks/grade';
import { KODAK, skyOf } from '../../src/render/looks/recipes';
import { buildRoadScene, type RoadDressing } from '../../src/render/road-mesh';
import { seaDepthAt, type SeaPlan } from '../../src/render/sea-bands';
import { PHONE, settledPose } from './chase-sight.test-util';

/** One sample per STEP_PX by STEP_PX pixels of the phone's screen. */
export const STEP_PX = 6;
/** The sea nearer than this is under the bike and the deck's rails; farther than this is the horizon. */
export const NEAREST_M = 25;
export const FARTHEST_M = 900;
/** The haze: the scene's fog starts here and is full at FOG_FAR_M (render/look.ts setupScene), view-space depth. */
export const FOG_NEAR_M = MIN_THREAT_DRAW_M + 20;
export const FOG_FAR_M = 700;

type Rgb = readonly [number, number, number];

const smoothstep = (a: number, b: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const toLinear = (hex: string): Rgb => {
  const c = new Color(hex);
  return [c.r, c.g, c.b];
};
const encode = (v: number) => {
  const c = Math.min(1, Math.max(0, v));
  return c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
};
const decode = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);

/**
 * The colour (display sRGB, 0..1) of the sea where its vertex tint is `tint`, `depthM` ahead of the camera, in the
 * default look (the ink look `kodak`) at `timeOfDay`. The ink water shader's body is
 * `diffuse * exposure * (0.94 + 0.12 h)` with `h` a per-cell hash that averages 1 over the sea (the wave glints
 * and strokes are left out: they sit on both sides of every patch edge); then three's linear fog, a smoothstep
 * from the fog's near to its far, toward the haze colour (the look's horizon colour); then the final pass's grade.
 */
export function seenSea(tint: Rgb, depthM: number, timeOfDay: string): [number, number, number] {
  const sky = skyOf(KODAK, timeOfDay);
  const water = toLinear(KODAK.palette.water ?? '#1e8e98');
  const haze = toLinear(sky.horizon);
  const f = smoothstep(FOG_NEAR_M, FOG_FAR_M, depthM);
  const out = [0, 1, 2].map((k) => {
    const lit = Math.min(1, (water[k] ?? 0) * (tint[k] ?? 1) * sky.exposure);
    return encode(lit * (1 - f) + (haze[k] ?? 0) * f);
  });
  return kodachromeGrade(out[0] ?? 0, out[1] ?? 0, out[2] ?? 0);
}

/** CIE L*a*b* (D65) of a display sRGB colour. */
export function lab(c: readonly [number, number, number]): [number, number, number] {
  const [r, g, b] = c.map(decode) as [number, number, number];
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

/** CIE76 colour difference. About 2.3 is a just-noticeable difference side by side; 6 or more is plain at a glance. */
export const deltaE = (a: readonly number[], b: readonly number[]) =>
  Math.hypot((a[0] ?? 0) - (b[0] ?? 0), (a[1] ?? 0) - (b[1] ?? 0), (a[2] ?? 0) - (b[2] ?? 0));

export interface SeaPixel {
  /** The sample's column and row on the sample grid (`cols` by `rows` of a frame). */
  col: number;
  row: number;
  /** Metres ahead of the camera along its view axis (what the fog reads). */
  depthM: number;
  tint: Rgb;
  /** The plan's depth there, 0 (flats) to 1 (channel). */
  deep: number;
}

export interface SeaFrame {
  edge: number;
  s: number;
  cols: number;
  rows: number;
  /** The sea the land leaves in view, in the sample grid's order. */
  pixels: SeaPixel[];
}

const look = createFlatLook();
const COLS = Math.ceil(PHONE.width / STEP_PX);
const ROWS = Math.ceil(PHONE.height / STEP_PX);

/**
 * The view depth of the nearest triangle of the scene's meshes at each sample of the grid, Infinity where none
 * covers it: a depth buffer filled by a plain scanline-free rasteriser (the sample's centre against each
 * triangle's edges, 1/z interpolated in screen space), with the triangles clipped at the camera's near plane.
 * Instanced meshes (posts, pylons) and the sea itself are left out.
 */
function groundDepth(group: Group, cam: PerspectiveCamera): Float32Array {
  const depth = new Float32Array(COLS * ROWS).fill(Infinity);
  const view = cam.matrixWorldInverse;
  const p = cam.projectionMatrix.elements;
  const near = 0.3;
  const m = new Matrix4();
  const toGridX = (vx: number, vz: number) => (((p[0] ?? 1) * vx) / -vz + 1) * 0.5 * COLS;
  const toGridY = (vy: number, vz: number) => (1 - ((p[5] ?? 1) * vy) / -vz) * 0.5 * ROWS;
  const poly: number[][] = [];
  const clipped: number[][] = [];
  const fill = (pts: number[][]) => {
    // pts: [gx, gy, 1/depth] fan from pts[0].
    for (let k = 1; k + 1 < pts.length; k++) {
      const a = pts[0] as number[];
      const b = pts[k] as number[];
      const c = pts[k + 1] as number[];
      const area = (b[0]! - a[0]!) * (c[1]! - a[1]!) - (c[0]! - a[0]!) * (b[1]! - a[1]!);
      if (Math.abs(area) < 1e-9) continue;
      const x0 = Math.max(0, Math.floor(Math.min(a[0]!, b[0]!, c[0]!)));
      const x1 = Math.min(COLS - 1, Math.ceil(Math.max(a[0]!, b[0]!, c[0]!)));
      const y0 = Math.max(0, Math.floor(Math.min(a[1]!, b[1]!, c[1]!)));
      const y1 = Math.min(ROWS - 1, Math.ceil(Math.max(a[1]!, b[1]!, c[1]!)));
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) {
          const px = x + 0.5;
          const py = y + 0.5;
          const w1 = ((px - a[0]!) * (c[1]! - a[1]!) - (c[0]! - a[0]!) * (py - a[1]!)) / area;
          const w2 = ((b[0]! - a[0]!) * (py - a[1]!) - (px - a[0]!) * (b[1]! - a[1]!)) / area;
          const w0 = 1 - w1 - w2;
          if (w0 < 0 || w1 < 0 || w2 < 0) continue;
          const inv = w0 * a[2]! + w1 * b[2]! + w2 * c[2]!;
          if (inv <= 0) continue;
          const d = 1 / inv;
          const at = y * COLS + x;
          if (d < (depth[at] ?? Infinity)) depth[at] = d;
        }
    }
  };
  group.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh || (o as InstancedMesh).isInstancedMesh || o.name === 'road-water') return;
    for (let q: typeof o | null = o; q; q = q.parent) if (!q.visible) return;
    const pos = mesh.geometry.getAttribute('position') as BufferAttribute;
    const index = mesh.geometry.getIndex();
    const count = index ? index.count : pos.count;
    mesh.updateWorldMatrix(true, false);
    m.multiplyMatrices(view, mesh.matrixWorld);
    const e = m.elements;
    // View-space positions of every vertex, once.
    const vx = new Float64Array(pos.count);
    const vy = new Float64Array(pos.count);
    const vz = new Float64Array(pos.count);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      vx[i] = (e[0] ?? 0) * x + (e[4] ?? 0) * y + (e[8] ?? 0) * z + (e[12] ?? 0);
      vy[i] = (e[1] ?? 0) * x + (e[5] ?? 0) * y + (e[9] ?? 0) * z + (e[13] ?? 0);
      vz[i] = (e[2] ?? 0) * x + (e[6] ?? 0) * y + (e[10] ?? 0) * z + (e[14] ?? 0);
    }
    for (let t = 0; t + 2 < count; t += 3) {
      const ids = [0, 1, 2].map((k) => (index ? index.getX(t + k) : t + k)) as [number, number, number];
      if (ids.every((i) => (vz[i] ?? 0) > -near)) continue;
      if (ids.every((i) => (vz[i] ?? 0) < -FARTHEST_M * 1.5)) continue;
      poly.length = 0;
      for (const i of ids) poly.push([vx[i] ?? 0, vy[i] ?? 0, vz[i] ?? 0]);
      // Clip at the near plane (view z = -near).
      clipped.length = 0;
      for (let k = 0; k < 3; k++) {
        const a = poly[k] as number[];
        const b = poly[(k + 1) % 3] as number[];
        const aIn = a[2]! <= -near;
        const bIn = b[2]! <= -near;
        if (aIn) clipped.push(a);
        if (aIn !== bIn) {
          const u = (-near - a[2]!) / (b[2]! - a[2]!);
          clipped.push([a[0]! + (b[0]! - a[0]!) * u, a[1]! + (b[1]! - a[1]!) * u, -near]);
        }
      }
      if (clipped.length < 3) continue;
      fill(clipped.map((v) => [toGridX(v[0]!, v[2]!), toGridY(v[1]!, v[2]!), 1 / -v[2]!]));
    }
  });
  return depth;
}

/**
 * The sea's pixels at every `stepM` along each road of the network, for a rider at d = 2 at `speed`: every sample
 * of the grid whose ray meets the sea between NEAREST_M and FARTHEST_M away (along the ground), clear of the deck
 * (past 7 m from the road's line) and not behind a triangle of the scene.
 */
export function seaFrames(
  road: RoadNetwork,
  dressing: RoadDressing,
  plan: SeaPlan,
  seed: number,
  stepM: number,
  speed = 38,
): SeaFrame[] {
  const scene = buildRoadScene(road, look, dressing, { seed, roadsideDensity: 1 });
  const out: SeaFrame[] = [];
  for (const e of road.edges) {
    for (let s = 150; s < e.length - 100; s += stepM) {
      const { pose, aspect } = settledPose(road, e.index, s, 2, speed);
      scene.update(pose.x, pose.z, 0, 760);
      let mesh: Mesh | undefined;
      scene.group.traverse((o) => {
        if ((o as Mesh).isMesh && o.name === 'road-water') mesh = o as Mesh;
      });
      if (!mesh) throw new Error('no sea mesh');
      const pos = mesh.geometry.getAttribute('position') as BufferAttribute;
      const col = mesh.geometry.getAttribute('color') as BufferAttribute;
      const n = Math.round(Math.sqrt(pos.count));
      const xs = Array.from({ length: n }, (_, i) => pos.getX(i * n));
      const zs = Array.from({ length: n }, (_, j) => pos.getZ(j));
      const at = (i: number, j: number, k: number) =>
        k === 0 ? col.getX(i * n + j) : k === 1 ? col.getY(i * n + j) : col.getZ(i * n + j);
      const lower = (a: readonly number[], v: number) => {
        let k = 0;
        while (k < a.length - 2 && (a[k + 1] ?? 0) <= v) k++;
        return k;
      };
      const cam = new PerspectiveCamera(pose.fov, aspect, 0.3, 3000);
      cam.position.set(pose.x, pose.y, pose.z);
      cam.lookAt(pose.lookX, pose.lookY, pose.lookZ);
      if (pose.roll) cam.rotateZ(pose.roll);
      cam.updateMatrixWorld(true);
      cam.updateProjectionMatrix();
      const ground = groundDepth(scene.group, cam);
      const eye = new Vector3(pose.x, pose.y, pose.z);
      const w0 = road.toWorld(e.index, s, 0, 0);
      const f = road.frameAt(e.index, s);
      const pixels: SeaPixel[] = [];
      for (let row = 0; row < ROWS; row++)
        for (let colIx = 0; colIx < COLS; colIx++) {
          const dir = new Vector3(((colIx + 0.5) / COLS) * 2 - 1, 1 - ((row + 0.5) / ROWS) * 2, 0.5)
            .unproject(cam)
            .sub(eye)
            .normalize();
          if (dir.y > -0.002) continue;
          const t = -eye.y / dir.y;
          if (t < NEAREST_M || t > FARTHEST_M) continue;
          const x = eye.x + dir.x * t;
          const z = eye.z + dir.z * t;
          if (Math.abs((x - w0.x) * -f.tz + (z - w0.z) * f.tx) < 7) continue;
          const depthM = -new Vector3(x, 0, z).applyMatrix4(cam.matrixWorldInverse).z;
          // Behind land, a deck or a rail.
          if ((ground[row * COLS + colIx] ?? Infinity) < depthM - 0.05) continue;
          const i = lower(xs, x);
          const j = lower(zs, z);
          const u = Math.min(1, Math.max(0, (x - (xs[i] ?? 0)) / ((xs[i + 1] ?? 1) - (xs[i] ?? 0))));
          const v = Math.min(1, Math.max(0, (z - (zs[j] ?? 0)) / ((zs[j + 1] ?? 1) - (zs[j] ?? 0))));
          const c = [0, 1, 2].map(
            (k) =>
              at(i, j, k) * (1 - u) * (1 - v) +
              at(i + 1, j, k) * u * (1 - v) +
              at(i, j + 1, k) * (1 - u) * v +
              at(i + 1, j + 1, k) * u * v,
          );
          pixels.push({
            col: colIx,
            row,
            depthM,
            tint: [c[0] ?? 1, c[1] ?? 1, c[2] ?? 1],
            deep: seaDepthAt(plan, x, z),
          });
        }
      out.push({ edge: e.index, s, cols: COLS, rows: ROWS, pixels });
    }
  }
  scene.dispose();
  return out;
}
