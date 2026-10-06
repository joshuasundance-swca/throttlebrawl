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
// - Floors (far land and water) are flat triangles kilometres across, and a squeeze per vertex
//   bends them: a triangle whose corners are pulled in by different amounts becomes a tilted sheet
//   above the near sea and hills, and covers them (W-P, verify-skyline mustFix 1: San Francisco's
//   far ground painted the bay beside the road in the haze colour). So floors keep their true
//   positions and only their depth follows another law (floorDrawnDepth): 1 / depth stays affine in
//   1 / true depth, so the depth is exact across a flat triangle, no floor is ever drawn nearer than
//   it truly is up to the fog's end (the near sea and ground cover it), and none goes past the far
//   plane. It is one more row of the vertex shader, nothing per pixel.
// - Colours are flat and unlit (each facet is shaded once by the classic sun when built), then
//   mixed toward the scene's own haze colour by true distance (aerial perspective), with a little
//   more haze at each piece's foot, so ridges fade into the fog and every look's haze colour,
//   grade and film pass apply. Floors (far land and water) also fade in from the fog's end, so they
//   meet the near fogged ground instead of standing out of it.
// - Ships, ferries and fog banks drift by a per-vertex swing, so nothing is touched per frame but
//   five uniforms. W-T (the horizon comes alive) adds a one-way glide on the same attributes: a
//   freight train, a landing seaplane, a bridge's traffic and fog pouring over a crest run end to
//   end, thin into the haze near each end and come round again, still without a per-frame touch.
// - A piece with `nearFadeM` (playtest 4, G1: the Golden Gate from the headlands) is the far form of a
//   model the near world draws up close: no fragment of it nearer (in view depth) than the near fog's
//   end, where the near model is wholly in the fog, then it comes out of the haze. One bridge, never two.
import { BufferGeometry, Color, DoubleSide, Float32BufferAttribute, Mesh, ShaderMaterial } from 'three';
import {
  backdropProblems,
  NEAR_WATER_FLOOR,
  type BackdropNetworkFile,
  type BackdropRegionFile,
  type Piece,
  type PieceKind,
  type Pt,
} from './data';
import { geoFrame } from './geo';
export { NEAR_WATER_FLOOR };
import { buildAircraft, buildBridgeTraffic, buildPour, buildTrain } from './movers';
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

/**
 * The depth (m along the view axis) a floor point `z` metres deep is drawn at:
 * 1 / drawn = 1 / BACKDROP_FAR_M + c / z, with c set so the fog's end maps to itself. Affine in
 * 1 / z, so a flat triangle's depth interpolates exactly; at or beyond the true depth up to the
 * fog's end; always inside the far end. The vertex shader below does the same (plus a tiny bias
 * so water lies over land, and land over the far ring).
 */
export function floorDrawnDepth(z: number, fogFar: number): number {
  const c = 1 - squeezeStart(fogFar) / BACKDROP_FAR_M;
  return 1 / (1 / BACKDROP_FAR_M + c / z);
}

/**
 * Where a faded piece (`nearFadeM`, playtest 4, G1) starts to be drawn, m of view depth: the near fog's
 * end, where the near world's own model of the same thing is wholly in the fog (three's fog is by view
 * depth too), and never past the squeeze's far end, just inside the camera's far plane that clips the
 * near model.
 */
export function fadeFrom(fogFar: number): number {
  return Math.min(fogFar, BACKDROP_FAR_M);
}

/**
 * A faded piece's vertex at view depth `depth`: null where it is not drawn at all (nearer than
 * fadeFrom), else the extra haze over it, 1 at fadeFrom down to 0 `fadeM` metres past it (a smoothstep).
 * With `fadeM` 0 the piece has no near fade: 0 everywhere. The backdrop's fragment shader does the same.
 */
export function nearFadeAt(depth: number, fadeM: number, fogFar: number): number | null {
  if (fadeM <= 0) return 0;
  const k = (depth - fadeFrom(fogFar)) / fadeM;
  if (k < 0) return null;
  const x = Math.min(1, k);
  return 1 - x * x * (3 - 2 * x);
}

/**
 * The haze over a floor vertex `d` metres from the eye (a camera `camY` m up), before the aerial haze: the far
 * floors (the sea, the far ground) are wholly the haze inside the fog's end, where the near world's own sea and
 * ground cover them, then come out of it gradually and only part way. The vertex shader below does the same.
 */
