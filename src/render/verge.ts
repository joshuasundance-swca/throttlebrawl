// The ground beside the road as drawn (run W-R; interview, 2026-10-02: "Anywhere with ground";
// off-road as "a ground band beside most roads (dirt, sand, grass, gravel, kerbs; water, ferns and
// kerbs are the real edges; some fences smash)"). The sim lets a rider ride each verge band out to
// its edge (sim/riders/verge.ts); this layer shows that ground and what ends it, from the same
// road queries (`vergeAt`), so what is drawn is what is ridable:
// - the band itself, coloured by its surface (dirt, gravel, sand, grass, a city kerb and pavement),
//   merged per chunk into one vertex-coloured mesh;
// - its edge: a fence line in short panels that break where a rider smashes through (a white
//   picket in the Keys, a split-rail in the Pacific Northwest, a painted garden fence in San
//   Francisco), a row of ferns and bushes at a `brush` edge, and a strip of shallows past a `water`
//   edge; walls, buildings and rails are already drawn by the road and the scenery;
// - the feel: dust, sand spray, gravel and grass flung up behind a bike on loose ground, a splash at
//   the water's edge, leaves at the ferns, and boards flying when a fence goes.
// Presentation only: it reads the road, the snapshot and the events, and may use Math.random and
// wall-clock time (docs/architecture.md, "Rendering, Structure"). It loads lazily with the road.
import {
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  Quaternion,
  Vector3,
} from 'three';
import type { BakedVerge, RoadNetwork } from '../road';
import type { EntitySnapshot, GroundSurface, SimEvent, SimSnapshot } from '../sim/api';
import { mergeBoxes, type BoxPart, type Point3 } from './geometry';
import type { LookStyle } from './look';

type Surface = BakedVerge['surface'];
type Side = -1 | 1;

/** Metres between the band's samples along the road. [default] */
export const VERGE_STEP_M = 2;
/** The band sits under the road's own verge strip (-0.02) and over the land (-0.06 to -0.09), m. */
export const VERGE_LIFT_M = -0.045;
/** Square chunks the layer is merged and culled in, m. [default] */
export const VERGE_CHUNK_M = 128;
/** One fence panel's length along the road: what one smash breaks at the least, m. [default] */
export const FENCE_SEG_M = 2;
/** Metres between fern clumps along a `brush` edge. [default] */
const BRUSH_STEP_M = 3.5;
/** Fences and ferns are drawn out to this far from the camera (the band always), m. [default] */
export const VERGE_DRAW_M = 150;
/** The shallows drawn past a `water` edge where the band ends on land, m. */
const SHALLOWS_M = 2.5;
/** Below this width a band is not drawn (a road's own edge is its edge), m. */
const MIN_BAND_M = 0.05;

/** Each band surface's colour [default]: muted, so the road and the riders stay the loudest things. */
export const SURFACE_COLOUR: Readonly<Record<Surface, string>> = {
  shoulder: '#8a8170',
  dirt: '#8b6b4a',
  gravel: '#a29d92',
  sand: '#e3cf9f',
  grass: '#6f9650',
  kerb: '#c4beb3',
};
const SHALLOWS_COLOUR = '#5fb3ad';

/** What flies up behind a bike on each loose surface: colour, particles per second at 40 m/s, lift. */
const DUST: Readonly<Partial<Record<GroundSurface, { colour: string; rate: number; up: number }>>> = {
  dirt: { colour: '#a3825d', rate: 55, up: 1.6 },
  sand: { colour: '#efdcae', rate: 70, up: 2.2 },
  gravel: { colour: '#b9b3a7', rate: 40, up: 2.6 },
  grass: { colour: '#7faa58', rate: 22, up: 1.4 },
};

/** The fence a region builds: its panel's parts (local x along the road, y up, centred). */
export type FenceStyle = 'picket' | 'split-rail' | 'garden';

