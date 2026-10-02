// The backdrop's lazy half: builds a network's far pieces into one mesh with one material (one draw
// call), and the material that draws them past the fog. Loaded with the region's backdrop data the
// first time a race (or the menu) shows a road that has one, so the first load never carries it.
//
// How the horizon is drawn in one cheap pass:
// - Every vertex is a TRUE world position, often kilometres out. The vertex shader pulls it in
//   along its own line of sight to a depth between the near fog's end and just inside the camera's
//   far plane (760 m), farther pieces deeper. A point on the same line of sight projects to the same
//   pixel, so the picture is exact; only the depth is squeezed, and it keeps the far-to-near order.
//   Anything nearer than the fog's end stays where it is.
// - Floors (far land and water) are big flat triangles, kilometres across, and a squeeze per
//   vertex bends them: a triangle with one corner pulled in toward the camera is drawn as a tilted
//   sheet that stands above the near sea and hills, and covers them (W-P, verify-skyline mustFix 1:
//   San Francisco's far ground painted the bay beside the road in the haze colour). So a floor's
//   fragment finds its own true point (where its pixel's ray meets the floor's level), squeezes
//   that, and writes that depth and that haze. Then the near sea and ground cover a floor wherever
//   they are nearer, exactly as the floor lying a hair under the sea means.
// - Colours are flat and unlit (each facet is shaded once by the classic sun when built), then
//   mixed toward the scene's own haze colour by true distance (aerial perspective), with a little
//   more haze at each piece's foot, so ridges fade into the fog and every look's haze colour,
//   grade and film pass apply. Floors (far land and water) also fade in from the fog's end, so they
//   meet the near fogged ground instead of standing out of it.
// - Ships, ferries and fog banks drift by a per-vertex swing, so nothing is touched per frame but
//   five uniforms.
import {
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Matrix4,
  Mesh,
  ShaderMaterial,
} from 'three';
import {
  backdropProblems,
  type BackdropNetworkFile,
  type BackdropRegionFile,
  type Piece,
  type PieceKind,
  type Pt,
} from './data';
import { geoFrame } from './geo';
import {
  buildBlocks,
  buildBridge,
  buildClouds,
  buildFloor,
  buildFloorRing,
  buildIslands,
  buildLighthouse,
  buildMast,
  buildPeak,
  buildRidge,
  buildSkyline,
  buildVessels,
  type ShapeCtx,
} from './shapes';
import { Soup } from './soup';

/** The squeezed depth's far end: just inside the camera's far plane (render/index.ts, 760 m). */
export const BACKDROP_FAR_M = 750;
/** How fast the squeeze tightens with distance, m: half the depth range is used by this far past the fog. */
export const BACKDROP_SQUEEZE_M = 6000;

/** Where the squeeze starts: the near fog's end, but never closer than 40 m to the far end. */
const squeezeStart = (fogFar: number) => Math.min(fogFar, BACKDROP_FAR_M - 40);

/**
 * The depth (m from the eye) a point `d` metres away is drawn at: itself up to the fog's end, then
 * squeezed toward BACKDROP_FAR_M, farther always deeper. The vertex shader below does the same.
 */
export function squeezedDepth(d: number, fogFar: number): number {
  const r0 = squeezeStart(fogFar);
  return d <= r0 ? d : r0 + ((BACKDROP_FAR_M - r0) * (d - r0)) / (d - r0 + BACKDROP_SQUEEZE_M);
}

/** Shared by both stages: the squeezed depth and the haze, from a true distance `d`. */
const COMMON = /* glsl */ `
uniform vec3 uCam;
uniform float uRMin;
uniform float uRMax;
uniform float uSqueeze;
uniform float uHazeM;
uniform float uHazeMax;
uniform float uFogFar;
float squeezed(float d, float bias) {
  float r = d <= uRMin ? d : uRMin + (uRMax - uRMin) * (d - uRMin) / (d - uRMin + uSqueeze);
  // A decal's or a floor's depth bias applies past the fog's end only (nearer, everything is exact).
  return max(r - bias * step(uRMin, d), 0.5);
}
float hazeAt(float d, float foot, float isFloor) {
  float aerial = min(1.0 - exp(-d / uHazeM), uHazeMax);
  float h = 1.0 - (1.0 - aerial) * (1.0 - foot);
  // Floors (far land and water) come out of the fog's end gradually, and only part way: the haze
  // lies along the ground, so a camera high on a hill sees more of the ground below than one at sea level.
  float floorMin = mix(0.82, 0.3, smoothstep(15.0, 220.0, uCam.y));
  h = max(h, isFloor * mix(1.0, floorMin, smoothstep(uFogFar, uFogFar * 4.0, d)));
  return clamp(h, 0.0, 1.0);
}`;

