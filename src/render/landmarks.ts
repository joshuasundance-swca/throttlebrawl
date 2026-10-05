// Landmarks (playtest 3, round 1: "real landmarks"; "Duval St, downtown Portland, Golden Gate"; the
// critic's C8: one landmark system). A road file's `landmark` feature names a node of a landmark kit
// (`<asset id>#<node>`, models.ts) and a footprint; this layer draws each one where its footprint
// stands on the road, and nothing else: the sim ignores them.
//
// Drawing, for the phone's budget (the plan caps the whole view at 3 landmark draws and aims for 1):
// every landmark of a network is built into ONE vertex-coloured mesh, so a view of any number of
// them costs one draw call. Each landmark is cut into pieces (a tower, a deck bay, a stretch of
// cable), and each piece carries its levels of detail as runs of the mesh's own vertices. As the
// camera moves (every LANDMARK_REFILL_M) the index buffer is refilled with the run each piece shows
// at its distance, so a level of detail is a draw range, never a second mesh:
//   - near (within LANDMARK_NEAR_M of the piece): the full model;
//   - mid (out to LANDMARK_MID_M, just past the camera's far plane): the kit's `_lod1` node, or
//     `far_<node>`, swapped in past a feature's `farM`; a kit with neither keeps its one node;
//   - past LANDMARK_MID_M: nothing. The far bridge is the backdrop's silhouette.
// A feature whose kit or node is missing draws nothing (never a placeholder box in a public build).
//
// The Golden Gate is composed in code from the kit's pieces (`golden-gate#gg_bridge`, a virtual node;
// COMPOSITES): the two towers, a bay of the deck's edge every 15.24 m, the anchorages, and the main
// cables, which are code-made tubes along the catenary from tower top to tower top and down to the
// anchorages, because their shape follows the deck the road lane bakes. Presentation only. This is a
// lazy chunk: it loads with a region's race, never in the first load.
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Group,
  Matrix3,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  Vector3,
} from 'three';
import { landmarkParams, type BakedFeature, type LandmarkParams, type RoadNetwork } from '../road';
import { fredSoup, FRED, type Soup } from './fred';
import type { LookStyle } from './look';
import { islandSoup, pigeonKeyPlan, PIGEON_KEY } from './pigeon-key';
import {
  LANDMARK_KITS,
  LANDMARK_ROLE_PALETTE,
  parseLandmarkModel,
  type LandmarkKit,
  type LandmarkKitId,
  type LandmarkNode,
} from './models';
import { placeSurface, type PlacedSurface } from './text-surfaces';

export { loadLandmarkKits } from './models';
export type { LandmarkKit, LandmarkKitId } from './models';

/** A piece draws its full model within this far of the camera, m. [default] (assets plan, P1) */
export const LANDMARK_NEAR_M = 600;
/**
 * Past this a piece draws nothing, m. [default] The camera's far plane is 760 m (render/index.ts
 * CAMERA_FAR_M), so a piece any farther is clipped; the plan's 2,000 m would only cost the perf
 * gate's triangle count. The far bridge past it is the backdrop's silhouette.
 */
export const LANDMARK_MID_M = 820;
/** The levels of detail refill when the camera has moved this far, m. */
export const LANDMARK_REFILL_M = 20;

/** The code-made suspension bridge's numbers. [default] (the real figures where there are any) */
export const SUSPENSION = {
  /** A side span, tower to anchorage, m (the Golden Gate's 343 m). */
  sideSpanM: 343,
  /** One deck-edge bay, m, when the kit's bay does not say (`bay_m`; the suspenders' 50 ft). */
  bayM: 15.24,
  /** How far above the deck the main cable's lowest point hangs, m. */
  midClearM: 3,
  /** A side span's cable sags this share of its length. */
  sideSag: 0.015,
  /** Where a cable enters its anchorage above the anchorage's origin, m, when the kit does not say. */
  entryM: 4,
  /** Cable segments on the main span near and mid, and on each side span, and the sides of a tube. */
  mainNear: 64,
  mainMid: 12,
  sideNear: 32,
  sideMid: 6,
  sides: 6,
  /** A cable's radius near, and mid (thicker, so it still shows), m. */
  radiusNear: 0.5,
  radiusMid: 0.8,
  /** A cable is cut into pieces about this long, so each picks its own level of detail, m. */
  pieceM: 160,
  /**
   * The suspender ropes (playtest 4, P1: "no suspender ropes"): one hangs from each main cable down to
   * the deck's edge at every bay, a 3-sided tube of this radius near and mid (thicker, so it still
   * shows), in the cable's own mesh, so they cost no draw call. A rope shorter than `ropeMinM` is left
   * out (where the cable meets the deck or a tower's leg), and the ropes are cut into pieces of
   * `ropesPerPiece` bays so each picks its own level of detail.
   */
  ropeRadiusNear: 0.14,
  /** A rope draws thin out to `ropeNearM`, thicker to `ropeMidM`, and not at all past it (the cables and towers carry the bridge there), m. */
  ropeNearM: 200,
  ropeMidM: 500,
  ropeRadiusMid: 0.32,
  ropeSides: 3,
  ropeMinM: 1.5,
  ropeTowerClearM: 12,
  ropesPerPiece: 8,
  /** Where a rope's foot meets the deck: this far over the deck top (the railing's rail), m. */
  ropeFootM: 1.1,
} as const;

/** The paint of a landmark bridge when the region's palette has no `bridgePaint`: International Orange. */
const BRIDGE_PAINT = '#c0452f';

/**
 * Neon (playtest 4, P1; the wave C check: "the neon salmon is a thin dark outline"). A vertex of a node
 * whose material role is in `GLOW_ROLES` is not drawn with the lit mesh: it goes to a second mesh, drawn
 * unlit and additive, as a bright `core` of the model's own tube and a `halo` shell stood `shellM` out
 * from it along its normals, at `haloGain` of the halo's colour, so the stroke reads as light, not as a
 * dark line against a dusk sky. One more draw call, only while a glowing landmark is in range. [default]
 */
