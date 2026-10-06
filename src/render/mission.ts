// San Francisco's mural alleys (run W-U; the pitch deck after playtest 2, #8 "San Francisco: a real
// city": "the Mission's mural alleys, where a mural of the streaming outfit's mascot is being painted
// over mid-race"; interview, 2026-10-02: all four SF districts; playtest 2: "I expected some city
// feeling not just all row houses"). This layer draws what stands on the mural network's tagged land
// (src/render/scenery.ts's `mission` theme; the road scene draws the land itself):
//
// - `shopfronts`: two- and three-storey shopfronts shoulder to shoulder on the sidewalk's hard edge
//   (road/cross-section.ts), with shop windows, awnings, upper windows and a cornice; one in five has
//   a mural over its upper floors; street lamps at the kerb and bins by the doors;
// - `murals`: an alley's walls, 1.5 m past the shoulder, each building its own height and colour,
//   most of them painted end to end (sunbursts, waves, flowers, birds, hills, planets, diamonds,
//   chevrons), the rest plain stucco with a roll-up door;
// - `mascot-mural`: the corner wall where the streaming outfit painted its mascot (a grinning head in
//   a headset, a thumbs-up, LIVE, and STAY TUNED). A scaffold runs the length of it and a crew of four
//   is painting it out while the race runs: primer first, then a new mural (a sunrise over the hills),
//   column by column from the far end. How far they have got follows the race's leader
//   (`raceShare`), so the field meets the first wall primed at the far end and the thumbs-up going,
//   the face still grinning, and the second primed with a sunrise going up. The joke is on the outfit,
//   never on the neighbourhood.
//
// Murals are flat colour cells (0.5 m) on the wall, merged into runs, so every look recolours them
// like any vertex-coloured prop and nothing needs a texture. Drawing (the phone's budget): the static
// parts on one GRID_M square of ground are merged into one vertex-coloured mesh, built when the
// camera comes near and freed when it has gone. Each mascot wall adds two meshes while it is in range:
// its paint (one geometry, revealed by draw range) and its crew. This is a lazy chunk: it loads with
// the mural network, never in the first load.
import { BufferGeometry, Float32BufferAttribute, Group, Mesh, Vector3 } from 'three';
import { planStreetFurniture } from '../road';
import type { RoadNetwork, SimSnapshot } from '../sim/api';
import type { Point3 } from './geometry';
import type { LookStyle } from './look';
import type { SceneryModel } from './models';
import type { RoadDressing } from './road-mesh';
import { scatterHash } from './scenery';

/** The tags this layer draws. */
export const MISSION_TAGS = ['mascot-mural', 'murals', 'shopfronts'] as const;
export type MissionKind = 'mascot' | 'murals' | 'shopfronts';
const KIND_OF: Readonly<Record<string, MissionKind>> = {
  'mascot-mural': 'mascot',
  murals: 'murals',
  shopfronts: 'shopfronts',
};
const RANK: Readonly<Record<MissionKind, number>> = { mascot: 0, murals: 1, shopfronts: 2 };

/** Whether the network has any of the mural district's land. */
export function hasMission(tags: ReadonlySet<string>): boolean {
  return MISSION_TAGS.some((t) => tags.has(t));
}

/** A mural cell's side, m. */
export const CELL_M = 0.5;
/** The longest run of same-coloured cells merged into one quad on a bend (its chord stays short), cells. */
const RUN_MAX = 4;
/** A wall counts as flat under a quad while its facing turns less than this (cosine of about 1°). */
const FLAT_DOT = 0.99985;
/** Step along the road when a wall's front line is sampled, m. */
const STEP_M = 2;
/** A wall's front stands this far past the verge's hard edge, m. */
const WALL_GAP_M = 0.05;
/** The mascot's wall stands this far past the hard edge: its scaffold stands between, m. */
export const SCAFFOLD_M = 1.6;
/** How far each layer of paint stands off the wall (mural, primer, new mural), m. */
const PAINT_OFF = [0.04, 0.08, 0.12] as const;
/** Buildings reach this far below the road, so a slope never shows a gap under them, m. */
const SINK_M = 1.5;
/** The walls stop this far short of a landmark's footprint along the alley, m. */
const LANDMARK_GAP_M = 1;
/** A building's depth back from its front, m. */
const DEPTH_M: Readonly<Record<MissionKind, number>> = { shopfronts: 14, murals: 12, mascot: 14 };
/** Building widths along the front, m: [least, spread]. */
const WIDTH_M: Readonly<Record<'shopfronts' | 'murals', readonly [number, number]>> = {
  shopfronts: [7, 6],
  murals: [8, 9],
};
/** Building heights, m: [least, spread]. The mascot's wall stands taller than the block. */
const HEIGHT_M: Readonly<Record<'shopfronts' | 'murals', readonly [number, number]>> = {
  shopfronts: [7.5, 4],
  murals: [5, 4],
};
export const MASCOT_HEIGHT_M = 14.5;
/** How far back up the approaching street the face is lined up from, m. */
const FACE_SIGHT_M = 150;
/** Share of alley walls painted, and of shopfronts with a mural over the upper floors. */
const MURAL_SHARE = { murals: 0.72, shopfronts: 0.2 } as const;
// The shopfront kerb's lamps and bins are road/furniture.ts's (MS_LAMP_EVERY_M).

/**
 * Static parts merge per square of ground this wide (the route zig-zags, so a square holds several
 * roads' walls and a view needs few of them), drawn to this distance.
 */
export const GRID_M = 300;
export const MISSION_DRAW_M = 450;
const PREFETCH_M = 120;
const KEEP_M = MISSION_DRAW_M + 200;

/**
 * The crew's schedule over the leader's share of the race (0 at the start, 1 at the finish): the
 * primer goes on over PRIMER, then the new mural over FRESH. [default] Set so the field meets the
 * first wall (45 % in) with the far end primed up to the thumbs-up and the face still grinning, and
 * the second (79 % in) primed and the sunrise going up.
 */
export const PRIMER: readonly [number, number] = [0.23, 0.78];
export const FRESH: readonly [number, number] = [0.78, 0.97];

/** Flat colours. [default] */
export const MISSION_COLOURS = {
  stucco: ['#e8b4a0', '#f2d0a4', '#b5d3c5', '#c9b6d9', '#f1e3b6', '#a9c4dc', '#e6a57e', '#d9c7b8'],
  awning: ['#c0392b', '#2e7d4f', '#2e5f8a', '#e0a526', '#7b4fa0', '#1f8a8a'],
  glass: '#33414c',
  door: '#6d5a4a',
  rollUp: '#8a8f96',
  window: '#3d4b57',
  roof: '#8b857c',
  scaffold: '#b9bcc0',
  plank: '#a77b4f',
  primer: '#f3ecd9',
  overalls: '#f4f1e8',
  cap: '#e94f37',
  skin: '#c99a74',
} as const;
/** The murals' colours: bright, flat and clean (no crack, rust or grime). */
const PAINT = [
  '#e94f37',
  '#f6ae2d',
  '#f9dc5c',
  '#3fa34d',
  '#2e86ab',
  '#7b4fa0',
  '#ef6f9a',
  '#3cc6c4',
  '#f4f1de',
  '#2b2d42',
  '#ff8c42',
  '#8ac926',
] as const;

/** The mural motifs (see `motif`). */
export const MOTIFS = [
  'sunburst',
  'waves',
  'flowers',
  'birds',
  'diamonds',
  'hills',
  'planets',
  'chevrons',
] as const;
export type Motif = (typeof MOTIFS)[number];

/** One wall's front line: points along the road on one side, the way in toward the road, and u. */
export interface WallLine {
  kind: MissionKind;
  side: -1 | 1;
  /** Where each point was sampled (edge index, s) and the d of the front. */
  edges: number[];
  ss: number[];
  ds: number[];
  /** Front points at road height (the road's centre height at that s). */
  pts: Point3[];
  /** Unit horizontal vectors from each point toward the road. */
  ins: { x: number; z: number }[];
  /** Arc length along the front, m. */
  us: number[];
}

/** One building of the district. */
export interface MissionBuilding {
  kind: MissionKind;
  edge: number;
  s: number;
  side: -1 | 1;
  u0: number;
  u1: number;
  height: number;
  colour: string;
  /** Its mural, or null for plain stucco. */
  motif: Motif | 'mascot' | null;
  /** The footprint's front and back corners (tests: off the road). */
  front: Point3[];
  back: Point3[];
}