const VERTEX = /* glsl */ `
${COMMON}
uniform float uTime;
attribute vec3 aColor;
attribute vec4 aInfo;
attribute vec4 aMotion;
varying vec3 vColor;
varying float vHaze;
varying vec3 vW;
varying float vFloor;
varying float vFloorY;
varying float vBias;
varying float vFoot;
void main() {
  vec3 p = position;
  p.xz += aMotion.xy * sin(uTime * aMotion.z + aMotion.w);
  p.xz += uCam.xz * aInfo.w;
  vec3 v = p - uCam;
  float d = max(length(v), 0.5);
  vec3 w = uCam + v * (squeezed(d, aInfo.z) / d);
  vHaze = hazeAt(d, aInfo.x, aInfo.y);
  vColor = aColor;
  vW = w;
  vFloor = aInfo.y;
  vFloorY = p.y;
  vBias = aInfo.z;
  vFoot = aInfo.x;
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}`;

const FRAGMENT = /* glsl */ `
${COMMON}
uniform vec3 uHaze;
uniform mat4 uProj;
varying vec3 vColor;
varying float vHaze;
varying vec3 vW;
varying float vFloor;
varying float vFloorY;
varying float vBias;
varying float vFoot;
void main() {
  float h = vHaze;
  float depth = gl_FragCoord.z;
  if (vFloor > 0.5) {
    // This pixel's ray (every point drawn here lies on it) meets the floor's level at its true point.
    vec3 ray = vW - uCam;
    if (ray.y > -1e-6 || uCam.y <= vFloorY) discard;
    float d = length(ray) * (vFloorY - uCam.y) / ray.y;
    vec3 w = uCam + normalize(ray) * squeezed(d, vBias);
    vec4 clip = uProj * viewMatrix * vec4(w, 1.0);
    depth = clamp(0.5 * clip.z / clip.w + 0.5, 0.0, 1.0);
    h = hazeAt(d, vFoot, 1.0);
  }
  gl_FragDepth = depth;
  gl_FragColor = vec4(mix(vColor, uHaze, h), 1.0);
  #include <colorspace_fragment>
}`;

export interface BackdropStats {
  network: string;
  region: string;
  /** Pieces drawn, by kind. */
  kinds: Partial<Record<PieceKind, number>>;
  /** Pieces left out: too far, for another network, or too close to a road. */
  skipped: number;
  triangles: number;
}

export interface BuiltBackdrop {
  mesh: Mesh;
  stats: BackdropStats;
  /** Per frame: the camera, the scene's haze and fog end, the time. */
  update(cam: { x: number; y: number; z: number }, haze: Color, fogFar: number, timeS: number): void;
  dispose(): void;
}

/** Road points on a coarse grid, for "is this piece too close to a road" (keep-out). */
export function roadIndex(points: readonly (readonly [number, number])[], cell = 400) {
  const grid = new Map<string, [number, number][]>();
  for (const [x, z] of points) {
    const key = `${Math.floor(x / cell)},${Math.floor(z / cell)}`;
    let list = grid.get(key);
    if (!list) grid.set(key, (list = []));
    list.push([x, z]);
  }
  return (x: number, z: number, r: number): boolean => {
    const r2 = r * r;
    const k = Math.ceil(r / cell);
    const cx = Math.floor(x / cell);
    const cz = Math.floor(z / cell);
    for (let i = cx - k; i <= cx + k; i++)
      for (let j = cz - k; j <= cz + k; j++)
        for (const [px, pz] of grid.get(`${i},${j}`) ?? [])
          if ((px - x) ** 2 + (pz - z) ** 2 < r2) return true;
    return false;
  };
}