export const GLOW_ROLES: Readonly<Record<string, { core: string; halo: string }>> = {
  neon: { core: '#ffa6d2', halo: '#ff2d8f' },
};
export const GLOW = { shellM: 0.45, haloGain: 0.45 } as const;

/**
 * A rain cloud over a landmark (playtest 4, P1; the wave C check: Pioneer Courthouse Square "reads as a low
 * brick strip", not "a square under a rain cloud"). The square's model is a hand's breadth of paving under
 * a 5 m weather column, and the land the road draws caps its scale at about 0.45, so from the road it is
 * all but flat. A feature that says `params.cloudM` (a height over its ground, m) gets a cloud of flat
 * grey blobs that high over its middle and a curtain of rain falling from it, code-made into the same
 * mesh (no draw call): the cloud shows above the street's roofline from down the road, the rain says
 * what it is. [default]
 */
export const RAIN_CLOUD = {
  /** The blobs: [x, y over the cloud's base, z, half-width x, half-height, half-width z] about the middle, m. */
  blobs: [
    [-6, 0.4, 2, 6.5, 2.4, 5.5],
    [0, 1.2, 0, 8.5, 3.2, 6.5],
    [6.5, 0.2, -1.5, 6, 2.4, 5],
    [-1.5, 0.6, -6, 5.5, 2.2, 4.5],
    [2, 0.8, 6, 5.5, 2.4, 4.5],
  ],
  cloud: '#808a92',
  rain: '#bcd3de',
  /** The rain: streaks on a grid this far apart, each this wide, jittered, and falling to this far over the ground, m. */
  streakPitchM: 3.2,
  streakWidthM: 0.12,
  streakEndM: 0.6,
  /** The cloud and its rain draw within these, m (the rain is too thin to see far out). */
  cloudDrawM: LANDMARK_MID_M,
  rainDrawM: 320,
} as const;

/** A run of a mesh's vertices (a triangle list) that one level of a piece draws. */
interface Run {
  v0: number;
  n: number;
}
/**
 * A level of detail: shown while the piece is no farther than `maxM`. Levels run nearest first. `glow`
 * is the run of the glow mesh's vertices the level also draws (a node's neon), if it has any.
 */
interface Tier extends Run {
  maxM: number;
  glow?: Run | null;
}
/** One thing that picks its level by distance: where it stands, how big, and its levels. */
interface Piece {
  x: number;
  z: number;
  r: number;
  tiers: Tier[];
}

/** One `landmark` feature as the road puts it in the world. */
export interface LandmarkPlacement {
  feature: BakedFeature;
  edge: number;
  kit: LandmarkKitId;
  node: string;
  params: LandmarkParams;
  /** Where the node's origin stands, in world metres. */
  x: number;
  y: number;
  z: number;
  /** Turn about the vertical (radians): the road's heading at the centre plus the feature's `yawDeg`. */
  yaw: number;
  scale: number;
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const num = (f: BakedFeature, key: string, fallback: number): number => {
  const v = f.params?.[key];
  return finite(v) && v > 0 ? v : fallback;
};

/** The model's local +Z lies along the road's +s; the angle about Y that turns +Z onto (tx, tz). */
const headingOf = (tx: number, tz: number): number => Math.atan2(tx, tz);

/**
 * Every landmark feature of a network that names a node of a known kit, placed: its origin at the
 * footprint's centre, its +Z along the road. Its height is the road's surface there, or
 * `params.baseY` (world metres) when it says so: a tower that rises from the water says 0. Features
 * that name no model, or a kit this build does not know, are left out.
 */
export function landmarkPlacements(road: RoadNetwork): LandmarkPlacement[] {
  const out: LandmarkPlacement[] = [];
  for (const e of road.edges) {
    for (const feature of road.featuresOf(e.index, 'landmark')) {
      const params = landmarkParams(feature);
      const model = parseLandmarkModel(params.model);
      if (!model) continue;
      const s = (feature.s0 + feature.s1) / 2;
      const d = (feature.d0 + feature.d1) / 2;
      const at = road.toWorld(e.index, s, d, 0);
      const frame = road.frameAt(e.index, s);
      const baseY = feature.params?.['baseY'];
      out.push({
        feature,
        edge: e.index,
        kit: model.kit,
        node: model.node,
        params,
        x: at.x,
        y: finite(baseY) ? baseY : at.y,
        z: at.z,
        yaw: headingOf(frame.tx, frame.tz) + (params.yawDeg * Math.PI) / 180,
        scale: params.scale,
      });
    }
  }
  return out;
}

/** The kits a network's landmark features name, so a race fetches only those. */
export function landmarkKitsFor(road: RoadNetwork): LandmarkKitId[] {
  const names = new Set(landmarkPlacements(road).map((p) => p.kit));
  return LANDMARK_KITS.filter((k) => names.has(k));
}

/**
 * Circles that cover the landmarks' footprints on the ground, for the roadside layers to keep off
 * (`reserved`, as the staged scenes give). A structure the road runs through or under (`overRoad`)
 * stands on the road or in the water and takes no ground.
 */
export function landmarkFootprints(road: RoadNetwork): { x: number; z: number; r: number }[] {
  const out: { x: number; z: number; r: number }[] = [];
  for (const e of road.edges) {
    for (const f of road.featuresOf(e.index, 'landmark')) {
      if (landmarkParams(f).overRoad || !parseLandmarkModel(landmarkParams(f).model)) continue;
      const along = f.s1 - f.s0;
      const across = Math.abs(f.d1 - f.d0);
      if (!(along > 0) || !(across > 0)) continue;
      const lengthwise = along >= across;
      const long = Math.max(along, across);
      const short = Math.min(along, across);
      const n = Math.min(12, Math.max(1, Math.ceil(long / short)));
      const cell = long / n;
      const r = Math.hypot(cell / 2, short / 2);
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) * cell;
        const p = lengthwise
          ? road.toWorld(e.index, f.s0 + t, (f.d0 + f.d1) / 2, 0)
          : road.toWorld(e.index, (f.s0 + f.s1) / 2, Math.min(f.d0, f.d1) + t, 0);
        out.push({ x: p.x, z: p.z, r });
      }
    }
  }
  return out;
}