/** A mascot wall: the run of the wall it covers, its paint and its crew's scaffold. */
export interface MascotWall {
  line: WallLine;
  /** The mural's extent along the front and up from the road, m. */
  ua: number;
  ub: number;
  ya: number;
  yb: number;
  /** u where the wall turns from the first road onto the next (the corner): the mascot's face. */
  uCorner: number;
  /**
   * u where the wall crosses the approaching street's centre line, seen from FACE_SIGHT_M up it:
   * the mascot's face, looking straight back up the street.
   */
  uFace: number;
  /** Columns of cells, left to right, and each column's new-mural quads (vertex counts). */
  columns: number;
  /** The paint geometry's vertex count after each primer column, then after each new column. */
  primerVerts: number[];
  freshVerts: number[];
  paint: { pos: number[]; col: number[] };
  /** Plank heights of the scaffold, m above the road. */
  planks: number[];
}

/** One placed kit prop (a lamp, bins). */
export interface MissionItem {
  /** The square of ground it is merged with. */
  key: string;
  variant: number;
  rule: string;
  p: Point3;
  turn: number;
  edge: number;
  s: number;
  d: number;
}

/** A coloured triangle soup (three vertices per triangle). */
interface Soup {
  pos: number[];
  col: number[];
}

export interface MissionPlan {
  lines: WallLine[];
  buildings: MissionBuilding[];
  mascots: MascotWall[];
  items: MissionItem[];
  /** Static surfaces per square of ground (`gridKey`). */
  soups: Map<string, Soup>;
  /** Stretch keys, with their centre and radius on the ground. */
  stretches: { key: string; cx: number; cz: number; radius: number }[];
}

export interface MissionInput {
  road: RoadNetwork;
  dressing: RoadDressing | undefined;
  seed: number;
}