/**
 * A simple polygon (no holes, either winding) as triangles of its point indices, by ear clipping.
 * Floors have a few dozen points at most. (Not three's ShapeUtils: three is one module, so using it
 * here would pull its triangulator into the first-load bundle.)
 */
export function triangulate(pts: readonly (readonly [number, number])[]): number[][] {
  const n = pts.length;
  if (n < 3) return [];
  let area = 0;
  for (let i = 0; i < n; i++) {
    const [x0, z0] = pts[i]!;
    const [x1, z1] = pts[(i + 1) % n]!;
    area += x0 * z1 - x1 * z0;
  }
  const ccw = area > 0;
  const cross = (a: number, b: number, c: number) => {
    const [ax, az] = pts[a]!;
    const [bx, bz] = pts[b]!;
    const [cx, cz] = pts[c]!;
    const v = (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
    return ccw ? v : -v;
  };
  const inside = (p: number, a: number, b: number, c: number) =>
    cross(a, b, p) >= 0 && cross(b, c, p) >= 0 && cross(c, a, p) >= 0;
  const left = Array.from({ length: n }, (_, i) => i);
  const out: number[][] = [];
  let guard = n * n;
  while (left.length > 3 && guard-- > 0) {
    let clipped = false;
    for (let i = 0; i < left.length; i++) {
      const a = left[(i + left.length - 1) % left.length]!;
      const b = left[i]!;
      const c = left[(i + 1) % left.length]!;
      if (cross(a, b, c) <= 0) continue;
      if (left.some((p) => p !== a && p !== b && p !== c && inside(p, a, b, c))) continue;
      out.push([a, b, c]);
      left.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) break;
  }
  if (left.length === 3) out.push([left[0]!, left[1]!, left[2]!]);
  return out;
}

/**
 * Builds the pieces of a region (and of one network) into a triangle soup: the far ground ring,
 * then every piece the network keeps. `roadPoints` are the network's road samples, world [x, z].
 */
export function buildSoup(
  region: BackdropRegionFile,
  network: BackdropNetworkFile,
  roadPoints: readonly (readonly [number, number])[],
  seed: number,
): { soup: Soup; stats: BackdropStats } {
  const problems = [...backdropProblems(region, 'region'), ...backdropProblems(network, 'network')];
  if (problems.length) throw new Error(`backdrop data: ${problems.join('; ')}`);
  const soup = new Soup();
  const geo = geoFrame(network.originLatDeg, network.originLonDeg);
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const [x, z] of roadPoints) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
  }
  const centre: [number, number] = roadPoints.length ? [(minX + maxX) / 2, (minZ + maxZ) / 2] : [0, 0];
  const nearRoad = roadIndex(roadPoints);
  const stats: BackdropStats = {
    network: network.network,
    region: region.region,
    kinds: {},
    skipped: 0,
    triangles: 0,
  };
  buildFloorRing(soup, region.floorColour);
  const pieces: Piece[] = [...region.pieces, ...(network.pieces ?? [])];
  for (const p of pieces) {
    if (p.networks && !p.networks.includes(network.network)) {
      stats.skipped++;
      continue;
    }
    const toWorld = (q: Pt): [number, number] =>
      p.frame === 'local' ? [q[0], q[1]] : geo.toWorld(q[0], q[1]);
    const anchor = anchorOf(p);
    if (anchor) {
      const [x, z] = toWorld(anchor);
      if (Math.hypot(x - centre[0], z - centre[1]) > (p.maxDistM ?? 160_000)) {
        stats.skipped++;
        continue;
      }
    }
    const ctx: ShapeCtx = { soup, toWorld, nearRoad, centre, seed };
    const kept = buildPiece(p, ctx);
    if (kept) stats.kinds[p.kind] = (stats.kinds[p.kind] ?? 0) + 1;
    else stats.skipped++;
  }
  stats.triangles = soup.triangles;
  return { soup, stats };
}