/** A cable's points: the straight line from `a` to `b`, hung `sagM` below its middle (a parabola). */
export function cablePoints(a: Vector3, b: Vector3, sagM: number, segments: number): Vector3[] {
  return cableRange(a, b, sagM, 0, 1, segments);
}

/** The part of that cable between u0 and u1 (0 at `a`, 1 at `b`), in `segments` steps. */
function cableRange(
  a: Vector3,
  b: Vector3,
  sagM: number,
  u0: number,
  u1: number,
  segments: number,
): Vector3[] {
  const out: Vector3[] = [];
  for (let i = 0; i <= segments; i++) {
    const u = u0 + ((u1 - u0) * i) / segments;
    const p = a.clone().lerp(b, u);
    p.y -= sagM * 4 * u * (1 - u);
    out.push(p);
  }
  return out;
}

/** Builds one vertex-coloured triangle soup, and hands back the run each added part took. */
export class MeshBuilder {
  readonly pos: number[] = [];
  readonly nrm: number[] = [];
  readonly col: number[] = [];
  private readonly p = new Vector3();
  private readonly n = new Vector3();
  private readonly c = new Color();

  get vertices(): number {
    return this.pos.length / 3;
  }

  /** Where the vertices of a glowing role go (a second builder), or null: the node's neon stays in the lit mesh. */
  glow: MeshBuilder | null = null;

  /**
   * A kit node under `m`, its roles named in `paint` recoloured. With a `glow` builder, the vertices of a
   * `GLOW_ROLES` role go there instead (core, then halo shell); the run says where in `glow` they went.
   */
  addNode(node: LandmarkNode, m: Matrix4, paint: ReadonlyMap<string, Color>): Run & { glow: Run | null } {
    const v0 = this.vertices;
    const g = node.geometry;
    const pos = g.getAttribute('position');
    const nrm = g.getAttribute('normal');
    const col = g.getAttribute('color');
    const nm = new Matrix3().getNormalMatrix(m);
    const roleOf = new Map<number, Color>();
    const glowOf = new Map<number, { core: Color; halo: Color }>();
    for (const run of node.roles) {
      const c = paint.get(run.role);
      if (c) for (let i = run.start; i < run.start + run.count; i++) roleOf.set(i, c);
      const lit = this.glow ? GLOW_ROLES[run.role] : undefined;
      if (lit) {
        const colours = {
          core: new Color(lit.core),
          halo: new Color(lit.halo).multiplyScalar(GLOW.haloGain),
        };
        for (let i = run.start; i < run.start + run.count; i++) glowOf.set(i, colours);
      }
    }
    const glowStart = this.glow?.vertices ?? 0;
    const lifted: number[] = [];
    for (let i = 0; i < pos.count; i++) {
      this.p.fromBufferAttribute(pos, i).applyMatrix4(m);
      this.n.fromBufferAttribute(nrm, i).applyMatrix3(nm).normalize();
      const lit = glowOf.get(i);
      if (lit && this.glow) {
        this.glow.pos.push(this.p.x, this.p.y, this.p.z);
        this.glow.nrm.push(this.n.x, this.n.y, this.n.z);
        this.glow.col.push(lit.core.r, lit.core.g, lit.core.b);
        lifted.push(i);
        continue;
      }
      this.pos.push(this.p.x, this.p.y, this.p.z);
      this.nrm.push(this.n.x, this.n.y, this.n.z);
      const c = roleOf.get(i);
      if (c) this.col.push(c.r, c.g, c.b);
      else this.col.push(col.getX(i), col.getY(i), col.getZ(i));
    }
    // The halo: the same triangles stood out along their normals, dimmer.
    if (this.glow) {
      for (const i of lifted) {
        this.p.fromBufferAttribute(pos, i).applyMatrix4(m);
        this.n.fromBufferAttribute(nrm, i).applyMatrix3(nm).normalize();
        const lit = glowOf.get(i);
        if (!lit) continue;
        this.glow.pos.push(
          this.p.x + this.n.x * GLOW.shellM,
          this.p.y + this.n.y * GLOW.shellM,
          this.p.z + this.n.z * GLOW.shellM,
        );
        this.glow.nrm.push(this.n.x, this.n.y, this.n.z);
        this.glow.col.push(lit.halo.r, lit.halo.g, lit.halo.b);
      }
    }
    const glowN = (this.glow?.vertices ?? 0) - glowStart;
    return { v0, n: this.vertices - v0, glow: glowN > 0 ? { v0: glowStart, n: glowN } : null };
  }

  /** One flat-shaded triangle, counter-clockwise from outside. */
  private tri(a: Vector3, b: Vector3, c: Vector3, colour: Color): void {
    const n = this.n.subVectors(b, a).cross(this.p.subVectors(c, a)).normalize();
    for (const v of [a, b, c]) {
      this.pos.push(v.x, v.y, v.z);
      this.nrm.push(n.x, n.y, n.z);
      this.col.push(colour.r, colour.g, colour.b);
    }
  }

  /** A flattened icosahedron (20 flat triangles) about `centre`, `rx`, `ry`, `rz` across: a low-poly blob. */
  addBlob(centre: Vector3, rx: number, ry: number, rz: number, colour: Color): Run {
    const v0 = this.vertices;
    const t = (1 + Math.sqrt(5)) / 2;
    const corners: [number, number, number][] = [
      [-1, t, 0],
      [1, t, 0],
      [-1, -t, 0],
      [1, -t, 0],
      [0, -1, t],
      [0, 1, t],
      [0, -1, -t],
      [0, 1, -t],
      [t, 0, -1],
      [t, 0, 1],
      [-t, 0, -1],
      [-t, 0, 1],
    ];
    const v = corners.map(([x, y, z]) => {
      const l = Math.hypot(x, y, z);
      return new Vector3(centre.x + (x / l) * rx, centre.y + (y / l) * ry, centre.z + (z / l) * rz);
    });
    const faces = [
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
    ] as const;
    for (const [a, b, c] of faces) this.tri(v[a] as Vector3, v[b] as Vector3, v[c] as Vector3, colour);
    return { v0, n: this.vertices - v0 };
  }