const rgb = (h: string): [number, number, number] => {
  const n = parseInt(h.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
/** The square of ground a point is merged with. */
const gridKey = (x: number, z: number) => `${Math.floor(x / GRID_M)}:${Math.floor(z / GRID_M)}`;

/**
 * The leader's share of the race, 0 at the start to 1 at the finish (the crew's clock): the furthest
 * racer's progress over the route's length (cops and traffic not counted), 1 once the race is over.
 */
export function raceShare(snap: Pick<SimSnapshot, 'race' | 'entities'> | null | undefined): number {
  if (!snap) return 0;
  if (snap.race.over) return 1;
  const length = snap.race.routeLength;
  if (!(length > 0)) return 0;
  let best = 0;
  for (const e of snap.entities) {
    if (e.kind !== 'rider' || e.faction !== 'rider') continue;
    best = Math.max(best, e.finished ? length : e.progress);
  }
  return clamp01(best / length);
}

/**
 * How many of a mascot wall's paint vertices show: the primer's first columns from the far end, and
 * once it is all on, the new mural's.
 */
export function paintDrawCount(
  wall: Pick<MascotWall, 'columns' | 'primerVerts' | 'freshVerts'>,
  primer: number,
  fresh: number,
): number {
  const n = wall.columns;
  const k1 = Math.floor(clamp01(primer) * n);
  if (k1 < n) return k1 > 0 ? (wall.primerVerts[k1 - 1] ?? 0) : 0;
  const k2 = Math.floor(clamp01(fresh) * n);
  return k2 > 0 ? (wall.freshVerts[k2 - 1] ?? 0) : (wall.primerVerts[n - 1] ?? 0);
}

/** How far the crew has got at a share of the race: primer and new mural, each 0..1. */
export function crewProgress(share: number): { primer: number; fresh: number } {
  return {
    primer: clamp01((share - PRIMER[0]) / (PRIMER[1] - PRIMER[0])),
    fresh: clamp01((share - FRESH[0]) / (FRESH[1] - FRESH[0])),
  };
}

// ---- the letters (5 x 7, one cell each) ----
const FONT: Readonly<Record<string, readonly string[]>> = {
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
  V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
};

/** Whether the cell at (x, y) metres falls on a letter of `word` set at (x0, y0), `px` m per dot. */
function onText(word: string, x0: number, y0: number, px: number, x: number, y: number): boolean {
  const col = Math.floor((x - x0) / px);
  const row = 6 - Math.floor((y - y0) / px);
  if (row < 0 || row > 6 || col < 0) return false;
  const ch = word[Math.floor(col / 6)];
  const c = col % 6;
  if (!ch || c > 4) return false;
  return FONT[ch]?.[row]?.[c] === '1';
}

/** A mural's colour at (x, y) metres from its bottom-left corner, for a wall w by h. */
type Painter = (x: number, y: number) => string;

/** A seeded mural of one motif. */
function motif(kind: Motif, w: number, h: number, r: (k: number) => number): Painter {
  const pick = (k: number) => PAINT[Math.floor(r(k) * PAINT.length) % PAINT.length] as string;
  const a = pick(1);
  let b = pick(2);
  if (b === a) b = PAINT[(PAINT.indexOf(a as (typeof PAINT)[number]) + 3) % PAINT.length] as string;
  let c = pick(3);
  if (c === a || c === b)
    c = PAINT[(PAINT.indexOf(b as (typeof PAINT)[number]) + 5) % PAINT.length] as string;
  const d = pick(4);
  switch (kind) {
    case 'sunburst': {
      const cx = w * (0.3 + 0.4 * r(5));
      const cy = h * 0.3;
      const rays = 10 + Math.floor(r(6) * 8);
      return (x, y) => {
        const dx = x - cx;
        const dy = y - cy;
        const dist = Math.hypot(dx, dy);
        if (dist < h * 0.22) return '#f9dc5c';
        if (dist < h * 0.27) return '#ff8c42';
        const k = Math.floor(((Math.atan2(dy, dx) + Math.PI) / (2 * Math.PI)) * rays * 2);
        return k % 2 ? a : b;
      };
    }
    case 'waves': {
      const k = (2 * Math.PI) / (6 + r(5) * 6);
      const amp = 0.4 + r(6) * 0.8;
      const band = h / (4 + Math.floor(r(7) * 3));
      const ph = r(8) * 6;
      return (x, y) => {
        const i = Math.floor((y + amp * Math.sin(x * k + ph)) / band);
        return [a, b, c, '#f4f1de'][((i % 4) + 4) % 4] as string;
      };
    }
    case 'flowers': {
      const n = Math.max(2, Math.round(w / 4.5));
      const fl = Array.from({ length: n }, (_, i) => ({
        x: ((i + 0.5) * w) / n + (r(10 + i) - 0.5) * 1.2,
        y: h * (0.35 + 0.35 * r(30 + i)),
        rad: Math.min(h * 0.18, 0.9 + r(50 + i) * 0.9),
        petal: pick(70 + i),
      }));
      return (x, y) => {
        for (const f of fl) {
          const dx = x - f.x;
          const dy = y - f.y;
          const dist = Math.hypot(dx, dy);
          if (dist < f.rad * 0.55) return '#f9dc5c';
          const ang = Math.atan2(dy, dx);
          if (dist < f.rad * (1.1 + 0.55 * Math.cos(5 * ang))) return f.petal;
          // The stem.
          if (Math.abs(dx) < 0.2 && y < f.y && y > 0.4) return '#3fa34d';
        }
        return y < 0.9 ? '#3fa34d' : a;
      };
    }
    case 'birds': {
      const n = Math.max(3, Math.round(w / 2.5));
      const flock = Array.from({ length: n }, (_, i) => ({
        x: r(10 + i) * w,
        y: h * (0.3 + 0.6 * r(40 + i)),
        span: 0.7 + r(70 + i) * 0.9,
      }));
      return (x, y) => {
        for (const f of flock) {
          const dx = Math.abs(x - f.x);
          if (dx < f.span && Math.abs(y - (f.y + dx * 0.55)) < 0.28) return '#2b2d42';
        }
        return y > h * 0.55 ? a : b;
      };
    }
    case 'diamonds': {
      const size = 1.5 + Math.floor(r(5) * 3) * 0.5;
      return (x, y) => {
        const fx = (((x % size) + size) % size) - size / 2;
        const fy = (((y % size) + size) % size) - size / 2;
        const inside = Math.abs(fx) + Math.abs(fy) < size * 0.36;
        const row = Math.floor(y / size) + Math.floor(x / size);
        return inside ? (row % 2 ? c : d) : row % 3 === 0 ? a : b;
      };
    }
    case 'hills': {
      const ph = r(5) * 10;
      const sunX = w * (0.2 + 0.6 * r(6));
      return (x, y) => {
        if (Math.hypot(x - sunX, y - h * 0.72) < h * 0.13) return '#f9dc5c';
        const near = h * 0.3 + 0.7 * Math.sin(x * 0.45 + ph);
        const far = h * 0.5 + 0.9 * Math.sin(x * 0.27 + ph * 2);
        if (y < near) return '#3fa34d';
        if (y < far) return c === '#3fa34d' ? '#8ac926' : c;
        return y > h * 0.8 ? a : b;
      };
    }
    case 'planets': {
      const n = Math.max(2, Math.round(w / 6));
      const ps = Array.from({ length: n }, (_, i) => ({
        x: ((i + 0.5) * w) / n + (r(10 + i) - 0.5) * 2,
        y: h * (0.3 + 0.4 * r(30 + i)),
        rad: 0.8 + r(50 + i) * Math.min(1.6, h * 0.15),
        col: pick(70 + i),
      }));
      return (x, y) => {
        for (const p of ps) {
          const dx = x - p.x;
          const dy = y - p.y;
          if (Math.hypot(dx, dy) < p.rad) return p.col;
          // A ring, seen edge on.
          if (Math.abs(dy - dx * 0.2) < 0.15 && Math.abs(dx) < p.rad * 1.7) return '#f4f1de';
        }
        const star = scatterHash(97, Math.floor(x * 2), Math.floor(y * 2), 5);
        return star > 0.94 ? '#f9dc5c' : '#2b2d42';
      };
    }
    case 'chevrons': {
      const size = 1 + Math.floor(r(5) * 3) * 0.5;
      return (x, y) => {
        const i = Math.floor((y + Math.abs((((x % (size * 4)) + size * 4) % (size * 4)) - size * 2)) / size);
        return [a, b, c, d][((i % 4) + 4) % 4] as string;
      };
    }
  }
}

/**
 * The streaming outfit's mascot, for a wall w by h with its corner at uc: a grinning round head in a
 * headset looking back up the street at the corner, STAY TUNED on the wall before it, a thumbs-up
 * and a LIVE badge after it, and like-hearts trailing off. Invented, like the outfit.
 */
export function mascotPainter(w: number, h: number, uc: number): Painter {
  const R = Math.min(h * 0.44, 6);
  const hx = uc;
  const hy = h * 0.5;
  const textPx = CELL_M;
  // STAY over TUNED, right-aligned to stop short of the head.
  const textRight = hx - R - 1.5;
  const tunedX = textRight - 29 * textPx;
  const stayX = tunedX + 6 * textPx;
  return (x, y) => {
    const dx = x - hx;
    const dy = y - hy;
    const dist = Math.hypot(dx, dy);
    // The headset: a band over the head and two cups.
    if (Math.abs(dist - (R + 0.45)) < 0.35 && dy > R * 0.2) return '#2b2d42';
    if (Math.abs(dx) > R * 0.8 && Math.abs(dx) < R + 0.75 && Math.abs(dy) < R * 0.38) return '#2b2d42';
    if (dist < R) {
      // The eyes: big, white, looking up the street.
      for (const ex of [-R * 0.38, R * 0.38]) {
        const ed = Math.hypot(dx - ex, dy - R * 0.22);
        if (ed < R * 0.12) return '#2b2d42';
        if (ed < R * 0.26) return '#ffffff';
      }
      // The grin.
      const gr = Math.hypot(dx, dy + R * 0.05);
      if (dy < -R * 0.1 && gr > R * 0.45 && gr < R * 0.68) return '#2b2d42';
      if (dist > R - 0.4) return '#e0a526';
      return '#f9dc5c';
    }
    // The microphone arm, off the right cup.
    if (dy < -R * 0.3 && dy > -R * 0.42 && dx > R * 0.2 && dx < R + 0.6) return '#2b2d42';
    // STAY over TUNED, before the head.
    if (onText('TUNED', tunedX, h * 0.18, textPx, x, y)) return '#f9dc5c';
    if (onText('STAY', stayX, h * 0.18 + 8 * textPx, textPx, x, y)) return '#f9dc5c';
    // The thumbs-up after the head: a fist and a thumb.
    const fx = hx + R + 4.5;
    const fy = h * 0.42;
    if (x > fx - 1.6 && x < fx + 1.6 && y > fy - 1.8 && y < fy + 1.2) {
      if (Math.abs(y - (fy - 0.6)) < 0.12 || Math.abs(y - (fy + 0.1)) < 0.12) return '#e0a526';
      return '#f9dc5c';
    }
    if (x > fx - 1.4 && x < fx - 0.4 && y >= fy + 1.2 && y < fy + 3.6) return '#f9dc5c';
    // LIVE, on a red badge.
    const bx = fx + 4;
    if (x > bx && x < bx + 12.5 && y > h * 0.32 && y < h * 0.32 + 5) {
      if (onText('LIVE', bx + 0.75, h * 0.32 + 0.75, CELL_M, x, y)) return '#ffffff';
      return '#e94f37';
    }
    // Like-hearts trailing off to the end.
    const hx2 = bx + 15;
    if (x > hx2) {
      const k = Math.floor((x - hx2) / 4);
      const cx = hx2 + k * 4 + 2;
      const cy = h * (0.3 + 0.35 * ((k * 0.37) % 1));
      const s = 1 - 0.12 * (k % 3);
      const qx = Math.abs(x - cx) / s;
      const qy = (y - cy) / s;
      if (Math.hypot(qx - 0.55, qy - 0.35) < 0.65 || (qy < 0.4 && qy > -1.2 && qx < 1.15 + qy * 0.95))
        return '#ef6f9a';
    }
    // The outfit's purple, with a lighter stripe.
    return y > h * 0.86 || y < h * 0.08 ? '#9b6fe0' : '#6c3fc9';
  };
}

/** The new mural the crew paints in its place: a sunrise over the hills, with birds. */
export function freshPainter(w: number, h: number): Painter {
  const sunX = w * 0.5;
  return (x, y) => {
    const dx = x - sunX;
    const dy = y - h * 0.38;
    const dist = Math.hypot(dx, dy);
    const near = h * 0.22 + 0.9 * Math.sin(x * 0.21 + 1.3);
    const far = h * 0.34 + 1.2 * Math.sin(x * 0.13 + 0.4);
    if (y < near) {
      // Poppies in the near field.
      const k = Math.floor(x / 2.2);
      const fy = 0.9 + ((k * 0.61) % 1) * (near - 1.6);
      if (Math.hypot(x - (k * 2.2 + 1.1), y - fy) < 0.45) return '#e94f37';
      return '#3fa34d';
    }
    if (y < far) return '#8ac926';
    if (dist < h * 0.2) return '#f9dc5c';
    const ray = Math.floor(((Math.atan2(dy, dx) + Math.PI) / (2 * Math.PI)) * 28);
    // Birds, high up.
    const bk = Math.floor(x / 5);
    const bx = bk * 5 + 2.5;
    const by = h * (0.72 + 0.16 * ((bk * 0.43) % 1));
    const ddx = Math.abs(x - bx);
    if (ddx < 1 && Math.abs(y - (by + ddx * 0.5)) < 0.26) return '#2b2d42';
    return ray % 2 ? '#ff8c42' : '#f6ae2d';
  };
}

/** A point on a wall line at u (clamped), with the way toward the road there. */
function lineAt(line: WallLine, u: number): { x: number; y: number; z: number; ix: number; iz: number } {
  const us = line.us;
  const n = us.length;
  if (n < 2) {
    const p = line.pts[0] ?? { x: 0, y: 0, z: 0 };
    const i = line.ins[0] ?? { x: 0, z: 1 };
    return { x: p.x, y: p.y, z: p.z, ix: i.x, iz: i.z };
  }
  let lo = 0;
  let hi = n - 1;
  const uu = Math.max(0, Math.min(us[n - 1] ?? 0, u));
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if ((us[mid] ?? 0) <= uu) lo = mid;
    else hi = mid;
  }
  const u0 = us[lo] ?? 0;
  const u1 = us[hi] ?? u0;
  const t = u1 > u0 ? (uu - u0) / (u1 - u0) : 0;
  const a = line.pts[lo] as Point3;
  const b = line.pts[hi] as Point3;
  const ia = line.ins[lo] as { x: number; z: number };
  const ib = line.ins[hi] as { x: number; z: number };
  const ix = ia.x + (ib.x - ia.x) * t;
  const iz = ia.z + (ib.z - ia.z) * t;
  const il = Math.hypot(ix, iz) || 1;
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
    ix: ix / il,
    iz: iz / il,
  };
}

