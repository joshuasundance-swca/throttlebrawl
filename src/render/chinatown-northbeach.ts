// San Francisco's Chinatown and North Beach (run W-U; the pitch deck's #8, "San Francisco: a real
// city": "Chinatown and North Beach (lantern strings, awnings, cafe tables)"; interview, 2026-10-02:
// the maintainer picked all four SF districts; playtest 2, 2026-10-02: "I expected some city feeling
// not just all row houses"). This layer draws what stands on the network's tagged land
// (src/render/scenery.ts's `lanterns`, `cafes`, `crossing` and `park` themes; the road scene draws the
// land, the verge layer the pavement):
//
// - Chinatown (`lanterns`): narrow three- to five-storey buildings shoulder to shoulder, their
//   shopfronts on the sim's hard edge (road/cross-section.ts: 4 m of pavement), each with an awning
//   in a deep colour, balconies with painted railings on many, a blank blade sign on some, and
//   strings of lanterns across the street between the facades. No smashables and no crates here:
//   the pitch deck cut the chase-film grocery crates, and no region smashable lists these tags.
// - North Beach (`cafes`): lighter Italianate fronts with bay windows and cornices, striped awnings,
//   and cafe patios behind a low rail on the hard edge (3.2 m of pavement), their tables and chairs
//   drawn behind the rail where no rider reaches. The tables a rider can smash are the sim's own, on
//   the pavement (sim/smash, the region's `cafes` smashables; render/smashables.ts draws them).
// - each block's side street (`side-street`): its roadway runs off both sides, flat as the crest
//   it meets, lined with buildings and closed by a facade at its far end, with zebras on the road;
// - the hill's park (`hill-park`): trees and benches past the grass, and on the hill beyond the
//   finish, a fluted tower on its mound, never named (like the bridge);
// - a second row of plain buildings behind the first, so the blocks have depth up the hills.
//
// Drawing (the phone's budget): everything static in one STRETCH_M (240 m) stretch of road, both sides, is
// merged into one vertex-coloured mesh, built when the camera comes near and freed when it has gone;
// past NEAR_M the stretch swaps to a far stand-in (the building boxes only: no lanterns, windows,
// awnings or tables), so a stretch is one draw call either way. The tower is its own mesh. All of
// it is presentation only and placed from the race's seed; a lazy chunk loaded only on this network.
import { BufferGeometry, Float32BufferAttribute, Group, Mesh, Vector3 } from 'three';
import type { RoadNetwork } from '../road';
import type { Point3 } from './geometry';
import type { LookStyle } from './look';
import type { RoadDressing } from './road-mesh';
import { scatterHash, themeAt, type SideTag, type SideTheme } from './scenery';

/** The tags this layer draws. */
export const BLOCK_TAGS = ['lanterns', 'cafes', 'side-street', 'hill-park'] as const;

/** Whether the network has these districts at all. */
export function hasBlocks(tags: ReadonlySet<string>): boolean {
  return BLOCK_TAGS.some((t) => tags.has(t));
}

/** Static geometry merges per stretch of road this long, m. [default] */
export const STRETCH_M = 240;
/** A stretch shows its full detail within this far of the camera, its far stand-in beyond, m. [default] */
export const NEAR_M = 240;
/** Drawn out to this far (the foggy region's haze is full at 480 m), m. [default] */
export const BLOCKS_DRAW_M = 500;
const PREFETCH_M = 120;
const KEEP_M = BLOCKS_DRAW_M + 200;
/** The tower on the hill is drawn out to this far, m. */
export const TOWER_DRAW_M = 1400;

/** A building's depth from its front, m; the second row stands behind it. [default] */
const DEPTH_M = 14;
const BACK_DEPTH_M = 16;
/** The ground storey and each storey above it, m. */
const GROUND_STOREY_M = 4.2;
const STOREY_M = 3.3;
/** Every building's foot reaches this far under the lower end of its ground (the hills), m. */
const FOOT_SINK_M = 6;
/** North Beach's cafe patio: from the rail on the hard edge back to the cafe fronts, m. */
export const PATIO_M = 2.8;
/** The lanterns: a string every so often across Chinatown's street, its height and sag, m. [default] */
export const STRING_EVERY_M = 11;
const STRING_HEIGHT_M = 6.6;
const STRING_SAG_M = 0.9;
/** Metres between lanterns along a string, and their size. */
const LANTERN_PITCH_M = 1.7;
const LANTERN_R = 0.3;
const LANTERN_HALF_H = 0.38;
/** A side street's reach from the road and its roadway's half width, m. */
export const SIDE_REACH_M = 90;
const SIDE_ROAD_HALF_M = 4.2;
/** The hill's park: a tree every so often past the grass band, m. [default] */
const TREE_EVERY_M = 9;
/** The tower: how far past the finish crest it stands, out to its side, its height and radius, m. */
const TOWER_AHEAD_M = 90;
const TOWER_OUT_M = 70;
export const TOWER_HEIGHT_M = 52;
const TOWER_R = 4.6;
/** The park's back row of buildings stands this far past its grass, and clear of the tower's hill, m. */
const PARK_BACK_M = 24;
const TOWER_CLEAR_M = 75;
/** Features nothing of this layer stands in. */
const KEEP_CLEAR = new Set(['billboard', 'boostPad', 'rampTruck', 'roadsideZone', 'copSpawn']);

/** Flat colours. [default] Clean paint, no grime (maintainer, 2026-09-30: no crack, rust, grime). */
export const BLOCK_COLOURS = {
  chinatownWalls: ['#c9b8a0', '#b9a58b', '#d8c9ae', '#ad8a70', '#e3d6bf', '#a39684', '#c4ab8e'],
  chinatownAccents: ['#a4282a', '#2f6b4f', '#c79a2e', '#2c3e66'],
  northBeachWalls: ['#efe6d2', '#e9d8b8', '#d9c7a6', '#c8d3cf', '#e6cfc4', '#bfc8b0', '#f2ece0'],
  northBeachStripes: [
    ['#2f5d3a', '#efe6d2'],
    ['#8c2f2f', '#efe6d2'],
    ['#2b3f5c', '#e9d8b8'],
    ['#b5652b', '#f2ece0'],
  ],
  backWalls: ['#b9ad98', '#c7bca8', '#a99d89', '#d3c8b4'],
  window: '#39424a',
  glass: '#4d5b66',
  frame: '#efe9dc',
  roof: '#8d8579',
  lantern: '#c8322b',
  lanternGold: '#e0a537',
  string: '#2b2b2b',
  rail: '#2f2f2f',
  tableTop: '#ebe6da',
  chair: '#3a3a3a',
  planter: '#5f8a48',
  patio: '#c2ad94',
  street: '#4a4b50',
  pavement: '#aaa7a0',
  zebra: '#ece9e1',
  trunk: '#6b4f3a',
  canopy: ['#4f7a3e', '#5d8a46', '#46703a'],
  bench: '#7a5a3a',
  tower: '#ece6d6',
  towerDark: '#bdb5a3',
  mound: '#7f8c6c',
} as const;

/** A coloured triangle soup (three vertices per triangle). */
interface Soup {
  pos: number[];
  col: number[];
}