function fenceParts(style: FenceStyle): BoxPart[] {
  const half = FENCE_SEG_M / 2;
  if (style === 'picket') {
    const white = '#f3efe4';
    const parts: BoxPart[] = [
      { size: [FENCE_SEG_M, 0.07, 0.04], at: [0, 0.28, 0], color: white },
      { size: [FENCE_SEG_M, 0.07, 0.04], at: [0, 0.68, 0], color: white },
    ];
    for (let i = 0; i < 4; i++) {
      parts.push({ size: [0.1, 0.95, 0.03], at: [-half + 0.25 + i * 0.5, 0.47, 0.03], color: white });
    }
    return parts;
  }
  if (style === 'split-rail') {
    const wood = '#7d6248';
    const grey = '#8f8577';
    return [
      { size: [0.16, 1.1, 0.16], at: [-half + 0.08, 0.55, 0], color: grey },
      { size: [FENCE_SEG_M, 0.12, 0.1], at: [0, 0.45, 0], color: wood, rotX: 0.2 },
      { size: [FENCE_SEG_M, 0.12, 0.1], at: [0, 0.85, 0], color: wood, rotX: -0.15 },
    ];
  }
  const green = '#2f5b46';
  const parts: BoxPart[] = [
    { size: [FENCE_SEG_M, 0.06, 0.05], at: [0, 0.2, 0], color: green },
    { size: [FENCE_SEG_M, 0.06, 0.05], at: [0, 1.0, 0], color: green },
  ];
  for (let i = 0; i < 5; i++) {
    parts.push({ size: [0.06, 1.15, 0.06], at: [-half + 0.2 + i * 0.4, 0.58, 0], color: green });
  }
  return parts;
}

/** A clump of ferns: fronds fanned out from the middle (the sim's `brush` edge). */
function brushParts(colour: string, dark: string): BoxPart[] {
  const parts: BoxPart[] = [];
  for (let i = 0; i < 3; i++) {
    const turn = (i / 3) * Math.PI * 2;
    parts.push({
      size: [0.3, 0.06, 1.3],
      at: [Math.sin(turn) * 0.4, 0.4, Math.cos(turn) * 0.4],
      color: i === 0 ? dark : colour,
      rotX: 0.7,
      rotY: turn,
    });
  }
  return parts;
}

/** The fence a network builds, by its land: tropical pickets, city garden fences, forest split rails. */
export function fenceStyleFor(tags: ReadonlySet<string>): FenceStyle {
  if (['palms', 'beach', 'mangrove', 'swamp'].some((t) => tags.has(t))) return 'picket';
  if (['row-houses', 'painted-houses', 'gardens', 'warehouses', 'piers'].some((t) => tags.has(t)))
    return 'garden';
  return 'split-rail';
}

/** A run of vertex-coloured strips split into chunks (the band and the shallows). */
class ColourStrips {
  readonly chunks = new Map<string, { pos: number[]; col: number[]; idx: number[]; open: boolean }>();
  private last: [Point3, Point3] | null = null;
  private key = '';

  private part(key: string) {
    let p = this.chunks.get(key);
    if (!p) this.chunks.set(key, (p = { pos: [], col: [], idx: [], open: false }));
    return p;
  }

  private push(key: string, a: Point3, b: Point3, c: Color): void {
    const p = this.part(key);
    const k = p.pos.length / 3;
    p.pos.push(a.x, a.y, a.z, b.x, b.y, b.z);
    p.col.push(c.r, c.g, c.b, c.r, c.g, c.b);
    if (p.open) p.idx.push(k - 2, k - 1, k, k - 1, k + 1, k);
    p.open = true;
  }

  /** The next pair across the strip: `a` at the smaller d, `b` at the larger (the road's winding). */
  pair(a: Point3, b: Point3, c: Color): void {
    const key = chunkOf((a.x + b.x) / 2, (a.z + b.z) / 2);
    if (this.last && key !== this.key) {
      this.part(this.key).open = false;
      this.part(key).open = false;
      this.push(key, this.last[0], this.last[1], c);
    } else if (!this.last) this.part(key).open = false;
    this.push(key, a, b, c);
    this.key = key;
    this.last = [a, b];
  }

  breakStrip(): void {
    if (this.last) this.part(this.key).open = false;
    this.last = null;
  }

  build(key: string): BufferGeometry | null {
    const p = this.chunks.get(key);
    if (!p || p.idx.length === 0) return null;
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(p.pos, 3));
    g.setAttribute('color', new Float32BufferAttribute(p.col, 3));
    g.setIndex(p.idx);
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
}