/** A triangle, wound to face `want` (a direction). */
function tri(soup: Soup, a: Point3, b: Point3, c: Point3, colour: string, want: Point3): void {
  const ux = b.x - a.x;
  const uy = b.y - a.y;
  const uz = b.z - a.z;
  const vx = c.x - a.x;
  const vy = c.y - a.y;
  const vz = c.z - a.z;
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  if (nx * want.x + ny * want.y + nz * want.z < 0) [b, c] = [c, b];
  soup.pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  const [r, g, bl] = rgb(colour);
  for (let i = 0; i < 3; i++) soup.col.push(r, g, bl);
}

/** A quad a-b-c-d (in order round it), facing `want`. */
function quad(soup: Soup, a: Point3, b: Point3, c: Point3, d: Point3, colour: string, want: Point3): void {
  tri(soup, a, b, c, colour, want);
  tri(soup, a, c, d, colour, want);
}

/** A box between two points on the ground plane's frame: centre, half sizes, and its yaw. */
function box(
  soup: Soup,
  cx: number,
  cy: number,
  cz: number,
  hx: number,
  hy: number,
  hz: number,
  yaw: number,
  colour: string,
): void {
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  // Local x along (cos, -sin) in (x, z)... the model's +Z goes to (sin, cos), so +X goes to (cos, -sin).
  const at = (lx: number, ly: number, lz: number): Point3 => ({
    x: cx + lx * cos + lz * sin,
    y: cy + ly,
    z: cz - lx * sin + lz * cos,
  });
  const p = [
    at(-hx, -hy, -hz),
    at(hx, -hy, -hz),
    at(hx, -hy, hz),
    at(-hx, -hy, hz),
    at(-hx, hy, -hz),
    at(hx, hy, -hz),
    at(hx, hy, hz),
    at(-hx, hy, hz),
  ] as const;
  const dir = (lx: number, ly: number, lz: number): Point3 => ({
    x: lx * cos + lz * sin,
    y: ly,
    z: -lx * sin + lz * cos,
  });
  const [p0, p1, p2, p3, p4, p5, p6, p7] = p;
  quad(soup, p4, p5, p6, p7, colour, dir(0, 1, 0));
  quad(soup, p0, p1, p2, p3, colour, dir(0, -1, 0));
  quad(soup, p3, p2, p6, p7, colour, dir(0, 0, 1));
  quad(soup, p0, p1, p5, p4, colour, dir(0, 0, -1));
  quad(soup, p1, p2, p6, p5, colour, dir(1, 0, 0));
  quad(soup, p0, p3, p7, p4, colour, dir(-1, 0, 0));
}

/** A thin beam from a to b, `t` thick (the crew's roller poles; never vertical). */
function beam(soup: Soup, a: Point3, b: Point3, t: number, colour: string): void {
  // Across the beam: level and square to it, and straight up.
  const ul = Math.hypot(b.x - a.x, b.z - a.z) || 1;
  const ux = (-(b.z - a.z) / ul) * t;
  const uz = ((b.x - a.x) / ul) * t;
  const corners = (p: Point3) => [
    { x: p.x + ux, y: p.y, z: p.z + uz },
    { x: p.x, y: p.y + t, z: p.z },
    { x: p.x - ux, y: p.y, z: p.z - uz },
    { x: p.x, y: p.y - t, z: p.z },
  ];
  const ca = corners(a);
  const cb = corners(b);
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    const qa = ca[i] as Point3;
    const qb = ca[j] as Point3;
    const out = {
      x: (qa.x + qb.x) / 2 - a.x,
      y: (qa.y + qb.y) / 2 - a.y,
      z: (qa.z + qb.z) / 2 - a.z,
    };
    quad(soup, qa, qb, cb[j] as Point3, cb[i] as Point3, colour, out);
  }
}

/**
 * Paints cells of `paint` over u0..u1 and y0..y1 of a wall line, `off` metres off it. Rows merge
 * same-coloured cells into runs (at most RUN_MAX), or, with `byColumn`, columns merge them upward,
 * and the vertex count after each column is pushed to `marks`. A wall on the road's right is seen
 * with u running to the viewer's left, so `mirror` paints it the other way round (words read).
 */
function paintCells(
  soup: Soup,
  line: WallLine,
  u0: number,
  u1: number,
  y0: number,
  y1: number,
  off: number,
  paint: Painter,
  opts: { byColumn?: boolean; marks?: number[]; reverse?: boolean; mirror?: boolean } = {},
): number {
  const nu = Math.max(1, Math.floor((u1 - u0) / CELL_M));
  const nv = Math.max(1, Math.floor((y1 - y0) / CELL_M));
  const cu = (u1 - u0) / nu;
  const cv = (y1 - y0) / nv;
  const w = u1 - u0;
  const corner = (u: number, y: number): Point3 => {
    const p = lineAt(line, u);
    return { x: p.x + p.ix * off, y: p.y + y, z: p.z + p.iz * off };
  };
  const face = (u: number): Point3 => {
    const p = lineAt(line, u);
    return { x: p.ix, y: 0, z: p.iz };
  };
  const colourAt = (i: number, j: number) =>
    paint(opts.mirror ? w - (i + 0.5) * cu : (i + 0.5) * cu, (j + 0.5) * cv);
  let cells = 0;
  if (opts.byColumn) {
    for (let k = 0; k < nu; k++) {
      const i = opts.reverse ? nu - 1 - k : k;
      const ua = u0 + i * cu;
      const ub = ua + cu;
      let j = 0;
      while (j < nv) {
        const colour = colourAt(i, j);
        let j1 = j + 1;
        while (j1 < nv && colourAt(i, j1) === colour) j1++;
        quad(
          soup,
          corner(ua, y0 + j * cv),
          corner(ub, y0 + j * cv),
          corner(ub, y0 + j1 * cv),
          corner(ua, y0 + j1 * cv),
          colour,
          face((ua + ub) / 2),
        );
        j = j1;
        cells++;
      }
      opts.marks?.push(soup.pos.length / 3);
    }
    return cells;
  }
  // Greedy rectangles: a run of one colour along a row, as long as the wall stays flat under it (on a
  // bend at most RUN_MAX cells, so the quad's chord stays on the wall's face), grown upward while the
  // rows above match it.
  const colours: string[] = [];
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) colours.push(colourAt(i, j));
  const used = new Uint8Array(nu * nv);
  const flat = (ia: number, ib: number) => {
    const a = lineAt(line, u0 + ia * cu);
    const b = lineAt(line, u0 + ib * cu);
    return a.ix * b.ix + a.iz * b.iz > FLAT_DOT;
  };
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      if (used[j * nu + i]) continue;
      const colour = colours[j * nu + i] as string;
      let i1 = i + 1;
      while (
        i1 < nu &&
        !used[j * nu + i1] &&
        colours[j * nu + i1] === colour &&
        (i1 - i < RUN_MAX || flat(i, i1 + 1))
      )
        i1++;
      let j1 = j + 1;
      for (; j1 < nv; j1++) {
        let same = true;
        for (let k = i; k < i1 && same; k++) same = !used[j1 * nu + k] && colours[j1 * nu + k] === colour;
        if (!same) break;
      }
      for (let jj = j; jj < j1; jj++) for (let k = i; k < i1; k++) used[jj * nu + k] = 1;
      const ua = u0 + i * cu;
      const ub = u0 + i1 * cu;
      quad(
        soup,
        corner(ua, y0 + j * cv),
        corner(ub, y0 + j * cv),
        corner(ub, y0 + j1 * cv),
        corner(ua, y0 + j1 * cv),
        colour,
        face((ua + ub) / 2),
      );
      cells++;
    }
  }
  return cells;
}