/** A placed building of the front row (tests read these). */
export interface Building {
  edge: number;
  side: -1 | 1;
  s0: number;
  s1: number;
  /** Its front's distance from the centre line, m. */
  front: number;
  district: 'lanterns' | 'cafes' | 'side' | 'park';
  storeys: number;
  cafe: boolean;
}

export interface LanternString {
  edge: number;
  s: number;
  lanterns: number;
  /** Its lowest point above the road, m. */
  clearance: number;
}

export interface BlocksPlan {
  buildings: Building[];
  strings: LanternString[];
  /** Patio tables (presentation only, behind the rail). */
  tables: { edge: number; s: number; d: number }[];
  trees: number;
  sideStreets: { edge: number; s: number }[];
  tower: Point3 | null;
  near: Map<string, Soup>;
  far: Map<string, Soup>;
  towerSoup: Soup | null;
  stretches: { key: string; cx: number; cz: number; radius: number }[];
}

export interface BlocksInput {
  road: RoadNetwork;
  dressing: RoadDressing | undefined;
  seed: number;
}

const hex = (h: string): [number, number, number] => {
  const n = parseInt(h.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

const sub = (a: Point3, b: Point3): Point3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const cross = (a: Point3, b: Point3): Point3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
const dot = (a: Point3, b: Point3) => a.x * b.x + a.y * b.y + a.z * b.z;

/** A triangle facing `toward` (its front side, as three.js culls), into a soup. */
function tri(soup: Soup, a: Point3, b: Point3, c: Point3, colour: string, toward: Point3): void {
  const n = cross(sub(b, a), sub(c, a));
  if (dot(n, toward) < 0) [b, c] = [c, b];
  soup.pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  const [r, g, bl] = hex(colour);
  for (let i = 0; i < 3; i++) soup.col.push(r, g, bl);
}

/** A quad a-b-c-d (in order round its edge) facing `toward`. */
function quad(soup: Soup, a: Point3, b: Point3, c: Point3, d: Point3, colour: string, toward: Point3): void {
  tri(soup, a, b, c, colour, toward);
  tri(soup, a, c, d, colour, toward);
}

const UP: Point3 = { x: 0, y: 1, z: 0 };
const DOWN: Point3 = { x: 0, y: -1, z: 0 };

/**
 * A local frame on the ground: an origin, a unit `a` along a frontage and a unit `n` away from the
 * street (into the building). P(t, k, y) is t along, k in, at world height y.
 */
interface Frame {
  o: Point3;
  a: Point3;
  n: Point3;
}
const at = (f: Frame, t: number, k: number, y: number): Point3 => ({
  x: f.o.x + f.a.x * t + f.n.x * k,
  y,
  z: f.o.z + f.a.z * t + f.n.z * k,
});
const neg = (p: Point3): Point3 => ({ x: -p.x, y: -p.y, z: -p.z });

/**
 * A box in a frame: t0..t1 along, k0..k1 in, y0..y1 high. `faces` picks which to draw (the front
 * faces the street, -n): f(ront), b(ack), l(eft, t0), r(ight, t1), t(op), u(nder).
 */
function box(
  soup: Soup,
  f: Frame,
  t0: number,
  t1: number,
  k0: number,
  k1: number,
  y0: number,
  y1: number,
  colour: string,
  faces = 'flrt',
  topColour: string = colour,
): void {
  const p = (t: number, k: number, y: number) => at(f, t, k, y);
  if (faces.includes('f'))
    quad(soup, p(t0, k0, y0), p(t1, k0, y0), p(t1, k0, y1), p(t0, k0, y1), colour, neg(f.n));
  if (faces.includes('b'))
    quad(soup, p(t0, k1, y0), p(t1, k1, y0), p(t1, k1, y1), p(t0, k1, y1), colour, f.n);
  if (faces.includes('l'))
    quad(soup, p(t0, k0, y0), p(t0, k1, y0), p(t0, k1, y1), p(t0, k0, y1), colour, neg(f.a));
  if (faces.includes('r'))
    quad(soup, p(t1, k0, y0), p(t1, k1, y0), p(t1, k1, y1), p(t1, k0, y1), colour, f.a);
  if (faces.includes('t'))
    quad(soup, p(t0, k0, y1), p(t1, k0, y1), p(t1, k1, y1), p(t0, k1, y1), topColour, UP);
  if (faces.includes('u'))
    quad(soup, p(t0, k0, y0), p(t1, k0, y0), p(t1, k1, y0), p(t0, k1, y0), colour, DOWN);
}

/** A flat quad on a facade (a window, a shopfront) just proud of the front plane. */
function panel(
  soup: Soup,
  f: Frame,
  t0: number,
  t1: number,
  y0: number,
  y1: number,
  colour: string,
  k = -0.06,
): void {
  quad(soup, at(f, t0, k, y0), at(f, t1, k, y0), at(f, t1, k, y1), at(f, t0, k, y1), colour, neg(f.n));
}

/** A lantern: a six-sided bicone hanging from (c) by its top. */
function lantern(soup: Soup, c: Point3, colour: string): void {
  const top = { x: c.x, y: c.y, z: c.z };
  const mid = c.y - LANTERN_HALF_H;
  const bottom = { x: c.x, y: c.y - 2 * LANTERN_HALF_H, z: c.z };
  const ring: Point3[] = [];
  for (let i = 0; i < 6; i++) {
    const ang = (i / 6) * Math.PI * 2;
    ring.push({ x: c.x + Math.cos(ang) * LANTERN_R, y: mid, z: c.z + Math.sin(ang) * LANTERN_R });
  }
  for (let i = 0; i < 6; i++) {
    const a = ring[i] as Point3;
    const b = ring[(i + 1) % 6] as Point3;
    const out = { x: (a.x + b.x) / 2 - c.x, y: 0, z: (a.z + b.z) / 2 - c.z };
    tri(soup, top, a, b, colour, { ...out, y: 0.5 });
    tri(soup, bottom, a, b, colour, { ...out, y: -0.5 });
  }
}

/** A tree: a trunk and a two-tier canopy (a low-poly cypress or a street tree). */
function tree(soup: Soup, base: Point3, h: number, colour: string): void {
  const f: Frame = { o: base, a: { x: 1, y: 0, z: 0 }, n: { x: 0, y: 0, z: 1 } };
  box(soup, f, -0.18, 0.18, -0.18, 0.18, base.y - 0.3, base.y + h * 0.35, BLOCK_COLOURS.trunk, 'fblr');
  // A rounded crown: two rings between a low point and a top point, so it reads as a canopy.
  const r = h * 0.3;
  const ringAt = (y: number, rr: number, phase: number) =>
    Array.from({ length: 6 }, (_v, i) => {
      const ang = phase + (i / 6) * Math.PI * 2;
      return { x: base.x + Math.cos(ang) * rr, y, z: base.z + Math.sin(ang) * rr };
    });
  const lower = ringAt(base.y + h * 0.5, r, 0);
  const upper = ringAt(base.y + h * 0.78, r * 0.75, Math.PI / 6);
  const top = { x: base.x, y: base.y + h, z: base.z };
  const low = { x: base.x, y: base.y + h * 0.3, z: base.z };
  const outOf = (a: Point3, b: Point3, y: number) => ({
    x: (a.x + b.x) / 2 - base.x,
    y,
    z: (a.z + b.z) / 2 - base.z,
  });
  for (let i = 0; i < 6; i++) {
    const a = lower[i] as Point3;
    const b = lower[(i + 1) % 6] as Point3;
    const c = upper[i] as Point3;
    const d = upper[(i + 1) % 6] as Point3;
    tri(soup, low, a, b, colour, outOf(a, b, -0.8));
    tri(soup, a, b, c, colour, outOf(a, b, 0.3));
    tri(soup, b, d, c, colour, outOf(c, d, 0.3));
    tri(soup, top, c, d, colour, outOf(c, d, 0.8));
  }
}

/** The ground's height under a frame point: the road's height at that s (the land is level with it). */
type GroundAt = (t: number) => number;

/** One front-row building's look, decided from the seed. */
interface Look {
  district: 'lanterns' | 'cafes';
  storeys: number;
  wall: string;
  accent: string;
  stripes: readonly [string, string] | null;
  balconies: boolean;
  blade: boolean;
  bay: boolean;
  cafe: boolean;
}

function pick<T>(list: readonly T[], u: number): T {
  return list[Math.min(list.length - 1, Math.floor(u * list.length))] as T;
}

/**
 * Draws one building of the front row into the near soup (its whole look) and the far soup (its box).
 * `f`'s origin is the front's left end at t 0, the front `width` long; `ground` gives the ground
 * height along the front.
 */
function building(near: Soup, far: Soup, f: Frame, width: number, ground: GroundAt, look: Look): void {
  const g0 = ground(0);
  const g1 = ground(width);
  const lo = Math.min(g0, g1);
  const hi = Math.max(g0, g1);
  // The facade's own floor line: between its two ends, so the shopfront stays above the ground at
  // the low end and a plinth shows there on a hill.
  const gy = (g0 + g1) / 2 + 0.35;
  const top = hi + GROUND_STOREY_M + STOREY_M * (look.storeys - 1) + 0.9;
  const foot = lo - FOOT_SINK_M;
  for (const soup of [near, far])
    box(soup, f, 0, width, 0, DEPTH_M, foot, top, look.wall, 'flrt', BLOCK_COLOURS.roof);
  // Far stand-in: one band of the awning colour and a darker band of upper windows.
  panel(far, f, 0.4, width - 0.4, gy + 2.6, gy + 3.4, look.stripes?.[0] ?? look.accent);
  panel(far, f, 0.6, width - 0.6, gy + GROUND_STOREY_M + 0.7, top - 1.6, BLOCK_COLOURS.window, -0.04);

  // Near: the shopfront (glass between two piers), its door, the awning over it.
  panel(near, f, 0.45, width - 0.45, gy + 0.2, gy + 2.9, BLOCK_COLOURS.glass);
  const door = width * (look.cafe ? 0.18 : 0.5);
  panel(near, f, door - 0.55, door + 0.55, gy + 0.05, gy + 2.5, BLOCK_COLOURS.window, -0.08);
  const awnOut = look.district === 'cafes' ? 1.7 : 1.4;
  const aTop = gy + 3.45;
  const aLow = gy + 2.75;
  if (look.stripes) {
    const strip = 0.7;
    for (let t = 0.3, i = 0; t < width - 0.3; t += strip, i++) {
      const t1 = Math.min(width - 0.3, t + strip);
      const c = look.stripes[i % 2] as string;
      quad(
        near,
        at(f, t, 0, aTop),
        at(f, t1, 0, aTop),
        at(f, t1, -awnOut, aLow),
        at(f, t, -awnOut, aLow),
        c,
        {
          ...neg(f.n),
          y: 1.2,
        },
      );
      // The valance hanging from its front edge.
      panel(near, { ...f, o: at(f, 0, -awnOut, 0) }, t, t1, aLow - 0.32, aLow, c, 0);
    }
  } else {
    quad(
      near,
      at(f, 0.3, 0, aTop),
      at(f, width - 0.3, 0, aTop),
      at(f, width - 0.3, -awnOut, aLow),
      at(f, 0.3, -awnOut, aLow),
      look.accent,
      { ...neg(f.n), y: 1.2 },
    );
    panel(near, { ...f, o: at(f, 0, -awnOut, 0) }, 0.3, width - 0.3, aLow - 0.28, aLow, look.accent, 0);
  }
  // The upper storeys: a row of windows each, with balconies on some Chinatown buildings and a bay
  // window up the middle on some North Beach ones.
  const perRow = Math.max(2, Math.floor(width / 2.5));
  const pitch = width / perRow;
  for (let s = 1; s < look.storeys; s++) {
    const y0 = gy + GROUND_STOREY_M + STOREY_M * (s - 1) + 0.75;
    for (let i = 0; i < perRow; i++) {
      const c = (i + 0.5) * pitch;
      panel(near, f, c - 0.62, c + 0.62, y0, y0 + 1.75, BLOCK_COLOURS.window);
    }
    if (look.balconies) {
      const b0 = width * 0.12;
      const b1 = width * 0.88;
      box(near, f, b0, b1, -0.95, 0, y0 - 0.2, y0 - 0.05, BLOCK_COLOURS.frame, 'flrtu');
      // The railing: its front and ends as panels, in the building's accent.
      panel(near, { ...f, o: at(f, 0, -0.95, 0) }, b0, b1, y0 - 0.05, y0 + 0.85, look.accent, 0);
    }
  }
  if (look.bay && look.storeys > 2) {
    const c = width / 2;
    const y0 = gy + GROUND_STOREY_M + 0.4;
    const y1 = top - 1.3;
    box(near, f, c - 1.7, c + 1.7, -0.85, 0, y0, y1, look.wall, 'flrtu');
    for (let s = 1; s < look.storeys; s++) {
      const wy = gy + GROUND_STOREY_M + STOREY_M * (s - 1) + 0.75;
      panel(near, f, c - 1.3, c + 1.3, wy, wy + 1.75, BLOCK_COLOURS.glass, -0.9);
    }
  }
  if (look.blade) {
    // A vertical sign board standing out from the facade, left blank: no invented lettering on a
    // real neighbourhood's shops (the brief: signs are invented and respectful).
    const t = width - 0.6;
    const y0 = gy + GROUND_STOREY_M + 0.4;
    box(
      near,
      f,
      t - 0.08,
      t + 0.08,
      -1.3,
      -0.15,
      y0,
      y0 + Math.min(5, STOREY_M * (look.storeys - 1) - 0.4),
      look.accent,
      'flrtu',
    );
  }
  // The cornice: a band standing out along the top.
  box(
    near,
    f,
    0,
    width,
    -0.45,
    0,
    top - 0.75,
    top - 0.35,
    look.district === 'cafes' ? BLOCK_COLOURS.frame : look.accent,
    'flrtu',
  );
}

/** Plans the districts of a network: buildings, lanterns, patios, side streets, the park and the tower. */
export function planBlocks(input: BlocksInput): BlocksPlan {
  const { road, dressing, seed } = input;
  const near = new Map<string, Soup>();
  const far = new Map<string, Soup>();
  const centres = new Map<string, { xs: number; zs: number; n: number; pts: Point3[] }>();
  const plan: BlocksPlan = {
    buildings: [],
    strings: [],
    tables: [],
    trees: 0,
    sideStreets: [],
    tower: null,
    near,
    far,
    towerSoup: null,
    stretches: [],
  };
  const keyOf = (edge: number, s: number) => `${edge}:${Math.floor(Math.max(0, s) / STRETCH_M)}`;
  const soupsAt = (edge: number, s: number): [Soup, Soup] => {
    const key = keyOf(edge, s);
    let n = near.get(key);
    let fs = far.get(key);
    if (!n) near.set(key, (n = { pos: [], col: [] }));
    if (!fs) far.set(key, (fs = { pos: [], col: [] }));
    return [n, fs];
  };
  const note = (edge: number, s: number, p: Point3) => {
    const key = keyOf(edge, s);
    const c = centres.get(key) ?? { xs: 0, zs: 0, n: 0, pts: [] };
    c.xs += p.x;
    c.zs += p.z;
    c.n++;
    c.pts.push(p);
    centres.set(key, c);
  };

  let towerAt: { edge: number; s: number; side: -1 | 1 } | null = null;
  const parkRow: {
    edge: number;
    side: -1 | 1;
    s0: number;
    s1: number;
    d: number;
    storeys: number;
    wall: string;
  }[] = [];
  for (const e of road.edges) {
    const dress = dressing?.[e.id];
    const tags = (dress?.tags ?? e.tags) as readonly SideTag[] | undefined;
    if (!tags?.some((t) => (BLOCK_TAGS as readonly string[]).includes(t.tag))) continue;
    const features = (dress?.features ?? e.features).filter((f) => KEEP_CLEAR.has(f.kind));
    const h = (k: number, side: number, salt: number) =>
      scatterHash(seed, 7019 + e.index * 613, k, side * 41 + salt);
    const w = (s: number, d: number, y = 0) =>
      road.toWorld(e.index, Math.max(0, Math.min(e.length, s)), d, y);
    const theme = (side: -1 | 1, s: number): SideTheme => themeAt(tags, side < 0 ? 'left' : 'right', s);
    /** The sim's hard (or soft) edge on a side at s: the verge band's outer edge, as a distance. */
    const edgeAt = (side: -1 | 1, s: number) =>
      Math.abs(road.vergeAt(e.index, Math.max(0, Math.min(e.length, s)), side < 0 ? 'left' : 'right').dOuter);
    const runs = (side: -1 | 1, want: SideTheme): [number, number][] => {
      const out: [number, number][] = [];
      let start = -1;
      for (let s = 0; s <= e.length + 1e-6; s += 2) {
        const here = theme(side, Math.min(s, e.length)) === want;
        if (here && start < 0) start = s;
        if ((!here || s + 2 > e.length + 1e-6) && start >= 0) {
          out.push([start, here ? e.length : s - 2]);
          start = -1;
        }
      }
      return out;
    };
    const clearOf = (side: -1 | 1, s0: number, s1: number, a0: number, a1: number) =>
      !features.some((f) => {
        const lo = Math.min(f.d0 * side, f.d1 * side);
        const hi = Math.max(f.d0 * side, f.d1 * side);
        return Math.min(f.s0, f.s1) - 1 < s1 && Math.max(f.s0, f.s1) + 1 > s0 && lo - 1 < a1 && hi + 1 > a0;
      });
    /** The frame of a frontage from s0 to s1 on a side, its front `d` out (the front's left end first). */
    const frontFrame = (side: -1 | 1, s0: number, s1: number, d: number): { f: Frame; width: number } => {
      // Seen from the street, a right-side front runs with s and a left-side one against it.
      const [sa, sb] = side > 0 ? [s0, s1] : [s1, s0];
      const p0 = w(sa, side * d);
      const p1 = w(sb, side * d);
      const len = Math.hypot(p1.x - p0.x, p1.z - p0.z) || 1;
      const a = { x: (p1.x - p0.x) / len, y: 0, z: (p1.z - p0.z) / len };
      const inward = w((s0 + s1) / 2, side * (d + 1));
      const mid = w((s0 + s1) / 2, side * d);
      let n = { x: a.z, y: 0, z: -a.x };
      if (n.x * (inward.x - mid.x) + n.z * (inward.z - mid.z) < 0) n = { x: -n.x, y: 0, z: -n.z };
      return { f: { o: { ...p0, y: 0 }, a, n }, width: len };
    };
    const groundAlong = (side: -1 | 1, s0: number, s1: number): GroundAt => {
      const [sa, sb] = side > 0 ? [s0, s1] : [s1, s0];
      const ya = w(sa, 0).y;
      const yb = w(sb, 0).y;
      const len = Math.abs(s1 - s0) || 1;
      return (t: number) => ya + ((yb - ya) * Math.max(0, Math.min(len, t))) / len;
    };

    // Side streets: one per span (both sides share it).
    const seen = new Set<number>();
    for (const t of tags) {
      if (t.tag !== 'side-street') continue;
      const s = (t.s0 + t.s1) / 2;
      if (seen.has(s)) continue;
      seen.add(s);
      plan.sideStreets.push({ edge: e.index, s });
      const half = (t.s1 - t.s0) / 2;
      const [n, fs] = soupsAt(e.index, s);
      const y = w(s, 0).y;
      for (const side of [-1, 1] as const) {
        const edge = road.vergeAt(e.index, s, side < 0 ? 'left' : 'right').dInner;
        const o = w(s, side * Math.abs(edge));
        const outward = w(s, side * (Math.abs(edge) + 1));
        const n0 = { x: outward.x - o.x, y: 0, z: outward.z - o.z };
        const nl = Math.hypot(n0.x, n0.z) || 1;
        const a0 = w(s + 1, side * Math.abs(edge));
        const al = Math.hypot(a0.x - o.x, a0.z - o.z) || 1;
        // Frame: t along the side street (away from the road), k across it.
        const f: Frame = {
          o: { ...o, y: 0 },
          a: { x: n0.x / nl, y: 0, z: n0.z / nl },
          n: { x: (a0.x - o.x) / al, y: 0, z: (a0.z - o.z) / al },
        };
        for (const soup of [n, fs]) {
          quad(
            soup,
            at(f, 0, -SIDE_ROAD_HALF_M, y + 0.03),
            at(f, SIDE_REACH_M, -SIDE_ROAD_HALF_M, y + 0.03),
            at(f, SIDE_REACH_M, SIDE_ROAD_HALF_M, y + 0.03),
            at(f, 0, SIDE_ROAD_HALF_M, y + 0.03),
            BLOCK_COLOURS.street,
            UP,
          );
          for (const k of [-1, 1]) {
            const k0 = k * SIDE_ROAD_HALF_M;
            const k1 = k * half;
            quad(
              soup,
              at(f, 0, k0, y + 0.07),
              at(f, SIDE_REACH_M, k0, y + 0.07),
              at(f, SIDE_REACH_M, k1, y + 0.07),
              at(f, 0, k1, y + 0.07),
              BLOCK_COLOURS.pavement,
              UP,
            );
          }
        }
        // Buildings line it from behind the corner buildings out, and one closes its far end.
        for (const k of [-1, 1] as const) {
          let cursor = DEPTH_M + 4;
          for (let i = 0; cursor < SIDE_REACH_M - 8; i++) {
            const wd = 8 + 5 * h(i + Math.round(s), side * 3 + k, 11);
            const t0 = cursor;
            const t1 = Math.min(SIDE_REACH_M, cursor + wd);
            cursor = t1 + 0.3;
            const storeys = 3 + Math.floor(h(i, side * 3 + k, 12) * 3);
            const top = y + GROUND_STOREY_M + STOREY_M * (storeys - 1) + 0.8;
            // Its front faces the side street (k toward the street is -k).
            const g: Frame = { o: at(f, 0, k * half, 0), a: f.a, n: k > 0 ? f.n : neg(f.n) };
            const wall = pick(
              theme(side, s - half - 3) === 'lanterns'
                ? BLOCK_COLOURS.chinatownWalls
                : BLOCK_COLOURS.northBeachWalls,
              h(i, k, 13),
            );
            for (const soup of [n, fs])
              box(soup, g, t0, t1, 0, DEPTH_M, y - FOOT_SINK_M, top, wall, 'flrt', BLOCK_COLOURS.roof);
            for (let st = 1; st < storeys; st++) {
              const wy = y + GROUND_STOREY_M + STOREY_M * (st - 1) + 0.8;
              panel(n, g, t0 + 0.8, t1 - 0.8, wy, wy + 1.6, BLOCK_COLOURS.window);
            }
            plan.buildings.push({
              edge: e.index,
              side,
              s0: s,
              s1: s,
              front: t0,
              district: 'side',
              storeys,
              cafe: false,
            });
          }
        }
        const endTop = y + GROUND_STOREY_M + STOREY_M * 3;
        for (const soup of [n, fs])
          box(
            soup,
            f,
            SIDE_REACH_M,
            SIDE_REACH_M + DEPTH_M,
            -half - 2,
            half + 2,
            y - FOOT_SINK_M,
            endTop,
            pick(BLOCK_COLOURS.backWalls, h(3, side, 14)),
            'lrt',
            BLOCK_COLOURS.roof,
          );
        // The end facade faces back down the street.
        for (const soup of [n, fs])
          quad(
            soup,
            at(f, SIDE_REACH_M, -half - 2, y - 1),
            at(f, SIDE_REACH_M, half + 2, y - 1),
            at(f, SIDE_REACH_M, half + 2, endTop),
            at(f, SIDE_REACH_M, -half - 2, endTop),
            pick(BLOCK_COLOURS.backWalls, h(4, side, 14)),
            neg(f.a),
          );
        note(e.index, s, at(f, SIDE_REACH_M, 0, y));
      }
      // Zebras across the road on both sides of the side street.
      for (const s0 of [s - half + 0.5, s + half - 3.5]) {
        for (let d = -5.5 + 0.4; d + 0.6 <= 5.5 - 0.4; d += 1.3) {
          const p = (u: number, v: number) =>
            road.toWorld(e.index, Math.max(0, Math.min(e.length, u)), v, 0.035);
          quad(n, p(s0, d), p(s0, d + 0.6), p(s0 + 3, d + 0.6), p(s0 + 3, d), BLOCK_COLOURS.zebra, UP);
        }
      }
    }

    for (const side of [-1, 1] as const) {
      for (const district of ['lanterns', 'cafes'] as const) {
        for (const [a, b] of runs(side, district)) {
          // The front row, shoulder to shoulder.
          let cursor = a + 0.4;
          for (let k = 0; ; k++) {
            const u = h(k + Math.round(a), side, 1);
            let width = district === 'lanterns' ? 6 + 4 * u : 7 + 4.5 * u;
            if (cursor + width > b - 0.3) {
              width = b - 0.3 - cursor;
              if (width < 5) break;
            }
            const s0 = cursor;
            const s1 = cursor + width;
            cursor = s1 + 0.25;
            const edgeD = edgeAt(side, (s0 + s1) / 2);
            const frontD = district === 'cafes' ? edgeD + PATIO_M : edgeD;
            if (!clearOf(side, s0, s1, frontD, frontD + DEPTH_M)) continue;
            const { f, width: len } = frontFrame(side, s0, s1, frontD);
            const ground = groundAlong(side, s0, s1);
            const v = (salt: number) => h(k + Math.round(a), side, salt);
            const cafe = district === 'cafes' && v(2) < 0.6;
            const look: Look = {
              district,
              storeys: district === 'lanterns' ? 3 + Math.floor(v(3) * 3) : 3 + Math.floor(v(3) * 2),
              wall: pick(
                district === 'lanterns' ? BLOCK_COLOURS.chinatownWalls : BLOCK_COLOURS.northBeachWalls,
                v(4),
              ),
              accent: pick(BLOCK_COLOURS.chinatownAccents, v(5)),
              stripes: district === 'cafes' ? pick(BLOCK_COLOURS.northBeachStripes, v(6)) : null,
              balconies: district === 'lanterns' && v(7) < 0.55,
              blade: district === 'lanterns' && v(8) < 0.4,
              bay: district === 'cafes' && v(9) < 0.6,
              cafe,
            };
            const [n, fs] = soupsAt(e.index, (s0 + s1) / 2);
            building(n, fs, f, len, ground, look);
            plan.buildings.push({
              edge: e.index,
              side,
              s0,
              s1,
              front: frontD,
              district,
              storeys: look.storeys,
              cafe,
            });
            note(e.index, (s0 + s1) / 2, at(f, len / 2, 0, 0));
            // The second row behind it: a plain box, a different height.
            const back = frontFrame(side, s0, s1, frontD + DEPTH_M + 0.5);
            const bt = ground(len) + GROUND_STOREY_M + STOREY_M * (1 + Math.floor(v(10) * 4));
            for (const soup of [n, fs])
              box(
                soup,
                back.f,
                0,
                back.width,
                0,
                BACK_DEPTH_M,
                Math.min(ground(0), ground(len)) - FOOT_SINK_M,
                bt,
                pick(BLOCK_COLOURS.backWalls, v(11)),
                'flrt',
                BLOCK_COLOURS.roof,
              );
            // North Beach: the cafe patio behind the rail. A cafe gets two or three tables and
            // their chairs; the rail and its planters run along every front.
            if (district === 'cafes') {
              const railF = frontFrame(side, s0, s1, edgeD).f;
              const ry = (t: number) => ground(t);
              // The patio's tiles, from the rail back to the front.
              for (const soup of [n, fs])
                quad(
                  soup,
                  at(railF, 0, 0, ry(0) + 0.04),
                  at(railF, len, 0, ry(len) + 0.04),
                  at(railF, len, PATIO_M, ry(len) + 0.04),
                  at(railF, 0, PATIO_M, ry(0) + 0.04),
                  BLOCK_COLOURS.patio,
                  UP,
                );
              for (let t = 0.3; t < len - 0.2; t += 2) {
                const y = ry(t);
                box(n, railF, t, t + 0.08, 0.02, 0.1, y - 0.2, y + 0.9, BLOCK_COLOURS.rail, 'flr');
              }
              const ya = ry(0);
              const yb = ry(len);
              quad(
                n,
                at(railF, 0, 0.02, ya + 0.86),
                at(railF, len, 0.02, yb + 0.86),
                at(railF, len, 0.02, yb + 0.94),
                at(railF, 0, 0.02, ya + 0.94),
                BLOCK_COLOURS.rail,
                neg(railF.n),
              );
              box(
                fs,
                railF,
                0,
                len,
                0,
                0.1,
                Math.min(ya, yb) - 0.2,
                Math.max(ya, yb) + 0.9,
                BLOCK_COLOURS.rail,
                'f',
              );
              if (cafe) {
                const count = 2 + (v(12) < 0.5 ? 1 : 0);
                for (let i = 0; i < count; i++) {
                  const t = 1.6 + i * 2.6;
                  if (t > len - 1.2) break;
                  const y = ry(t);
                  const c = at(railF, t, 1.4, y);
                  // The round top (an octagon), its stem, and two chairs.
                  const ring: Point3[] = [];
                  for (let j = 0; j < 8; j++) {
                    const ang = (j / 8) * Math.PI * 2;
                    ring.push({ x: c.x + Math.cos(ang) * 0.42, y: y + 0.74, z: c.z + Math.sin(ang) * 0.42 });
                  }
                  for (let j = 1; j < 7; j++)
                    tri(
                      n,
                      ring[0] as Point3,
                      ring[j] as Point3,
                      ring[j + 1] as Point3,
                      BLOCK_COLOURS.tableTop,
                      UP,
                    );
                  box(
                    n,
                    { o: c, a: railF.a, n: railF.n },
                    -0.05,
                    0.05,
                    -0.05,
                    0.05,
                    y,
                    y + 0.72,
                    BLOCK_COLOURS.chair,
                    'fl',
                  );
                  for (const off of [-0.7, 0.7]) {
                    const cf: Frame = { o: at(railF, t + off, 1.4, 0), a: railF.a, n: railF.n };
                    box(n, cf, -0.22, 0.22, -0.22, 0.22, y + 0.42, y + 0.47, BLOCK_COLOURS.chair, 'flrt');
                    box(
                      n,
                      cf,
                      off > 0 ? 0.18 : -0.22,
                      off > 0 ? 0.22 : -0.18,
                      -0.22,
                      0.22,
                      y + 0.42,
                      y + 0.9,
                      BLOCK_COLOURS.chair,
                      'flr',
                    );
                  }
                  plan.tables.push({
                    edge: e.index,
                    s: s0 + (side > 0 ? t : len - t),
                    d: side * (edgeD + 1.4),
                  });
                }
              } else if (v(13) < 0.7) {
                for (let t = 1.2; t < len - 1; t += 3.2) {
                  const y = ry(t);
                  box(n, railF, t - 0.5, t + 0.5, 0.2, 0.7, y - 0.1, y + 0.55, BLOCK_COLOURS.planter, 'flrt');
                }
              }
            }
          }

          // Chinatown: lantern strings across the street, where both sides are lantern fronts.
          if (district === 'lanterns' && side > 0) {
            for (let k = 0; ; k++) {
              const s = a + 5 + k * STRING_EVERY_M + (h(k, 0, 20) - 0.5) * 3;
              if (s > b - 3) break;
              if (theme(-1, s) !== 'lanterns') continue;
              const left = edgeAt(-1, s);
              const right = edgeAt(1, s);
              const y = w(s, 0).y + STRING_HEIGHT_M;
              const span = left + right;
              const pts: Point3[] = [];
              const N = 10;
              for (let i = 0; i <= N; i++) {
                const d = -left + (span * i) / N;
                const u = i / N;
                const p = w(s, d);
                pts.push({ x: p.x, y: y - 4 * STRING_SAG_M * u * (1 - u), z: p.z });
              }
              const [n] = soupsAt(e.index, s);
              const fwd = sub(w(s - 1, 0), w(s, 0));
              const facing = { x: fwd.x, y: 0, z: fwd.z };
              for (let i = 0; i < N; i++) {
                const p = pts[i] as Point3;
                const q = pts[i + 1] as Point3;
                quad(n, p, q, { ...q, y: q.y - 0.06 }, { ...p, y: p.y - 0.06 }, BLOCK_COLOURS.string, facing);
                quad(
                  n,
                  p,
                  q,
                  { ...q, y: q.y - 0.06 },
                  { ...p, y: p.y - 0.06 },
                  BLOCK_COLOURS.string,
                  neg(facing),
                );
              }
              let count = 0;
              const gold = h(k, 1, 21) < 0.2;
              for (let dd = 1.2; dd < span - 1.2; dd += LANTERN_PITCH_M) {
                const u = dd / span;
                const p = w(s, -left + dd);
                const c = { x: p.x, y: y - 4 * STRING_SAG_M * u * (1 - u) - 0.05, z: p.z };
                lantern(n, c, gold && count % 2 === 1 ? BLOCK_COLOURS.lanternGold : BLOCK_COLOURS.lantern);
                count++;
              }
              plan.strings.push({
                edge: e.index,
                s,
                lanterns: count,
                clearance: STRING_HEIGHT_M - STRING_SAG_M - 2 * LANTERN_HALF_H - 0.05,
              });
            }
          }
        }
      }

      // The hill's park: trees and benches past the grass band; the tower's spot.
      for (const [a, b] of runs(side, 'park')) {
        for (let k = 0; ; k++) {
          const s = a + 4 + k * TREE_EVERY_M + (h(k, side, 30) - 0.5) * 4;
          if (s > b - 2) break;
          const edgeD = edgeAt(side, s);
          for (const row of [0, 1] as const) {
            if (row === 1 && h(k, side, 31) < 0.4) continue;
            const d = edgeD + 1.5 + row * 7 + h(k, side, 32 + row) * 3;
            if (!clearOf(side, s - 2, s + 2, d - 2, d + 2)) continue;
            const p = w(s, side * d);
            const [ns, fs] = soupsAt(e.index, s);
            const hgt = 6 + 5 * h(k, side, 34 + row);
            const colour = pick(BLOCK_COLOURS.canopy, h(k, side, 36 + row));
            tree(ns, { x: p.x, y: w(s, 0).y - 0.05, z: p.z }, hgt, colour);
            tree(fs, { x: p.x, y: w(s, 0).y - 0.05, z: p.z }, hgt, colour);
            plan.trees++;
            note(e.index, s, p);
          }
          if (h(k, side, 40) < 0.35) {
            const d = edgeD + 0.9;
            if (clearOf(side, s + 2, s + 4.5, d - 0.5, d + 1)) {
              const fr = frontFrame(side, s + 2, s + 4, d);
              const y = w(s + 3, 0).y;
              const [ns] = soupsAt(e.index, s);
              box(ns, fr.f, 0, fr.width, 0.1, 0.6, y + 0.42, y + 0.5, BLOCK_COLOURS.bench, 'flrt');
              box(ns, fr.f, 0, fr.width, 0.55, 0.62, y + 0.5, y + 0.95, BLOCK_COLOURS.bench, 'fb');
            }
          }
        }
        // The city behind the park: a row of plain buildings past the trees, so the park is a park
        // in the city, not the edge of the world (drawn once the tower's spot is known).
        for (let k = 0; ; k++) {
          const s0 = a + 6 + k * 16 + h(k, side, 50) * 3;
          const s1 = s0 + 10 + 4 * h(k, side, 51);
          if (s1 > b - 2) break;
          const d = edgeAt(side, (s0 + s1) / 2) + PARK_BACK_M;
          parkRow.push({
            edge: e.index,
            side,
            s0,
            s1,
            d,
            storeys: 2 + Math.floor(h(k, side, 52) * 3),
            wall: pick(BLOCK_COLOURS.northBeachWalls, h(k, side, 53)),
          });
        }
        if (side < 0) towerAt = { edge: e.index, s: b, side };
      }
    }
  }

  // The tower on the hill: past the finish crest on the last park's left, on its mound.
  if (towerAt) {
    const e = road.edges[towerAt.edge];
    if (e) {
      // The crest of that road: its highest point along it.
      let crestS = 0;
      let crestY = -Infinity;
      for (let s = 0; s <= e.length; s += 4) {
        const y = road.toWorld(e.index, s, 0, 0).y;
        if (y > crestY) {
          crestY = y;
          crestS = s;
        }
      }
      const s = Math.min(e.length, crestS + TOWER_AHEAD_M);
      const c = road.toWorld(e.index, s, towerAt.side * TOWER_OUT_M, 0);
      const base = road.toWorld(e.index, s, 0, 0).y - 6;
      const soup: Soup = { pos: [], col: [] };
      const top = crestY + 3;
      const ringAt = (r: number, y: number, n: number, phase = 0) =>
        Array.from({ length: n }, (_v, i) => {
          const ang = phase + (i / n) * Math.PI * 2;
          return { x: c.x + Math.cos(ang) * r, y, z: c.z + Math.sin(ang) * r };
        });
      const band = (lo: Point3[], hiR: Point3[], colour: string) => {
        for (let i = 0; i < lo.length; i++) {
          const a = lo[i] as Point3;
          const b = lo[(i + 1) % lo.length] as Point3;
          const d = hiR[(i + 1) % hiR.length] as Point3;
          const u = hiR[i] as Point3;
          quad(soup, a, b, d, u, colour, { x: (a.x + b.x) / 2 - c.x, y: 0, z: (a.z + b.z) / 2 - c.z });
        }
      };
      // The mound: a low cone frustum, flat on top.
      const m0 = ringAt(36, base, 12);
      const m1 = ringAt(15, top, 12);
      band(m0, m1, BLOCK_COLOURS.mound);
      for (let i = 1; i < 11; i++)
        tri(soup, m1[0] as Point3, m1[i] as Point3, m1[i + 1] as Point3, BLOCK_COLOURS.mound, UP);
      // The fluted column: sixteen flutes, a slight taper, a darker band of arches near the top,
      // and a crown.
      const flute = (r: number, y: number) =>
        Array.from({ length: 32 }, (_v, i) => {
          const ang = (i / 32) * Math.PI * 2;
          const rr = r * (i % 2 === 0 ? 1 : 0.9);
          return { x: c.x + Math.cos(ang) * rr, y, z: c.z + Math.sin(ang) * rr };
        });
      const y0 = top;
      const y1 = top + TOWER_HEIGHT_M - 9;
      const y2 = top + TOWER_HEIGHT_M - 4;
      const y3 = top + TOWER_HEIGHT_M;
      band(flute(TOWER_R, y0), flute(TOWER_R * 0.94, y1), BLOCK_COLOURS.tower);
      band(flute(TOWER_R * 0.94, y1), flute(TOWER_R * 0.93, y2), BLOCK_COLOURS.towerDark);
      band(ringAt(TOWER_R * 1.02, y2, 16), ringAt(TOWER_R * 0.85, y3, 16), BLOCK_COLOURS.tower);
      const cap = ringAt(TOWER_R * 0.85, y3, 16);
      for (let i = 1; i < 15; i++)
        tri(soup, cap[0] as Point3, cap[i] as Point3, cap[i + 1] as Point3, BLOCK_COLOURS.tower, UP);
      plan.tower = { x: c.x, y: top, z: c.z };
      plan.towerSoup = soup;
    }
  }
  // The buildings behind the parks, clear of the tower's hill.
  for (const r of parkRow) {
    const e = road.edges[r.edge];
    if (!e) continue;
    const w = (s: number, d: number) => road.toWorld(r.edge, Math.max(0, Math.min(e.length, s)), d, 0);
    const mid = w((r.s0 + r.s1) / 2, r.side * r.d);
    if (plan.tower && Math.hypot(mid.x - plan.tower.x, mid.z - plan.tower.z) < TOWER_CLEAR_M) continue;
    const [sa, sb] = r.side > 0 ? [r.s0, r.s1] : [r.s1, r.s0];
    const p0 = w(sa, r.side * r.d);
    const p1 = w(sb, r.side * r.d);
    const len = Math.hypot(p1.x - p0.x, p1.z - p0.z) || 1;
    const a = { x: (p1.x - p0.x) / len, y: 0, z: (p1.z - p0.z) / len };
    const inward = w((r.s0 + r.s1) / 2, r.side * (r.d + 1));
    let nn = { x: a.z, y: 0, z: -a.x };
    if (nn.x * (inward.x - mid.x) + nn.z * (inward.z - mid.z) < 0) nn = { x: -nn.x, y: 0, z: -nn.z };
    const f: Frame = { o: { ...p0, y: 0 }, a, n: nn };
    const y = Math.max(w(r.s0, 0).y, w(r.s1, 0).y);
    const top = y + GROUND_STOREY_M + STOREY_M * (r.storeys - 1) + 0.8;
    const [n, fs] = soupsAt(r.edge, (r.s0 + r.s1) / 2);
    for (const soup of [n, fs])
      box(
        soup,
        f,
        0,
        len,
        0,
        DEPTH_M,
        Math.min(w(r.s0, 0).y, w(r.s1, 0).y) - FOOT_SINK_M,
        top,
        r.wall,
        'flrt',
        BLOCK_COLOURS.roof,
      );
    for (let st = 1; st < r.storeys; st++) {
      const wy = y + GROUND_STOREY_M + STOREY_M * (st - 1) + 0.8;
      panel(n, f, 0.8, len - 0.8, wy, wy + 1.6, BLOCK_COLOURS.window);
    }
    plan.buildings.push({
      edge: r.edge,
      side: r.side,
      s0: r.s0,
      s1: r.s1,
      front: r.d,
      district: 'park',
      storeys: r.storeys,
      cafe: false,
    });
    note(r.edge, (r.s0 + r.s1) / 2, mid);
  }

  plan.stretches = [...centres.entries()].map(([key, c]) => {
    const cx = c.xs / c.n;
    const cz = c.zs / c.n;
    const radius = Math.max(...c.pts.map((p) => Math.hypot(p.x - cx, p.z - cz))) + 30;
    return { key, cx, cz, radius };
  });
  for (const key of near.keys()) {
    if (centres.has(key)) continue;
    const s = near.get(key);
    if (!s || s.pos.length < 9) continue;
    let xs = 0;
    let zs = 0;
    const n = s.pos.length / 3;
    for (let i = 0; i < n; i++) {
      xs += s.pos[i * 3] ?? 0;
      zs += s.pos[i * 3 + 2] ?? 0;
    }
    plan.stretches.push({ key, cx: xs / n, cz: zs / n, radius: SIDE_REACH_M + 60 });
  }
  return plan;
}

/** A soup as a mesh's geometry, with face normals. */
function geometryOf(soup: Soup): BufferGeometry {
  const pos = new Float32Array(soup.pos);
  const col = new Float32Array(soup.col);
  const nrm = new Float32Array(pos.length);
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  for (let i = 0; i + 8 < pos.length; i += 9) {
    a.fromArray(pos, i);
    b.fromArray(pos, i + 3).sub(a);
    c.fromArray(pos, i + 6).sub(a);
    b.cross(c).normalize();
    for (let k = 0; k < 3; k++) b.toArray(nrm, i + k * 3);
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new Float32BufferAttribute(nrm, 3));
  geo.setAttribute('color', new Float32BufferAttribute(col, 3));
  geo.computeBoundingSphere();
  return geo;
}

export interface BlocksCounts {
  buildings: number;
  cafes: number;
  strings: number;
  lanterns: number;
  tables: number;
  trees: number;
  sideStreets: number;
  tower: boolean;
  stretches: number;
  built: number;
  meshes: number;
  triangles: number;
}

interface Built {
  key: string;
  cx: number;
  cz: number;
  radius: number;
  near: Mesh | null;
  far: Mesh | null;
}

/** The districts of one road scene: their static stretches near the camera, and the tower. */
export class BlocksLayer {
  readonly group = new Group();
  readonly plan: BlocksPlan;
  private readonly stretches: Built[];
  private readonly tower: Mesh | null = null;
  private shownMeshes = 0;
  private shownTris = 0;

  constructor(
    private readonly look: LookStyle,
    input: BlocksInput,
  ) {
    this.group.name = 'road-blocks';
    this.plan = planBlocks(input);
    this.stretches = this.plan.stretches.map((s) => ({ ...s, near: null, far: null }));
    if (this.plan.towerSoup) {
      const mesh = new Mesh(geometryOf(this.plan.towerSoup), look.material('prop', { vertexColors: true }));
      mesh.name = 'road-blocks-tower';
      mesh.matrixAutoUpdate = false;
      mesh.visible = false;
      this.group.add(mesh);
      this.tower = mesh;
    }
  }

  /**
   * Per frame: builds, shows and frees the stretches by distance from the camera (full detail near,
   * the stand-in far). Returns the stretches in view.
   */
  update(cameraX: number, cameraZ: number): number {
    // Build at most one mesh a frame: the nearest stretch that needs one.
    let next: { st: Built; which: 'near' | 'far' } | null = null;
    let nextDist = Infinity;
    for (const st of this.stretches) {
      const dist = Math.hypot(st.cx - cameraX, st.cz - cameraZ) - st.radius;
      if (dist >= BLOCKS_DRAW_M + PREFETCH_M || dist >= nextDist) continue;
      const which = dist < NEAR_M + PREFETCH_M ? 'near' : 'far';
      if (!st[which]) {
        next = { st, which };
        nextDist = dist;
      }
    }
    if (next) this.build(next.st, next.which);
    let meshes = 0;
    let tris = 0;
    let shown = 0;
    for (const st of this.stretches) {
      const dist = Math.hypot(st.cx - cameraX, st.cz - cameraZ) - st.radius;
      const wantNear = dist < NEAR_M && st.near !== null;
      const wantFar = !wantNear && dist < BLOCKS_DRAW_M && st.far !== null;
      // Until a stretch's near mesh is built, its far one stands in (and the other way round).
      const showNear = wantNear || (dist < BLOCKS_DRAW_M && !st.far && st.near !== null);
      const showFar = wantFar || (dist < NEAR_M && !st.near && st.far !== null);
      if (st.near) st.near.visible = showNear && !st.near.userData['empty'];
      if (st.far) st.far.visible = showFar && !showNear && !st.far.userData['empty'];
      for (const m of [st.near, st.far]) {
        if (m?.visible) {
          meshes++;
          tris += (m.geometry.getAttribute('position')?.count ?? 0) / 3;
          shown++;
        }
      }
      if (dist > KEEP_M) this.free(st);
      else if (dist > NEAR_M + PREFETCH_M + 60 && st.near) this.freeOne(st, 'near');
    }
    if (this.tower && this.plan.tower) {
      const d = Math.hypot(this.plan.tower.x - cameraX, this.plan.tower.z - cameraZ);
      this.tower.visible = d < TOWER_DRAW_M;
      if (this.tower.visible) {
        meshes++;
        tris += (this.tower.geometry.getAttribute('position')?.count ?? 0) / 3;
      }
    }
    this.shownMeshes = meshes;
    this.shownTris = tris;
    return shown;
  }

  counts(): BlocksCounts {
    const p = this.plan;
    return {
      buildings: p.buildings.length,
      cafes: p.buildings.filter((b) => b.cafe).length,
      strings: p.strings.length,
      lanterns: p.strings.reduce((n, s) => n + s.lanterns, 0),
      tables: p.tables.length,
      trees: p.trees,
      sideStreets: p.sideStreets.length,
      tower: p.tower !== null,
      stretches: this.stretches.length,
      built: this.stretches.filter((s) => s.near || s.far).length,
      meshes: this.shownMeshes,
      triangles: Math.round(this.shownTris),
    };
  }

  dispose(): void {
    for (const st of this.stretches) this.free(st);
    this.tower?.geometry.dispose();
    this.group.removeFromParent();
  }

  private free(st: Built) {
    this.freeOne(st, 'near');
    this.freeOne(st, 'far');
  }

  private freeOne(st: Built, which: 'near' | 'far') {
    const m = st[which];
    if (!m) return;
    m.geometry.dispose();
    m.removeFromParent();
    st[which] = null;
  }

  private build(st: Built, which: 'near' | 'far') {
    const soup = (which === 'near' ? this.plan.near : this.plan.far).get(st.key);
    if (!soup || soup.pos.length < 9) {
      // Nothing to draw at this detail: an empty placeholder (never added) so it is not asked for again.
      const mesh = new Mesh(new BufferGeometry(), this.look.material('prop', { vertexColors: true }));
      mesh.userData['empty'] = true;
      mesh.visible = false;
      st[which] = mesh;
      return;
    }
    const mesh = new Mesh(geometryOf(soup), this.look.material('prop', { vertexColors: true }));
    mesh.name = which === 'near' ? 'road-blocks' : 'road-blocks-far';
    mesh.matrixAutoUpdate = false;
    mesh.visible = false;
    this.group.add(mesh);
    st[which] = mesh;
  }
}