function anchorOf(p: Piece): Pt | null {
  switch (p.kind) {
    case 'ridge':
      return [p.path[Math.floor(p.path.length / 2)]![0], p.path[Math.floor(p.path.length / 2)]![1]];
    case 'peak':
    case 'lighthouse':
    case 'mast':
      return p.at;
    case 'bridge':
      return p.from;
    case 'skyline':
      return p.centre;
    case 'blocks':
    case 'floor':
      return p.area[0]!;
    case 'vessels':
      return p.path ? p.path[0] : (p.centre ?? null);
    case 'clouds':
      return p.path ? p.path[0]! : null;
    case 'islands':
      return null;
  }
}

function buildPiece(p: Piece, ctx: ShapeCtx): number {
  switch (p.kind) {
    case 'ridge':
      return buildRidge(p, ctx);
    case 'peak':
      return buildPeak(p, ctx);
    case 'bridge':
      return buildBridge(p, ctx);
    case 'skyline':
      return buildSkyline(p, ctx);
    case 'blocks':
      return buildBlocks(p, ctx);
    case 'vessels':
      return buildVessels(p, ctx);
    case 'clouds':
      return buildClouds(p, ctx);
    case 'islands':
      return buildIslands(p, ctx);
    case 'lighthouse':
      return buildLighthouse(p, ctx);
    case 'mast':
      return buildMast(p, ctx);
    case 'floor':
      return buildFloor(p, ctx, triangulate);
  }
}

/** The road samples of a network as world [x, z], every `step` samples. */
export function roadPointsOf(
  edges: readonly { x: ArrayLike<number>; z: ArrayLike<number>; count: number }[],
  step = 5,
) {
  const out: [number, number][] = [];
  for (const e of edges) {
    for (let i = 0; i < e.count; i += step) out.push([e.x[i]!, e.z[i]!]);
    if (e.count) out.push([e.x[e.count - 1]!, e.z[e.count - 1]!]);
  }
  return out;
}

export function buildBackdrop(
  region: BackdropRegionFile,
  network: BackdropNetworkFile,
  roadPoints: readonly (readonly [number, number])[],
  seed: number,
): BuiltBackdrop {
  const { soup, stats } = buildSoup(region, network, roadPoints, seed);
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(soup.pos, 3));
  geometry.setAttribute('aColor', new Float32BufferAttribute(soup.col, 3));
  geometry.setAttribute('aInfo', new Float32BufferAttribute(soup.info, 4));
  geometry.setAttribute('aMotion', new Float32BufferAttribute(soup.motion, 4));
  const uniforms = {
    uCam: { value: [0, 0, 0] as [number, number, number] },
    uTime: { value: 0 },
    uRMin: { value: 480 },
    uRMax: { value: BACKDROP_FAR_M },
    uSqueeze: { value: BACKDROP_SQUEEZE_M },
    uHazeM: { value: region.hazeM },
    uHazeMax: { value: region.hazeMax ?? 0.8 },
    uFogFar: { value: 700 },
    uHaze: { value: new Color('#ffffff') },
    uProj: { value: new Matrix4() },
  };
  // Facets face every way (curtains, ribbons, sails): draw both sides.
  const material = new ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms,
    fog: false,
    side: DoubleSide,
  });
  const mesh = new Mesh(geometry, material);
  mesh.name = 'backdrop';
  // The vertex shader moves everything: the CPU's bounding sphere would cull it wrongly.
  mesh.frustumCulled = false;
  // A floor's fragment works out its own depth, with the camera that draws it.
  mesh.onBeforeRender = (_renderer, _scene, camera) => {
    uniforms.uProj.value.copy(camera.projectionMatrix);
  };
  return {
    mesh,
    stats,
    update(cam, haze, fogFar, timeS) {
      uniforms.uCam.value = [cam.x, cam.y, cam.z];
      uniforms.uTime.value = timeS;
      // The squeeze starts where the near fog is full, never past the far end.
      uniforms.uRMin.value = squeezeStart(fogFar);
      uniforms.uFogFar.value = fogFar;
      uniforms.uHaze.value.copy(haze);
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