/** The district's runs of tagged wall: each side of each road, joined across a corner for a mascot. */
function wallLines(road: RoadNetwork, dressing: RoadDressing | undefined): WallLine[] {
  const out: WallLine[] = [];
  for (const e of road.edges) {
    const dress = dressing?.[e.id];
    const tags = (dress?.tags ?? e.tags) as readonly { s0: number; s1: number; side?: string; tag: string }[];
    if (!tags?.some((t) => KIND_OF[t.tag])) continue;
    // A landmark beside the alley (playtest 4, P4-19, M3: the mission chapel) stands in the wall's place: the
    // walls on its side stop short of its footprint, a few metres each way.
    const landmarks = (dress?.features ?? e.features).filter((f) => f.kind === 'landmark');
    for (const side of [-1, 1] as const) {
      const name = side < 0 ? 'left' : 'right';
      const kindAt = (s: number): MissionKind | null => {
        if (
          landmarks.some((f) => {
            // Playtest 4, run C: a landmark that says `params.sightM` also opens its side of the alley that far
            // before it (the downtown's rule), so its front is seen down the street and not only from beside it.
            const sight = Number(f.params?.['sightM']);
            const before = Math.max(LANDMARK_GAP_M, Number.isFinite(sight) ? sight : 0);
            return (
              Math.min(f.d0, f.d1) * side > 0 &&
              s > Math.min(f.s0, f.s1) - before &&
              s < Math.max(f.s0, f.s1) + LANDMARK_GAP_M
            );
          })
        )
          return null;
        let best: MissionKind | null = null;
        for (const t of tags) {
          if (s < t.s0 || s > t.s1 || (t.side !== undefined && t.side !== 'both' && t.side !== name))
            continue;
          // Where two meet, the first in MISSION_TAGS wins (the mascot's wall over an alley's).
          const k = KIND_OF[t.tag];
          if (k && (best === null || RANK[k] < RANK[best])) best = k;
        }
        return best;
      };
      const n = Math.max(1, Math.round(e.length / STEP_M));
      let line: WallLine | null = null;
      for (let k = 0; k <= n; k++) {
        const s = (e.length * k) / n;
        const kind = kindAt(s === e.length ? s - 1e-6 : s);
        if (!kind || (line && line.kind !== kind)) {
          if (line && line.pts.length > 1) out.push(line);
          line = null;
        }
        if (!kind) continue;
        if (!line) line = { kind, side, edges: [], ss: [], ds: [], pts: [], ins: [], us: [] };
        const verge = road.vergeAt(e.index, s, name);
        const d = side * (Math.abs(verge.dOuter) + (kind === 'mascot' ? SCAFFOLD_M : WALL_GAP_M));
        const p = road.toWorld(e.index, s, d, 0);
        const c = road.toWorld(e.index, s, 0, 0);
        const il = Math.hypot(c.x - p.x, c.z - p.z) || 1;
        const last = line.pts[line.pts.length - 1];
        line.us.push(last ? (line.us[line.us.length - 1] ?? 0) + Math.hypot(p.x - last.x, p.z - last.z) : 0);
        line.pts.push({ x: p.x, y: c.y, z: p.z });
        line.ins.push({ x: (c.x - p.x) / il, z: (c.z - p.z) / il });
        line.edges.push(e.index);
        line.ss.push(s);
        line.ds.push(d);
      }
      if (line && line.pts.length > 1) out.push(line);
    }
  }
  // A mascot wall that runs round a corner onto the next road is one wall.
  const joined: WallLine[] = [];
  for (const l of out) {
    // The same side's mascot wall that ran to the end of the road before this one.
    const prev =
      l.kind === 'mascot' && (l.ss[0] ?? 1) <= 1e-6
        ? joined.find((j) => {
            const last = road.edges[j.edges[j.edges.length - 1] ?? -1];
            return (
              j.kind === 'mascot' &&
              j.side === l.side &&
              !!last &&
              l.edges[0] === last.index + 1 &&
              (j.ss[j.ss.length - 1] ?? 0) >= last.length - 1e-6
            );
          })
        : undefined;
    if (prev) {
      const base = prev.us[prev.us.length - 1] ?? 0;
      for (let i = 1; i < l.pts.length; i++) {
        prev.pts.push(l.pts[i] as Point3);
        prev.ins.push(l.ins[i] as { x: number; z: number });
        prev.us.push(base + (l.us[i] ?? 0));
        prev.edges.push(l.edges[i] as number);
        prev.ss.push(l.ss[i] as number);
        prev.ds.push(l.ds[i] as number);
      }
      continue;
    }
    joined.push(l);
  }
  return joined;
}

