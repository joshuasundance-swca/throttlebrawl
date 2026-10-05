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
  BufferAttribute,
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Group,
  Matrix3,
  Matrix4,
  Mesh,
  Quaternion,
  Vector3,
} from 'three';
import { landmarkParams, type BakedFeature, type LandmarkParams, type RoadNetwork } from '../road';
import type { LookStyle } from './look';
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
} as const;

/** The paint of a landmark bridge when the region's palette has no `bridgePaint`: International Orange. */
const BRIDGE_PAINT = '#c0452f';

/** A run of a mesh's vertices (a triangle list) that one level of a piece draws. */
interface Run {
  v0: number;
  n: number;
}
/** A level of detail: shown while the piece is no farther than `maxM`. Levels run nearest first. */
interface Tier extends Run {
  maxM: number;
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
class MeshBuilder {
  readonly pos: number[] = [];
  readonly nrm: number[] = [];
  readonly col: number[] = [];
  private readonly p = new Vector3();
  private readonly n = new Vector3();
  private readonly c = new Color();

  get vertices(): number {
    return this.pos.length / 3;
  }

  /** A kit node under `m`, its roles named in `paint` recoloured. */
  addNode(node: LandmarkNode, m: Matrix4, paint: ReadonlyMap<string, Color>): Run {
    const v0 = this.vertices;
    const g = node.geometry;
    const pos = g.getAttribute('position');
    const nrm = g.getAttribute('normal');
    const col = g.getAttribute('color');
    const nm = new Matrix3().getNormalMatrix(m);
    const roleOf = new Map<number, Color>();
    for (const run of node.roles) {
      const c = paint.get(run.role);
      if (c) for (let i = run.start; i < run.start + run.count; i++) roleOf.set(i, c);
    }
    for (let i = 0; i < pos.count; i++) {
      this.p.fromBufferAttribute(pos, i).applyMatrix4(m);
      this.n.fromBufferAttribute(nrm, i).applyMatrix3(nm).normalize();
      this.pos.push(this.p.x, this.p.y, this.p.z);
      this.nrm.push(this.n.x, this.n.y, this.n.z);
      const c = roleOf.get(i);
      if (c) this.col.push(c.r, c.g, c.b);
      else this.col.push(col.getX(i), col.getY(i), col.getZ(i));
    }
    return { v0, n: pos.count };
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
  const top = tower0.extras['top_m'];
  const saddleX = tower0.extras['cable_saddle_x_m'];
  if (finite(top) && finite(saddleX)) {
    const entry = anchor?.extras['cable_entry_m'] ?? SUSPENSION.entryM;
    const deckMid = at2((sT[0] + sT[1]) / 2, 0).y;
    for (const sigma of [-1, 1]) {
      const saddle = towerM.map((m) => new Vector3(sigma * saddleX, top, 0).applyMatrix4(m));
      const end = anchorM.map((m, i) =>
        new Vector3((i === 0 ? sigma : -sigma) * saddleX, entry, 0).applyMatrix4(m),
      );
      const span = (a: Vector3, b: Vector3, sag: number, near: number, mid: number) => {
        const pieceCount = Math.max(1, Math.round(Math.hypot(b.x - a.x, b.z - a.z) / SUSPENSION.pieceM));
        const nearEach = Math.max(1, Math.round(near / pieceCount));
        const midEach = Math.max(1, Math.round(mid / pieceCount));
        for (let k = 0; k < pieceCount; k++) {
          const u0 = k / pieceCount;
          const u1 = (k + 1) / pieceCount;
          const nearPts = cableRange(a, b, sag, u0, u1, nearEach);
          const midPts = cableRange(a, b, sag, u0, u1, midEach);
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
      const [t0, t1] = saddle as [Vector3, Vector3];
      const [a0, a1] = end as [Vector3, Vector3];
      const mainSag = Math.max(1, (t0.y + t1.y) / 2 - (deckMid + SUSPENSION.midClearM));
      span(t0, t1, mainSag, SUSPENSION.mainNear, SUSPENSION.mainMid);
      span(a0, t0, a0.distanceTo(t0) * SUSPENSION.sideSag, SUSPENSION.sideNear, SUSPENSION.sideMid);
      span(t1, a1, t1.distanceTo(a1) * SUSPENSION.sideSag, SUSPENSION.sideNear, SUSPENSION.sideMid);
    }
  }
  return pieces;
}

/** Virtual nodes composed in code, by `<kit>#<node>`. */
const COMPOSITES: Readonly<Record<string, (c: Compose) => Piece[] | null>> = {
  'golden-gate#gg_bridge': suspensionBridge,
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
    if (builder.vertices === 0) {
      this.geometry = null;
      this.mesh = null;
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
    for (const surface of near.surfaces) this.surfaceList.push(placeSurface(surface, m));
    return [
      {
        x: at.x,
        z: at.z,
        r: radiusOf(near, at.scale),
        tiers: tiersOf(b, m, paint, near, far, at.params.farM),
      },
    ];
  }

  /** Refills the index with the level each piece shows at the camera; cheap, and only after it moved. */
  update(cameraX: number, cameraZ: number): void {
    if (!this.mesh || !this.geometry) return;
    if (Math.hypot(cameraX - this.filledX, cameraZ - this.filledZ) < LANDMARK_REFILL_M) return;
    this.filledX = cameraX;
    this.filledZ = cameraZ;
    let w = 0;
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
    }
    this.drawn = w;
    const index = this.geometry.getIndex();
    if (index) index.needsUpdate = true;
    this.geometry.setDrawRange(0, w);
    this.mesh.visible = w > 0;
  }

  counts(): LandmarkCounts {
    return {
      placed: this.placed,
      skipped: this.skipped,
      pieces: this.pieces.length,
      vertices: this.live.length,
      trianglesDrawn: this.drawn / 3,
      nearPieces: this.nearPieces,
      farPieces: this.farPieces,
      drawCalls: this.mesh?.visible ? 1 : 0,
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
  }
}
