// A party street's string lights (playtest 4, P4-16: "Duval St should be a party street"; neon and
// string lights at dusk). A `roadsideZone` whose `params.dressing` is `party` is a stretch of bars and
// crowds: at dusk and after, its side of the road gets a line of tall posts along the sidewalk, with a
// string of coloured bulbs hung between them, sagging. Where both sides of the street are party
// (P4-19: "lights over the street"), a string also crosses the street between a pair of posts, high
// over the lanes, hung with the same helper as Chinatown's lantern strings (string-lights.ts). Code-made
// and unlit (the bulbs read as light sources in every look), one mesh and one draw call whatever the
// length of the street: the whole street's bulbs sit in one static buffer and an index of the ones near
// the camera is refilled as it moves (as text-surfaces.ts does for its words). Presentation only: nothing
// here reaches the sim, and nothing hangs where a bike or a car can ride (the lowest cord is
// `CROSS_CLEARANCE_M` over the road). A lazy chunk, loaded only for a road that has a party zone. By day
// (noon, golden hour) it builds no strings.
//
// Run A's check (item 7: "the party lights read as unlit coloured diamonds floating with no string"):
// the cord is drawn now, a dark cord of `CORD_W_M` through every bulb and up to the posts; each bulb is
// a bright-cored diamond of `BULB_SIZE_M` with a soft additive glow round it (`GLOW_R_M`, a second mesh
// and so a second draw call: bright at the bulb, black at the rim, so it fades with no texture). And
// the crowd (balcony-crowd.ts, `setFronts`): the street's balconies are full of revellers, by day too, and
// (run B's check, item 4) its pavements have people standing on them.
import {
  AdditiveBlending,
  BufferGeometry,
  BufferAttribute,
  Color,
  Float32BufferAttribute,
  Group,
  Mesh,
  type MeshBasicMaterial,
} from 'three';
import type { RoadNetwork } from '../sim/api';
import { BalconyCrowd, type BalconyCrowdCounts, type CrowdSurface } from './balcony-crowd';
import type { Point3 } from './geometry';
import type { LookStyle } from './look';
import type { RoadDressing } from './road-mesh';
import { LAND_TOP_M, scatterHash } from './scenery';
import { hangPoints, lowestPoint, stringPoints } from './string-lights';

/** The roadside zone's `params.dressing` that makes it a party stretch (docs/content-packs.md). */
export const PARTY_DRESSING = 'party';

export { isLitTime } from './look';

/** One party stretch: a side of a road between two s. */
export interface PartyRun {
  edge: number;
  s0: number;
  s1: number;
  side: -1 | 1;
}

interface ZoneLike {
  kind: string;
  s0: number;
  s1: number;
  d0: number;
  d1: number;
  params?: Readonly<Record<string, unknown>> | undefined;
}

/** The party stretches of a road network: each party zone, on the side its `d` says. */
export function partyRuns(road: RoadNetwork, dressing: RoadDressing | undefined): PartyRun[] {
  const out: PartyRun[] = [];
  for (const e of road.edges) {
    const features = (dressing?.[e.id]?.features ?? e.features) as readonly ZoneLike[];
    for (const f of features) {
      if (f.kind !== 'roadsideZone' || f.params?.['dressing'] !== PARTY_DRESSING) continue;
      const s0 = Math.max(0, Math.min(f.s0, f.s1));
      const s1 = Math.min(e.length, Math.max(f.s0, f.s1));
      if (s1 - s0 < POST_EVERY_M) continue;
      out.push({ edge: e.index, s0, s1, side: f.d0 + f.d1 < 0 ? -1 : 1 });
    }
  }
  return out;
}

/** Metres between posts, and between bulbs on a string. [default] */
export const POST_EVERY_M = 12;
export const BULB_EVERY_M = 1.5;
/** The posts' height, and how far a string sags between two, m. [default] */
export const POST_H_M = 6;
export const SAG_M = 0.8;
/**
 * The line of posts stands this far past the road's verge, m: on the sidewalk (4 m wide in Old Town, the
 * crowd's ground), in front of the shopfronts, which stand on its edge. [default]
 */
export const POST_OUT_M = 1;
const VERGE_M = 0.6;
/** A string across the street every so often where both sides are party, and its sag, m. [default] */
export const CROSS_EVERY_M = 26;
export const CROSS_SAG_M = 1;
/**
 * The lowest a cord hangs over the road, m: over the tallest vehicle on Old Town's streets (the island
 * tram is 3.3 m) with the room a rider's raised arm needs. A cross string is only hung where its low
 * point clears this.
 */