/** Plans the mural district of a network: its buildings, murals, mascot walls and lamps. */
export function planMission(input: MissionInput): MissionPlan {
  const { road, dressing, seed } = input;
  const lines = wallLines(road, dressing);
  const buildings: MissionBuilding[] = [];
  const mascots: MascotWall[] = [];
  const items: MissionItem[] = [];
  const soups = new Map<string, Soup>();
  const centres = new Map<string, { xs: number; zs: number; n: number; pts: Point3[] }>();
  const keyOf = (p: { x: number; z: number }) => gridKey(p.x, p.z);
  const soupAt = (key: string): Soup => {
    let soup = soups.get(key);
    if (!soup) {
      soup = { pos: [], col: [] };
      soups.set(key, soup);
    }
    return soup;
  };
  const note = (key: string, p: Point3) => {
    const c = centres.get(key) ?? { xs: 0, zs: 0, n: 0, pts: [] };
    c.xs += p.x;
    c.zs += p.z;
    c.n++;
    c.pts.push(p);
    centres.set(key, c);
  };
  const UP: Point3 = { x: 0, y: 1, z: 0 };

  /** The index of the line point at or before u. */
  const indexAt = (line: WallLine, u: number) => {
    let i = 0;
    while (i + 1 < line.us.length && (line.us[i + 1] ?? 0) <= u) i++;
    return i;
  };
  /** A building's box over u0..u1 of a line: front, roof and both ends (the back is never seen). */
  const building = (
    line: WallLine,
    u0: number,
    u1: number,
    height: number,
    depth: number,
    colour: string,
  ) => {
    const i0 = indexAt(line, u0);
    const i1 = indexAt(line, u1);
    const us = [u0];
    for (let i = i0 + 1; i <= i1; i++)
      if ((line.us[i] ?? 0) > u0 + 0.05 && (line.us[i] ?? 0) < u1 - 0.05) us.push(line.us[i] ?? 0);
    us.push(u1);
    const mid = Math.min(line.pts.length - 1, Math.max(0, indexAt(line, (u0 + u1) / 2)));
    const edge = line.edges[mid] ?? 0;
    const s = line.ss[mid] ?? 0;
    const key = keyOf(lineAt(line, (u0 + u1) / 2));
    const soup = soupAt(key);
    const front: Point3[] = [];
    const back: Point3[] = [];
    for (const u of us) {
      const p = lineAt(line, u);
      const j = Math.min(line.pts.length - 1, indexAt(line, u));
      const e = line.edges[j] ?? 0;
      const ss = line.ss[j] ?? 0;
      const dd = Math.abs(line.ds[j] ?? 0);
      // On the inside of a bend the back is held short of the bend's centre.
      const k = road.kappaAt(e, ss);
      const inner = k * line.side > 0;
      const room = inner && Math.abs(k) > 1e-6 ? 1 / Math.abs(k) - dd - 1 : Infinity;
      const dep = Math.max(2, Math.min(depth, room));
      front.push({ x: p.x, y: p.y, z: p.z });
      back.push({ x: p.x - p.ix * dep, y: p.y, z: p.z - p.iz * dep });
      note(key, front[front.length - 1] as Point3);
      note(key, back[back.length - 1] as Point3);
    }
    const lo = (q: Point3): Point3 => ({ x: q.x, y: q.y - SINK_M, z: q.z });
    const hi = (q: Point3): Point3 => ({ x: q.x, y: q.y + height, z: q.z });
    const roof = MISSION_COLOURS.roof;
    for (let i = 0; i + 1 < front.length; i++) {
      const fa = front[i] as Point3;
      const fb = front[i + 1] as Point3;
      const ba = back[i] as Point3;
      const bb = back[i + 1] as Point3;
      const want = { x: fa.x - ba.x + fb.x - bb.x, y: 0, z: fa.z - ba.z + fb.z - bb.z };
      quad(soup, lo(fa), lo(fb), hi(fb), hi(fa), colour, want);
      quad(soup, hi(fa), hi(fb), hi(bb), hi(ba), roof, UP);
    }
    const f0 = front[0] as Point3;
    const b0 = back[0] as Point3;
    const fn = front[front.length - 1] as Point3;
    const bn = back[back.length - 1] as Point3;
    const f1 = front[1] ?? fn;
    const fm = front[front.length - 2] ?? f0;
    quad(soup, lo(f0), lo(b0), hi(b0), hi(f0), colour, { x: f0.x - f1.x, y: 0, z: f0.z - f1.z });
    quad(soup, lo(fn), lo(bn), hi(bn), hi(fn), colour, { x: fn.x - fm.x, y: 0, z: fn.z - fm.z });
    return { key, soup, front, back, edge, s };
  };
  /** A flat band on a wall over u0..u1 and y0..y1 (windows, doors, glass), `off` off it. */
  const band = (
    soup: Soup,
    line: WallLine,
    u0: number,
    u1: number,
    y0: number,
    y1: number,
    off: number,
    colour: string,
  ) => {
    const a = lineAt(line, u0);
    const b = lineAt(line, u1);
    const want = { x: a.ix + b.ix, y: 0, z: a.iz + b.iz };
    const at = (p: typeof a, y: number): Point3 => ({ x: p.x + p.ix * off, y: p.y + y, z: p.z + p.iz * off });
    quad(soup, at(a, y0), at(b, y0), at(b, y1), at(a, y1), colour, want);
  };

  lines.forEach((line, li) => {
    const total = line.us[line.us.length - 1] ?? 0;
    const h = (k: number, salt: number) => scatterHash(seed, 7919 + li * 131, k, salt);
    if (line.kind === 'mascot') {
      // One tall wall the length of the run, the mascot over all of it, and its scaffold.
      const colour = MISSION_COLOURS.primer;
      const built = building(line, 0, total, MASCOT_HEIGHT_M, DEPTH_M.mascot, colour);
      buildings.push({
        kind: 'mascot',
        edge: built.edge,
        s: built.s,
        side: line.side,
        u0: 0,
        u1: total,
        height: MASCOT_HEIGHT_M,
        colour,
        motif: 'mascot',
        front: built.front,
        back: built.back,
      });
      // The corner: where the line passes from one road onto the next.
      let uCorner = total / 2;
      for (let i = 1; i < line.edges.length; i++)
        if (line.edges[i] !== line.edges[i - 1]) {
          uCorner = line.us[i] ?? uCorner;
          break;
        }
      const ua = CELL_M;
      const ub = ua + Math.floor((total - 2 * CELL_M) / CELL_M) * CELL_M;
      const ya = 0.6;
      const yb = ya + Math.floor((MASCOT_HEIGHT_M - 1.2) / CELL_M) * CELL_M;
      const w = ub - ua;
      const hh = yb - ya;
      // On a right-hand wall the mural is painted mirrored (so it reads), the face still on the corner.
      const mirror = line.side > 0;
      // The face: where the wall crosses the approaching street's centre line.
      const e0 = line.edges[0] ?? 0;
      const sight = road.frameAt(e0, Math.max(0, (line.ss[0] ?? 0) - FACE_SIGHT_M));
      let uFace = uCorner;
      let bestAcross = Infinity;
      line.pts.forEach((p, i) => {
        const across = Math.abs((p.x - sight.x) * -sight.tz + (p.z - sight.z) * sight.tx);
        if (across < bestAcross) {
          bestAcross = across;
          uFace = line.us[i] ?? uFace;
        }
      });
      const faceX = mirror ? w - (uFace - ua) : uFace - ua;
      paintCells(built.soup, line, ua, ub, ya, yb, PAINT_OFF[0], mascotPainter(w, hh, faceX), { mirror });
      // The scaffold: standards every 2.5 m at the wall and at the front, planks every 3.5 m up.
      const planks = [3.5, 7, 10.5, 13.5];
      const bay = 2.5;
      const nb = Math.max(1, Math.round(w / bay));
      for (let i = 0; i <= nb; i++) {
        const u = ua + (w * i) / nb;
        const p = lineAt(line, u);
        const yaw = Math.atan2(p.ix, p.iz);
        for (const out of [0.2, 1.3]) {
          const x = p.x + p.ix * out;
          const z = p.z + p.iz * out;
          box(built.soup, x, p.y + 7, z, 0.06, 7, 0.06, yaw, MISSION_COLOURS.scaffold);
        }
        if (i === nb) continue;
        const q = lineAt(line, u + w / nb / 2);
        const qyaw = Math.atan2(q.ix, q.iz);
        for (const y of planks) {
          box(
            built.soup,
            q.x + q.ix * 0.75,
            q.y + y,
            q.z + q.iz * 0.75,
            w / nb / 2,
            0.05,
            0.6,
            qyaw,
            MISSION_COLOURS.plank,
          );
          // The guard rail.
          box(
            built.soup,
            q.x + q.ix * 1.3,
            q.y + y + 1,
            q.z + q.iz * 1.3,
            w / nb / 2,
            0.04,
            0.04,
            qyaw,
            MISSION_COLOURS.scaffold,
          );
        }
      }
      // The crew's paint, as one geometry revealed column by column from the far end: the primer,
      // then the new mural.
      const paint: Soup = { pos: [], col: [] };
      const primerVerts: number[] = [];
      const freshVerts: number[] = [];
      const primer = MISSION_COLOURS.primer;
      paintCells(paint, line, ua, ub, ya, yb, PAINT_OFF[1], () => primer, {
        byColumn: true,
        reverse: true,
        marks: primerVerts,
      });
      paintCells(paint, line, ua, ub, ya, yb, PAINT_OFF[2], freshPainter(w, hh), {
        byColumn: true,
        reverse: true,
        marks: freshVerts,
        mirror,
      });
      mascots.push({
        line,
        ua,
        ub,
        ya,
        yb,
        uCorner,
        uFace,
        columns: primerVerts.length,
        primerVerts,
        freshVerts,
        paint,
        planks: [0, ...planks.slice(0, 3)],
      });
      return;
    }
    // Buildings of their own widths along the run; the last takes what is left.
    const [wMin, wSpread] = WIDTH_M[line.kind];
    const [hMin, hSpread] = HEIGHT_M[line.kind];
    let u = 0;
    let k = 0;
    while (u < total - 0.5) {
      let w = wMin + h(k, 1) * wSpread;
      if (total - (u + w) < wMin * 0.6) w = total - u;
      const u0 = u;
      const u1 = Math.min(total, u + w);
      u = u1;
      const height = hMin + h(k, 2) * hSpread;
      const colour = MISSION_COLOURS.stucco[Math.floor(h(k, 3) * MISSION_COLOURS.stucco.length)] as string;
      const painted = h(k, 4) < MURAL_SHARE[line.kind] && u1 - u0 >= 4;
      const m: Motif | null = painted ? (MOTIFS[Math.floor(h(k, 5) * MOTIFS.length)] as Motif) : null;
      const built = building(line, u0, u1, height, DEPTH_M[line.kind], colour);
      buildings.push({
        kind: line.kind,
        edge: built.edge,
        s: built.s,
        side: line.side,
        u0,
        u1,
        height,
        colour,
        motif: m,
        front: built.front,
        back: built.back,
      });
      const soup = built.soup;
      const r = (j: number) => h(k, 100 + j);
      if (line.kind === 'murals') {
        if (m) {
          const ma = u0 + 0.3;
          const mb = ma + Math.floor((u1 - u0 - 0.6) / CELL_M) * CELL_M;
          const ya = 0.3;
          const yb = ya + Math.floor((height - 0.7) / CELL_M) * CELL_M;
          paintCells(soup, line, ma, mb, ya, yb, PAINT_OFF[0], motif(m, mb - ma, yb - ya, r));
        } else {
          // A roll-up door in the middle and a small window.
          const c = (u0 + u1) / 2;
          band(soup, line, c - 1.6, c + 1.6, 0.05, 2.9, 0.03, MISSION_COLOURS.rollUp);
          if (height > 6) band(soup, line, c - 0.7, c + 0.7, 4, 5.2, 0.03, MISSION_COLOURS.window);
        }
      } else {
        // Shopfront: the shop's glass with a door, an awning, windows above and a cornice.
        const a = u0 + 0.5;
        const b = u1 - 0.5;
        band(soup, line, a, b, 0.4, 3.0, 0.03, MISSION_COLOURS.glass);
        const door = a + (b - a) * (0.2 + 0.6 * r(1));
        band(soup, line, door - 0.55, door + 0.55, 0.05, 2.5, 0.05, MISSION_COLOURS.door);
        const awning = MISSION_COLOURS.awning[Math.floor(r(2) * MISSION_COLOURS.awning.length)] as string;
        const pa = lineAt(line, a);
        const pb = lineAt(line, b);
        const atA = (p: typeof pa, out: number, y: number): Point3 => ({
          x: p.x + p.ix * out,
          y: p.y + y,
          z: p.z + p.iz * out,
        });
        quad(soup, atA(pa, 0, 3.35), atA(pb, 0, 3.35), atA(pb, 1.3, 2.85), atA(pa, 1.3, 2.85), awning, {
          x: pa.ix + pb.ix,
          y: 1.5,
          z: pa.iz + pb.iz,
        });
        quad(soup, atA(pa, 1.3, 2.85), atA(pb, 1.3, 2.85), atA(pb, 1.3, 2.5), atA(pa, 1.3, 2.5), awning, {
          x: pa.ix + pb.ix,
          y: 0,
          z: pa.iz + pb.iz,
        });
        const top = height - 0.7;
        if (m) {
          const ma = u0 + 0.4;
          const mb = ma + Math.floor((u1 - u0 - 0.8) / CELL_M) * CELL_M;
          const ya = 3.8;
          const yb = ya + Math.floor((top - 3.8) / CELL_M) * CELL_M;
          if (yb - ya >= 2)
            paintCells(soup, line, ma, mb, ya, yb, PAINT_OFF[0], motif(m, mb - ma, yb - ya, r));
        } else {
          for (let y = 4.2; y + 1.6 <= top; y += 3.2) {
            const n = Math.max(1, Math.floor((b - a) / 2.6));
            for (let i = 0; i < n; i++) {
              const c = a + ((i + 0.5) * (b - a)) / n;
              band(soup, line, c - 0.6, c + 0.6, y, y + 1.6, 0.03, MISSION_COLOURS.window);
            }
          }
        }
        band(soup, line, u0, u1, height - 0.5, height, 0.06, MISSION_COLOURS.roof);
      }
      k++;
    }
    // The lamps at the kerb of a shopfront sidewalk and the bins by some doors stand where
    // road/furniture.ts plans them (playtest 4, "solid but forgiving": the sim meets what is drawn).
  });

  for (const f of planStreetFurniture(road, seed).items) {
    if (f.layer !== 'mission') continue;
    const p = road.toWorld(f.edge, f.s, f.d, 0);
    const c = road.toWorld(f.edge, f.s, 0, 0);
    const it: MissionItem = {
      variant: f.variant,
      rule: f.rule,
      key: gridKey(p.x, p.z),
      p: { x: p.x, y: c.y, z: p.z },
      turn: Math.atan2(c.x - p.x, c.z - p.z),
      edge: f.edge,
      s: f.s,
      d: f.d,
    };
    items.push(it);
    note(it.key, it.p);
  }

  const stretches = [...centres.entries()].map(([key, c]) => {
    const cx = c.xs / c.n;
    const cz = c.zs / c.n;
    const radius = Math.max(0, ...c.pts.map((p) => Math.hypot(p.x - cx, p.z - cz)));
    return { key, cx, cz, radius };
  });
  for (const st of stretches) if (!soups.has(st.key)) soups.set(st.key, { pos: [], col: [] });
  return { lines, buildings, mascots, items, soups, stretches };
}

