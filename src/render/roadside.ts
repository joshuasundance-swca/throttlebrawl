// Roadside density (run W-P, "fill the world"; the maintainer, 2026-10-01b: "the worlds just feel
// very empty", roadside density close to the road "so speed is felt", and "unique regional flavor
// everywhere, like NW tree species, SF AI stuff"). Each region has a kit of small props (a Blender
// GLB, tools/blender/props/<region>_roadside.py) and rules for where they stand: ferns, fences,
// mailboxes and espresso huts in the Pacific Northwest, and so on. This module scatters them on
// the land the road scene drew (seeded, never on a road, a bridge or the water) and draws them.
//
// Drawing (the phone's budget: about 50 draws for the whole scene): the props of one 128 m square
// are merged into ONE vertex-coloured mesh, built when the camera comes near and freed when it has
// gone, so the layer costs a draw call per nearby square, however many props it holds. Past
// ROADSIDE_LOD_M a square draws only its big props (trees, huts, fences), a prefix of its vertex
// buffer, so the far triangles drop without a second mesh. It is a lazy chunk: a race loads it with
// its region's models, and the first load never pays for it.
import { BufferGeometry, Float32BufferAttribute, Group, Matrix4, Mesh, Quaternion, Vector3 } from 'three';
import type { RoadNetwork } from '../road';
import type { Point3 } from './geometry';
import type { LookStyle } from './look';
import type { SceneryModel } from './models';
import { EdgeLocator } from './overlap';
import type { RoadDressing } from './road-mesh';
import { LAND_TOP_M, scatterHash, themeAt, type LandTheme, type ScenerySpot, type SideTag } from './scenery';

/** A roadside prop's rule: where it stands, how often, how it is laid out. [default] numbers. */
export interface RoadsideRule {
  /** A name for tests and the debug overlay. */
  id: string;
  /** The kit model's variants it draws (one picked per spot, by the seed). */
  v: readonly number[];
  /** The land themes it stands on. */
  on: readonly LandTheme[];
  /** Metres between candidate spots on one side at density 1, and the share of them that place. */
  every: number;
  rate: number;
  /** Past the verge: the nearest offset and the random spread beyond it, m. */
  across: readonly [number, number];
  /** Clear ground round its anchor, m (other props, scenery, features, other roads). */
  r: number;
  /** Land it needs behind its anchor, and half its length along the road, m. */
  back?: number;
  along?: number;
  /** Turns its front (+Z) to the road; otherwise a random turn. */
  face?: boolean;
  /** A run of sections laid end to end along the road (a fence): [min, max] sections, its length. */
  run?: readonly [number, number, number];
  /** Scale range (uniform). */
  size?: readonly [number, number];
  /** Kept in the far level of detail (trees, buildings, fences). */
  big?: boolean;
  /** Stands among the trees (ferns and salal grow under the forest canopy). */
  understory?: boolean;
  /** A tree: its ground counts as canopy, so the understory may grow under it. */
  canopy?: boolean;
}

export interface RoadsideKit {
  id: 'pnw';
  rules: readonly RoadsideRule[];
}

const FOREST: readonly LandTheme[] = ['forest', 'sawmill'];
const TOWN: readonly LandTheme[] = ['commercial'];

/**
 * The Pacific Northwest (the maintainer: "NW tree species"; the 2026-10-01b amendment's list):
 * sword fern and salal under the trees, mossy stumps and rocks, split-rail and log fences,
 * mailboxes on posts with stacked firewood, a big-footed warning sign gone dark with rain,
 * drive-through espresso huts, and bigleaf maples and red alders among the firs and cedars. The
 * kit's variants: 0 fern, 1 salal, 2 stump, 3 rock, 4 mailbox, 5 firewood, 6 split rail, 7 log
 * fence, 8 sign, 9 espresso hut, 10 maple, 11 alder.
 */