export function floorHazeAt(d: number, fogFar: number, camY: number, flag = 1): number {
  const smooth = (a: number, b: number, x: number) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  const floorMin = 0.82 + (0.3 - 0.82) * smooth(15, 220, camY);
  const far = 1 + (floorMin - 1) * smooth(fogFar, fogFar * 4, d);
  if (flag <= 0.5) return 0;
  // A lake: the fog's haze by distance, so inside the fog's end it keeps its colour and meets the far floor at its end.
  return flag > 1.5 ? Math.min(far, smooth(0, fogFar, d)) : far;
}

/** A glide is fully seen over the middle of its run; past this share of the half-run it thins out. */
export const GLIDE_FADE = 0.8;

/**
 * Where a moving vertex is at time t as a share of its drift, -1..1, and how much the end-of-run
 * fade hides it (0 for a swing). The backdrop's vertex shader does the same.
 */
export function motionAt(t: number, speed: number, phase: number): { m: number; fade: number } {
  if (speed >= 0) return { m: Math.sin(t * speed + phase), fade: 0 };
  const f = t * -speed + phase;
  const m = (f - Math.floor(f)) * 2 - 1;
  const x = Math.min(1, Math.max(0, (Math.abs(m) - GLIDE_FADE) / (1 - GLIDE_FADE)));
  return { m, fade: x * x * (3 - 2 * x) };
}

const VERTEX = /* glsl */ `
#define GLIDE_FADE ${GLIDE_FADE.toFixed(2)}
uniform vec3 uCam;
uniform float uTime;
uniform float uRMin;
uniform float uRMax;
uniform float uSqueeze;
uniform float uHazeM;
uniform float uHazeMax;
uniform float uFogFar;
attribute vec3 aColor;
attribute vec4 aInfo;
attribute vec4 aMotion;
attribute float aLift;
attribute float aFade;
varying vec3 vColor;
varying float vHaze;
varying float vFade;
varying float vDepth;
void main() {
  vec3 p = position;
  // A swing (a ship, a fog bank) or, with a negative speed, a one-way glide that comes round again
  // (a train, a seaplane, the bridge traffic, a pour; motionAt mirrors this).
  bool glide = aMotion.z < 0.0;
  float m = glide ? fract(uTime * -aMotion.z + aMotion.w) * 2.0 - 1.0 : sin(uTime * aMotion.z + aMotion.w);
  p.xz += aMotion.xy * m;
  p.y += aLift * m;
  p.xz += uCam.xz * aInfo.w;
  // A faded piece (playtest 4, G1) is cut by its TRUE view depth, as three's fog fades the near model.
  vFade = aFade;
  vDepth = -(viewMatrix * vec4(p, 1.0)).z;
  vec3 v = p - uCam;
  float d = max(length(v), 0.5);
  float r = d <= uRMin ? d : uRMin + (uRMax - uRMin) * (d - uRMin) / (d - uRMin + uSqueeze);
  // A decal's or a floor's depth bias applies past the fog's end only (nearer, everything is exact).
  r = max(r - aInfo.z * step(uRMin, d), 0.5);
  vec3 w = uCam + v * (r / d);
  float aerial = min(1.0 - exp(-d / uHazeM), uHazeMax);
  float h = 1.0 - (1.0 - aerial) * (1.0 - aInfo.x);
  // Floors (far land and water) come out of the fog's end gradually, and only part way: the haze
  // lies along the ground, so a camera high on a hill sees more of the ground below than one at sea level.
  float floorMin = mix(0.82, 0.3, smoothstep(15.0, 220.0, uCam.y));
  // A lake (a water floor above the sea, flag 2) has no near sea or ground over it inside the fog's end: it keeps
  // its own colour there and takes the fog's haze by distance (floorHazeAt mirrors this).
  float nearWater = step(1.5, aInfo.y);
  float floorH = mix(1.0, floorMin, smoothstep(uFogFar, uFogFar * 4.0, d));
  floorH = mix(floorH, min(floorH, smoothstep(0.0, uFogFar, d)), nearWater);
  h = max(h, min(aInfo.y, 1.0) * floorH);
  // A glide thins into the haze at each end of its run, so it never pops round.
  if (glide) h = max(h, smoothstep(GLIDE_FADE, 1.0, abs(m)));
  vHaze = clamp(h, 0.0, 1.0);
  vColor = aColor;
  if (aInfo.y > 0.5) {
    // A floor: its true position, and a depth that is affine in its true depth (floorDrawnDepth).
    // With view depth Z, NDC depth is -P22 + P32 / Z; here 1 / Z becomes 1 / uRMax + c / Z + a bias,
    // so clip z = (-P22 + P32 * (1 / uRMax + bias)) * Z + P32 * c, a plain linear row like any
    // projection's: clipping and interpolation stay exact.
    vec4 view = viewMatrix * vec4(p, 1.0);
    vec4 clip = projectionMatrix * view;
    float p22 = projectionMatrix[2][2];
    float p32 = projectionMatrix[3][2];
    float c = 1.0 - uRMin / uRMax;
    float bias = aInfo.z / (uRMax * uRMax);
    clip.z = (-p22 + p32 * (1.0 / uRMax + bias)) * (-view.z) + p32 * c;
    gl_Position = clip;
  } else {
    gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
  }
}`;