export interface MissionCounts {
  buildings: number;
  murals: number;
  motifs: number;
  mascots: number;
  /**
   * Each mascot wall's crew: how much primer and how much new mural is on, where the work's edge is
   * along the wall, and where each painter stands (u, m).
   */
  crew: { primer: number; fresh: number; edge: number; at: number[] }[];
  lamps: number;
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
  mesh: Mesh | null;
}

/** One mascot wall's live parts: its paint (revealed by draw range) and its crew. */
interface Crew {
  wall: MascotWall;
  paint: Mesh;
  crew: Mesh;
  crewPos: Float32Array;
  crewCol: Float32Array;
  cx: number;
  cz: number;
  radius: number;
  /** Where each painter stands along the wall, eased toward the work. */
  at: number[];
  primer: number;
  fresh: number;
  /** Where the paint going on now has got to along the wall (u, m). */
  edge: number;
}

/** The crew: four painters, one per scaffold level, staggered either side of the work. */
const PAINTERS = [
  { level: 0, lead: 0.4, phase: 0 },
  { level: 1, lead: -0.7, phase: 1.7 },
  { level: 2, lead: 1, phase: 3.1 },
  { level: 3, lead: -0.3, phase: 4.4 },
] as const;

/** A painter, built into a soup at a point on the wall: standing on `y`, facing it, roller at `ry`. */
function painterSoup(soup: Soup, wall: MascotWall, u: number, y: number, ry: number, paint: string): void {
  const p = lineAt(wall.line, u);
  const yaw = Math.atan2(p.ix, p.iz);
  const at = (out: number, yy: number): Point3 => ({ x: p.x + p.ix * out, y: p.y + yy, z: p.z + p.iz * out });
  const stand = at(0.95, y);
  box(soup, stand.x, stand.y + 0.43, stand.z, 0.18, 0.43, 0.13, yaw, MISSION_COLOURS.overalls);
  box(soup, stand.x, stand.y + 1.2, stand.z, 0.23, 0.35, 0.15, yaw, MISSION_COLOURS.overalls);
  box(soup, stand.x, stand.y + 1.7, stand.z, 0.13, 0.14, 0.13, yaw, MISSION_COLOURS.skin);
  box(soup, stand.x, stand.y + 1.86, stand.z, 0.15, 0.05, 0.15, yaw, MISSION_COLOURS.cap);
  const shoulder = at(0.85, y + 1.35);
  const roller = at(0.16, y + ry);
  beam(soup, shoulder, roller, 0.035, '#6d5a4a');
  const head = lineAt(wall.line, u);
  box(soup, roller.x, roller.y, roller.z, 0.32, 0.07, 0.07, Math.atan2(head.ix, head.iz), paint);
}

/** The mural district of one road scene: its static stretches near the camera, and its crews. */
export class MissionLayer {
  readonly group = new Group();
  readonly plan: MissionPlan;
  private readonly stretches: Built[];
  private readonly crews: Crew[] = [];
  private shownMeshes = 0;
  private shownTris = 0;
  private clock = 0;

  constructor(
    private readonly props: SceneryModel | undefined,
    private readonly look: LookStyle,
    input: MissionInput,
  ) {
    this.group.name = 'road-mission';
    this.plan = planMission(input);
    this.stretches = this.plan.stretches.map((s) => ({ ...s, mesh: null }));
    const material = look.material('prop', { vertexColors: true });
    for (const wall of this.plan.mascots) {
      const geo = soupGeometry(wall.paint);
      geo.setDrawRange(0, 0);
      const paint = new Mesh(geo, material);
      paint.name = 'road-mission-paint';
      paint.matrixAutoUpdate = false;
      paint.visible = false;
      const crewSoup: Soup = { pos: [], col: [] };
      for (const pt of PAINTERS)
        painterSoup(crewSoup, wall, wall.ub, wall.planks[pt.level] ?? 0, 1, '#ffffff');
      const crewGeo = soupGeometry(crewSoup);
      const crew = new Mesh(crewGeo, material);
      crew.name = 'road-mission-crew';
      crew.matrixAutoUpdate = false;
      crew.frustumCulled = false;
      crew.visible = false;
      this.group.add(paint, crew);
      const pts = wall.line.pts;
      const cx = pts.reduce((a, p) => a + p.x, 0) / pts.length;
      const cz = pts.reduce((a, p) => a + p.z, 0) / pts.length;
      const radius = Math.max(...pts.map((p) => Math.hypot(p.x - cx, p.z - cz)));
      this.crews.push({
        wall,
        paint,
        crew,
        crewPos: (crewGeo.getAttribute('position') as Float32BufferAttribute).array as Float32Array,
        crewCol: (crewGeo.getAttribute('color') as Float32BufferAttribute).array as Float32Array,
        cx,
        cz,
        radius,
        at: PAINTERS.map(() => wall.ub),
        primer: 0,
        fresh: 0,
        edge: wall.ub,
      });
    }
  }