  /** An axis-aligned box from `lo` to `hi`: 12 flat triangles, outward. */
  addBox(lo: Vector3, hi: Vector3, colour: Color): Run {
    const v0 = this.vertices;
    const p = (x: number, y: number, z: number) => new Vector3(x, y, z);
    const quad = (a: Vector3, b: Vector3, c: Vector3, d: Vector3) => {
      this.tri(a, b, c, colour);
      this.tri(a, c, d, colour);
    };
    const [x0, y0, z0] = [lo.x, lo.y, lo.z];
    const [x1, y1, z1] = [hi.x, hi.y, hi.z];
    quad(p(x1, y0, z1), p(x1, y0, z0), p(x1, y1, z0), p(x1, y1, z1));
    quad(p(x0, y0, z0), p(x0, y0, z1), p(x0, y1, z1), p(x0, y1, z0));
    quad(p(x0, y0, z1), p(x1, y0, z1), p(x1, y1, z1), p(x0, y1, z1));
    quad(p(x1, y0, z0), p(x0, y0, z0), p(x0, y1, z0), p(x1, y1, z0));
    quad(p(x0, y1, z1), p(x1, y1, z1), p(x1, y1, z0), p(x0, y1, z0));
    quad(p(x0, y0, z0), p(x1, y0, z0), p(x1, y0, z1), p(x0, y0, z1));
    return { v0, n: this.vertices - v0 };
  }

  /** A code-made triangle soup (fred.ts) under `m`: positions and normals turned, colours as made. */
  addSoup(soup: Soup, m: Matrix4): Run {
    const v0 = this.vertices;
    const nm = new Matrix3().getNormalMatrix(m);
    for (let i = 0; i < soup.pos.length; i += 3) {
      this.p.set(soup.pos[i] ?? 0, soup.pos[i + 1] ?? 0, soup.pos[i + 2] ?? 0).applyMatrix4(m);
      this.n
        .set(soup.nrm[i] ?? 0, soup.nrm[i + 1] ?? 0, soup.nrm[i + 2] ?? 0)
        .applyMatrix3(nm)
        .normalize();
      this.pos.push(this.p.x, this.p.y, this.p.z);
      this.nrm.push(this.n.x, this.n.y, this.n.z);
      this.col.push(soup.col[i] ?? 0, soup.col[i + 1] ?? 0, soup.col[i + 2] ?? 0);
    }
    return { v0, n: this.vertices - v0 };
  }

  /**
   * A tube along `pts`: `sides` faces round, outward winding, open at its ends (a tower or an
   * anchorage covers them).
   */
  addTube(pts: readonly Vector3[], radius: number, sides: number, colour: Color): Run {
    const v0 = this.vertices;
    const rings: { p: Vector3; o: Vector3[] }[] = [];
    const up = new Vector3(0, 1, 0);
    pts.forEach((p, i) => {
      const t = (pts[Math.min(pts.length - 1, i + 1)] ?? p)
        .clone()
        .sub(pts[Math.max(0, i - 1)] ?? p)
        .normalize();
      const u = new Vector3().crossVectors(t, Math.abs(t.y) > 0.99 ? new Vector3(1, 0, 0) : up).normalize();
      const v = new Vector3().crossVectors(t, u);
      const o: Vector3[] = [];
      for (let k = 0; k < sides; k++) {
        const phi = (k / sides) * Math.PI * 2;
        o.push(u.clone().multiplyScalar(Math.cos(phi)).addScaledVector(v, Math.sin(phi)));
      }
      rings.push({ p, o });
    });
    const push = (ring: { p: Vector3; o: Vector3[] }, k: number) => {
      const o = ring.o[k % sides] as Vector3;
      this.pos.push(ring.p.x + o.x * radius, ring.p.y + o.y * radius, ring.p.z + o.z * radius);
      this.nrm.push(o.x, o.y, o.z);
      this.col.push(colour.r, colour.g, colour.b);
    };
    for (let i = 0; i + 1 < rings.length; i++) {
      const a = rings[i] as (typeof rings)[number];
      const b = rings[i + 1] as (typeof rings)[number];
      for (let k = 0; k < sides; k++) {
        push(a, k);
        push(a, k + 1);
        push(b, k);
        push(a, k + 1);
        push(b, k + 1);
        push(b, k);
      }
    }
    return { v0, n: this.vertices - v0 };
  }
}

/** What a composite needs to build its pieces. */
interface Compose {
  road: RoadNetwork;
  at: LandmarkPlacement;
  kit: LandmarkKit;
  builder: MeshBuilder;
  paint: ReadonlyMap<string, Color>;
  /** The colour of the code-made parts: the palette's `bridgePaint`, or International Orange. */
  paintColour: Color;
}

const matrixAt = (x: number, y: number, z: number, yaw: number, scale = 1): Matrix4 =>
  new Matrix4().compose(
    new Vector3(x, y, z),
    new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw),
    new Vector3(scale, scale, scale),
  );

const radiusOf = (node: LandmarkNode, scale: number): number => {
  const g = node.geometry;
  if (!g.boundingSphere) g.computeBoundingSphere();
  return (g.boundingSphere?.radius ?? 1) * scale;
};

/**
 * The tiers of a piece with a near node and (maybe) a lighter one: the near node out to `nearM`, the
 * lighter one to LANDMARK_MID_M. Without a lighter node the near one holds to LANDMARK_MID_M.
 */
function tiersOf(
  b: MeshBuilder,
  m: Matrix4,
  paint: ReadonlyMap<string, Color>,
  near: LandmarkNode | undefined,
  far: LandmarkNode | undefined,
  nearM: number,
): Tier[] {
  const tiers: Tier[] = [];
  if (near && far && near !== far) {
    tiers.push({ maxM: nearM, ...b.addNode(near, m, paint) });
    tiers.push({ maxM: LANDMARK_MID_M, ...b.addNode(far, m, paint) });
  } else if (near ?? far) {
    tiers.push({ maxM: LANDMARK_MID_M, ...b.addNode((near ?? far) as LandmarkNode, m, paint) });
  }
  return tiers;
}