export function chunkOf(x: number, z: number): string {
  return `${Math.floor(x / VERGE_CHUNK_M)},${Math.floor(z / VERGE_CHUNK_M)}`;
}

/** One fence panel as drawn: where it stands on the road, and its slot in its chunk's instances. */
interface FencePanel {
  edge: number;
  side: Side;
  s0: number;
  s1: number;
  mesh: InstancedMesh;
  index: number;
  /** World midpoint, for the boards. */
  at: Point3;
  broken: boolean;
}

interface Chunk {
  group: Group;
  x: number;
  z: number;
  /** Fences and ferns: hidden past VERGE_DRAW_M. */
  near: InstancedMesh[];
}

export interface VergeCounts {
  /** Metres of road side with a ground band drawn, by surface. */
  bandM: Readonly<Record<Surface, number>>;
  /** Metres of shallows drawn past `water` edges. */
  shallowsM: number;
  fencePanels: number;
  brokenPanels: number;
  brushClumps: number;
  /** Particles alive in the last frame: dust and spray, and flying boards. */
  particles: number;
  boards: number;
  /** Bursts started since the build, by kind (splash, leaves, boards). */
  bursts: Readonly<Record<'splash' | 'leaves' | 'boards', number>>;
  fenceStyle: FenceStyle;
}

const ZERO = new Matrix4().makeScale(0, 0, 0);

/** A pool of short-lived coloured particles in one instanced mesh; boards also tumble. */
class Pool {
  readonly mesh: InstancedMesh;
  private readonly p: Float32Array;
  private readonly v: Float32Array;
  private readonly c: Float32Array;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private readonly spin: Float32Array;
  private live = 0;
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly pos = new Vector3();
  private readonly scale = new Vector3();
  private readonly axis = new Vector3(1, 0.3, 0.2).normalize();
  private readonly colour = new Color();

  constructor(
    name: string,
    geometry: BufferGeometry,
    material: InstancedMesh['material'],
    private readonly capacity: number,
    private readonly gravity: number,
  ) {
    this.mesh = new InstancedMesh(geometry, material, capacity);
    this.mesh.name = name;
    this.mesh.count = 0;
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;
    this.p = new Float32Array(capacity * 3);
    this.v = new Float32Array(capacity * 3);
    this.c = new Float32Array(capacity * 3);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
    this.spin = new Float32Array(capacity);
  }

  get count(): number {
    return this.live;
  }

  spawn(at: Point3, v: Point3, life: number, colour: Color, spin = 0): void {
    const i = this.live < this.capacity ? this.live++ : Math.floor(Math.random() * this.capacity);
    const j = i * 3;
    this.p[j] = at.x;
    this.p[j + 1] = at.y;
    this.p[j + 2] = at.z;
    this.v[j] = v.x;
    this.v[j + 1] = v.y;
    this.v[j + 2] = v.z;
    this.c[j] = colour.r;
    this.c[j + 1] = colour.g;
    this.c[j + 2] = colour.b;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.spin[i] = spin;
  }

