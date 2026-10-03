// San Francisco's waterfront (run W-U; the pitch deck's #8, "Later": "the waterfront (palms, piers,
// sea lions, an invented clock-tower ferry building)"; playtest 2, 2026-10-02: "I expected some city
// feeling not just all row houses"). This layer draws what stands on the waterfront network's tagged
// land (tools/road/tracks/sf-waterfront.ts; scenery.ts's `promenade` and `wharf` themes, which the
// road scene draws as land and the verge layer as paving):
//
// - on the bay side, the seawall's face along the promenade, palms and lamps along its edge, benches
//   facing the water, and on its edge the pier sheds (`pier-shed`: a bulkhead facade with its number,
//   even before the ferry hall and odd after it, as the city numbers them, and the long shed over the
//   water behind it) and the clock-tower ferry hall (`ferry-hall`; its four clocks each tell a
//   different time, and nobody mentions it), with a ferry at its slip;
// - in the water between the piers, moored boats, and the sea lions' floats (`sea-lions`);
// - on the city side, low waterfront blocks shoulder to shoulder behind the sidewalk (brick lofts, an
//   arcade, a crab house, a startup in stealth mode, an old hotel, a parking garage), with taller
//   towers behind them; short side streets running inland (`wharf-street`) lined with buildings; the
//   plaza facing the ferry hall (`ferry-plaza`) with its palms; the lot by the bridge (`wharf-lot`)
//   with its parked cars; and a city floor out past them, so no sea shows between the blocks.
//
// Every building is made here from coloured boxes (no download: this chunk is the whole kit), and
// its words are a 3 by 5 block font. The palms are the Keys' palm models (models.ts loads them for
// a waterfront), the cars the city kit's, the boats the base pack's.
//
// Drawing (the phone's budget): every still item is merged per 160 m square of the world with a far
// stand-in for each (scenery-merge.ts: one draw call per square, the far ones a few boxes each),
// and the flat surfaces (the seawall's face, the side streets, the lot's lines, the city floor) are
// merged per STRETCH_M of road, built when the camera comes near and freed when it has gone. It is a
// lazy chunk: it loads with a waterfront race, never in the first load. Presentation only: the sim's
// verge bands (road/cross-section.ts) are what stops a rider at the seawall and the building fronts.
import {
  BufferGeometry,
  Euler,
  Float32BufferAttribute,
  Group,
  Matrix4,
  Mesh,
  Quaternion,
  Vector3,
  type Material,
} from 'three';
import type { RoadNetwork } from '../road';
import type { Point3 } from './geometry';
import type { LookStyle } from './look';
import type { SceneryModel, SceneryModels } from './models';
import type { RoadDressing } from './road-mesh';
import { LAND_TOP_M, scatterHash } from './scenery';
import { MergedScenery, SCENERY_LOD_M, type MergeItem } from './scenery-merge';

/** The waterfront's tags (tools/road/tracks/sf-waterfront.ts). */
const BAY_TAGS = ['promenade', 'pier-shed', 'ferry-hall', 'sea-lions'] as const;
const CITY_TAGS = ['wharf', 'wharf-street', 'ferry-plaza', 'wharf-lot'] as const;

/** Whether a network has a waterfront at all (any waterfront tag). */
export function hasWaterfront(tags: ReadonlySet<string>): boolean {
  return [...BAY_TAGS, ...CITY_TAGS].some((t) => tags.has(t));
}

/** The verge past the drawn shoulder (road-mesh.ts VERGE_M). */
const VERGE_M = 0.6;
/** The road scene's land strip past the verge on the city side (road-mesh.ts SCENERY_LAND_M). */
const LAND_STRIP_M = 24;
/** How deep a pier shed reaches out over the water, and the ferry hall, m. [default] */
export const SHED_DEPTH_M = 70;
const HALL_DEPTH_M = 42;
/** The ferry hall's clock tower: its flagpole's top, m over the promenade. [default] */
export const TOWER_TOP_M = 76;
/** A waterfront block's depth back from its front, m: past the land strip's edge, so none shows behind it. */
const BLOCK_DEPTH_M = 22;
/** The taller towers behind the blocks: past the front this far (plus a seeded spread), every so often. */
const BACK_ROW_M = 40;
const BACK_ROW_EVERY_M = 36;
/** A side street's reach inland and its roadway's half width, m. */
export const STREET_REACH_M = 170;
const STREET_ROAD_HALF_M = 5.5;
/** A side street drops this much per metre past the land strip, down to the floor. */
const STREET_DROP = 0.05;
/** The city floor under the blocks: its height and its reach past the land strip, m. */
const CITY_FLOOR_Y = 0.45;
export const CITY_FLOOR_M = 260;
/** Behind the plaza and the lot, buildings stand this far past the verge, m: where their paving ends. */
const OPEN_BACK_M = 17.4;
/** Along the promenade: palms, lamps and benches every so many metres. [default] */
const PALM_EVERY_M = 24;
const LAMP_EVERY_M = 32;
const BENCH_EVERY_M = 48;
/** Static surfaces are merged per stretch of road this long, m. [default] */
export const STRETCH_M = 160;
/** Items and surfaces are drawn out to this far (the foggy region's haze is full at 480 m), m. */
export const WATERFRONT_DRAW_M = 480;
const PREFETCH_M = 100;
const KEEP_M = WATERFRONT_DRAW_M + 200;
/** Features nothing of this layer stands in, with room round them (road-mesh.ts KEEP_CLEAR). */
const KEEP_CLEAR = new Set(['billboard', 'boostPad', 'rampTruck', 'roadsideZone', 'copSpawn']);
const FEATURE_CLEAR_M = 2;

/**
 * The pier numbers [default], nearest the ferry hall first: even on the hall's near side, odd past
 * it, as the city numbers its piers (with gaps, as its numbers have).
 */
export const EVEN_PIERS: readonly number[] = [14, 20, 22, 24, 26, 28, 30, 32, 36, 38, 40];
export const ODD_PIERS: readonly number[] = [1, 3, 5, 7, 9, 15, 17, 19, 23, 27, 29, 31, 33, 35, 39];
/** The four clocks of the ferry hall's tower: each tells its own time [default] (hours, minutes). */
export const CLOCK_TIMES: readonly (readonly [number, number])[] = [
  [10, 10],
  [3, 40],
  [7, 25],
  [12, 55],
];

/** Flat colours of the layer's own surfaces and buildings. [default] */
export const WATERFRONT_COLOURS = {
  seawall: '#8d877b',
  cap: '#d7d0c0',
  street: '#4a4b50',
  sidewalk: '#aaa7a0',
  line: '#ece9e1',
  floor: '#8f918c',
  shedFacade: '#dcd2b6',
  shedTrim: '#efe7d2',
  shedBody: '#c7c0ad',
  shedRoof: '#8e9a92',
  deck: '#6e6a61',
  piles: '#3d3a35',
  door: '#3a4147',
  glass: '#4b5862',
  pierText: '#2f5d50',
  hall: '#e4d8bd',
  hallTrim: '#f2ead7',
  hallRoof: '#7f8a84',
  clock: '#f6f3ea',
  hands: '#1f2326',
  flag: '#c0392b',
  brick: '#9a5b45',
  stucco: '#e3d7bf',
  teal: '#5e9c95',
  white: '#f1efe8',
  hotel: '#e7d39a',
  concrete: '#b3b0a8',
  tile: '#b0523b',
  awningA: '#2f6b5a',
  awningB: '#b8433a',
  awningC: '#2f4a7a',
  tower: '#8fa3b3',
  towerDark: '#6d8191',
  lampPost: '#2b3a34',
  lampGlobe: '#f4ecd2',
  bench: '#6b4f36',
  float: '#7c7a6f',
  seaLion: '#6b5a4a',
  seaLionDark: '#4a3f35',
  fish: '#e0663a',
  ferryHull: '#f2f2ee',
  ferryBand: '#2e5f8a',
} as const;

// ---- a small box builder (positions, normals and colours as flat triangles) ----------------------

type Face = 'px' | 'nx' | 'py' | 'ny' | 'pz' | 'nz';
/** Each face: its normal and two axes u, v with u x v = normal (so a, b, c, d run counter-clockwise). */
const FACE_AXES: Readonly<Record<Face, readonly [readonly number[], readonly number[], readonly number[]]>> =
  {
    px: [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ],
    nx: [
      [-1, 0, 0],
      [0, 0, 1],
      [0, 1, 0],
    ],
    py: [
      [0, 1, 0],
      [0, 0, 1],
      [1, 0, 0],
    ],
    ny: [
      [0, -1, 0],
      [1, 0, 0],
      [0, 0, 1],
    ],
    pz: [
      [0, 0, 1],
      [1, 0, 0],
      [0, 1, 0],
    ],
    nz: [
      [0, 0, -1],
      [0, 1, 0],
      [1, 0, 0],
    ],
  };