/** The suspension bridge: `golden-gate#gg_bridge` (see the header). Null draws nothing. */
function suspensionBridge(c: Compose): Piece[] | null {
  const { road, at, kit, builder, paint, paintColour } = c;
  const f = at.feature;
  const e = at.edge;
  const side = num(f, 'sideSpanM', SUSPENSION.sideSpanM);
  const mainM = f.s1 - f.s0 - 2 * side;
  const tower0 = kit.nodes.get('gg_tower_lod0') ?? kit.nodes.get('gg_tower_lod1');
  if (!(mainM > 0) || !tower0) return null;
  const tower1 = kit.nodes.get('gg_tower_lod1');
  const given = f.params?.['baseY'];
  const baseY = finite(given) ? given : 0;
  const pieces: Piece[] = [];
  const at2 = (s: number, d: number) => road.toWorld(e, s, d, 0);
  const yawAt = (s: number) => {
    const fr = road.frameAt(e, s);
    return headingOf(fr.tx, fr.tz);
  };

  // The towers: their origin is at the waterline under the tower's centre, the deck between the legs.
  const sT = [f.s0 + side, f.s1 - side] as const;
  const towerM = sT.map((s) => {
    const p = at2(s, 0);
    return matrixAt(p.x, baseY, p.z, yawAt(s));
  });
  towerM.forEach((m, i) => {
    const p = at2(sT[i] as number, 0);
    pieces.push({
      x: p.x,
      z: p.z,
      r: radiusOf(tower0, 1),
      tiers: tiersOf(builder, m, paint, kit.nodes.get('gg_tower_lod0'), tower1, LANDMARK_NEAR_M),
    });
  });

  // The deck's edge, one bay at a time: y = 0 is the deck top, and the bay runs along +Z.
  const bayNear = kit.nodes.get('gg_bay_lod0');
  const bayFar = kit.nodes.get('gg_bay_lod1');
  const bayM = (bayNear ?? bayFar)?.extras['bay_m'] ?? SUSPENSION.bayM;
  if (bayNear ?? bayFar) {
    const count = Math.floor((f.s1 - f.s0) / bayM);
    for (let i = 0; i < count; i++) {
      const s = f.s0 + i * bayM;
      const p = at2(s, 0);
      const mid = at2(s + bayM / 2, 0);
      pieces.push({
        x: mid.x,
        z: mid.z,
        r: bayM / 2 + 20,
        tiers: tiersOf(
          builder,
          matrixAt(p.x, p.y, p.z, yawAt(s + bayM / 2)),
          paint,
          bayNear,
          bayFar,
          LANDMARK_NEAR_M,
        ),
      });
    }
  }

  // The anchorages: the origin is where the cable enters, on the centreline at deck-top height, the
  // block behind it (-Z) and the span ahead (+Z); the far end is turned round to face the span.
  const anchor = kit.nodes.get('gg_anchorage');
  const anchorM = [f.s0, f.s1].map((s, i) => {
    const p = at2(s, 0);
    return matrixAt(p.x, p.y, p.z, yawAt(s) + (i === 0 ? 0 : Math.PI));
  });
  if (anchor) {
    anchorM.forEach((m, i) => {
      const p = at2(i === 0 ? f.s0 : f.s1, 0);
      pieces.push({
        x: p.x,
        z: p.z,
        r: radiusOf(anchor, 1),
        tiers: tiersOf(builder, m, paint, anchor, undefined, LANDMARK_NEAR_M),
      });
    });
  }

  // The main cables: two, each hung from a saddle on each tower's top, down to an anchorage at each end.
  // Each is three parabolas: the side span from its anchorage entry to a saddle, the main span between
  // the saddles, and the other side span down to its entry.
  const top = tower0.extras['top_m'];
  const saddleX = tower0.extras['cable_saddle_x_m'];
  interface CableSpan {
    a: Vector3;
    b: Vector3;
    sag: number;
  }
  const cables: { sigma: number; spans: [CableSpan, CableSpan, CableSpan] }[] = [];
  if (finite(top) && finite(saddleX)) {
    const entry = anchor?.extras['cable_entry_m'] ?? SUSPENSION.entryM;
    const deckMid = at2((sT[0] + sT[1]) / 2, 0).y;
    for (const sigma of [-1, 1]) {
      const saddle = towerM.map((m) => new Vector3(sigma * saddleX, top, 0).applyMatrix4(m));
      const end = anchorM.map((m, i) =>
        new Vector3((i === 0 ? sigma : -sigma) * saddleX, entry, 0).applyMatrix4(m),
      );
      const [t0, t1] = saddle as [Vector3, Vector3];
      const [a0, a1] = end as [Vector3, Vector3];
      const mainSag = Math.max(1, (t0.y + t1.y) / 2 - (deckMid + SUSPENSION.midClearM));
      cables.push({
        sigma,
        spans: [
          { a: a0, b: t0, sag: a0.distanceTo(t0) * SUSPENSION.sideSag },
          { a: t0, b: t1, sag: mainSag },
          { a: t1, b: a1, sag: t1.distanceTo(a1) * SUSPENSION.sideSag },
        ],
      });
    }
  }
  const tubeSpan = (sp: CableSpan, near: number, mid: number) => {
    const pieceCount = Math.max(
      1,
      Math.round(Math.hypot(sp.b.x - sp.a.x, sp.b.z - sp.a.z) / SUSPENSION.pieceM),
    );
    const nearEach = Math.max(1, Math.round(near / pieceCount));
    const midEach = Math.max(1, Math.round(mid / pieceCount));
    for (let k = 0; k < pieceCount; k++) {
      const u0 = k / pieceCount;
      const u1 = (k + 1) / pieceCount;
      const nearPts = cableRange(sp.a, sp.b, sp.sag, u0, u1, nearEach);
      const midPts = cableRange(sp.a, sp.b, sp.sag, u0, u1, midEach);
      const first = nearPts[0] as Vector3;
      const last = nearPts[nearPts.length - 1] as Vector3;
      pieces.push({
        x: (first.x + last.x) / 2,
        z: (first.z + last.z) / 2,
        r: Math.hypot(last.x - first.x, last.z - first.z) / 2 + 2,
        tiers: [
          {
            maxM: LANDMARK_NEAR_M,
            ...builder.addTube(nearPts, SUSPENSION.radiusNear, SUSPENSION.sides, paintColour),
          },
          {
            maxM: LANDMARK_MID_M,
            ...builder.addTube(midPts, SUSPENSION.radiusMid, SUSPENSION.sides, paintColour),
          },
        ],
      });
    }
  };
  for (const { spans } of cables) {
    tubeSpan(spans[0], SUSPENSION.sideNear, SUSPENSION.sideMid);
    tubeSpan(spans[1], SUSPENSION.mainNear, SUSPENSION.mainMid);
    tubeSpan(spans[2], SUSPENSION.sideNear, SUSPENSION.sideMid);
  }

  // The suspender ropes: one at every bay from each cable down to the deck's edge, straight down from
  // the point of the cable above it (the cable is a parabola between its saddles and anchorage entries).
  if (cables.length > 0 && finite(saddleX) && (bayNear ?? bayFar)) {
    const count = Math.floor((f.s1 - f.s0) / bayM);
    for (let first = 0; first < count; first += SUSPENSION.ropesPerPiece) {
      const ropes: Vector3[][] = [];
      let sx = 0;
      let sz = 0;
      let ends = 0;
      const last = Math.min(count, first + SUSPENSION.ropesPerPiece);
      for (let i = first; i < last; i++) {
        const s = f.s0 + (i + 0.5) * bayM;
        const k = s < sT[0] ? 0 : s < sT[1] ? 1 : 2;
        if (Math.min(Math.abs(s - sT[0]), Math.abs(s - sT[1])) < SUSPENSION.ropeTowerClearM) continue;
        for (const { sigma, spans } of cables) {
          const span = spans[k];
          const foot = at2(s, -sigma * saddleX);
          const ab = span.b.clone().sub(span.a);
          const along =
            ((foot.x - span.a.x) * ab.x + (foot.z - span.a.z) * ab.z) / (ab.x * ab.x + ab.z * ab.z);
          const u = Math.min(1, Math.max(0, along));
          const cable = span.a.clone().lerp(span.b, u);
          cable.y -= span.sag * 4 * u * (1 - u);
          const bottom = new Vector3(cable.x, foot.y + SUSPENSION.ropeFootM, cable.z);
          if (cable.y - bottom.y < SUSPENSION.ropeMinM) continue;
          ropes.push([bottom, cable]);
          sx += cable.x;
          sz += cable.z;
          ends++;
        }
      }
      if (ends === 0) continue;
      const cx = sx / ends;
      const cz = sz / ends;
      let reach = 0;
      for (const [bottom] of ropes)
        reach = Math.max(reach, Math.hypot((bottom as Vector3).x - cx, (bottom as Vector3).z - cz));
      const runOf = (ropes: Vector3[][], radius: number): Run => {
        const v0 = builder.vertices;
        for (const rope of ropes) builder.addTube(rope, radius, SUSPENSION.ropeSides, paintColour);
        return { v0, n: builder.vertices - v0 };
      };
      pieces.push({
        x: cx,
        z: cz,
        r: reach + 2,
        tiers: [
          { maxM: SUSPENSION.ropeNearM, ...runOf(ropes, SUSPENSION.ropeRadiusNear) },
          { maxM: SUSPENSION.ropeMidM, ...runOf(ropes, SUSPENSION.ropeRadiusMid) },
        ],
      });
    }
  }
  return pieces;
}