const FRAGMENT = /* glsl */ `
uniform vec3 uHaze;
uniform float uFadeFrom;
varying vec3 vColor;
varying float vHaze;
varying float vFade;
varying float vDepth;
void main() {
  float h = vHaze;
  // The far form of a near model (nearFadeAt mirrors this): nothing of it nearer than the near fog's
  // end, where the near model is wholly in the fog, then out of the haze over vFade metres.
  if (vFade > 0.0) {
    float k = (vDepth - uFadeFrom) / vFade;
    if (k < 0.0) discard;
    h = max(h, 1.0 - smoothstep(0.0, 1.0, k));
  }
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
  /** The ids of the pieces that move (ships, fog, the W-T middle distance), in build order. */
  moving: string[];
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
    moving: [],
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
    const from = soup.motion.length;
    soup.nearFade = p.nearFadeM ?? 0;
    const kept = buildPiece(p, ctx);
    soup.nearFade = 0;
    if (kept) stats.kinds[p.kind] = (stats.kinds[p.kind] ?? 0) + 1;
    else stats.skipped++;
    // What moves (W-T): any vertex the piece built with a drift.
    for (let i = from; i < soup.motion.length; i += 4)
      if (soup.motion[i] !== 0 || soup.motion[i + 1] !== 0) {
        stats.moving.push(p.id);
        break;
      }
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
    case 'train':
      return p.path[0];
    case 'aircraft':
      return p.path ? p.path[0] : null;
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
    case 'bridge': {
      const built = buildBridge(p, ctx);
      if (built) buildBridgeTraffic(p, ctx);
      return built;
    }
    case 'skyline':
      return buildSkyline(p, ctx);
    case 'blocks':
      return buildBlocks(p, ctx);
    case 'vessels':
      return buildVessels(p, ctx);
    case 'clouds':
      return p.style === 'pour' ? buildPour(p, ctx) : buildClouds(p, ctx);
    case 'train':
      return buildTrain(p, ctx);
    case 'aircraft':
      return buildAircraft(p, ctx);
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
  geometry.setAttribute('aLift', new Float32BufferAttribute(soup.lift, 1));
  geometry.setAttribute('aFade', new Float32BufferAttribute(soup.fade, 1));
  const uniforms = {
    uCam: { value: [0, 0, 0] as [number, number, number] },
    uTime: { value: 0 },
    uRMin: { value: 480 },
    uRMax: { value: BACKDROP_FAR_M },
    uSqueeze: { value: BACKDROP_SQUEEZE_M },
    uHazeM: { value: region.hazeM },
    uHazeMax: { value: region.hazeMax ?? 0.8 },
    uFogFar: { value: 700 },
    uFadeFrom: { value: fadeFrom(700) },
    uHaze: { value: new Color('#ffffff') },
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
  return {
    mesh,
    stats,
    update(cam, haze, fogFar, timeS) {
      uniforms.uCam.value = [cam.x, cam.y, cam.z];
      uniforms.uTime.value = timeS;
      // The squeeze starts where the near fog is full, never past the far end.
      uniforms.uRMin.value = squeezeStart(fogFar);
      uniforms.uFogFar.value = fogFar;
      uniforms.uFadeFrom.value = fadeFrom(fogFar);
      uniforms.uHaze.value.copy(haze);
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