export const PNW_KIT: RoadsideKit = {
  id: 'pnw',
  // In order of how much ground each needs: the big props claim theirs first, the understory last.
  rules: [
    {
      id: 'espresso',
      v: [9],
      on: FOREST,
      every: 1100,
      rate: 0.7,
      across: [4, 3],
      r: 2.6,
      back: 1.6,
      along: 2.1,
      face: true,
      big: true,
    },
    {
      id: 'espresso-town',
      v: [9],
      on: TOWN,
      every: 260,
      rate: 0.8,
      across: [3.5, 3],
      r: 2.6,
      back: 1.6,
      along: 2.1,
      face: true,
      big: true,
    },
    {
      id: 'firewood',
      v: [5],
      on: [...FOREST, ...TOWN],
      every: 120,
      rate: 0.55,
      across: [3, 4],
      r: 1.6,
      back: 0.6,
      along: 1.4,
      face: true,
      big: true,
    },
    {
      id: 'sign',
      v: [8],
      on: [...FOREST, ...TOWN],
      every: 300,
      rate: 0.7,
      across: [0.5, 0.4],
      r: 0.8,
      face: true,
      big: true,
    },
    {
      id: 'mailbox',
      v: [4],
      on: [...FOREST, ...TOWN],
      every: 70,
      rate: 0.6,
      across: [0.5, 0.3],
      r: 0.7,
      face: true,
    },
    {
      id: 'split-rail',
      v: [6],
      on: [...FOREST, ...TOWN],
      every: 110,
      rate: 0.6,
      across: [1.4, 1.2],
      r: 0.4,
      along: 3,
      face: true,
      run: [4, 14, 6],
      big: true,
    },
    {
      id: 'log-fence',
      v: [7],
      on: FOREST,
      every: 170,
      rate: 0.5,
      across: [1.6, 1.5],
      r: 0.4,
      along: 3,
      face: true,
      run: [3, 10, 6],
      big: true,
    },
    {
      id: 'broadleaf',
      v: [10, 11, 11],
      on: [...FOREST, ...TOWN],
      every: 24,
      rate: 0.6,
      across: [3, 11],
      r: 2.2,
      size: [0.8, 1.15],
      big: true,
      canopy: true,
    },
    { id: 'stump', v: [2, 3], on: FOREST, every: 18, rate: 0.75, across: [1, 9], r: 0.9 },
    // The verge: a dense band of fern and salal within 2 m of it, the near parallax at speed.
    {
      id: 'verge',
      v: [0, 0, 1],
      on: [...FOREST, ...TOWN],
      every: 3.2,
      rate: 0.75,
      across: [0.3, 1.8],
      r: 0.45,
      size: [0.75, 1.2],
      understory: true,
    },
    {
      id: 'salal',
      v: [1],
      on: FOREST,
      every: 9,
      rate: 0.7,
      across: [2.4, 7],
      r: 0.8,
      size: [0.8, 1.3],
      understory: true,
    },
    {
      id: 'fern',
      v: [0],
      on: FOREST,
      every: 4.5,
      rate: 0.85,
      across: [2.2, 9],
      r: 0.6,
      size: [0.8, 1.35],
      understory: true,
    },
  ],
};

/** The kit a region's loaded model draws, by the model's kind. */
export const KITS: Readonly<Record<string, RoadsideKit>> = { pnwRoadside: PNW_KIT };

/** One placed prop. */
export interface RoadsideItem {
  rule: string;
  variant: number;
  edge: number;
  s: number;
  d: number;
  p: Point3;
  /** Turn about the vertical (the model's +Z goes to (sin, cos) in x, z), and the grade it follows. */
  turn: number;
  pitch: number;
  size: number;
  big: boolean;
}

/** The squares the merged meshes cover, m. [default] */
export const ROADSIDE_CHUNK_M = 128;
/** Roadside props farther than this from the camera are not drawn, m (never past sceneryDrawM). [default] */
export const ROADSIDE_DRAW_M = 240;
/** Past this a square draws only its big props, m. [default] */
export const ROADSIDE_LOD_M = 110;
/** A built square farther than this is freed, m. */
const ROADSIDE_KEEP_M = ROADSIDE_DRAW_M + 160;
/** Squares built per frame at most, so coming round a corner never stalls a frame. */
const BUILDS_PER_FRAME = 2;
/** Features no prop stands in (as the scenery's KEEP_CLEAR), with room round them, m. */
const KEEP_CLEAR = new Set(['billboard', 'boostPad', 'rampTruck', 'roadsideZone', 'copSpawn']);
const FEATURE_CLEAR_M = 3;
const VERGE_M = 0.6;
/** The scenery's own footprints: houses and the sawmill reach back from their front. */
const SPOT_REACH: Partial<Record<ScenerySpot['kind'], { r: number; back: number }>> = {
  house: { r: 6.2, back: 5.8 },
  sawmill: { r: 16, back: 8.5 },
  shack: { r: 3.8, back: 0 },
  conifer: { r: 1.2, back: 0 },
  palm: { r: 1, back: 0 },
  mangrove: { r: 2.5, back: 0 },
  pole: { r: 0.8, back: 0 },
};