/**
 * A rain cloud over a landmark (`RAIN_CLOUD`): flat grey blobs `baseM` over the feature's ground at its
 * middle, and a curtain of thin pale streaks falling from it to the ground. Two pieces, so the cloud
 * shows from far out and the rain only near.
 */
function rainCloud(b: MeshBuilder, at: LandmarkPlacement, baseM: number): Piece[] {
  const C = RAIN_CLOUD;
  const baseY = at.y + baseM;
  const cloudColour = new Color(C.cloud);
  const rainColour = new Color(C.rain);
  const v0 = b.vertices;
  for (const [x, y, z, rx, ry, rz] of C.blobs)
    b.addBlob(new Vector3(at.x + x, baseY + y, at.z + z), rx, ry, rz, cloudColour);
  const cloud: Run = { v0, n: b.vertices - v0 };
  // The curtain: a jittered grid inside the cloud's span, each streak from just over the ground up into the cloud.
  const r0 = b.vertices;
  const reachX = Math.max(...C.blobs.map(([x, , , rx]) => Math.abs(x) + rx)) * 0.8;
  const reachZ = Math.max(...C.blobs.map(([, , z, , , rz]) => Math.abs(z) + rz)) * 0.8;
  const hash = (i: number, j: number) => {
    const n = Math.sin(i * 127.1 + j * 311.7) * 43758.5453;
    return n - Math.floor(n);
  };
  const w = C.streakWidthM / 2;
  for (let i = -4; i <= 4; i++) {
    for (let j = -4; j <= 4; j++) {
      const x = i * C.streakPitchM + (hash(i, j) - 0.5) * C.streakPitchM * 0.8;
      const z = j * C.streakPitchM + (hash(j, i + 9) - 0.5) * C.streakPitchM * 0.8;
      if ((x / reachX) ** 2 + (z / reachZ) ** 2 > 1) continue;
      b.addBox(
        new Vector3(at.x + x - w, at.y + C.streakEndM, at.z + z - w),
        new Vector3(at.x + x + w, baseY + 0.5, at.z + z + w),
        rainColour,
      );
    }
  }
  const rain: Run = { v0: r0, n: b.vertices - r0 };
  const r = Math.max(reachX, reachZ) + 2;
  return [
    { x: at.x, z: at.z, r, tiers: [{ maxM: C.cloudDrawM, ...cloud }] },
    { x: at.x, z: at.z, r, tiers: [{ maxM: C.rainDrawM, ...rain }] },
  ];
}