export const CROSS_CLEARANCE_M = 4.8;
/** Bulbs and posts within this far of the camera are drawn, m; the index refills every REFILL_M. [default] */
export const LIGHTS_DRAW_M = 170;
export const LIGHTS_REFILL_M = 10;
/**
 * A bulb is a diamond this big, m (a crossed pair, each this high and across), and a post this thick. A
 * bulb under 0.4 m is under 3 px at 40 m, which is how the first ones read: specks. [default]
 */
export const BULB_SIZE_M = 0.44;
const BULB_R = BULB_SIZE_M / 2;
const POST_R = 0.09;
/** The cord's width, m (1 px at 40 m is 0.14 m), and about how far apart its points are, m. [default] */
export const CORD_W_M = 0.16;
const CORD_STEP_M = 1;
/** The cord's colour: dark, to stand out against a dusk sky and the pale fronts. */
export const CORD_COLOUR = '#3a3342';
/** A bulb's glow: its radius, m, and how bright it is at the bulb (the rim is black). [default] */
export const GLOW_R_M = 0.9;
const GLOW_GAIN = 0.6;
const GLOW_SIDES = 6;
/** How much of white the bulb's core is, 0..1: the middle of the diamond is hot. */
const CORE_WHITE = 0.65;
/** The bulbs' colours: the bar-district palette. */
export const BULB_COLOURS: readonly string[] = [
  '#ff4fa3',
  '#ffd23f',
  '#2de2ff',
  '#b6ff3c',
  '#ff9f1c',
  '#fff1c9',
];
const POST_COLOUR = '#2a2a34';

export interface PartyBulb {
  x: number;
  y: number;
  z: number;
  colour: string;
  /** Hung across the street (over the lanes), not along a sidewalk. */
  over: boolean;
}

export interface PartyLightsCounts {
  runs: number;
  /** Strings hung across the street. */
  crossings: number;
  bulbs: number;
  /** Bulbs and triangles in the index now (strings and glow both), and the draw calls (0 to 2, and the crowd's). */
  shownBulbs: number;
  triangles: number;
  drawCalls: number;
  /** The crowd on the balconies, once the street fronts are placed (`setFronts`), else null. */
  crowd: BalconyCrowdCounts | null;
}

export interface PartyLightsInput {
  road: RoadNetwork;
  dressing: RoadDressing | undefined;
  seed: number;
  /** Dusk or night (`isLitTime`): by day no string is built. */
  lit: boolean;
  /** The drawn land beside the road (RoadScene.landReach); posts stand only where it reaches. */
  landReach?(edge: number, side: -1 | 1, s: number): number;
}

/** One span between two posts: its range in each vertex buffer, its middle, and its bulbs. */
interface Span {
  v0: number;
  n: number;
  g0: number;
  gn: number;
  x: number;
  z: number;
  bulbs: number;
}

export class PartyLights {
  readonly group = new Group();
  private readonly runList: PartyRun[] = [];
  private readonly bulbList: PartyBulb[] = [];
  private readonly spans: Span[] = [];
  private readonly live: Uint32Array;
  private readonly glowLive: Uint32Array;
  private readonly geometry: BufferGeometry | null = null;
  private readonly mesh: Mesh | null = null;
  private readonly glowGeometry: BufferGeometry | null = null;
  private readonly glowMesh: Mesh | null = null;
  private filledX = Number.NaN;
  private filledZ = Number.NaN;
  private shownBulbs = 0;
  private crossings = 0;
  private shownVerts = 0;
  private shownGlowVerts = 0;
  private crowd: BalconyCrowd | null = null;
  private cameraX = Number.NaN;
  private cameraZ = Number.NaN;