  /**
   * Per frame: builds, shows and frees the stretches by distance from the camera, and sets each
   * mascot wall's paint and crew from the leader's share of the race (`raceShare`); `dt` is the
   * race's own time step (0 while it is paused). Returns the static items in view.
   */
  update(cameraX: number, cameraZ: number, dt: number, share: number): number {
    let next: Built | null = null;
    let nextDist = Infinity;
    for (const st of this.stretches) {
      const dist = Math.hypot(st.cx - cameraX, st.cz - cameraZ) - st.radius;
      if (!st.mesh && dist < MISSION_DRAW_M + PREFETCH_M && dist < nextDist) {
        next = st;
        nextDist = dist;
      }
    }
    if (next) this.build(next);
    let meshes = 0;
    let tris = 0;
    let shown = 0;
    for (const st of this.stretches) {
      if (!st.mesh) continue;
      const dist = Math.hypot(st.cx - cameraX, st.cz - cameraZ) - st.radius;
      st.mesh.visible = dist < MISSION_DRAW_M;
      if (st.mesh.visible) {
        meshes++;
        tris += (st.mesh.geometry.getAttribute('position')?.count ?? 0) / 3;
        shown++;
      } else if (dist > KEEP_M) this.free(st);
    }
    this.clock += Math.max(0, Math.min(0.1, dt));
    const { primer, fresh } = crewProgress(share);
    for (const c of this.crews) {
      const near = Math.hypot(c.cx - cameraX, c.cz - cameraZ) - c.radius < MISSION_DRAW_M;
      c.primer = primer;
      c.fresh = fresh;
      const w = c.wall;
      const count = paintDrawCount(w, primer, fresh);
      const n = w.columns;
      const k1 = Math.floor(primer * n);
      const k2 = Math.floor(fresh * n);
      c.paint.geometry.setDrawRange(0, count);
      c.paint.visible = near && count > 0;
      c.crew.visible = near;
      if (c.paint.visible) {
        meshes++;
        tris += count / 3;
      }
      // The work: the edge of the paint going on now, and what is on the roller.
      const working = k1 < n ? k1 : k2;
      const edgeU = w.ub - working * ((w.ub - w.ua) / n);
      c.edge = edgeU;
      if (!near) continue;
      const painting = primer > 0 && fresh < 1;
      const roller = k1 < n ? MISSION_COLOURS.primer : '#f6ae2d';
      const soup: Soup = { pos: [], col: [] };
      PAINTERS.forEach((pt, i) => {
        const want = Math.max(w.ua + 0.5, Math.min(w.ub - 0.5, edgeU + pt.lead));
        const cur = c.at[i] ?? want;
        // Walking along with the work; arriving in view, already at it.
        c.at[i] = Math.abs(want - cur) > 3 ? want : cur + (want - cur) * Math.min(1, dt * 3);
        const swing = painting ? Math.sin(this.clock * 2.6 + pt.phase) * 0.7 : -0.6;
        painterSoup(soup, w, c.at[i] ?? want, w.planks[pt.level] ?? 0, 1.9 + swing, roller);
      });
      c.crewPos.set(soup.pos);
      c.crewCol.set(soup.col);
      c.crew.geometry.getAttribute('position').needsUpdate = true;
      c.crew.geometry.getAttribute('color').needsUpdate = true;
      meshes++;
      tris += soup.pos.length / 9;
    }
    this.shownMeshes = meshes;
    this.shownTris = tris;
    return shown;
  }

  counts(): MissionCounts {
    const painted = this.plan.buildings.filter((b) => b.motif);
    return {
      buildings: this.plan.buildings.length,
      murals: painted.length,
      motifs: new Set(painted.map((b) => b.motif)).size,
      mascots: this.plan.mascots.length,
      crew: this.crews.map((c) => ({ primer: c.primer, fresh: c.fresh, edge: c.edge, at: [...c.at] })),
      lamps: this.plan.items.filter((i) => i.rule === 'lamp').length,
      stretches: this.stretches.length,
      built: this.stretches.filter((s) => s.mesh).length,
      meshes: this.shownMeshes,
      triangles: Math.round(this.shownTris),
    };
  }

  /** Each mascot wall's paint and crew meshes (tests). */
  crewMeshes(): readonly { paint: Mesh; crew: Mesh }[] {
    return this.crews;
  }

  dispose(): void {
    for (const st of this.stretches) this.free(st);
    for (const c of this.crews) {
      c.paint.geometry.dispose();
      c.crew.geometry.dispose();
    }
    this.group.removeFromParent();
  }

  private free(st: Built) {
    if (!st.mesh) return;
    st.mesh.geometry.dispose();
    st.mesh.removeFromParent();
    st.mesh = null;
  }

  private build(st: Built) {
    const soup = this.plan.soups.get(st.key) ?? { pos: [], col: [] };
    const items = this.plan.items.filter((it) => it.key === st.key);
    const geoOf = (it: MissionItem) => this.props?.variants[it.variant];
    let total = soup.pos.length / 3;
    for (const it of items) total += geoOf(it)?.getAttribute('position').count ?? 0;
    const pos = new Float32Array(total * 3);
    const nrm = new Float32Array(total * 3);
    const col = new Float32Array(total * 3);
    pos.set(soup.pos, 0);
    col.set(soup.col, 0);
    faceNormals(soup.pos, nrm);
    let o = soup.pos.length / 3;
    for (const it of items) {
      const g = geoOf(it);
      if (!g) continue;
      const gp = g.getAttribute('position').array;
      const gn = g.getAttribute('normal').array;
      const gc = g.getAttribute('color').array;
      const n = gp.length / 3;
      col.set(gc, o * 3);
      const cos = Math.cos(it.turn);
      const sin = Math.sin(it.turn);
      for (let i = 0; i < n; i++, o++) {
        const x = gp[i * 3] ?? 0;
        const y = gp[i * 3 + 1] ?? 0;
        const z = gp[i * 3 + 2] ?? 0;
        pos[o * 3] = it.p.x + x * cos + z * sin;
        pos[o * 3 + 1] = it.p.y + y;
        pos[o * 3 + 2] = it.p.z + z * cos - x * sin;
        const nx = gn[i * 3] ?? 0;
        const nz = gn[i * 3 + 2] ?? 0;
        nrm[o * 3] = nx * cos + nz * sin;
        nrm[o * 3 + 1] = gn[i * 3 + 1] ?? 0;
        nrm[o * 3 + 2] = nz * cos - nx * sin;
      }
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(pos.subarray(0, o * 3), 3));
    geo.setAttribute('normal', new Float32BufferAttribute(nrm.subarray(0, o * 3), 3));
    geo.setAttribute('color', new Float32BufferAttribute(col.subarray(0, o * 3), 3));
    geo.computeBoundingSphere();
    const mesh = new Mesh(geo, this.look.material('prop', { vertexColors: true }));
    mesh.name = 'road-mission';
    mesh.matrixAutoUpdate = false;
    mesh.visible = false;
    this.group.add(mesh);
    st.mesh = mesh;
  }
}

/** Face normals for a triangle soup, written into `out`. */
function faceNormals(pos: readonly number[], out: Float32Array): void {
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  for (let i = 0; i + 8 < pos.length; i += 9) {
    a.fromArray(pos, i);
    b.fromArray(pos, i + 3).sub(a);
    c.fromArray(pos, i + 6).sub(a);
    b.cross(c).normalize();
    for (let k = 0; k < 3; k++) b.toArray(out, i + k * 3);
  }
}

/** A soup as a geometry with face normals. */
function soupGeometry(soup: Soup): BufferGeometry {
  const pos = Float32Array.from(soup.pos);
  const nrm = new Float32Array(pos.length);
  faceNormals(soup.pos, nrm);
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new Float32BufferAttribute(nrm, 3));
  geo.setAttribute('color', new Float32BufferAttribute(Float32Array.from(soup.col), 3));
  geo.computeBoundingSphere();
  return geo;
}