export interface RoadsideInput {
  road: RoadNetwork;
  dressing: RoadDressing | undefined;
  seed: number;
  /** Props per stretch of road: 1 = the kit's spacing, 0 = none (`render.roadsideDensity`). */
  density: number;
  kit: RoadsideKit;
  /** The drawn land beside the road (RoadScene.landReach). */
  landReach(edge: number, side: -1 | 1, s: number): number;
  /** The scenery already standing (houses, trees, shacks): props keep clear of it. */
  spots: readonly ScenerySpot[];
}

/** A grid of discs, for keeping props apart. */
class Discs {
  private readonly cells = new Map<string, { x: number; z: number; r: number; under: boolean }[]>();
  private static readonly CELL = 8;

  private key(i: number, j: number) {
    return `${i},${j}`;
  }

  add(x: number, z: number, r: number, under = false) {
    const k = this.key(Math.floor(x / Discs.CELL), Math.floor(z / Discs.CELL));
    const list = this.cells.get(k);
    const disc = { x, z, r, under };
    if (list) list.push(disc);
    else this.cells.set(k, [disc]);
  }

  /** Whether a disc of radius r at (x, z) overlaps any (understory props ignore trees' discs). */
  hits(x: number, z: number, r: number, understory: boolean): boolean {
    const reach = Math.ceil((r + 16) / Discs.CELL);
    const ci = Math.floor(x / Discs.CELL);
    const cj = Math.floor(z / Discs.CELL);
    for (let i = ci - reach; i <= ci + reach; i++)
      for (let j = cj - reach; j <= cj + reach; j++)
        for (const d of this.cells.get(this.key(i, j)) ?? []) {
          if (understory && d.under) continue;
          if (Math.hypot(d.x - x, d.z - z) < d.r + r) return true;
        }
    return false;
  }
}