  constructor(
    private readonly look: LookStyle,
    private readonly input: PartyLightsInput,
  ) {
    this.group.name = 'party-lights';
    const pos: number[] = [];
    const col: number[] = [];
    const gpos: number[] = [];
    const gcol: number[] = [];
    if (input.lit) {
      this.runList.push(...partyRuns(input.road, input.dressing));
      this.build(input, pos, col, gpos, gcol);
    }
    this.live = new Uint32Array(pos.length / 3);
    this.glowLive = new Uint32Array(gpos.length / 3);
    if (this.spans.length === 0) return;
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new Float32BufferAttribute(col, 3));
    g.setIndex(new BufferAttribute(this.live, 1));
    g.setDrawRange(0, 0);
    this.geometry = g;
    this.mesh = new Mesh(g, look.material('spark', { vertexColors: true, doubleSided: true }));
    this.mesh.name = 'party-lights';
    // The strings are far apart (a street's length): never culled whole; the index holds the near ones.
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.group.add(this.mesh);
    // The glow: its own buffer, unlit and additive (a copy of the look's unlit material, so the blend never
    // leaks into the shared one), never fogged: it draws only within LIGHTS_DRAW_M, inside the fog's start.
    const gg = new BufferGeometry();
    gg.setAttribute('position', new Float32BufferAttribute(gpos, 3));
    gg.setAttribute('color', new Float32BufferAttribute(gcol, 3));
    gg.setIndex(new BufferAttribute(this.glowLive, 1));
    gg.setDrawRange(0, 0);
    this.glowGeometry = gg;
    const glow = look
      .material('glint', { vertexColors: true, doubleSided: true })
      .clone() as MeshBasicMaterial;
    glow.blending = AdditiveBlending;
    glow.transparent = true;
    glow.depthWrite = false;
    glow.fog = false;
    this.glowMesh = new Mesh(gg, glow);
    this.glowMesh.name = 'party-lights-glow';
    this.glowMesh.frustumCulled = false;
    this.glowMesh.visible = false;
    this.group.add(this.glowMesh);
  }

  /** Lays the posts and strings of every run into `pos` and `col` (a triangle soup), span by span. */
  private build(input: PartyLightsInput, pos: number[], col: number[], gpos: number[], gcol: number[]) {
    const { road, seed } = input;
    const tmp = new Color();
    const hot = new Color();
    const white = new Color('#ffffff');
    /** A quad of four corners, as two triangles. */
    const quad = (
      a: readonly number[],
      b: readonly number[],
      c: readonly number[],
      d: readonly number[],
      colour: Color,
    ) => {
      for (const v of [a, b, c, a, c, d] as const) {
        pos.push(v[0] ?? 0, v[1] ?? 0, v[2] ?? 0);
        col.push(colour.r, colour.g, colour.b);
      }
    };
    // A crossed pair of upright diamonds round a centre: seen from any side. Each is four triangles about
    // a hot middle (the bulb's own colour toward white), so a bulb reads as lit, not as a flat chip.
    const cross = (
      x: number,
      y: number,
      z: number,
      rx: number,
      ry: number,
      colour: string,
      core?: boolean,
    ) => {
      tmp.set(colour);
      hot.copy(tmp).lerp(white, CORE_WHITE);
      for (const [ax, az] of [
        [rx, 0],
        [0, rx],
      ] as const) {
        const c = [
          [x - ax, y, z - az],
          [x, y - ry, z],
          [x + ax, y, z + az],
          [x, y + ry, z],
        ] as const;
        if (core) {
          for (let k = 0; k < 4; k++) {
            const a = c[k] as readonly number[];
            const b = c[(k + 1) % 4] as readonly number[];
            for (const [v, colour_] of [
              [a, tmp],
              [b, tmp],
              [[x, y, z], hot],
            ] as const) {
              pos.push(v[0] ?? 0, v[1] ?? 0, v[2] ?? 0);
              col.push(colour_.r, colour_.g, colour_.b);
            }
          }
        } else {
          for (const k of [0, 1, 2, 0, 2, 3] as const) {
            const v = c[k];
            pos.push(v[0], v[1], v[2]);
            col.push(tmp.r, tmp.g, tmp.b);
          }
        }
      }
    };
    /** A bulb's glow: two crossed upright fans, bright at the middle and black at the rim (added, they fade out). */
    const halo = (x: number, y: number, z: number, colour: string) => {
      tmp.set(colour).multiplyScalar(GLOW_GAIN);
      for (const [ax, az] of [
        [GLOW_R_M, 0],
        [0, GLOW_R_M],
      ] as const) {
        for (let k = 0; k < GLOW_SIDES; k++) {
          const a0 = (k / GLOW_SIDES) * Math.PI * 2;
          const a1 = ((k + 1) / GLOW_SIDES) * Math.PI * 2;
          const rim = (a: number): number[] => [
            x + Math.cos(a) * ax,
            y + Math.sin(a) * GLOW_R_M,
            z + Math.cos(a) * az,
          ];
          for (const [v, bright] of [
            [[x, y, z], true],
            [rim(a0), false],
            [rim(a1), false],
          ] as const) {
            gpos.push(v[0] ?? 0, v[1] ?? 0, v[2] ?? 0);
            if (bright) gcol.push(tmp.r, tmp.g, tmp.b);
            else gcol.push(0, 0, 0);
          }
        }
      }
    };
    /** The cord: a dark ribbon pair (one upright, one flat) along the string's sag, post to post. */
    const cord = (from: Point3, to: Point3, sagM: number) => {
      const span = Math.hypot(to.x - from.x, to.z - from.z);
      const pts = stringPoints(from, to, sagM, Math.max(4, Math.round(span / CORD_STEP_M)));
      tmp.set(CORD_COLOUR);
      const r = CORD_W_M / 2;
      for (let i = 0; i + 1 < pts.length; i++) {
        const p = pts[i] as Point3;
        const q = pts[i + 1] as Point3;
        const len = Math.hypot(q.x - p.x, q.z - p.z) || 1;
        // The flat ribbon's side vector: across the string, level.
        const sx = (-(q.z - p.z) / len) * r;
        const sz = ((q.x - p.x) / len) * r;
        quad([p.x, p.y - r, p.z], [q.x, q.y - r, q.z], [q.x, q.y + r, q.z], [p.x, p.y + r, p.z], tmp);
        quad(
          [p.x - sx, p.y, p.z - sz],
          [q.x - sx, q.y, q.z - sz],
          [q.x + sx, q.y, q.z + sz],
          [p.x + sx, p.y, p.z + sz],
          tmp,
        );
      }
    };
    /** Hangs the cord and bulbs of one string between two post tops, as one span of the index. */
    const hang = (
      from: Point3,
      to: Point3,
      sagM: number,
      salt: number,
      k: number,
      over: boolean,
      post: Point3[],
    ) => {
      const v0 = pos.length / 3;
      const g0 = gpos.length / 3;
      for (const p of post) cross(p.x, p.y + POST_H_M / 2, p.z, POST_R, POST_H_M / 2, POST_COLOUR);
      cord(from, to, sagM);
      const span = Math.hypot(to.x - from.x, to.z - from.z);
      const pitch = span / Math.max(2, Math.round(span / BULB_EVERY_M));
      const hung = hangPoints(from, to, { sagM, pitchM: pitch, endM: pitch });
      hung.forEach((p, i) => {
        // The colour: a seeded run of the palette, so no two strings repeat.
        const pick = Math.floor(scatterHash(seed, salt, from.x, k * 64 + i) * BULB_COLOURS.length);
        const colour = BULB_COLOURS[pick] ?? '#ffffff';
        cross(p.x, p.y, p.z, BULB_R, BULB_R * 1.25, colour, true);
        halo(p.x, p.y, p.z, colour);
        this.bulbList.push({ ...p, colour, over });
      });
      this.spans.push({
        v0,
        n: pos.length / 3 - v0,
        g0,
        gn: gpos.length / 3 - g0,
        x: (from.x + to.x) / 2,
        z: (from.z + to.z) / 2,
        bulbs: hung.length,
      });
    };
    /** A post top on a run's side at s, or null where the drawn land does not reach it. */
    const postTop = (run: PartyRun, s: number): Point3 | null => {
      const e = road.edges[run.edge];
      if (!e) return null;
      if (input.landReach && input.landReach(run.edge, run.side, s) < POST_OUT_M + 1) return null;
      const outer = (run.side < 0 ? -e.dMin : e.dMax) + VERGE_M;
      const w = road.toWorld(run.edge, s, run.side * (outer + POST_OUT_M), LAND_TOP_M);
      return { x: w.x, y: w.y, z: w.z };
    };
    const up = (p: Point3, h: number): Point3 => ({ x: p.x, y: p.y + h, z: p.z });
    for (const run of this.runList) {
      const n = Math.max(1, Math.round((run.s1 - run.s0) / POST_EVERY_M));
      const step = (run.s1 - run.s0) / n;
      // A string along the sidewalk between posts at both ends of every span; the land must reach them.
      for (let k = 0; k < n; k++) {
        const a = postTop(run, run.s0 + k * step);
        const b = postTop(run, run.s0 + (k + 1) * step);
        if (!a || !b) continue;
        // The last span of a run is closed by its far post.
        hang(up(a, POST_H_M), up(b, POST_H_M), SAG_M, 4417 + run.edge, k, false, k === n - 1 ? [a, b] : [a]);
      }
    }
    // Where both sides of the street are party, strings cross it between a pair of posts, high over the
    // lanes (P4-19: "lights over the street"): every CROSS_EVERY_M through the stretch the two share.
    for (const left of this.runList) {
      if (left.side !== -1) continue;
      for (const right of this.runList) {
        if (right.side !== 1 || right.edge !== left.edge) continue;
        const lo = Math.max(left.s0, right.s0);
        const hi = Math.min(left.s1, right.s1);
        const count = Math.floor((hi - lo) / CROSS_EVERY_M);
        for (let k = 0; k < count; k++) {
          const s = lo + (k + 0.5) * ((hi - lo) / count);
          const a = postTop(left, s);
          const b = postTop(right, s);
          if (!a || !b) continue;
          const from = up(a, POST_H_M);
          const to = up(b, POST_H_M);
          // Never lower over the road than the clearance (the road's own grade included).
          const road0 = road.toWorld(left.edge, s, 0, 0).y;
          if (lowestPoint(from, to, CROSS_SAG_M) - road0 < CROSS_CLEARANCE_M) continue;
          hang(from, to, CROSS_SAG_M, 4423 + left.edge, k, true, [a, b]);
          this.crossings++;
        }
      }
    }
  }

  /**
   * Stands the crowd on the balconies of the street's party blocks: the placed street fronts' text surfaces
   * (the shop boards the roadside layer returns), once they exist. Day or night; a road with no party block
   * gets nothing. Replaces any earlier crowd.
   */
  setFronts(surfaces: readonly CrowdSurface[]): void {
    this.crowd?.dispose();
    this.crowd = null;
    const { road, dressing, seed } = this.input;
    const runs = partyRuns(road, dressing);
    if (runs.length === 0) return;
    const accept = (x: number, z: number): boolean => {
      const p = road.project(x, z);
      return runs.some(
        (r) => r.edge === p.edge && p.s >= r.s0 - 4 && p.s <= r.s1 + 4 && Math.sign(p.d) === r.side,
      );
    };
    // Run B's check, item 4: and the people on the pavement of every party block, with or without a balcony shop.
    const crowd = new BalconyCrowd(this.look, { surfaces, seed, accept, walkers: { road, runs } });
    if (crowd.counts().figures === 0) {
      crowd.dispose();
      return;
    }
    this.crowd = crowd;
    this.group.add(crowd.group);
    // The index fills for the camera as it was last seen, so a crowd standing late is not an empty one.
    if (Number.isFinite(this.cameraX)) crowd.update(this.cameraX, this.cameraZ);
  }

  /** Per frame: refills the index with the spans near the camera. */
  update(cameraX: number, cameraZ: number): void {
    this.cameraX = cameraX;
    this.cameraZ = cameraZ;
    this.crowd?.update(cameraX, cameraZ);
    if (!this.mesh || !this.geometry || !this.glowMesh || !this.glowGeometry) return;
    if (Math.hypot(cameraX - this.filledX, cameraZ - this.filledZ) < LIGHTS_REFILL_M) return;
    this.filledX = cameraX;
    this.filledZ = cameraZ;
    let w = 0;
    let gw = 0;
    let bulbs = 0;
    for (const sp of this.spans) {
      if (Math.hypot(sp.x - cameraX, sp.z - cameraZ) > LIGHTS_DRAW_M) continue;
      for (let k = 0; k < sp.n; k++) this.live[w++] = sp.v0 + k;
      for (let k = 0; k < sp.gn; k++) this.glowLive[gw++] = sp.g0 + k;
      bulbs += sp.bulbs;
    }
    this.shownBulbs = bulbs;
    this.shownVerts = w;
    this.shownGlowVerts = gw;
    const index = this.geometry.getIndex();
    if (index) index.needsUpdate = true;
    this.geometry.setDrawRange(0, w);
    this.mesh.visible = w > 0;
    const gIndex = this.glowGeometry.getIndex();
    if (gIndex) gIndex.needsUpdate = true;
    this.glowGeometry.setDrawRange(0, gw);
    this.glowMesh.visible = gw > 0;
  }

  /** Every bulb hung (tests). */
  bulbs(): readonly PartyBulb[] {
    return this.bulbList;
  }

  /** Every reveller on a balcony (tests). */
  revellers(): readonly { x: number; y: number; z: number }[] {
    return this.crowd?.revellers() ?? [];
  }

  /** Every person standing on a party block's pavement (tests). */
  walkers(): readonly { x: number; y: number; z: number }[] {
    return this.crowd?.walkers() ?? [];
  }

  counts(): PartyLightsCounts {
    const crowd = this.crowd?.counts() ?? null;
    return {
      runs: this.runList.length,
      crossings: this.crossings,
      bulbs: this.bulbList.length,
      shownBulbs: this.shownBulbs,
      triangles: (this.shownVerts + this.shownGlowVerts) / 3 + (crowd?.triangles ?? 0),
      drawCalls: (this.mesh?.visible ? 1 : 0) + (this.glowMesh?.visible ? 1 : 0) + (crowd?.drawCalls ?? 0),
      crowd,
    };
  }

  dispose(): void {
    this.group.removeFromParent();
    this.geometry?.dispose();
    this.glowGeometry?.dispose();
    (this.glowMesh?.material as MeshBasicMaterial | undefined)?.dispose();
    this.crowd?.dispose();
  }
}