/**
 * Fred the Tree (playtest 4, P4-15): `keys-landmarks#fred_the_tree`, the little pine on the old Seven
 * Mile Bridge, made in fred.ts. One piece with one level, drawn out to LANDMARK_MID_M; the kit only
 * has to be loaded (the composite reads none of its nodes), and he stands where the feature puts him.
 */
function fredTheTree(c: Compose): Piece[] {
  const { at, builder } = c;
  const m = matrixAt(at.x, at.y, at.z, at.yaw, at.scale);
  return [
    {
      x: at.x,
      z: at.z,
      r: FRED.radiusM * at.scale,
      tiers: [{ maxM: LANDMARK_MID_M, ...builder.addSoup(fredSoup(), m) }],
    },
  ];
}

/**
 * Pigeon Key (playtest 4, P4-19): `seven-mile-kit#pigeon_key`, the island under the old Seven Mile Bridge.
 * The island's ground and palms are code-made (pigeon-key.ts); the cottages and the dock are the kit's
 * nodes, set on it by `pigeonKeyPlan`. It stands on the sea (world y = 0), not on the deck, with its
 * cottages facing the road (the soup is built for a left-hand landmark; a right-hand one turns round).
 * One piece, one level, drawn out to LANDMARK_MID_M.
 */
function pigeonKey(c: Compose): Piece[] | null {
  const { at, kit, builder, paint } = c;
  const plan = pigeonKeyPlan(kit);
  if (!plan.buildings.some((b) => b.node === 'pigeon_key_cottage_a')) return null;
  const flip = at.feature.d0 + at.feature.d1 > 0 ? Math.PI : 0;
  const island = matrixAt(at.x, 0, at.z, at.yaw + flip);
  const v0 = builder.vertices;
  builder.addSoup(islandSoup(), island);
  for (const b of plan.buildings) {
    const node = kit.nodes.get(b.node);
    if (!node) continue;
    const local = matrixAt(b.x, b.baseY, b.z, b.yaw);
    builder.addNode(node, island.clone().multiply(local), paint);
  }
  return [
    {
      x: at.x,
      z: at.z,
      r: Math.hypot(PIGEON_KEY.semiAcrossM, PIGEON_KEY.semiAlongM) * at.scale,
      tiers: [{ maxM: LANDMARK_MID_M, v0, n: builder.vertices - v0 }],
    },
  ];
}

/** Virtual nodes composed in code, by `<kit>#<node>`. */
const COMPOSITES: Readonly<Record<string, (c: Compose) => Piece[] | null>> = {
  'golden-gate#gg_bridge': suspensionBridge,
  'keys-landmarks#fred_the_tree': fredTheTree,
  'seven-mile-kit#pigeon_key': pigeonKey,
};

export interface LandmarkCounts {
  /** Landmark features drawn (their kit and node loaded). */
  placed: number;
  /** Features left out: no model, an unknown or missing kit, a missing node. */
  skipped: number;
  pieces: number;
  /** Vertices in the one mesh, and triangles the last refill drew. */
  vertices: number;
  trianglesDrawn: number;
  /** Pieces drawn at their near level and at a lighter one, in the last refill. */
  nearPieces: number;
  farPieces: number;
  /** The draw call the layer costs: 1 while anything is in range, else 0. */
  drawCalls: number;
}

export interface LandmarkOptions {
  road: RoadNetwork;
  /** The race's region palette: `bridgePaint` repaints a bridge kit's `bridge_paint` role and its cables. */
  palette?: Readonly<Record<string, string>> | undefined;
}

/**
 * Every landmark of one road network, in one mesh (see the header). Built once per road; `update`
 * picks each piece's level for the camera.
 */
export class LandmarkLayer {
  readonly group = new Group();
  private readonly pieces: Piece[] = [];
  private readonly surfaceList: PlacedSurface[] = [];
  private readonly mesh: Mesh | null;
  private readonly geometry: BufferGeometry | null;
  private readonly live: Uint32Array;
  /** The glowing mesh (neon, `GLOW_ROLES`): unlit, additive, its own index. Null when no landmark glows. */
  private readonly glowMesh: Mesh | null = null;
  private readonly glowGeometry: BufferGeometry | null = null;
  private readonly glowLive: Uint32Array;
  private glowDrawn = 0;
  private glowMaterial: MeshBasicMaterial | null = null;
  private placed = 0;
  private skipped = 0;
  private drawn = 0;
  private nearPieces = 0;
  private farPieces = 0;
  private filledX = NaN;
  private filledZ = NaN;