const ALL_FACES: readonly Face[] = ['px', 'nx', 'py', 'ny', 'pz', 'nz'];
/** Only the front: a flat panel on a wall (a window, a letter, a clock). */
export const FRONT_ONLY: readonly Face[] = ['px', 'nx', 'py', 'ny', 'nz'];

const hexRgb = (h: string): [number, number, number] => {
  const n = parseInt(h.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

/** Box options: turns (radians, applied Y then X then Z), faces left out, a parent frame. */
interface BoxOpts {
  rx?: number;
  ry?: number;
  rz?: number;
  omit?: readonly Face[];
  frame?: Matrix4;
}

/** Coloured boxes as one flat-triangle geometry, in the shape's own frame. */
export class Shape {
  readonly pos: number[] = [];
  readonly nrm: number[] = [];
  readonly col: number[] = [];
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly e = new Euler();
  private readonly v = new Vector3();
  private readonly n = new Vector3();
  private readonly one = new Vector3(1, 1, 1);

  /** A box of size [w, h, d] centred at `at`. */
  box(
    size: readonly [number, number, number],
    at: readonly [number, number, number],
    colour: string,
    o: BoxOpts = {},
  ) {
    this.e.set(o.rx ?? 0, o.ry ?? 0, o.rz ?? 0, 'YXZ');
    this.m.compose(this.v.set(at[0], at[1], at[2]), this.q.setFromEuler(this.e), this.one);
    if (o.frame) this.m.premultiply(o.frame);
    const [r, g, b] = hexRgb(colour);
    const half = [size[0] / 2, size[1] / 2, size[2] / 2];
    for (const face of ALL_FACES) {
      if (o.omit?.includes(face)) continue;
      const [nn, u, w] = FACE_AXES[face];
      const corner = (su: number, sw: number): Vector3 =>
        new Vector3(
          (nn[0]! + su * u[0]! + sw * w[0]!) * half[0]!,
          (nn[1]! + su * u[1]! + sw * w[1]!) * half[1]!,
          (nn[2]! + su * u[2]! + sw * w[2]!) * half[2]!,
        ).applyMatrix4(this.m);
      const a = corner(-1, -1);
      const bb = corner(1, -1);
      const c = corner(1, 1);
      const d = corner(-1, 1);
      this.n.set(nn[0]!, nn[1]!, nn[2]).transformDirection(this.m);
      for (const p of [a, bb, c, a, c, d]) {
        this.pos.push(p.x, p.y, p.z);
        this.nrm.push(this.n.x, this.n.y, this.n.z);
        this.col.push(r, g, b);
      }
    }
  }

  /**
   * Words in the block font on a wall facing +z: each pixel `px` m, centred on x, its bottom at y,
   * standing just proud of z. Runs of pixels in a row are one panel.
   */
  text(words: string, x: number, y: number, z: number, px: number, colour: string, frame?: Matrix4) {
    const glyphs = [...words.toUpperCase()];
    const width = glyphs.length * 4 - 1;
    const x0 = x - (width * px) / 2;
    glyphs.forEach((ch, i) => {
      const rows = FONT[ch];
      if (!rows) return;
      rows.forEach((row, r) => {
        let start = -1;
        for (let c = 0; c <= row.length; c++) {
          const on = row[c] === '#';
          if (on && start < 0) start = c;
          if (!on && start >= 0) {
            const len = c - start;
            this.box(
              [len * px, px, 0.04],
              [x0 + (i * 4 + start + len / 2) * px, y + (4 - r + 0.5) * px, z],
              colour,
              { omit: FRONT_ONLY, ...(frame ? { frame } : {}) },
            );
            start = -1;
          }
        }
      });
    });
  }

  get triangles(): number {
    return this.pos.length / 9;
  }

  geometry(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('color', new Float32BufferAttribute(this.col, 3));
    g.computeBoundingSphere();
    return g;
  }
}

/** A 3 by 5 block font (rows top to bottom; '#' is a pixel). */
const FONT: Readonly<Record<string, readonly string[]>> = {
  A: ['.#.', '#.#', '###', '#.#', '#.#'],
  B: ['##.', '#.#', '##.', '#.#', '##.'],
  C: ['.##', '#..', '#..', '#..', '.##'],
  D: ['##.', '#.#', '#.#', '#.#', '##.'],
  E: ['###', '#..', '##.', '#..', '###'],
  F: ['###', '#..', '##.', '#..', '#..'],
  G: ['.##', '#..', '#.#', '#.#', '.##'],
  H: ['#.#', '#.#', '###', '#.#', '#.#'],
  I: ['###', '.#.', '.#.', '.#.', '###'],
  K: ['#.#', '#.#', '##.', '#.#', '#.#'],
  L: ['#..', '#..', '#..', '#..', '###'],
  M: ['#.#', '###', '###', '#.#', '#.#'],
  N: ['##.', '#.#', '#.#', '#.#', '#.#'],
  O: ['.#.', '#.#', '#.#', '#.#', '.#.'],
  P: ['##.', '#.#', '##.', '#..', '#..'],
  R: ['##.', '#.#', '##.', '#.#', '#.#'],
  S: ['.##', '#..', '.#.', '..#', '##.'],
  T: ['###', '.#.', '.#.', '.#.', '.#.'],
  U: ['#.#', '#.#', '#.#', '#.#', '###'],
  W: ['#.#', '#.#', '###', '###', '#.#'],
  Y: ['#.#', '#.#', '.#.', '.#.', '.#.'],
  '0': ['###', '#.#', '#.#', '#.#', '###'],
  '1': ['.#.', '##.', '.#.', '.#.', '###'],
  '2': ['##.', '..#', '.#.', '#..', '###'],
  '3': ['##.', '..#', '.#.', '..#', '##.'],
  '4': ['#.#', '#.#', '###', '..#', '..#'],
  '5': ['###', '#..', '##.', '..#', '##.'],
  '6': ['.##', '#..', '###', '#.#', '###'],
  '7': ['###', '..#', '.#.', '.#.', '.#.'],
  '8': ['###', '#.#', '###', '#.#', '###'],
  '9': ['###', '#.#', '###', '..#', '##.'],
  ' ': ['...', '...', '...', '...', '...'],
};

/** Whether the block font draws every character of a word (a missing one is left blank). */
export function fontCovers(words: string): boolean {
  return [...words.toUpperCase()].every((ch) => FONT[ch] !== undefined);
}

// ---- the kit: what stands on the waterfront, front toward +z, base at y 0 ------------------------

const C = WATERFRONT_COLOURS;
/** Building walls reach this far under their base, so none shows a gap on a slope. */
const FOOT_M = 4;

/** A row of windows (front panels) across a wall of width w, at height y. */
function windows(
  sh: Shape,
  w: number,
  y: number,
  every: number,
  size: readonly [number, number],
  colour = C.glass,
) {
  const n = Math.max(1, Math.floor((w - 2) / every));
  for (let i = 0; i < n; i++) {
    const x = -((n - 1) * every) / 2 + i * every;
    sh.box([size[0], size[1], 0.04], [x, y, 0.03], colour, { omit: FRONT_ONLY });
  }
}

/** A pier's bulkhead shed: its facade on the seawall, the shed over the water, its deck and piles. */
export function pierShed(width: number, pier: number, drop: number): Shape {
  const sh = new Shape();
  const h = 10;
  // The deck and the dark piles under it, from the water up to the promenade.
  sh.box([width + 4, 0.6, SHED_DEPTH_M + 2], [0, -0.3, -SHED_DEPTH_M / 2 - 1], C.deck, { omit: ['ny'] });
  sh.box([width + 3, drop, SHED_DEPTH_M], [0, -0.6 - drop / 2, -SHED_DEPTH_M / 2 - 1.5], C.piles, {
    omit: ['py', 'pz', 'ny'],
  });
  // The long shed behind the facade, its clerestory along the ridge.
  sh.box([width - 2, 7.5, SHED_DEPTH_M - 3], [0, 3.75, -SHED_DEPTH_M / 2 - 1.5], C.shedBody, {
    omit: ['ny', 'pz'],
  });
  sh.box([width * 0.35, 2, SHED_DEPTH_M - 6], [0, 8.5, -SHED_DEPTH_M / 2 - 2.5], C.shedRoof, {
    omit: ['ny'],
  });
  // The facade: its wall, a raised middle, pilasters, a cornice, the big door, a row of windows.
  sh.box([width, h, 1.2], [0, h / 2, -0.6], C.shedFacade, { omit: ['ny'] });
  sh.box([width * 0.4, 3, 1.2], [0, h + 1.5, -0.6], C.shedFacade, { omit: ['ny'] });
  sh.box([width * 0.4 + 0.6, 0.5, 1.5], [0, h + 3.2, -0.6], C.shedTrim, { omit: ['ny'] });
  sh.box([width + 0.6, 0.6, 1.6], [0, h + 0.1, -0.6], C.shedTrim, { omit: ['ny'] });
  const bays = Math.max(2, Math.round(width / 10));
  for (let i = 0; i <= bays; i++) {
    const x = -width / 2 + (i * width) / bays;
    sh.box([0.9, h, 0.5], [x, h / 2, 0.2], C.shedTrim, { omit: ['ny', 'nz'] });
  }
  sh.box([7, 6, 0.06], [0, 3, 0.03], C.door, { omit: FRONT_ONLY });
  windows(sh, width * 0.9, 7.6, 4, [1.8, 1.6]);
  sh.text(`PIER ${pier}`, 0, 10.8, 0.05, 0.42, C.pierText);
  return sh;
}

/** The hands of a clock face (in the face's frame, facing +z) at h:m. */
function clockHands(sh: Shape, r: number, hours: number, minutes: number, frame: Matrix4) {
  const minA = (minutes / 60) * Math.PI * 2;
  const hourA = ((hours % 12) / 12 + minutes / 720) * Math.PI * 2;
  for (const [a, len, w] of [
    [minA, r * 0.85, r * 0.08],
    [hourA, r * 0.55, r * 0.12],
  ] as const) {
    // A hand from the centre outward: turned clockwise from twelve (negative about +z).
    sh.box([w, len, 0.05], [Math.sin(a) * (len / 2), Math.cos(a) * (len / 2), 0.1], C.hands, {
      rz: -a,
      omit: FRONT_ONLY,
      frame,
    });
  }
}

/**
 * The ferry hall: a long two-storey arcaded hall on the seawall, the clock tower over its middle
 * (each of its four clocks telling a different time), and a ferry at its slip behind it.
 */
export function ferryHall(width: number, drop: number): Shape {
  const sh = new Shape();
  const h = 13;
  sh.box([width + 6, 0.6, HALL_DEPTH_M + 2], [0, -0.3, -HALL_DEPTH_M / 2 - 1], C.deck, { omit: ['ny'] });
  sh.box([width + 5, drop, HALL_DEPTH_M], [0, -0.6 - drop / 2, -HALL_DEPTH_M / 2 - 1.5], C.piles, {
    omit: ['py', 'pz', 'ny'],
  });
  // The hall, its roof and cornice.
  sh.box([width, h, HALL_DEPTH_M], [0, h / 2, -HALL_DEPTH_M / 2], C.hall, { omit: ['ny'] });
  sh.box([width - 4, 2.2, HALL_DEPTH_M - 6], [0, h + 1.1, -HALL_DEPTH_M / 2], C.hallRoof, { omit: ['ny'] });
  sh.box([width + 0.8, 0.7, 1.4], [0, h, 0], C.hallTrim, { omit: ['ny'] });
  sh.box([width + 0.4, 0.5, 1.0], [0, 6.2, 0.1], C.hallTrim, { omit: ['ny'] });
  // The arcade below and the windows above, a bay every 6 m.
  const bays = Math.floor((width - 6) / 6);
  for (let i = 0; i < bays; i++) {
    const x = -((bays - 1) * 6) / 2 + i * 6;
    if (Math.abs(x) < 9) continue;
    sh.box([3.4, 4.6, 0.06], [x, 2.6, 0.03], C.door, { omit: FRONT_ONLY });
    sh.box([2.6, 3.2, 0.06], [x, 9.4, 0.03], C.glass, { omit: FRONT_ONLY });
  }
  // The central entrance: a tall arch and the word over it.
  sh.box([10, 4, 1.2], [0, h + 2, 0], C.hall, { omit: ['ny'] });
  sh.box([7, 8, 0.06], [0, 4.2, 0.03], C.door, { omit: FRONT_ONLY });
  sh.text('FERRIES', 0, 10.4, 0.06, 0.4, C.pierText);
  // The tower: a shaft, corner piers, the clock stage, the belfry, a stepped cap and its flag.
  const tw = 11;
  const base = h;
  const shaft = 28;
  sh.box([tw, shaft, tw], [0, base + shaft / 2, -tw / 2 - 1], C.hall, { omit: ['ny'] });
  for (const [x, z] of [
    [-tw / 2, -1],
    [tw / 2, -1],
    [-tw / 2, -tw - 1],
    [tw / 2, -tw - 1],
  ] as const)
    sh.box([1.4, shaft + 2, 1.4], [x, base + (shaft + 2) / 2, z], C.hallTrim, { omit: ['ny'] });
  for (let k = 0; k < 4; k++) {
    // The tower's front face is at z -1 (it stands 1 m back from the hall's front).
    for (const x of [-2.6, 2.6])
      sh.box([1.2, 3, 0.06], [x, base + 6 + k * 6.5, -0.97], C.glass, { omit: FRONT_ONLY });
  }
  const stage = base + shaft;
  sh.box([tw + 1.6, 10, tw + 1.6], [0, stage + 5, -tw / 2 - 1], C.hallTrim, { omit: ['ny'] });
  // Four clocks, one per side, each its own time.
  const centre = new Vector3(0, stage + 5, -tw / 2 - 1);
  const r = 3.6;
  for (let side = 0; side < 4; side++) {
    const yaw = (side * Math.PI) / 2;
    const frame = new Matrix4().compose(
      new Vector3(
        centre.x + Math.sin(yaw) * (tw / 2 + 0.85),
        centre.y,
        centre.z + Math.cos(yaw) * (tw / 2 + 0.85),
      ),
      new Quaternion().setFromEuler(new Euler(0, yaw, 0)),
      new Vector3(1, 1, 1),
    );
    // The dial: three crossed panels make a twelve-sided disc.
    for (let k = 0; k < 3; k++)
      sh.box([r * 2 * 0.52, r * 2, 0.06], [0, 0, 0.05], C.clock, {
        rz: (k * Math.PI) / 3,
        omit: FRONT_ONLY,
        frame,
      });
    const [hh, mm] = CLOCK_TIMES[side] ?? [12, 0];
    clockHands(sh, r, hh, mm, frame);
  }
  const belfry = stage + 10;
  sh.box([tw, 9, tw], [0, belfry + 4.5, -tw / 2 - 1], C.hall, { omit: ['ny'] });
  for (let side = 0; side < 4; side++) {
    const yaw = (side * Math.PI) / 2;
    const frame = new Matrix4().compose(
      new Vector3(
        Math.sin(yaw) * (tw / 2 + 0.02),
        belfry + 4.5,
        -tw / 2 - 1 + Math.cos(yaw) * (tw / 2 + 0.02),
      ),
      new Quaternion().setFromEuler(new Euler(0, yaw, 0)),
      new Vector3(1, 1, 1),
    );
    for (const x of [-2.6, 0, 2.6])
      sh.box([1.6, 5, 0.06], [x, -0.5, 0.03], C.door, { omit: FRONT_ONLY, frame });
  }
  let y = belfry + 9;
  for (const [s, hh] of [
    [tw + 1, 1],
    [tw * 0.7, 3],
    [tw * 0.45, 3],
    [tw * 0.22, 3.5],
  ] as const) {
    sh.box([s, hh, s], [0, y + hh / 2, -tw / 2 - 1], hh === 1 ? C.hallTrim : C.hallRoof, { omit: ['ny'] });
    y += hh;
  }
  sh.box([0.15, TOWER_TOP_M - y, 0.15], [0, (TOWER_TOP_M + y) / 2, -tw / 2 - 1], C.hands);
  sh.box([0.06, 1.2, 2], [0, TOWER_TOP_M - 0.8, -tw / 2 - 2.05], C.flag, { omit: ['ny'] });
  // A ferry at its slip, past the hall's far end (the hall faces the road: its -x is up the road).
  const fx = -(width / 2 + 10);
  sh.box([9, 3.4, 34], [fx, 0.9, -24], C.ferryHull, { omit: ['ny'] });
  sh.box([9.1, 0.5, 34.1], [fx, 0.3, -24], C.ferryBand, { omit: ['ny', 'py'] });
  sh.box([7, 2.6, 22], [fx, 3.9, -24], C.white, { omit: ['ny'] });
  sh.box([7.1, 0.7, 22.1], [fx, 3.9, -24], C.glass, { omit: ['ny', 'py'] });
  sh.box([4, 2, 8], [fx, 6.2, -24], C.white, { omit: ['ny'] });
  sh.box([1.2, 2.4, 1.2], [fx, 8.4, -24], C.ferryBand, { omit: ['ny'] });
  return sh;
}

/** What a waterfront block is. */
export type BlockKind = 'loft' | 'arcade' | 'crab' | 'startup' | 'hotel' | 'garage';
/** The front's width each kind takes, m (a building is packed to fill its frontage). */
export const BLOCK_WIDTH: Readonly<Record<BlockKind, readonly [number, number]>> = {
  loft: [20, 28],
  arcade: [24, 34],
  crab: [14, 18],
  startup: [18, 24],
  hotel: [16, 20],
  garage: [26, 32],
};
/** The front row's mix [default]: mostly brick lofts and arcades, now and then the odd ones. */
const BLOCK_MIX: readonly BlockKind[] = [
  'loft',
  'loft',
  'arcade',
  'arcade',
  'loft',
  'crab',
  'startup',
  'hotel',
  'garage',
];

/** A waterfront block of a kind and width; `u` (0..1) varies its height and colours. */
export function block(kind: BlockKind, width: number, u: number): Shape {
  const sh = new Shape();
  const d = BLOCK_DEPTH_M;
  const awning = [C.awningA, C.awningB, C.awningC][Math.floor(u * 3) % 3] ?? C.awningA;
  const body = (h: number, colour: string) =>
    sh.box([width, h + FOOT_M, d], [0, (h - FOOT_M) / 2, -d / 2], colour, { omit: ['ny'] });
  const cornice = (h: number, colour: string) =>
    sh.box([width + 0.5, 0.6, 0.8], [0, h - 0.3, 0.2], colour, { omit: ['ny'] });
  const shopfront = () => {
    sh.box([width - 2, 2.8, 0.06], [0, 1.6, 0.03], C.glass, { omit: FRONT_ONLY });
    sh.box([width - 2, 0.12, 1.6], [0, 3.3, 0.8], awning, { rx: -0.25, omit: ['ny'] });
  };
  if (kind === 'loft' || kind === 'startup') {
    const floors = kind === 'loft' ? 3 + Math.floor(u * 2) : 3;
    const h = floors * 3.6 + 0.8;
    body(h, kind === 'loft' ? C.brick : C.concrete);
    shopfront();
    for (let f = 1; f < floors; f++) windows(sh, width, f * 3.6 + 1.9, 3, [1.3, 1.8]);
    cornice(h, kind === 'loft' ? C.stucco : C.white);
    if (kind === 'loft' && u > 0.55) {
      // A wooden water tank on the roof.
      sh.box([2.6, 3, 2.6], [width / 4, h + 2.6, -d / 2], '#7a5a3c', { omit: ['ny'] });
      sh.box([0.2, 1.2, 0.2], [width / 4, h + 0.6, -d / 2], C.lampPost);
    }
    if (kind === 'startup') {
      // A banner over the door that says what the company does.
      sh.box([Math.min(width - 3, 12), 2.2, 0.15], [0, 5.6, 0.1], C.white, { omit: ['ny'] });
      sh.text('STEALTH', 0, 4.8, 0.2, 0.32, C.hands);
    }
    return sh;
  }
  if (kind === 'arcade') {
    const h = 9 + u * 2;
    body(h, C.stucco);
    const n = Math.max(2, Math.floor(width / 4));
    for (let i = 0; i < n; i++) {
      const x = -((n - 1) * 4) / 2 + i * 4;
      sh.box([2.6, 3.2, 0.06], [x, 1.8, 0.03], C.door, { omit: FRONT_ONLY });
      sh.box([1.4, 1.8, 0.06], [x, 6.6, 0.03], C.glass, { omit: FRONT_ONLY });
    }
    sh.box([width + 0.6, 0.9, 1.8], [0, h - 0.2, 0.4], C.tile, { rx: 0.35, omit: ['ny'] });
    return sh;
  }
  if (kind === 'crab') {
    const h = 6.5;
    body(h, u > 0.5 ? C.teal : C.white);
    shopfront();
    cornice(h, C.white);
    // The fish on the roof, and the board under it.
    sh.box([5.6, 1.8, 0.4], [0, h + 3.4, -1], C.fish, { omit: ['ny'] });
    sh.box([1.6, 1.6, 0.4], [3.3, h + 3.4, -1], C.fish, { rz: Math.PI / 4, omit: ['ny'] });
    sh.box([0.4, 0.4, 0.5], [-2, h + 3.8, -1], C.white);
    sh.box([0.3, 1.6, 0.3], [0, h + 1.4, -1], C.lampPost);
    sh.box([6.4, 1.6, 0.2], [0, h + 1.2, -0.8], C.awningB, { omit: ['ny'] });
    sh.text('CRAB', 0, h + 0.65, -0.65, 0.25, C.white);
    return sh;
  }
  if (kind === 'hotel') {
    const floors = 5 + Math.floor(u * 2);
    const h = floors * 3.3 + 1;
    body(h, C.hotel);
    shopfront();
    for (let f = 1; f < floors; f++) windows(sh, width, f * 3.3 + 1.7, 2.8, [1.2, 1.7]);
    cornice(h, C.white);
    // The blade sign at the corner, its word facing along the road both ways.
    const x = width / 2 - 1.5;
    sh.box([1.8, 8, 0.5], [x, h - 5, 1.2], C.awningB, { ry: Math.PI / 2, omit: ['ny'] });
    for (const yaw of [Math.PI / 2, -Math.PI / 2]) {
      const frame = new Matrix4().compose(
        new Vector3(x + Math.sin(yaw) * 0.27, h - 9, 1.2),
        new Quaternion().setFromEuler(new Euler(0, yaw, 0)),
        new Vector3(1, 1, 1),
      );
      'HOTEL'.split('').forEach((ch, i) => sh.text(ch, 0, 6.2 - i * 1.5, 0, 0.26, C.hotel, frame));
    }
    return sh;
  }
  // The garage: open decks, dark between the slabs.
  const decks = 4;
  const h = decks * 3 + 0.6;
  body(h, C.concrete);
  for (let k = 0; k < decks; k++)
    sh.box([width - 1, 1.6, 0.06], [0, k * 3 + 1.6, 0.03], C.door, { omit: FRONT_ONLY });
  sh.text('PARK', 0, h - 2.6, 0.06, 0.4, C.awningC);
  return sh;
}

/** A taller tower behind the blocks (the city behind the waterfront). */
export function backTower(u: number): Shape {
  const sh = new Shape();
  const w = 20 + u * 10;
  const h = 40 + u * 70;
  sh.box([w, h + FOOT_M, w * 0.8], [0, (h - FOOT_M) / 2, -w * 0.4], u > 0.5 ? C.tower : C.towerDark, {
    omit: ['ny'],
  });
  sh.box([w * 0.7, 4, w * 0.55], [0, h + 2, -w * 0.4], C.concrete, { omit: ['ny'] });
  for (let k = 1; k < 4; k++)
    sh.box([w + 0.1, 0.6, w * 0.8 + 0.1], [0, (k * h) / 4, -w * 0.4], C.concrete, { omit: ['ny', 'py'] });
  return sh;
}

/** A promenade lamp: a green post, an arm and two globes. */
export function lamp(): Shape {
  const sh = new Shape();
  sh.box([0.22, 5.2, 0.22], [0, 2.6, 0], C.lampPost, { omit: ['ny'] });
  sh.box([1.6, 0.12, 0.12], [0, 5, 0], C.lampPost);
  for (const x of [-0.7, 0.7]) sh.box([0.45, 0.6, 0.45], [x, 4.6, 0], C.lampGlobe, { omit: ['ny'] });
  return sh;
}

/** A bench, its back to -z (it faces +z). */
export function bench(): Shape {
  const sh = new Shape();
  sh.box([2, 0.1, 0.55], [0, 0.48, 0], C.bench, { omit: ['ny'] });
  sh.box([2, 0.5, 0.08], [0, 0.85, -0.26], C.bench, { omit: ['ny'] });
  for (const x of [-0.85, 0.85]) sh.box([0.08, 0.48, 0.5], [x, 0.24, 0], C.lampPost, { omit: ['ny'] });
  return sh;
}

/** A palm for when the palm models have not loaded: a trunk and a crown. */
export function palmStandIn(): Shape {
  const sh = new Shape();
  sh.box([0.4, 8, 0.4], [0, 4, 0], '#8a7255', { omit: ['ny'] });
  for (let k = 0; k < 4; k++)
    sh.box([0.6, 0.2, 3.4], [0, 8, 0], '#4f7f3a', { ry: (k * Math.PI) / 4, rx: 0.25 });
  return sh;
}

/** One sea lion lying (or, `up`, propped on its flippers), facing +z. */
function seaLion(sh: Shape, x: number, z: number, yaw: number, up: boolean, dark: boolean) {
  const frame = new Matrix4().compose(
    new Vector3(x, 0, z),
    new Quaternion().setFromEuler(new Euler(0, yaw, 0)),
    new Vector3(1, 1, 1),
  );
  const colour = dark ? C.seaLionDark : C.seaLion;
  sh.box([0.7, 0.5, 1.4], [0, 0.25, -0.3], colour, { omit: ['ny'], frame });
  sh.box([0.4, 0.3, 0.6], [0, 0.18, -1.2], colour, { omit: ['ny'], frame });
  if (up) {
    sh.box([0.45, 0.8, 0.45], [0, 0.75, 0.35], colour, { rx: -0.35, omit: ['ny'], frame });
    sh.box([0.32, 0.3, 0.45], [0, 1.2, 0.6], colour, { omit: ['ny'], frame });
  } else sh.box([0.38, 0.35, 0.55], [0, 0.22, 0.6], colour, { omit: ['ny'], frame });
  for (const s of [-1, 1]) sh.box([0.5, 0.06, 0.3], [s * 0.5, 0.05, 0.1], colour, { ry: s * 0.4, frame });
}

/** A sea lions' float: a weathered dock on the water, several of them asleep on it, one awake. */
export function seaLionFloat(u: number): Shape {
  const sh = new Shape();
  sh.box([7, 0.5, 3.4], [0, 0.15, 0], C.float, { omit: ['ny'] });
  const n = 4 + Math.floor(u * 3);
  for (let i = 0; i < n; i++) {
    const x = -2.8 + (5.6 * (i + 0.5)) / n;
    const z = ((i * 37) % 5) / 5 - 0.4;
    const top = 0.4;
    const f = new Shape();
    seaLion(f, x, z, ((i * 2.3 + u * 5) % 6.28) - 3.14, i === 1, i % 3 === 2);
    for (let k = 1; k < f.pos.length; k += 3) f.pos[k] = (f.pos[k] ?? 0) + top;
    sh.pos.push(...f.pos);
    sh.nrm.push(...f.nrm);
    sh.col.push(...f.col);
  }
  return sh;
}

// ---- the plan: what stands where ---------------------------------------------------------------

/** One placed item: a geometry at a world point, turned, scaled. */
export interface WaterfrontItem {
  rule: string;
  geometry: BufferGeometry;
  /** The palm models' fronds draw both faces. */
  doubleSided: boolean;
  p: Point3;
  turn: number;
  size: number;
  edge: number;
  s: number;
  d: number;
}

/** A pier shed or the ferry hall as placed: its front's span on the seawall. */
export interface Frontage {
  kind: 'shed' | 'hall';
  edge: number;
  s0: number;
  s1: number;
  /** The front's d (the verge band's outer edge), and the pier number (0 for the hall). */
  d: number;
  pier: number;
}

/** A coloured triangle soup (three vertices per triangle), for the merged surfaces. */
interface Soup {
  pos: number[];
  col: number[];
}

export interface WaterfrontPlan {
  items: WaterfrontItem[];
  frontages: Frontage[];
  /** Side streets: edge, s and the unit vector inland from the boulevard. */
  streets: { edge: number; s: number }[];
  soups: Map<string, Soup>;
  stretches: { key: string; cx: number; cz: number; radius: number }[];
}

export interface WaterfrontInput {
  road: RoadNetwork;
  dressing: RoadDressing | undefined;
  seed: number;
  /** Ground the staged scenes stand on (scenes/layer.ts `reserved`): nothing stands in it. */
  reserved?: readonly { x: number; z: number; r: number }[];
}

type SideTag = { s0: number; s1: number; side?: string; tag: string };
const onSide = (t: SideTag, side: 'left' | 'right') =>
  t.side === undefined || t.side === 'both' || t.side === side;

/** Plans the waterfront of a network. Pure placement: same input, same plan (tests read it). */
export function planWaterfront(input: WaterfrontInput, models: SceneryModels = {}): WaterfrontPlan {
  const { road, dressing, seed } = input;
  const items: WaterfrontItem[] = [];
  const frontages: Frontage[] = [];
  const streets: { edge: number; s: number }[] = [];
  const soups = new Map<string, Soup>();
  const centres = new Map<string, { xs: number; zs: number; n: number; pts: Point3[] }>();
  const keyOf = (edge: number, s: number) => `${edge}:${Math.floor(Math.max(0, s) / STRETCH_M)}`;
  const soupAt = (edge: number, s: number): Soup => {
    const key = keyOf(edge, s);
    let soup = soups.get(key);
    if (!soup) soups.set(key, (soup = { pos: [], col: [] }));
    return soup;
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
  /** A triangle, its front toward (nx, ny, nz) (flipped to face it). */
  const tri = (
    soup: Soup,
    a: Point3,
    b: Point3,
    c: Point3,
    colour: string,
    face: readonly [number, number, number],
  ) => {
    const ux = b.x - a.x;
    const uy = b.y - a.y;
    const uz = b.z - a.z;
    const vx = c.x - a.x;
    const vy = c.y - a.y;
    const vz = c.z - a.z;
    const n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
    if (n[0]! * face[0] + n[1]! * face[1] + n[2]! * face[2] < 0) [b, c] = [c, b];
    soup.pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    const [r, g, bl] = hexRgb(colour);
    for (let i = 0; i < 3; i++) soup.col.push(r, g, bl);
  };
  const UP = [0, 1, 0] as const;
  const quad = (
    soup: Soup,
    a: Point3,
    b: Point3,
    c: Point3,
    d: Point3,
    colour: string,
    face: readonly [number, number, number] = UP,
  ) => {
    tri(soup, a, b, c, colour, face);
    tri(soup, b, d, c, colour, face);
  };

  // Shared small geometries.
  const lampGeo = lamp().geometry();
  const benchGeo = bench().geometry();
  const palmModel: SceneryModel | undefined = models.palms;
  const palmFallback = palmStandIn().geometry();
  const towers = [0.1, 0.3, 0.5, 0.7, 0.9].map((u) => backTower(u).geometry());
  const floats = [0.2, 0.6, 0.9].map((u) => seaLionFloat(u).geometry());
  const carModel: SceneryModel | undefined = models.sfRoadside;
  const boats = [models.skiff?.variants[0], models.boat?.variants[0]].filter((g): g is BufferGeometry => !!g);

  const reserved = input.reserved ?? [];
  const takenByScene = (p: Point3, r: number) =>
    reserved.some((q) => Math.hypot(q.x - p.x, q.z - p.z) < q.r + r);
  const place = (it: WaterfrontItem) => {
    items.push(it);
    note(it.edge, it.s, it.p);
  };

  // Pier numbers run outward from the ferry hall: collect every frontage first.
  const raw: { kind: 'shed' | 'hall'; edge: number; s0: number; s1: number }[] = [];
  for (const e of road.edges) {
    const tags = (dressing?.[e.id]?.tags ?? e.tags) as readonly SideTag[];
    for (const t of tags) {
      if (!onSide(t, 'right')) continue;
      if (t.tag === 'pier-shed' || t.tag === 'ferry-hall')
        raw.push({
          kind: t.tag === 'pier-shed' ? 'shed' : 'hall',
          edge: e.index,
          s0: t.s0,
          s1: Math.min(t.s1, e.length),
        });
    }
  }
  raw.sort((a, b) => a.edge - b.edge || a.s0 - b.s0);
  const hallAt = raw.findIndex((r) => r.kind === 'hall');
  raw.forEach((r, i) => {
    let pier = 0;
    if (r.kind === 'shed') {
      if (hallAt < 0 || i > hallAt) {
        const k = raw.slice(hallAt < 0 ? 0 : hallAt + 1, i).filter((q) => q.kind === 'shed').length;
        pier = ODD_PIERS[k] ?? 41 + 2 * k;
      } else {
        const k = raw.slice(i + 1, hallAt).filter((q) => q.kind === 'shed').length;
        pier = EVEN_PIERS[k] ?? 42 + 2 * k;
      }
    }
    const mid = (r.s0 + r.s1) / 2;
    frontages.push({ ...r, d: road.vergeAt(r.edge, mid, 'right').dOuter, pier });
  });

  for (const e of road.edges) {
    const dress = dressing?.[e.id];
    const tags = (dress?.tags ?? e.tags) as readonly SideTag[];
    if (
      !tags.some(
        (t) =>
          (BAY_TAGS as readonly string[]).includes(t.tag) || (CITY_TAGS as readonly string[]).includes(t.tag),
      )
    )
      continue;
    const features = (dress?.features ?? e.features).filter((f) => KEEP_CLEAR.has(f.kind));
    const h = (k: number, side: number, salt: number) =>
      scatterHash(seed, 7211 + e.index * 977, k, side * 41 + salt);
    const has = (side: 'left' | 'right', s: number, tag: string) =>
      tags.some((t) => t.tag === tag && onSide(t, side) && s >= t.s0 && s <= t.s1);
    const w = (s: number, d: number, hgt: number) => road.toWorld(e.index, s, d, hgt);
    const faceRoad = (p: Point3, s: number) => {
      const c = w(s, 0, 0);
      return Math.atan2(c.x - p.x, c.z - p.z);
    };
    /** Whether nothing kept clear lies over s0..s1 at |d| a0..a1 on a side, with `margin` round it. */
    const clear = (side: -1 | 1, s0: number, s1: number, a0: number, a1: number, margin = FEATURE_CLEAR_M) =>
      !features.some((f) => {
        const lo = Math.min(f.d0 * side, f.d1 * side);
        const hi = Math.max(f.d0 * side, f.d1 * side);
        return (
          Math.min(f.s0, f.s1) - margin < s1 &&
          Math.max(f.s0, f.s1) + margin > s0 &&
          lo - margin < a1 &&
          hi + margin > a0
        );
      });
    /** The runs of s (2 m steps) where `want` holds: [start, end] pairs. */
    const runs = (want: (s: number) => boolean): [number, number][] => {
      const out: [number, number][] = [];
      let start = -1;
      for (let s = 0; s <= e.length + 1e-6; s += 2) {
        const here = want(Math.min(s, e.length));
        if (here && start < 0) start = s;
        if ((!here || s + 2 > e.length + 1e-6) && start >= 0) {
          out.push([start, here ? e.length : s - 2]);
          start = -1;
        }
      }
      return out;
    };
    const vR = (s: number) => road.vergeAt(e.index, s, 'right');
    const vL = (s: number) => road.vergeAt(e.index, s, 'left');
    const outerL = -e.dMin + VERGE_M;
    const bayOpen = (s: number) =>
      has('right', s, 'promenade') && !has('right', s, 'pier-shed') && !has('right', s, 'ferry-hall');

    // ---- the bay side --------------------------------------------------------------------------
    if (tags.some((t) => t.tag === 'promenade')) {
      // The seawall's face and its cap, along the open promenade.
      for (const [a, b] of runs((s) => has('right', s, 'promenade'))) {
        for (let s = a; s < b; s += 4) {
          const s1 = Math.min(b, s + 4);
          const soup = soupAt(e.index, s);
          const d0 = vR(s).dOuter;
          const d1 = vR(s1).dOuter;
          const t0 = w(s, d0 + 0.02, LAND_TOP_M);
          const t1 = w(s1, d1 + 0.02, LAND_TOP_M);
          const f0 = { ...t0, y: -0.9 };
          const f1 = { ...t1, y: -0.9 };
          const out = w(s, d0 + 5, 0);
          const face = [out.x - t0.x, 0, out.z - t0.z] as const;
          if (bayOpen(s) || bayOpen(s1)) quad(soup, t0, t1, f0, f1, C.seawall, face);
          quad(soup, w(s, d0 - 0.6, -0.02), w(s1, d1 - 0.6, -0.02), w(s, d0, -0.02), w(s1, d1, -0.02), C.cap);
        }
      }
      // Palms, lamps and benches along the seawall's edge (palms and lamps on the paving a little in
      // from it, benches at it, facing the bay), never in front of a shed's door or the hall.
      for (const [a, b] of runs((s) => has('right', s, 'promenade'))) {
        for (let k = 0; ; k++) {
          const s = a + 8 + k * PALM_EVERY_M + 6 * (h(k, 1, 1) - 0.5);
          if (s > b - 4) break;
          const d = vR(s).dOuter - 1.6;
          if (!clear(1, s - 2, s + 2, d - 2, d + 2)) continue;
          const p = w(s, d, LAND_TOP_M);
          if (takenByScene(p, 1.5)) continue;
          const variant = Math.floor(h(k, 1, 2) * 3);
          const geo = palmModel?.variants[variant] ?? palmFallback;
          place({
            rule: 'palm',
            geometry: geo,
            doubleSided: !!palmModel?.doubleSided,
            p,
            turn: h(k, 1, 3) * Math.PI * 2,
            size: 1.05 + 0.3 * h(k, 1, 4),
            edge: e.index,
            s,
            d,
          });
        }
        for (let k = 0; ; k++) {
          const s = a + 20 + k * LAMP_EVERY_M;
          if (s > b - 4) break;
          const d = vR(s).dOuter - 0.9;
          if (!clear(1, s - 1, s + 1, d - 1, d + 1)) continue;
          const p = w(s, d, LAND_TOP_M);
          if (takenByScene(p, 1)) continue;
          place({
            rule: 'lamp',
            geometry: lampGeo,
            doubleSided: false,
            p,
            turn: faceRoad(p, s) + Math.PI / 2,
            size: 1,
            edge: e.index,
            s,
            d,
          });
        }
        for (let k = 0; ; k++) {
          const s = a + 32 + k * BENCH_EVERY_M;
          if (s > b - 4) break;
          if (!bayOpen(s)) continue;
          const d = vR(s).dOuter - 0.7;
          if (!clear(1, s - 2, s + 2, d - 1, d + 1)) continue;
          const p = w(s, d, LAND_TOP_M);
          if (takenByScene(p, 1.5)) continue;
          // It faces the bay: its +z away from the road.
          place({
            rule: 'bench',
            geometry: benchGeo,
            doubleSided: false,
            p,
            turn: faceRoad(p, s) + Math.PI,
            size: 1,
            edge: e.index,
            s,
            d,
          });
        }
      }
      // In the water between the piers: a moored boat now and then, and the sea lions' floats.
      for (const [a, b] of runs(bayOpen)) {
        for (let k = 0; ; k++) {
          const s = a + 14 + k * 26;
          if (s > b - 10) break;
          const d = vR(s).dOuter;
          if (has('right', s, 'sea-lions')) {
            const across = d + 14 + 18 * h(k, 1, 20);
            const p = w(s, across, 0);
            place({
              rule: 'sea-lions',
              geometry: floats[k % floats.length] ?? floats[0]!,
              doubleSided: false,
              p: { x: p.x, y: 0, z: p.z },
              turn: faceRoad(p, s) + (h(k, 1, 21) - 0.5) * 0.8,
              size: 1,
              edge: e.index,
              s,
              d: across,
            });
          } else if (boats.length && h(k, 1, 22) < 0.45) {
            const across = d + 6 + 10 * h(k, 1, 23);
            const p = w(s, across, 0);
            const ahead = w(Math.min(e.length, s + 1), across, 0);
            place({
              rule: 'boat',
              geometry: boats[Math.floor(h(k, 1, 24) * boats.length)] ?? boats[0]!,
              doubleSided: false,
              p: { x: p.x, y: 0, z: p.z },
              turn: Math.atan2(ahead.x - p.x, ahead.z - p.z) + (h(k, 1, 25) < 0.5 ? Math.PI : 0),
              size: 1,
              edge: e.index,
              s,
              d: across,
            });
          }
        }
      }
    }
    // The sheds and the hall on this edge.
    for (const f of frontages.filter((q) => q.edge === e.index)) {
      const s = (f.s0 + f.s1) / 2;
      const p = w(s, f.d, LAND_TOP_M);
      const drop = Math.max(0.5, p.y + 0.6);
      const geo = (
        f.kind === 'shed' ? pierShed(f.s1 - f.s0, f.pier, drop) : ferryHall(f.s1 - f.s0, drop)
      ).geometry();
      place({
        rule: f.kind === 'shed' ? 'pier-shed' : 'ferry-hall',
        geometry: geo,
        doubleSided: false,
        p,
        turn: faceRoad(p, s),
        size: 1,
        edge: e.index,
        s,
        d: f.d,
      });
    }

    // ---- the city side -------------------------------------------------------------------------
    if (!tags.some((t) => (CITY_TAGS as readonly string[]).includes(t.tag))) continue;
    const front = (s: number) => has('left', s, 'wharf') && vL(s).edge === 'hard';
    const open = (s: number) => has('left', s, 'ferry-plaza') || has('left', s, 'wharf-lot');
    // The front row of blocks along each run of frontage, packed shoulder to shoulder.
    const blockRow = (a: number, b: number, back: number, salt: number) => {
      let cursor = a + 0.5;
      for (let k = 0; ; k++) {
        let kind = BLOCK_MIX[Math.floor(h(k + Math.round(a), -1, salt) * BLOCK_MIX.length)] ?? 'loft';
        const [lo, hi] = BLOCK_WIDTH[kind];
        let width = lo + (hi - lo) * h(k + Math.round(a), -1, salt + 1);
        if (cursor + width > b - 0.5) {
          const narrow = (['crab', 'hotel', 'loft'] as const).find(
            (q) => cursor + BLOCK_WIDTH[q][0] <= b - 0.5,
          );
          if (!narrow) break;
          kind = narrow;
          width = Math.min(BLOCK_WIDTH[kind][1], b - 0.5 - cursor);
        }
        const s = cursor + width / 2;
        cursor += width + 0.3;
        if (!clear(-1, s - width / 2, s + width / 2, back, back + BLOCK_DEPTH_M, 0.3)) continue;
        const d = -back;
        const p = w(s, d, 0);
        // The base sits at the lower front corner, so neither floats on a slope.
        const y = Math.min(p.y, w(s - width / 2, d, 0).y, w(s + width / 2, d, 0).y) + LAND_TOP_M;
        place({
          rule: `block-${kind}`,
          geometry: block(kind, width, h(k + Math.round(a), -1, salt + 2)).geometry(),
          doubleSided: false,
          p: { x: p.x, y, z: p.z },
          turn: faceRoad(p, s),
          size: 1,
          edge: e.index,
          s,
          d,
        });
      }
    };
    // Fronts on the sidewalk's hard edge (the sim's), behind the lot and the plaza further back.
    for (const [a, b] of runs(front)) blockRow(a, b, -vL(Math.min(e.length, a + 1)).dOuter, 10);
    for (const [a, b] of runs(open)) blockRow(a, b, outerL + OPEN_BACK_M, 20);
    // The taller towers behind, away from the side streets.
    for (const [a, b] of runs((s) => has('left', s, 'wharf') || open(s))) {
      for (let k = 0; ; k++) {
        const s = a + (k + 0.5) * BACK_ROW_EVERY_M;
        if (s + 12 > b) break;
        if (h(k + Math.round(a), -1, 30) < 0.3) continue;
        // Clear of a side street and the blocks lining it.
        if (tags.some((t) => t.tag === 'wharf-street' && Math.abs((t.s0 + t.s1) / 2 - s) < 44)) continue;
        const d = -(outerL + BACK_ROW_M + 30 * h(k, -1, 31));
        const p = w(s, d, 0);
        place({
          rule: 'back-tower',
          geometry: towers[Math.floor(h(k + Math.round(a), -1, 32) * towers.length)] ?? towers[0]!,
          doubleSided: false,
          p: { x: p.x, y: CITY_FLOOR_Y - 0.2, z: p.z },
          turn: faceRoad(p, s),
          size: 0.85 + 0.3 * h(k, -1, 33),
          edge: e.index,
          s,
          d,
        });
      }
    }
    // Lamps along the sidewalk, and palms on the plaza.
    for (const [a, b] of runs(front)) {
      for (let k = 0; ; k++) {
        const s = a + 10 + k * LAMP_EVERY_M;
        if (s > b - 4) break;
        const d = -(outerL + 0.5);
        if (!clear(-1, s - 1, s + 1, -d - 1, -d + 1)) continue;
        const p = w(s, d, LAND_TOP_M);
        place({
          rule: 'sidewalk-lamp',
          geometry: lampGeo,
          doubleSided: false,
          p,
          turn: faceRoad(p, s) + Math.PI / 2,
          size: 0.9,
          edge: e.index,
          s,
          d,
        });
      }
    }
    for (const [a, b] of runs((s) => has('left', s, 'ferry-plaza'))) {
      for (let s = a + 8; s < b - 6; s += 15) {
        for (const across of [5, 13]) {
          const d = -(outerL + across);
          if (!clear(-1, s - 2, s + 2, -d - 2, -d + 2)) continue;
          const p = w(s, d, LAND_TOP_M);
          if (takenByScene(p, 1.5)) continue;
          const k = Math.round(s) + across;
          place({
            rule: 'plaza-palm',
            geometry: palmModel?.variants[k % 3] ?? palmFallback,
            doubleSided: !!palmModel?.doubleSided,
            p,
            turn: h(k, -1, 40) * Math.PI * 2,
            size: 1.1 + 0.25 * h(k, -1, 41),
            edge: e.index,
            s,
            d,
          });
        }
        const d = -(outerL + 9);
        if (clear(-1, s + 5, s + 9, -d - 1, -d + 1)) {
          const p = w(s + 7, d, LAND_TOP_M);
          place({
            rule: 'plaza-bench',
            geometry: benchGeo,
            doubleSided: false,
            p,
            turn: faceRoad(p, s + 7),
            size: 1,
            edge: e.index,
            s: s + 7,
            d,
          });
        }
      }
    }
    // The lot: parked cars in a row, nose to the road, and its painted bays.
    for (const [a, b] of runs((s) => has('left', s, 'wharf-lot'))) {
      for (let s = a + 4; s < b - 3; s += 3) {
        const soup = soupAt(e.index, s);
        for (const [d0, d1] of [
          [outerL + 4, outerL + 9.5],
          [outerL + 11.5, outerL + 17],
        ] as const) {
          quad(
            soup,
            w(s, -d0, -0.02),
            w(s + 0.12, -d0, -0.02),
            w(s, -d1, -0.02),
            w(s + 0.12, -d1, -0.02),
            C.line,
          );
        }
      }
      for (let k = 0; ; k++) {
        const s = a + 5.5 + k * 3;
        if (s > b - 3) break;
        for (const [across, row] of [
          [6.8, 0],
          [14.3, 1],
        ] as const) {
          if (!carModel || h(k, -1, 50 + row) < 0.35) continue;
          const d = -(outerL + across);
          if (!clear(-1, s - 1.5, s + 1.5, -d - 3, -d + 3, 0.5)) continue;
          const p = w(s, d, LAND_TOP_M);
          const variant = [0, 1, 2][Math.floor(h(k, -1, 52 + row) * 3)] ?? 0;
          const geo = carModel.variants[variant];
          if (!geo) continue;
          place({
            rule: 'parked-car',
            geometry: geo,
            doubleSided: false,
            p,
            turn: faceRoad(p, s) + (row ? Math.PI : 0),
            size: 1,
            edge: e.index,
            s,
            d,
          });
        }
      }
    }
    // Side streets: the roadway and its sidewalks running inland, buildings lining both sides.
    for (const t of tags.filter((x) => x.tag === 'wharf-street' && onSide(x, 'left'))) {
      const s = (t.s0 + t.s1) / 2;
      streets.push({ edge: e.index, s });
      const centre = w(s, 0, 0);
      const r1 = w(s, -1, 0);
      const ax = r1.x - centre.x;
      const az = r1.z - centre.z;
      const al = Math.hypot(ax, az) || 1;
      const f = w(Math.min(e.length, s + 1), 0, 0);
      const bk = w(Math.max(0, s - 1), 0, 0);
      const fx = f.x - bk.x;
      const fz = f.z - bk.z;
      const fl = Math.hypot(fx, fz) || 1;
      const across = { x: ax / al, z: az / al };
      const along = { x: fx / fl, z: fz / fl };
      // At the road's own height at its mouth (over the verge band), then down to the floor.
      const roadY = centre.y;
      const half = (t.s1 - t.s0) / 2;
      const yAt = (u: number) =>
        Math.max(CITY_FLOOR_Y + 0.05, roadY - STREET_DROP * Math.max(0, u - outerL - LAND_STRIP_M));
      const at = (u: number, v: number, lift = 0): Point3 => ({
        x: centre.x + across.x * u + along.x * v,
        y: yAt(u) + lift,
        z: centre.z + across.z * u + along.z * v,
      });
      const soup = soupAt(e.index, s);
      for (let u = outerL; u < outerL + STREET_REACH_M; u += 10) {
        const u1 = Math.min(outerL + STREET_REACH_M, u + 10);
        const strip = (v0: number, v1: number, lift: number, colour: string) =>
          quad(soup, at(u, v0, lift), at(u, v1, lift), at(u1, v0, lift), at(u1, v1, lift), colour);
        strip(-STREET_ROAD_HALF_M, STREET_ROAD_HALF_M, 0.02, C.street);
        strip(-half, -STREET_ROAD_HALF_M, 0.06, C.sidewalk);
        strip(STREET_ROAD_HALF_M, half, 0.06, C.sidewalk);
      }
      // A zebra across its mouth.
      for (let v = -STREET_ROAD_HALF_M + 0.4; v + 0.6 <= STREET_ROAD_HALF_M; v += 1.3) {
        const u0 = outerL + 6;
        quad(
          soup,
          at(u0, v, 0.04),
          at(u0, v + 0.6, 0.04),
          at(u0 + 3, v, 0.04),
          at(u0 + 3, v + 0.6, 0.04),
          C.line,
        );
      }
      for (const vs of [-1, 1] as const) {
        // Behind the corner blocks on the boulevard (their backs at the sidewalk's edge + their depth).
        let cursor = outerL + 3.4 + BLOCK_DEPTH_M + 1;
        for (let k = 0; cursor < outerL + STREET_REACH_M - 30; k++) {
          const kind: BlockKind =
            scatterHash(seed, 9001 + e.index * 131 + Math.round(s), k, vs) < 0.6 ? 'loft' : 'garage';
          const width = BLOCK_WIDTH[kind][0] + 4 * scatterHash(seed, 9011 + e.index, k, vs);
          const u = cursor + width / 2;
          cursor += width + 1;
          const base = at(u, vs * half);
          const toStreet = at(u, 0);
          place({
            rule: 'street-block',
            geometry: block(kind, width, scatterHash(seed, 9021 + e.index, k, vs)).geometry(),
            doubleSided: false,
            p: { x: base.x, y: base.y - 0.05, z: base.z },
            turn: Math.atan2(toStreet.x - base.x, toStreet.z - base.z),
            size: 1,
            edge: e.index,
            s,
            d: -u,
          });
        }
      }
      note(e.index, s, at(outerL + STREET_REACH_M, 0));
    }
    // The city floor: from the land strip's edge out to CITY_FLOOR_M, every 20 m.
    for (let s = 0; s < e.length; s += 20) {
      const s1 = Math.min(e.length, s + 20);
      const soup = soupAt(e.index, s);
      const at = (u: number, d: number) => ({ ...w(u, -d, 0), y: CITY_FLOOR_Y });
      quad(
        soup,
        at(s, outerL + LAND_STRIP_M),
        at(s1, outerL + LAND_STRIP_M),
        at(s, outerL + LAND_STRIP_M + CITY_FLOOR_M),
        at(s1, outerL + LAND_STRIP_M + CITY_FLOOR_M),
        C.floor,
      );
    }
  }

  const stretches = [...centres.entries()].map(([key, c]) => {
    const cx = c.xs / c.n;
    const cz = c.zs / c.n;
    const radius = Math.max(...c.pts.map((p) => Math.hypot(p.x - cx, p.z - cz))) + 40;
    return { key, cx, cz, radius };
  });
  for (const [key, s] of soups) {
    if (centres.has(key) || s.pos.length < 9) continue;
    let xs = 0;
    let zs = 0;
    const n = s.pos.length / 3;
    for (let i = 0; i < n; i++) {
      xs += s.pos[i * 3] ?? 0;
      zs += s.pos[i * 3 + 2] ?? 0;
    }
    stretches.push({ key, cx: xs / n, cz: zs / n, radius: CITY_FLOOR_M + 80 });
  }
  return { items, frontages, streets, soups, stretches };
}

// ---- the layer ---------------------------------------------------------------------------------

export interface WaterfrontCounts {
  items: Readonly<Record<string, number>>;
  piers: number[];
  hall: boolean;
  streets: number;
  stretches: number;
  built: number;
  /** Meshes and triangles drawn by the last update (the merged items and the surfaces). */
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

/** The waterfront of one road scene: its merged items and its surfaces near the camera. */
export class WaterfrontLayer {
  readonly group = new Group();
  readonly plan: WaterfrontPlan;
  private readonly merged: MergedScenery;
  private readonly stretches: Built[];
  private readonly surface: Material;
  private shown = { meshes: 0, triangles: 0 };

  constructor(models: SceneryModels, look: LookStyle, input: WaterfrontInput) {
    this.group.name = 'road-waterfront';
    this.plan = planWaterfront(input, models);
    const single = look.material('prop', { vertexColors: true });
    const both = look.material('prop', { vertexColors: true, doubleSided: true });
    const mergeItems: MergeItem[] = this.plan.items.map((it) => ({
      spot: {
        kind: 'shack',
        variant: 0,
        p: it.p,
        turn: it.turn,
        size: it.size,
        phase: 0,
        edge: it.edge,
        s: it.s,
        d: it.d,
      },
      geometry: it.geometry,
      material: it.doubleSided ? both : single,
    }));
    this.merged = new MergedScenery(mergeItems, both);
    this.merged.group.name = 'road-waterfront-items';
    this.group.add(this.merged.group);
    this.surface = single;
    this.stretches = this.plan.stretches.map((s) => ({ ...s, mesh: null }));
  }

  /**
   * Per frame: builds, shows and frees the merged items and the surfaces by distance from the
   * camera (one build of each a frame). Returns the items in view.
   */
  update(
    cameraX: number,
    cameraZ: number,
    lodM = SCENERY_LOD_M,
    drawM = WATERFRONT_DRAW_M,
    builds = 1,
  ): number {
    const shownItems = this.merged.update(cameraX, cameraZ, drawM, lodM, builds);
    const want = this.stretches
      .filter(
        (st) => !st.mesh && Math.hypot(st.cx - cameraX, st.cz - cameraZ) - st.radius < drawM + PREFETCH_M,
      )
      .sort(
        (a, b) => Math.hypot(a.cx - cameraX, a.cz - cameraZ) - Math.hypot(b.cx - cameraX, b.cz - cameraZ),
      );
    for (const st of want.slice(0, builds)) this.build(st);
    let meshes = 0;
    let tris = 0;
    for (const st of this.stretches) {
      if (!st.mesh) continue;
      const dist = Math.hypot(st.cx - cameraX, st.cz - cameraZ) - st.radius;
      st.mesh.visible = dist < drawM;
      if (st.mesh.visible) {
        meshes++;
        tris += (st.mesh.geometry.getAttribute('position')?.count ?? 0) / 3;
      } else if (dist > KEEP_M) this.free(st);
    }
    const m = this.merged.counts();
    this.shown = { meshes: meshes + m.meshes, triangles: tris + m.triangles };
    return shownItems;
  }

  counts(): WaterfrontCounts {
    const items: Record<string, number> = {};
    for (const it of this.plan.items) items[it.rule] = (items[it.rule] ?? 0) + 1;
    return {
      items,
      piers: this.plan.frontages.filter((f) => f.kind === 'shed').map((f) => f.pier),
      hall: this.plan.frontages.some((f) => f.kind === 'hall'),
      streets: this.plan.streets.length,
      stretches: this.stretches.length + this.merged.count,
      built: this.stretches.filter((s) => s.mesh).length + this.merged.counts().built,
      meshes: this.shown.meshes,
      triangles: Math.round(this.shown.triangles),
    };
  }

  dispose(): void {
    for (const st of this.stretches) this.free(st);
    this.merged.dispose();
    for (const it of this.plan.items)
      if (it.rule !== 'palm' && it.rule !== 'plaza-palm' && it.rule !== 'boat' && it.rule !== 'parked-car')
        it.geometry.dispose();
    this.group.removeFromParent();
  }

  private free(st: Built) {
    if (!st.mesh) return;
    st.mesh.geometry.dispose();
    st.mesh.removeFromParent();
    st.mesh = null;
  }

  private build(st: Built) {
    const soup = this.plan.soups.get(st.key);
    if (!soup || soup.pos.length < 9) {
      // Nothing flat here (only items): an empty stand-in so it is not asked for again.
      st.mesh = new Mesh(new BufferGeometry(), this.surface);
      st.mesh.visible = false;
      return;
    }
    const n = soup.pos.length / 3;
    const nrm = new Float32Array(n * 3);
    const a = new Vector3();
    const b = new Vector3();
    const c = new Vector3();
    for (let i = 0; i + 2 < n; i += 3) {
      a.fromArray(soup.pos, i * 3);
      b.fromArray(soup.pos, i * 3 + 3).sub(a);
      c.fromArray(soup.pos, i * 3 + 6).sub(a);
      b.cross(c).normalize();
      for (let k = 0; k < 3; k++) b.toArray(nrm, (i + k) * 3);
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(soup.pos, 3));
    geo.setAttribute('normal', new Float32BufferAttribute(nrm, 3));
    geo.setAttribute('color', new Float32BufferAttribute(soup.col, 3));
    geo.computeBoundingSphere();
    const mesh = new Mesh(geo, this.surface);
    mesh.name = 'road-waterfront-surface';
    mesh.matrixAutoUpdate = false;
    mesh.visible = false;
    this.group.add(mesh);
    st.mesh = mesh;
  }
}
