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
// (noon, golden hour) it builds nothing.
import { BufferGeometry, BufferAttribute, Color, Float32BufferAttribute, Group, Mesh } from 'three';
import type { RoadNetwork } from '../sim/api';
import type { Point3 } from './geometry';
import type { LookStyle } from './look';
import type { RoadDressing } from './road-mesh';
import { LAND_TOP_M, scatterHash } from './scenery';
import { hangPoints, lowestPoint } from './string-lights';

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
/** A bulb is this big, m (a crossed pair of diamonds), and a post this thick. */
const BULB_R = 0.12;
const POST_R = 0.05;
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
  /** Bulbs and triangles in the index now, and the draw calls (1 while any is shown). */
  shownBulbs: number;
  triangles: number;
  drawCalls: number;
}

export interface PartyLightsInput {
  road: RoadNetwork;
  dressing: RoadDressing | undefined;
  seed: number;
  /** Dusk or night (`isLitTime`): by day nothing is built. */
  lit: boolean;
  /** The drawn land beside the road (RoadScene.landReach); posts stand only where it reaches. */
  landReach?(edge: number, side: -1 | 1, s: number): number;
}

/** One span between two posts: its range in the vertex buffer, its middle, and its bulbs. */
interface Span {
  v0: number;
  n: number;
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
  private readonly geometry: BufferGeometry | null = null;
  private readonly mesh: Mesh | null = null;
  private filledX = Number.NaN;
  private filledZ = Number.NaN;
  private shownBulbs = 0;
  private crossings = 0;
  private shownVerts = 0;

  constructor(look: LookStyle, input: PartyLightsInput) {
    this.group.name = 'party-lights';
    const pos: number[] = [];
    const col: number[] = [];
    if (input.lit) {
      this.runList.push(...partyRuns(input.road, input.dressing));
      this.build(input, pos, col);
    }
    this.live = new Uint32Array(pos.length / 3);
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
  }

  /** Lays the posts and strings of every run into `pos` and `col` (a triangle soup), span by span. */
  private build(input: PartyLightsInput, pos: number[], col: number[]) {
    const { road, seed } = input;
    const tmp = new Color();
    // A crossed pair of upright diamonds (two quads) round a centre: seen from any side.
    const cross = (x: number, y: number, z: number, rx: number, ry: number, colour: string) => {
      tmp.set(colour);
      const quad = (ax: number, az: number) => {
        const c = [
          [x - ax, y, z - az],
          [x, y - ry, z],
          [x + ax, y, z + az],
          [x, y + ry, z],
        ] as const;
        for (const k of [0, 1, 2, 0, 2, 3] as const) {
          const v = c[k];
          pos.push(v[0], v[1], v[2]);
          col.push(tmp.r, tmp.g, tmp.b);
        }
      };
      quad(rx, 0);
      quad(0, rx);
    };
    /** Hangs the bulbs of one string between two post tops, as one span of the index. */
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
      for (const p of post) cross(p.x, p.y + POST_H_M / 2, p.z, POST_R, POST_H_M / 2, POST_COLOUR);
      const span = Math.hypot(to.x - from.x, to.z - from.z);
      const pitch = span / Math.max(2, Math.round(span / BULB_EVERY_M));
      const hung = hangPoints(from, to, { sagM, pitchM: pitch, endM: pitch });
      hung.forEach((p, i) => {
        // The colour: a seeded run of the palette, so no two strings repeat.
        const pick = Math.floor(scatterHash(seed, salt, from.x, k * 64 + i) * BULB_COLOURS.length);
        const colour = BULB_COLOURS[pick] ?? '#ffffff';
        cross(p.x, p.y, p.z, BULB_R, BULB_R * 1.25, colour);
        this.bulbList.push({ ...p, colour, over });
      });
      this.spans.push({
        v0,
        n: pos.length / 3 - v0,
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

  /** Per frame: refills the index with the spans near the camera. */
  update(cameraX: number, cameraZ: number): void {
    if (!this.mesh || !this.geometry) return;
    if (Math.hypot(cameraX - this.filledX, cameraZ - this.filledZ) < LIGHTS_REFILL_M) return;
    this.filledX = cameraX;
    this.filledZ = cameraZ;
    let w = 0;
    let bulbs = 0;
    for (const sp of this.spans) {
      if (Math.hypot(sp.x - cameraX, sp.z - cameraZ) > LIGHTS_DRAW_M) continue;
      for (let k = 0; k < sp.n; k++) this.live[w++] = sp.v0 + k;
      bulbs += sp.bulbs;
    }
    this.shownBulbs = bulbs;
    this.shownVerts = w;
    const index = this.geometry.getIndex();
    if (index) index.needsUpdate = true;
    this.geometry.setDrawRange(0, w);
    this.mesh.visible = w > 0;
  }

  /** Every bulb hung (tests). */
  bulbs(): readonly PartyBulb[] {
    return this.bulbList;
  }

  counts(): PartyLightsCounts {
    return {
      runs: this.runList.length,
      crossings: this.crossings,
      bulbs: this.bulbList.length,
      shownBulbs: this.shownBulbs,
      triangles: this.shownVerts / 3,
      drawCalls: this.mesh?.visible ? 1 : 0,
    };
  }

  dispose(): void {
    this.group.removeFromParent();
    this.geometry?.dispose();
  }
}