  update(dt: number): void {
    let w = 0;
    for (let i = 0; i < this.live; i++) {
      const life = (this.life[i] ?? 0) - dt;
      if (life <= 0) continue;
      const vy = (this.v[i * 3 + 1] ?? 0) - this.gravity * dt;
      let y = (this.p[i * 3 + 1] ?? 0) + vy * dt;
      const x = (this.p[i * 3] ?? 0) + (this.v[i * 3] ?? 0) * dt;
      const z = (this.p[i * 3 + 2] ?? 0) + (this.v[i * 3 + 2] ?? 0) * dt;
      const floor = this.p[i * 3 + 1] ?? 0;
      if (vy < 0 && y < floor - 3) y = floor - 3;
      if (w !== i) {
        this.v[w * 3] = this.v[i * 3] ?? 0;
        this.v[w * 3 + 2] = this.v[i * 3 + 2] ?? 0;
        this.c[w * 3] = this.c[i * 3] ?? 1;
        this.c[w * 3 + 1] = this.c[i * 3 + 1] ?? 1;
        this.c[w * 3 + 2] = this.c[i * 3 + 2] ?? 1;
        this.maxLife[w] = this.maxLife[i] ?? 1;
        this.spin[w] = this.spin[i] ?? 0;
      }
      this.v[w * 3 + 1] = vy;
      this.p[w * 3] = x;
      this.p[w * 3 + 1] = y;
      this.p[w * 3 + 2] = z;
      this.life[w] = life;
      const k = life / (this.maxLife[w] || 1);
      const spin = this.spin[w] ?? 0;
      if (spin !== 0) this.q.setFromAxisAngle(this.axis, spin * (1 - k) * 6);
      else this.q.identity();
      this.mesh.setMatrixAt(
        w,
        this.m.compose(this.pos.set(x, y, z), this.q, this.scale.setScalar(spin !== 0 ? 1 : 0.4 + 0.6 * k)),
      );
      this.colour.setRGB(this.c[w * 3] ?? 1, this.c[w * 3 + 1] ?? 1, this.c[w * 3 + 2] ?? 1);
      this.mesh.setColorAt(w, this.colour);
      w++;
    }
    this.live = w;
    this.mesh.count = w;
    this.mesh.visible = w > 0;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

export interface VergeOptions {
  /** The network's scenery tags (all of them): they pick the fence style and the fern colour. */
  tags: ReadonlySet<string>;
}

/** The ground band, its edges and their effects for one road network. */
export class VergeLayer {
  readonly group = new Group();
  readonly fenceStyle: FenceStyle;
  private readonly chunks = new Map<string, Chunk>();
  private readonly panels = new Map<number, FencePanel[]>();
  private readonly bandM: Record<Surface, number> = {
    shoulder: 0,
    dirt: 0,
    gravel: 0,
    sand: 0,
    grass: 0,
    kerb: 0,
  };
  private shallowsM = 0;
  private fencePanels = 0;
  private brokenPanels = 0;
  private brushClumps = 0;
  private readonly dust: Pool;
  private readonly boards: Pool;
  private readonly pending: SimEvent[] = [];
  private readonly emitAcc = new Map<number, number>();
  private readonly bursts = { splash: 0, leaves: 0, boards: 0 };
  private readonly tmp = new Color();
  private readonly fenceColour: Color;
  private readonly geometries: BufferGeometry[] = [];

  constructor(
    private readonly road: RoadNetwork,
    look: LookStyle,
    opts: VergeOptions,
  ) {
    this.group.name = 'verge';
    this.fenceStyle = fenceStyleFor(opts.tags);
    const forest = opts.tags.has('forest');
    this.fenceColour = new Color(
      this.fenceStyle === 'picket' ? '#f3efe4' : this.fenceStyle === 'split-rail' ? '#7d6248' : '#2f5b46',
    );
    const groundMat = look.material('land', { vertexColors: true });
    const propMat = look.material('prop', { vertexColors: true });
    const fenceGeo = mergeBoxes(fenceParts(this.fenceStyle));
    const brushGeo = mergeBoxes(forest ? brushParts('#3f6b3a', '#2a4a2c') : brushParts('#5c8a3c', '#3f6a2e'));
    const bitGeo = mergeBoxes([{ size: [0.12, 0.12, 0.12], at: [0, 0, 0], color: '#ffffff' }]);
    const boardGeo = mergeBoxes([{ size: [0.9, 0.1, 0.05], at: [0, 0, 0], color: '#ffffff' }]);
    this.geometries.push(fenceGeo, brushGeo, bitGeo, boardGeo);
    this.dust = new Pool('verge-dust', bitGeo, propMat, 240, 9.81);
    this.boards = new Pool('verge-boards', boardGeo, propMat, 48, 9.81);
    this.group.add(this.dust.mesh, this.boards.mesh);

    const strips = new ColourStrips();
    const shallows = new ColourStrips();
    const fences = new Map<string, { m: Matrix4; panel: Omit<FencePanel, 'mesh' | 'index'> }[]>();
    const brush = new Map<string, Matrix4[]>();
    const c = new Color();
    const q = new Quaternion();
    const up = new Vector3(0, 1, 0);
    const one = new Vector3(1, 1, 1);
    const p = new Vector3();
    for (const e of road.edges) {
      for (const side of [-1, 1] as const) {
        const name = side < 0 ? 'left' : 'right';
        // The band and the shallows: strips at VERGE_STEP_M.
        const n = Math.max(1, Math.ceil(e.length / VERGE_STEP_M));
        for (let i = 0; i <= n; i++) {
          const s = Math.min(e.length, i * VERGE_STEP_M);
          const v = road.vergeAt(e.index, s, name);
          if (v.widthM < MIN_BAND_M) {
            strips.breakStrip();
            shallows.breakStrip();
            continue;
          }
          const inner = road.toWorld(e.index, s, v.dInner, VERGE_LIFT_M);
          const outer = road.toWorld(e.index, s, v.dOuter, VERGE_LIFT_M);
          c.set(SURFACE_COLOUR[v.surface]);
          if (side < 0) strips.pair(outer, inner, c);
          else strips.pair(inner, outer, c);
          if (i > 0) this.bandM[v.surface] += VERGE_STEP_M;
          if (v.edge === 'water') {
            const far = road.toWorld(e.index, s, v.dOuter + side * SHALLOWS_M, VERGE_LIFT_M - 0.01);
            const near = road.toWorld(e.index, s, v.dOuter, VERGE_LIFT_M - 0.01);
            c.set(SHALLOWS_COLOUR);
            if (side < 0) shallows.pair(far, near, c);
            else shallows.pair(near, far, c);
            if (i > 0) this.shallowsM += VERGE_STEP_M;
          } else shallows.breakStrip();
        }
        strips.breakStrip();
        shallows.breakStrip();
        // The edge: fence panels and fern clumps along the band's outer edge.
        const list: FencePanel[] = this.panels.get(e.index) ?? [];
        for (let s0 = 0; s0 + FENCE_SEG_M <= e.length; s0 += FENCE_SEG_M) {
          const mid = s0 + FENCE_SEG_M / 2;
          const v = road.vergeAt(e.index, mid, name);
          if (v.widthM < MIN_BAND_M || v.edge !== 'fence') continue;
          const a = road.toWorld(e.index, s0, road.vergeAt(e.index, s0, name).dOuter, 0);
          const b = road.toWorld(
            e.index,
            s0 + FENCE_SEG_M,
            road.vergeAt(e.index, s0 + FENCE_SEG_M, name).dOuter,
            0,
          );
          const at = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 - 0.05, z: (a.z + b.z) / 2 };
          q.setFromAxisAngle(up, Math.atan2(-(b.z - a.z), b.x - a.x));
          const len = Math.hypot(b.x - a.x, b.z - a.z) / FENCE_SEG_M;
          const m = new Matrix4().compose(p.set(at.x, at.y, at.z), q, new Vector3(len, 1, 1));
          const key = chunkOf(at.x, at.z);
          const bucket = fences.get(key) ?? [];
          bucket.push({ m, panel: { edge: e.index, side, s0, s1: s0 + FENCE_SEG_M, at, broken: false } });
          fences.set(key, bucket);
        }
        this.panels.set(e.index, list);
        for (let s = BRUSH_STEP_M / 2; s < e.length; s += BRUSH_STEP_M) {
          const v = road.vergeAt(e.index, s, name);
          if (v.widthM < MIN_BAND_M || v.edge !== 'brush') continue;
          const k = hash(e.index, s, side);
          const at = road.toWorld(e.index, s + (k - 0.5) * 1.2, v.dOuter + side * (0.25 + k * 0.5), -0.05);
          q.setFromAxisAngle(up, k * Math.PI * 2);
          const size = 0.75 + hash(e.index, s, side * 3) * 0.6;
          const m = new Matrix4().compose(p.set(at.x, at.y, at.z), q, one.clone().multiplyScalar(size));
          const key = chunkOf(at.x, at.z);
          const bucket = brush.get(key) ?? [];
          bucket.push(m);
          brush.set(key, bucket);
          this.brushClumps++;
        }
      }
    }
    this.addStrips(strips, groundMat, 'verge-band');
    this.addStrips(shallows, groundMat, 'verge-shallows');
    for (const [key, bucket] of fences) {
      const mesh = new InstancedMesh(fenceGeo, propMat, bucket.length);
      mesh.name = 'verge-fence';
      bucket.forEach((f, i) => {
        mesh.setMatrixAt(i, f.m);
        const panel: FencePanel = { ...f.panel, mesh, index: i };
        this.panels.get(panel.edge)?.push(panel);
      });
      mesh.computeBoundingSphere();
      this.chunk(key).near.push(mesh);
      this.chunk(key).group.add(mesh);
      this.fencePanels += bucket.length;
    }
    for (const [key, bucket] of brush) {
      const mesh = new InstancedMesh(brushGeo, propMat, bucket.length);
      mesh.name = 'verge-brush';
      bucket.forEach((m, i) => mesh.setMatrixAt(i, m));
      mesh.computeBoundingSphere();
      this.chunk(key).near.push(mesh);
      this.chunk(key).group.add(mesh);
    }
  }

  private chunk(key: string): Chunk {
    let ch = this.chunks.get(key);
    if (!ch) {
      const [cx, cz] = key.split(',').map(Number);
      const group = new Group();
      group.name = `verge-chunk-${key}`;
      ch = {
        group,
        x: ((cx ?? 0) + 0.5) * VERGE_CHUNK_M,
        z: ((cz ?? 0) + 0.5) * VERGE_CHUNK_M,
        near: [],
      };
      this.chunks.set(key, ch);
      this.group.add(group);
    }
    return ch;
  }

  private addStrips(strips: ColourStrips, material: Mesh['material'], name: string): void {
    for (const key of strips.chunks.keys()) {
      const g = strips.build(key);
      if (!g) continue;
      this.geometries.push(g);
      const mesh = new Mesh(g, material);
      mesh.name = name;
      this.chunk(key).group.add(mesh);
    }
  }

  /** Sim events for the edges' bursts (a splash, leaves, a fence going). */
  pushEvents(events: readonly SimEvent[]): void {
    for (const ev of events) {
      if (ev.type !== 'wobble') continue;
      const cause = ev.data['cause'];
      if (cause === 'water' || cause === 'brush' || cause === 'fence') this.pending.push(ev);
    }
  }

  /**
   * Breaks the fence panels on a side of an edge that overlap [s0, s1] and returns how many broke
   * (a smash, or a rider ploughing along behind the line). Boards fly from each.
   */
  smash(edge: number, side: Side, s0: number, s1: number): number {
    let n = 0;
    for (const panel of this.panels.get(edge) ?? []) {
      if (panel.broken || panel.side !== side || panel.s1 < s0 || panel.s0 > s1) continue;
      panel.broken = true;
      panel.mesh.setMatrixAt(panel.index, ZERO);
      panel.mesh.instanceMatrix.needsUpdate = true;
      this.brokenPanels++;
      n++;
      for (let i = 0; i < 4; i++) {
        this.boards.spawn(
          { x: panel.at.x, y: panel.at.y + 0.5, z: panel.at.z },
          { x: (Math.random() - 0.5) * 7, y: 2.5 + Math.random() * 4, z: (Math.random() - 0.5) * 7 },
          1.1 + Math.random() * 0.5,
          this.fenceColour,
          0.6 + Math.random(),
        );
      }
    }
    if (n > 0) this.bursts.boards++;
    return n;
  }

  /**
   * Per frame: fences and ferns past VERGE_DRAW_M hide, the riders on loose ground kick up their
   * surface, the queued events burst, and a rider out past a fence line breaks it as it goes.
   */
  update(cameraX: number, cameraZ: number, snap: SimSnapshot | null, dt: number): void {
    const reach = VERGE_DRAW_M + VERGE_CHUNK_M * 0.71;
    for (const ch of this.chunks.values()) {
      const near = Math.hypot(ch.x - cameraX, ch.z - cameraZ) <= reach;
      for (const m of ch.near) m.visible = near;
    }
    if (snap) {
      for (const ev of this.pending.splice(0)) this.burst(ev, snap);
      for (const e of snap.entities) if (e.kind === 'rider') this.rideFeel(e, dt);
    } else this.pending.length = 0;
    this.dust.update(dt);
    this.boards.update(dt);
  }

  private burst(ev: SimEvent, snap: SimSnapshot): void {
    const e = snap.entities.find((x) => x.id === ev.actor);
    if (!e) return;
    const cause = ev.data['cause'];
    if (cause === 'fence') {
      const side = Number(ev.data['side']) < 0 ? -1 : 1;
      const s0 = Number(ev.data['s0']);
      const s1 = Number(ev.data['s1']);
      if (Number.isFinite(s0) && Number.isFinite(s1)) this.smash(e.road.edge, side, s0, s1);
      return;
    }
    const water = cause === 'water';
    this.tmp.set(water ? '#e6f7f7' : '#4e7d3a');
    const count = water ? 28 : 16;
    for (let i = 0; i < count; i++) {
      this.dust.spawn(
        { x: e.x + (Math.random() - 0.5), y: e.y + 0.3, z: e.z + (Math.random() - 0.5) },
        {
          x: (Math.random() - 0.5) * 5,
          y: (water ? 4 : 2.5) + Math.random() * 3,
          z: (Math.random() - 0.5) * 5,
        },
        0.6 + Math.random() * 0.5,
        this.tmp,
      );
    }
    this.bursts[water ? 'splash' : 'leaves']++;
  }

  private rideFeel(e: EntitySnapshot, dt: number): void {
    // Out past a fence line (a smash's yard): the fence breaks where the rider is.
    const side: Side = e.road.d < 0 ? -1 : 1;
    if (e.mode === 'Road' || e.mode === 'Airborne') {
      const v = this.road.vergeAt(e.road.edge, e.road.s, side < 0 ? 'left' : 'right');
      if (v.edge === 'fence' && v.widthM >= MIN_BAND_M && e.road.d * side > v.dOuter * side) {
        this.smash(e.road.edge, side, e.road.s - FENCE_SEG_M, e.road.s + FENCE_SEG_M);
      }
    }
    const dust = e.ground ? DUST[e.ground] : undefined;
    if (!dust || !e.grounded || e.mode !== 'Road' || e.speed < 4 || dt <= 0) {
      this.emitAcc.delete(e.id);
      return;
    }
    let acc = (this.emitAcc.get(e.id) ?? 0) + dust.rate * Math.min(1.5, e.speed / 40) * dt;
    const fx = -Math.sin(e.heading);
    const fz = -Math.cos(e.heading);
    this.tmp.set(dust.colour);
    while (acc >= 1) {
      acc -= 1;
      const back = 0.9 + Math.random() * 0.3;
      const across = (Math.random() - 0.5) * 0.5;
      this.dust.spawn(
        { x: e.x - fx * back - fz * across, y: e.y + 0.15, z: e.z - fz * back + fx * across },
        {
          x: -fx * e.speed * (0.1 + Math.random() * 0.15) + (Math.random() - 0.5) * 2,
          y: dust.up * (0.5 + Math.random()),
          z: -fz * e.speed * (0.1 + Math.random() * 0.15) + (Math.random() - 0.5) * 2,
        },
        0.45 + Math.random() * 0.45,
        this.tmp,
      );
    }
    this.emitAcc.set(e.id, acc);
  }

  counts(): VergeCounts {
    return {
      bandM: { ...this.bandM },
      shallowsM: this.shallowsM,
      fencePanels: this.fencePanels,
      brokenPanels: this.brokenPanels,
      brushClumps: this.brushClumps,
      particles: this.dust.count,
      boards: this.boards.count,
      bursts: { ...this.bursts },
      fenceStyle: this.fenceStyle,
    };
  }

  dispose(): void {
    this.group.removeFromParent();
    for (const g of this.geometries) g.dispose();
    for (const ch of this.chunks.values()) for (const m of ch.near) m.dispose();
    this.dust.mesh.dispose();
    this.boards.mesh.dispose();
  }
}

/** A stable 0..1 value per (edge, s, side), for the ferns' jitter (the same each build). */
function hash(edge: number, s: number, side: number): number {
  let h = (edge * 374761393 + Math.round(s * 10) * 668265263 + side * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
