// A party street's string lights (playtest 4, P4-16: "Duval St should be a party street"; neon and
// string lights at dusk). A `roadsideZone` whose `params.dressing` is `party` is a stretch of bars and
// crowds: at dusk and after, its side of the road gets a line of posts in front of the shopfronts, with
// a string of coloured bulbs hung between them, sagging. Code-made and unlit (the bulbs read as light
// sources in every look), one mesh and one draw call whatever the length of the street: the whole
// street's bulbs sit in one static buffer and an index of the ones near the camera is refilled as it
// moves (as text-surfaces.ts does for its words). Presentation only: nothing here reaches the sim, and
// nothing hangs where a bike can ride (the line stands past the sidewalk, 4 m up and more). A lazy
// chunk, loaded only for a road that has a party zone. By day (noon, golden hour) it builds nothing.
import { BufferGeometry, BufferAttribute, Color, Float32BufferAttribute, Group, Mesh } from 'three';
import type { RoadNetwork } from '../sim/api';
import type { LookStyle } from './look';
import type { RoadDressing } from './road-mesh';
import { LAND_TOP_M, scatterHash } from './scenery';

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
export const POST_H_M = 4.4;
export const SAG_M = 0.7;
/** The line of posts stands this far past the road's verge, m: in front of the shopfronts (9 m). [default] */
export const POST_OUT_M = 8.2;
const VERGE_M = 0.6;
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
}

export interface PartyLightsCounts {
  runs: number;
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
    for (const run of this.runList) {
      const e = road.edges[run.edge];
      if (!e) continue;
      const outer = (run.side < 0 ? -e.dMin : e.dMax) + VERGE_M;
      const d = run.side * (outer + POST_OUT_M);
      const n = Math.max(1, Math.round((run.s1 - run.s0) / POST_EVERY_M));
      const step = (run.s1 - run.s0) / n;
      // Posts at both ends of every span; the land must reach them.
      const post = (s: number) => {
        if (input.landReach && input.landReach(run.edge, run.side, s) < POST_OUT_M + 1) return null;
        const w = road.toWorld(run.edge, s, d, LAND_TOP_M);
        return { s, x: w.x, y: w.y, z: w.z };
      };
      for (let k = 0; k < n; k++) {
        const a = post(run.s0 + k * step);
        const b = post(run.s0 + (k + 1) * step);
        if (!a || !b) continue;
        const v0 = pos.length / 3;
        // The post at the span's start, standing on the ground.
        cross(a.x, a.y + POST_H_M / 2, a.z, POST_R, POST_H_M / 2, POST_COLOUR);
        const bulbs = Math.max(2, Math.round(step / BULB_EVERY_M));
        for (let i = 1; i < bulbs; i++) {
          const t = i / bulbs;
          const w = road.toWorld(run.edge, a.s + (b.s - a.s) * t, d, LAND_TOP_M);
          const y = w.y + POST_H_M - SAG_M * 4 * t * (1 - t);
          // The colour: a seeded run of the palette, so no two strings repeat.
          const pick = Math.floor(
            scatterHash(seed, 4417 + run.edge, a.s + i * 0.01, k) * BULB_COLOURS.length,
          );
          const colour = BULB_COLOURS[pick] ?? '#ffffff';
          cross(w.x, y, w.z, BULB_R, BULB_R * 1.25, colour);
          this.bulbList.push({ x: w.x, y, z: w.z, colour });
        }
        // The last span of a run is closed by its far post.
        if (k === n - 1) cross(b.x, b.y + POST_H_M / 2, b.z, POST_R, POST_H_M / 2, POST_COLOUR);
        this.spans.push({
          v0,
          n: pos.length / 3 - v0,
          x: (a.x + b.x) / 2,
          z: (a.z + b.z) / 2,
          bulbs: bulbs - 1,
        });
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