/** Scatters a kit along every edge: seeded, on drawn land, clear of everything else. */
export function scatterRoadside(input: RoadsideInput): RoadsideItem[] {
  const out: RoadsideItem[] = [];
  const { road, dressing, seed } = input;
  const density = Math.max(0, input.density);
  if (density <= 0) return out;
  const locator = new EdgeLocator(road);
  const taken = new Discs();
  // The scenery that stands already: trees count as canopy (ferns may grow under them).
  for (const sp of input.spots) {
    const reach = SPOT_REACH[sp.kind];
    if (!reach) continue;
    const e = road.edges[sp.edge];
    if (!e) continue;
    const c = reach.back > 0 ? road.toWorld(e.index, sp.s, sp.d + Math.sign(sp.d) * reach.back, 0) : sp.p;
    const tree = sp.kind === 'conifer' || sp.kind === 'palm' || sp.kind === 'mangrove';
    taken.add(c.x, c.z, reach.r * sp.size, tree);
  }
  for (const e of road.edges) {
    const dress = dressing?.[e.id];
    const tags = dress?.tags as readonly SideTag[] | undefined;
    const features = (dress?.features ?? []).filter((f) => KEEP_CLEAR.has(f.kind));
    const featureClear = (s: number, d: number, r: number) =>
      !features.some((f) => {
        const m = Math.max(r, FEATURE_CLEAR_M);
        return (
          s >= Math.min(f.s0, f.s1) - m &&
          s <= Math.max(f.s0, f.s1) + m &&
          d >= Math.min(f.d0, f.d1) - m &&
          d <= Math.max(f.d0, f.d1) + m
        );
      });
    const otherRoad = (x: number, z: number, r: number) =>
      locator.covered(x, z, e.index, (o) => [o.dMin - VERGE_M - r, o.dMax + VERGE_M + r]);
    input.kit.rules.forEach((rule, ri) => {
      const h = (k: number, side: number, salt: number) =>
        scatterHash(seed, 7919 + e.index * 977 + ri * 131, k, side * 17 + salt + 40);
      for (const side of [-1, 1] as const) {
        const outer = side < 0 ? -e.dMin + VERGE_M : e.dMax + VERGE_M;
        const spacing = rule.every / density;
        for (let k = 0; ; k++) {
          const s0 = (k + 0.15 + 0.7 * h(k, side, 0)) * spacing;
          if (s0 > e.length) break;
          if (h(k, side, 1) >= rule.rate) continue;
          const [near, spread] = rule.across;
          const across = near + spread * h(k, side, 2);
          const along = rule.along ?? rule.r;
          const back = rule.back ?? rule.r;
          const sections = rule.run
            ? rule.run[0] + Math.floor(h(k, side, 3) * (rule.run[1] - rule.run[0] + 1))
            : 1;
          const step = rule.run?.[2] ?? 0;
          const variant = rule.v[Math.floor(h(k, side, 4) * rule.v.length) % rule.v.length] ?? 0;
          for (let j = 0; j < sections; j++) {
            const s = s0 + j * step;
            if (s - along < 0 || s + along > e.length) break;
            const theme = themeAt(tags, side < 0 ? 'left' : 'right', s);
            if (!(rule.on as readonly string[]).includes(theme)) break;
            // On the drawn land, all of it: across its depth and along its length.
            const land = Math.min(
              input.landReach(e.index, side, s),
              input.landReach(e.index, side, s - along),
              input.landReach(e.index, side, s + along),
            );
            if (across + back > land) break;
            const d = side * (outer + across);
            const p = road.toWorld(e.index, s, d, LAND_TOP_M);
            const r = rule.r * (rule.run ? 1 : (rule.size?.[1] ?? 1));
            if (!featureClear(s, d, r)) break;
            if (taken.hits(p.x, p.z, r, !!rule.understory)) {
              if (rule.run) break;
              continue;
            }
            if (otherRoad(p.x, p.z, r)) break;
            const toRoad = road.toWorld(e.index, s, 0, 0);
            let turn: number;
            let pitch = 0;
            if (rule.face) {
              turn = Math.atan2(toRoad.x - p.x, toRoad.z - p.z);
              if (rule.run) {
                // A section follows the road's grade, so neither end floats or sinks.
                const a = road.toWorld(e.index, Math.max(0, s - along), d, LAND_TOP_M);
                const b = road.toWorld(e.index, Math.min(e.length, s + along), d, LAND_TOP_M);
                pitch = Math.atan2(b.y - a.y, Math.hypot(b.x - a.x, b.z - a.z)) * -side;
              }
            } else turn = h(k * 31 + j, side, 5) * Math.PI * 2;
            const size = rule.size
              ? rule.size[0] + (rule.size[1] - rule.size[0]) * h(k * 31 + j, side, 6)
              : 1;
            // A section's own disc covers its length; the next one along may touch it.
            if (rule.run) taken.add(p.x, p.z, 0.3);
            else if (rule.canopy) taken.add(p.x, p.z, r, true);
            else taken.add(p.x, p.z, rule.understory ? r * 0.6 : r);
            out.push({ rule: rule.id, variant, edge: e.index, s, d, p, turn, pitch, size, big: !!rule.big });
          }
        }
      }
    });
  }
  return out;
}

interface Chunk {
  items: RoadsideItem[];
  cx: number;
  cz: number;
  radius: number;
  mesh: Mesh | null;
  /** Vertices of the big props (they come first) and of all of them. */
  bigVerts: number;
  allVerts: number;
}

export interface RoadsideCounts {
  /** Props placed, by rule. */
  placed: Readonly<Record<string, number>>;
  /** Squares with props, squares built now, and meshes and triangles the last update showed. */
  chunks: number;
  built: number;
  meshes: number;
  triangles: number;
}

/** The roadside props of one road scene, drawn as merged squares near the camera. */
export class RoadsideLayer {
  readonly group = new Group();
  readonly items: readonly RoadsideItem[];
  private readonly chunks: Chunk[] = [];
  private shownMeshes = 0;
  private shownTris = 0;

  constructor(
    private readonly model: SceneryModel,
    private readonly look: LookStyle,
    input: RoadsideInput,
  ) {
    this.group.name = 'road-roadside';
    this.items = scatterRoadside(input);
    const byKey = new Map<string, RoadsideItem[]>();
    for (const it of this.items) {
      const key = `${Math.floor(it.p.x / ROADSIDE_CHUNK_M)},${Math.floor(it.p.z / ROADSIDE_CHUNK_M)}`;
      const list = byKey.get(key);
      if (list) list.push(it);
      else byKey.set(key, [it]);
    }
    for (const items of byKey.values()) {
      // Big props first: the far level of detail draws a prefix of the buffer.
      items.sort((a, b) => Number(b.big) - Number(a.big));
      const cx = items.reduce((n, i) => n + i.p.x, 0) / items.length;
      const cz = items.reduce((n, i) => n + i.p.z, 0) / items.length;
      const radius = Math.max(...items.map((i) => Math.hypot(i.p.x - cx, i.p.z - cz))) + 15;
      this.chunks.push({ items, cx, cz, radius, mesh: null, bigVerts: 0, allVerts: 0 });
    }
  }