  constructor(kits: ReadonlyMap<LandmarkKitId, LandmarkKit>, look: LookStyle, opts: LandmarkOptions) {
    this.group.name = 'landmarks';
    const builder = new MeshBuilder();
    const glowBuilder = new MeshBuilder();
    builder.glow = glowBuilder;
    const paint = new Map<string, Color>();
    for (const [role, key] of Object.entries(LANDMARK_ROLE_PALETTE)) {
      const hex = opts.palette?.[key];
      if (hex) paint.set(role, new Color(hex));
    }
    const paintColour = new Color(opts.palette?.['bridgePaint'] ?? BRIDGE_PAINT);
    let doubleSided = false;
    for (const at of landmarkPlacements(opts.road)) {
      const kit = kits.get(at.kit);
      if (!kit) {
        this.skipped++;
        continue;
      }
      const composite = COMPOSITES[`${at.kit}#${at.node}`];
      const made = composite
        ? composite({ road: opts.road, at, kit, builder, paint, paintColour })
        : this.single(builder, paint, kit, at);
      if (!made || made.length === 0) {
        this.skipped++;
        continue;
      }
      doubleSided ||= kit.doubleSided;
      this.placed++;
      this.pieces.push(...made);
    }
    this.live = new Uint32Array(builder.vertices);
    this.glowLive = new Uint32Array(glowBuilder.vertices);
    if (glowBuilder.vertices > 0) {
      // Shares nothing with the lit mesh but its pieces' levels: its own vertices and its own index.
      const gg = new BufferGeometry();
      gg.setAttribute('position', new Float32BufferAttribute(glowBuilder.pos, 3));
      gg.setAttribute('normal', new Float32BufferAttribute(glowBuilder.nrm, 3));
      gg.setAttribute('color', new Float32BufferAttribute(glowBuilder.col, 3));
      gg.setIndex(new BufferAttribute(this.glowLive, 1));
      gg.setDrawRange(0, 0);
      this.glowGeometry = gg;
      // An unlit material, copied so the additive blend never leaks into the look's shared one.
      const lit = look.material('glint', { vertexColors: true }).clone() as MeshBasicMaterial;
      lit.blending = AdditiveBlending;
      lit.transparent = true;
      lit.depthWrite = false;
      this.glowMaterial = lit;
      this.glowMesh = new Mesh(gg, lit);
      this.glowMesh.name = 'landmarks-glow';
      this.glowMesh.frustumCulled = false;
      this.glowMesh.visible = false;
    }
    if (builder.vertices === 0) {
      this.geometry = null;
      this.mesh = null;
      if (this.glowMesh) this.group.add(this.glowMesh);
      return;
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(builder.pos, 3));
    g.setAttribute('normal', new Float32BufferAttribute(builder.nrm, 3));
    g.setAttribute('color', new Float32BufferAttribute(builder.col, 3));
    // The index shares `live`, so a refill writes straight into what is uploaded.
    g.setIndex(new BufferAttribute(this.live, 1));
    g.setDrawRange(0, 0);
    this.geometry = g;
    this.mesh = new Mesh(g, look.material('prop', { vertexColors: true, doubleSided }));
    this.mesh.name = 'landmarks';
    // The index holds only what is in range, but the pieces span kilometres: never culled whole.
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.group.add(this.mesh);
    if (this.glowMesh) this.group.add(this.glowMesh);
  }

  /** One kit node as a piece: its near node, and the kit's lighter node past the feature's `farM`. */
  private single(
    b: MeshBuilder,
    paint: ReadonlyMap<string, Color>,
    kit: LandmarkKit,
    at: LandmarkPlacement,
  ): Piece[] | null {
    const near = kit.nodes.get(at.node) ?? kit.nodes.get(`${at.node}_lod0`);
    if (!near) return null;
    const base = at.node.replace(/_lod[01]$/, '');
    const far = kit.nodes.get(`${base}_lod1`) ?? kit.nodes.get(`far_${base}`);
    const m = matrixAt(at.x, at.y, at.z, at.yaw, at.scale);
    // Its blank boards (the roof sign's) are painted with pack text, by text-surfaces.ts.
    // A per-instance number (a mile post's) goes with each of its surfaces, for the sign's `{n}`.
    for (const surface of near.surfaces) {
      const placed = placeSurface(surface, m);
      if (at.params.number !== null) placed.number = at.params.number;
      this.surfaceList.push(placed);
    }
    const pieces: Piece[] = [
      {
        x: at.x,
        z: at.z,
        r: radiusOf(near, at.scale),
        tiers: tiersOf(b, m, paint, near, far, at.params.farM),
      },
    ];
    // A rain cloud over it, when the feature says how high (`params.cloudM`).
    const cloudM = num(at.feature, 'cloudM', 0);
    if (cloudM > 0) pieces.push(...rainCloud(b, at, cloudM));
    return pieces;
  }

  /** Refills the index with the level each piece shows at the camera; cheap, and only after it moved. */
  update(cameraX: number, cameraZ: number): void {
    if (!this.mesh && !this.glowMesh) return;
    if (Math.hypot(cameraX - this.filledX, cameraZ - this.filledZ) < LANDMARK_REFILL_M) return;
    this.filledX = cameraX;
    this.filledZ = cameraZ;
    let w = 0;
    let gw = 0;
    this.nearPieces = 0;
    this.farPieces = 0;
    for (const piece of this.pieces) {
      const d = Math.max(0, Math.hypot(piece.x - cameraX, piece.z - cameraZ) - piece.r);
      const level = piece.tiers.findIndex((t) => d <= t.maxM);
      const tier = piece.tiers[level];
      if (!tier) continue;
      if (level === 0) this.nearPieces++;
      else this.farPieces++;
      for (let k = 0; k < tier.n; k++) this.live[w++] = tier.v0 + k;
      if (tier.glow) for (let k = 0; k < tier.glow.n; k++) this.glowLive[gw++] = tier.glow.v0 + k;
    }
    this.drawn = w;
    this.glowDrawn = gw;
    if (this.geometry && this.mesh) {
      const index = this.geometry.getIndex();
      if (index) index.needsUpdate = true;
      this.geometry.setDrawRange(0, w);
      this.mesh.visible = w > 0;
    }
    if (this.glowGeometry && this.glowMesh) {
      const index = this.glowGeometry.getIndex();
      if (index) index.needsUpdate = true;
      this.glowGeometry.setDrawRange(0, gw);
      this.glowMesh.visible = gw > 0;
    }
  }

  counts(): LandmarkCounts {
    return {
      placed: this.placed,
      skipped: this.skipped,
      pieces: this.pieces.length,
      vertices: this.live.length,
      trianglesDrawn: (this.drawn + this.glowDrawn) / 3,
      nearPieces: this.nearPieces,
      farPieces: this.farPieces,
      drawCalls: (this.mesh?.visible ? 1 : 0) + (this.glowMesh?.visible ? 1 : 0),
    };
  }

  /**
   * The text surfaces of the placed landmarks (the roof sign's board), in the world, for the words of
   * their pack signs to be painted over (text-surfaces.ts). The blank panel stays in the mesh.
   */
  surfaces(): readonly PlacedSurface[] {
    return this.surfaceList;
  }

  /** Where each placed piece's levels begin and end, for tests: [maxM, triangles] per piece. */
  levels(): readonly (readonly [number, number][])[] {
    return this.pieces.map((p) => p.tiers.map((t) => [t.maxM, t.n / 3] as [number, number]));
  }

  dispose(): void {
    this.group.removeFromParent();
    this.geometry?.dispose();
    this.glowGeometry?.dispose();
    this.glowMaterial?.dispose();
  }
}