  /** Builds, shows, thins and frees squares by their distance from the camera. */
  update(cameraX: number, cameraZ: number, drawM: number): number {
    const draw = Math.min(drawM, ROADSIDE_DRAW_M);
    let builds = 0;
    let shown = 0;
    let meshes = 0;
    let tris = 0;
    for (const c of this.chunks) {
      const dist = Math.hypot(c.cx - cameraX, c.cz - cameraZ) - c.radius;
      if (dist < draw) {
        if (!c.mesh) {
          if (builds >= BUILDS_PER_FRAME) continue;
          this.build(c);
          builds++;
        }
        const mesh = c.mesh;
        if (!mesh) continue;
        const count = dist > ROADSIDE_LOD_M ? c.bigVerts : c.allVerts;
        mesh.geometry.setDrawRange(0, count);
        mesh.visible = count > 0;
        if (mesh.visible) {
          meshes++;
          tris += count / 3;
          shown += c.items.length;
        }
      } else if (c.mesh) {
        c.mesh.visible = false;
        if (dist > ROADSIDE_KEEP_M) this.free(c);
      }
    }
    this.shownMeshes = meshes;
    this.shownTris = tris;
    return shown;
  }

  counts(): RoadsideCounts {
    const placed: Record<string, number> = {};
    for (const it of this.items) placed[it.rule] = (placed[it.rule] ?? 0) + 1;
    return {
      placed,
      chunks: this.chunks.length,
      built: this.chunks.filter((c) => c.mesh).length,
      meshes: this.shownMeshes,
      triangles: this.shownTris,
    };
  }

  dispose(): void {
    for (const c of this.chunks) this.free(c);
    this.group.removeFromParent();
  }

  private free(c: Chunk) {
    if (!c.mesh) return;
    c.mesh.geometry.dispose();
    c.mesh.removeFromParent();
    c.mesh = null;
  }

  private build(c: Chunk) {
    const geos = this.model.variants;
    let total = 0;
    for (const it of c.items) total += geos[it.variant]?.getAttribute('position').count ?? 0;
    const pos = new Float32Array(total * 3);
    const nrm = new Float32Array(total * 3);
    const col = new Float32Array(total * 3);
    const m = new Matrix4();
    const q = new Quaternion();
    const qp = new Quaternion();
    const v = new Vector3();
    const up = new Vector3(0, 1, 0);
    const xAxis = new Vector3(1, 0, 0);
    let o = 0;
    let bigVerts = 0;
    for (const it of c.items) {
      const g = geos[it.variant];
      if (!g) continue;
      q.setFromAxisAngle(up, it.turn);
      if (it.pitch) q.multiply(qp.setFromAxisAngle(xAxis.set(0, 0, 1), it.pitch));
      m.compose(v.set(it.p.x, it.p.y, it.p.z), q, new Vector3(it.size, it.size, it.size));
      const gp = g.getAttribute('position');
      const gn = g.getAttribute('normal');
      const gc = g.getAttribute('color');
      for (let i = 0; i < gp.count; i++, o++) {
        v.fromBufferAttribute(gp, i).applyMatrix4(m);
        pos[o * 3] = v.x;
        pos[o * 3 + 1] = v.y;
        pos[o * 3 + 2] = v.z;
        v.fromBufferAttribute(gn, i).applyQuaternion(q);
        nrm[o * 3] = v.x;
        nrm[o * 3 + 1] = v.y;
        nrm[o * 3 + 2] = v.z;
        col[o * 3] = gc.getX(i);
        col[o * 3 + 1] = gc.getY(i);
        col[o * 3 + 2] = gc.getZ(i);
      }
      if (it.big) bigVerts = o;
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new Float32BufferAttribute(nrm, 3));
    geo.setAttribute('color', new Float32BufferAttribute(col, 3));
    geo.computeBoundingSphere();
    const mesh = new Mesh(
      geo,
      this.look.material('prop', { vertexColors: true, doubleSided: this.model.doubleSided }),
    );
    mesh.name = 'road-roadside';
    mesh.matrixAutoUpdate = false;
    this.group.add(mesh);
    c.mesh = mesh;
    c.bigVerts = bigVerts;
    c.allVerts = o;
  }
}
