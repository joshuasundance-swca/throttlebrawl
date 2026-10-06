// The Pacific Northwest's places (run W-U, the pitch deck's #12: "Ride up the ramp onto a car ferry,
// weave across the deck, and roll off the far side"; "a gravel logging spur through a fresh
// clear-cut, with stumps, a log-deck jump and log trucks coming the other way"; "a closed main street
// on logging-festival day, with a chainsaw-carved bear on every corner and a crowd that parts"). This
// layer draws what stands on three road tags and the solid hazards the sim makes riders meet
// (sim/riders/features.ts), so what a rider hits is what is drawn there:
//
// - `ferry`: the car ferry moored across the slip, the race's road running through it. Its hull to
//   the water, the bulwarks and the open sides of the car deck, the passenger deck overhead (you ride
//   under it), a funnel and two wheelhouses, its name on both sides, and on its deck the parked
//   pickups, the coffee cart and the stair towers (the `pickup`, `coffee-cart` and `stair-tower`
//   hazards).
// - `clearcut`: the stumps and the log deck's piles (`stump`, `log-pile`), and past the ridable dirt
//   more stumps, slash piles, bare earth, a few snags left standing and, by the replanting billboard,
//   rows of seedlings.
// - `festival`: the Stump Social on a closed main street: false-front shops along both sidewalks, the side
//   streets closed by barricades with the vendors' tents down them, bunting and a STUMP SOCIAL banner
//   over the street, the barricades pushed aside (`barricade`) and a chainsaw-carved bear on every
//   corner (`bear`). The crowd is the sim's own pedestrians, who part.
//
// Everything is code-made from boxes and prisms in flat colours (a seam: a kit of real models can
// replace any builder below), merged per block of the world like the rest of the still scenery
// (scenery-merge.ts): a few draw calls a view, built as the camera comes near. The solid hazards draw
// out to at least MIN_THREAT_DRAW_M whatever the scenery slider says. Presentation only; a lazy chunk.
import { BufferGeometry, Color, CylinderGeometry, Float32BufferAttribute, Group } from 'three';
import type { BakedFeature, RoadNetwork } from '../road';
import { mergeBoxes, type BoxPart } from './geometry';
import { MIN_THREAT_DRAW_M, type LookStyle } from './look';
import { MergedScenery, SCENERY_LOD_M, type MergeItem } from './scenery-merge';
import { ferrySections, FERRY_ROOF } from './roofs';
import { LAND_TOP_M, scatterHash, type ScenerySpot } from './scenery';

/** The tags this layer draws. */
export const PLACE_TAGS = ['ferry', 'clearcut', 'festival'] as const;

/** Whether a network carries any of them (the renderer loads this chunk only then). */
export function hasPnwPlaces(tags: ReadonlySet<string>): boolean {
  return PLACE_TAGS.some((t) => tags.has(t));
}

// ---- small builders ------------------------------------------------------------------------
// A model's own frame: +Z runs along the road (+s), +X to the road's LEFT (-d), +Y up; so a box
// across the road at d is at x = -d. `B` takes road terms: across (d), up, along (s).

type V3 = readonly [number, number, number];

/** A box in road terms: size [across, up, along], centre [d, y, s]. */
function B(size: V3, at: V3, color: string, extra: Partial<BoxPart> = {}): BoxPart {
  return { size: [size[0], size[1], size[2]], at: [-at[0], at[1], at[2]], color, ...extra };
}

/** A prism (an n-sided cylinder) standing up, or lying along the road (`lie`), with its own cap colour. */
interface PrismPart {
  r: number;
  /** Top radius (a cone when 0); the bottom's when absent. */
  rTop?: number;
  h: number;
  /** Centre [d, y, s]. */
  at: V3;
  color: string;
  cap?: string;
  sides?: number;
  lie?: boolean;
}

/** Paints every vertex of a geometry (and its first `capFrom`.. caps) and returns it non-indexed. */
function painted(g: BufferGeometry, color: string, cap?: string): BufferGeometry {
  const flat = g.index ? g.toNonIndexed() : g;
  if (flat !== g) g.dispose();
  const n = flat.getAttribute('position').count;
  const col = new Float32Array(n * 3);
  const c = new Color(color);
  const k = new Color(cap ?? color);
  const groups = flat.groups.length ? flat.groups : [{ start: 0, count: n, materialIndex: 0 }];
  for (const grp of groups) {
    const use = (grp.materialIndex ?? 0) > 0 ? k : c;
    for (let i = grp.start; i < grp.start + grp.count; i++) {
      col[i * 3] = use.r;
      col[i * 3 + 1] = use.g;
      col[i * 3 + 2] = use.b;
    }
  }
  flat.setAttribute('color', new Float32BufferAttribute(col, 3));
  flat.clearGroups();
  return flat;
}

function prism(p: PrismPart): BufferGeometry {
  const g = new CylinderGeometry(p.rTop ?? p.r, p.r, p.h, p.sides ?? 7, 1);
  if (p.lie) g.rotateX(Math.PI / 2);
  g.translate(-p.at[0], p.at[1], p.at[2]);
  return painted(g, p.color, p.cap);
}

/** Boxes and prisms as one vertex-coloured, non-indexed geometry. */
function model(boxes: readonly BoxPart[], prisms: readonly PrismPart[] = []): BufferGeometry {
  const parts: BufferGeometry[] = [];
  // mergeBoxes writes each box's own colour.
  if (boxes.length) {
    const merged = mergeBoxes(boxes);
    parts.push(merged.toNonIndexed());
    merged.dispose();
  }
  for (const p of prisms) parts.push(prism(p));
  return concat(parts);
}

function concat(parts: readonly BufferGeometry[]): BufferGeometry {
  let n = 0;
  for (const g of parts) n += g.getAttribute('position').count;
  const pos = new Float32Array(n * 3);
  const nrm = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  let o = 0;
  for (const g of parts) {
    const p = g.getAttribute('position');
    const q = g.getAttribute('normal');
    const c = g.getAttribute('color');
    for (let i = 0; i < p.count; i++, o++) {
      pos.set([p.getX(i), p.getY(i), p.getZ(i)], o * 3);
      nrm.set([q.getX(i), q.getY(i), q.getZ(i)], o * 3);
      col.set(c ? [c.getX(i), c.getY(i), c.getZ(i)] : [1, 1, 1], o * 3);
    }
    g.dispose();
  }
  const out = new BufferGeometry();
  out.setAttribute('position', new Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new Float32BufferAttribute(nrm, 3));
  out.setAttribute('color', new Float32BufferAttribute(col, 3));
  out.computeBoundingSphere();
  return out;
}

/**
 * Block letters (a 3 by 5 grid, no font: tools/blender's `_lib.block_word` does the same), as boxes
 * on a face. `along` is where the word's first letter starts on the road's s axis, `dir` the way it
 * reads (+1 toward +s), `d` the face's offset across the road, `y` its bottom.
 */
const GLYPHS: Readonly<Record<string, readonly string[]>> = {
  A: ['010', '101', '111', '101', '101'],
  B: ['110', '101', '110', '101', '110'],
  C: ['011', '100', '100', '100', '011'],
  D: ['110', '101', '101', '101', '110'],
  E: ['111', '100', '110', '100', '111'],
  I: ['111', '010', '010', '010', '111'],
  L: ['100', '100', '100', '100', '111'],
  M: ['101', '111', '111', '101', '101'],
  N: ['101', '111', '111', '111', '101'],
  O: ['010', '101', '101', '101', '010'],
  P: ['110', '101', '110', '100', '100'],
  R: ['110', '101', '110', '101', '101'],
  S: ['011', '100', '010', '001', '110'],
  T: ['111', '010', '010', '010', '010'],
  U: ['101', '101', '101', '101', '111'],
  V: ['101', '101', '101', '101', '010'],
  Y: ['101', '101', '010', '010', '010'],
};

/** A word's boxes on a face across the road (it reads along s): see GLYPHS. */
function wordAlong(
  word: string,
  cell: number,
  along: number,
  dir: 1 | -1,
  d: number,
  y: number,
  color: string,
) {
  const out: BoxPart[] = [];
  let at = along;
  for (const ch of word) {
    const g = GLYPHS[ch];
    if (g) {
      g.forEach((row, r) => {
        for (let c = 0; c < 3; c++) {
          if (row[c] !== '1') continue;
          const s = at + dir * (c + 0.5) * cell;
          out.push(B([0.08, cell * 0.95, cell * 0.95], [d, y + (4 - r + 0.5) * cell, s], color));
        }
      });
    }
    at += dir * 4 * cell;
  }
  return out;
}

/** A word's boxes on a face along the road (it reads across d, facing -s riders): see GLYPHS. */
function wordAcross(word: string, cell: number, d0: number, s: number, y: number, color: string) {
  const out: BoxPart[] = [];
  let at = d0;
  for (const ch of word) {
    const g = GLYPHS[ch];
    if (g) {
      g.forEach((row, r) => {
        for (let c = 0; c < 3; c++) {
          if (row[c] !== '1') continue;
          out.push(
            B([cell * 0.95, cell * 0.95, 0.08], [at + (c + 0.5) * cell, y + (4 - r + 0.5) * cell, s], color),
          );
        }
      });
    }
    at += 4 * cell;
  }
  return out;
}

const wordWidth = (word: string, cell: number) => (word.length * 4 - 1) * cell;

// ---- palette (flat and clean: no rust, no grime) ----------------------------------------------
const C = {
  hullNavy: '#2c3d50',
  hullWhite: '#e9e6dd',
  stripe: '#e2a33a',
  window: '#33414f',
  deckGrey: '#7e8379',
  funnel: '#e2a33a',
  funnelTop: '#2a2a2a',
  lifeRing: '#e46a2e',
  door: '#3f6f5a',
  tyre: '#26282a',
  glass: '#3d4b57',
  cart: '#2f6f6a',
  awningA: '#f2efe6',
  awningB: '#b8483a',
  bark: '#5b4636',
  cut: '#c9a46a',
  slash: '#7a6552',
  slashDry: '#9a8a6e',
  earth: '#6f5b45',
  earthDry: '#857058',
  snag: '#8d8579',
  seedling: '#4f8a43',
  log: '#7a5a3c',
  logEnd: '#c79b62',
  bearWood: '#7b5536',
  bearDark: '#4e3523',
  barricadeA: '#e8873a',
  barricadeB: '#f4f1e8',
  asphalt: '#45484c',
  tent: '#f2efe6',
  bunting: ['#c94f3d', '#e2a33a', '#3f6f9f', '#f2efe6', '#5d8a4a'],
  shops: ['#7d3b2c', '#6f8a6a', '#d9cfb4', '#4f5d6b', '#c99a3b', '#8a6f8f', '#a6b8b3'],
  pickups: ['#3f5a48', '#4b5d73', '#d8c9a3', '#8c3b32', '#ece9e1', '#2f3338'],
} as const;

// ---- the ferry ------------------------------------------------------------------------------
/** Hull half width, the car deck's walls and the passenger deck's heights above the car deck, m. */
export const FERRY_DIM = {
  hullHalfW: FERRY_ROOF.halfWidthM,
  wallD: 10,
  wallW: 0.6,
  bulwarkH: 2.6,
  /** The passenger deck's underside: roofs.ts keeps the rain out from under it. */
  ceilingY: FERRY_ROOF.heightM,
  cabinTopY: 10,
  /** The passenger deck stops this far short of each end of the hull. */
  cabinInsetM: FERRY_ROOF.insetM,
} as const;

/** One stretch of the hull, `len` along, standing `deckY` above the water (its local y = 0 is the deck). */
function hullSection(len: number, deckY: number, cabin: boolean, ring: boolean): BufferGeometry {
  const D = FERRY_DIM;
  const bottom = -deckY - 0.4;
  const parts: BoxPart[] = [
    // the hull below the deck: navy to the stripe, white above it
    B([D.hullHalfW * 2, -2 - bottom, len], [0, (bottom - 2) / 2, 0], C.hullNavy),
    B([D.hullHalfW * 2, 1.7, len], [0, -1.15, 0], C.hullWhite),
    B([D.hullHalfW * 2 + 0.1, 0.3, len], [0, -2.0, 0], C.stripe),
  ];
  for (const side of [-1, 1] as const) {
    const wd = side * (D.wallD + D.wallW / 2);
    parts.push(B([D.wallW, D.bulwarkH, len], [wd, D.bulwarkH / 2, 0], C.hullWhite));
    // the ledge between the bulwark and the hull's side
    parts.push(
      B(
        [D.hullHalfW - D.wallD - D.wallW, 0.2, len],
        [(side * (D.hullHalfW + D.wallD + D.wallW)) / 2, -0.25, 0],
        C.deckGrey,
      ),
    );
    if (ring) parts.push(B([0.12, 0.7, 0.7], [side * (D.wallD + D.wallW + 0.06), 1.6, 0], C.lifeRing));
    if (cabin) {
      // the car deck's open sides: posts holding the passenger deck up
      for (const at of [-len / 2 + 0.3, 0]) {
        parts.push(
          B([0.5, D.ceilingY - D.bulwarkH, 0.5], [wd, (D.ceilingY + D.bulwarkH) / 2, at], C.hullWhite),
        );
      }
      // the cabin's window band, proud of its wall
      parts.push(B([0.1, 1.2, len * 0.92], [side * (D.hullHalfW - 1 + 0.05), 8.6, 0], C.window));
    }
  }
  if (cabin) {
    parts.push(B([D.hullHalfW * 2, 0.4, len], [0, D.ceilingY + 0.2, 0], C.hullWhite));
    parts.push(
      B(
        [(D.hullHalfW - 1) * 2, D.cabinTopY - D.ceilingY - 0.4, len],
        [0, (D.cabinTopY + D.ceilingY + 0.4) / 2, 0],
        C.hullWhite,
      ),
    );
    parts.push(B([(D.hullHalfW - 0.6) * 2, 0.3, len], [0, D.cabinTopY + 0.15, 0], C.deckGrey));
  }
  return model(parts);
}

/** One end of the hull: the apron under the ramp, tapering below the waterline. */
function hullEnd(deckY: number, dir: 1 | -1): BufferGeometry {
  const D = FERRY_DIM;
  const bottom = -deckY - 0.4;
  const parts: BoxPart[] = [];
  for (let k = 0; k < 3; k++) {
    const w = D.hullHalfW * 2 - 3 - k * 4;
    const along = dir * (1.2 + k * 2);
    parts.push(
      B([w, -0.6 - bottom, 2.4], [0, (bottom - 0.6) / 2, along], k === 0 ? C.hullWhite : C.hullNavy),
    );
  }
  return model(parts);
}

/** The middle of the cabin roof: the funnel; each end of it: a wheelhouse. */
function ferryTop(kind: 'funnel' | 'wheelhouse'): BufferGeometry {
  const y = FERRY_DIM.cabinTopY + 0.3;
  if (kind === 'funnel')
    return model([
      B([3.2, 5, 3.2], [0, y + 2.5, 0], C.funnel),
      B([3.3, 0.8, 3.3], [0, y + 5.4, 0], C.funnelTop),
    ]);
  return model([
    B([9, 2.6, 4], [0, y + 1.3, 0], C.hullWhite),
    B([9.1, 0.9, 4.1], [0, y + 1.8, 0], C.window),
    B([10, 0.25, 4.6], [0, y + 2.7, 0], C.deckGrey),
  ]);
}

/** The ferry's name, block letters on the hull's white band (both sides, each reading forward). */
function ferryName(name: string): BufferGeometry {
  const cell = 0.24;
  const w = wordWidth(name, cell);
  const y = -1.9;
  const face = FERRY_DIM.hullHalfW + 0.05;
  return model([
    // right side: read by someone off the right, facing -d: it reads toward +s
    ...wordAlong(name, cell, -w / 2, 1, face, y, C.hullNavy),
    // left side: read toward -s
    ...wordAlong(name, cell, w / 2, -1, -face, y, C.hullNavy),
  ]);
}

// ---- deck, clear-cut and festival props (each sized to its hazard's box) -------------------
function pickup(w: number, len: number, paint: string): BufferGeometry {
  const half = len / 2;
  const parts: BoxPart[] = [
    B([w, 0.75, len - 0.2], [0, 0.85, 0], paint),
    B([w * 0.94, 0.65, len * 0.36], [0, 1.55, half * 0.22], paint),
    B([w * 0.96, 0.42, len * 0.3], [0, 1.6, half * 0.22], C.glass),
    // the bed's floor, darker
    B([w * 0.86, 0.06, len * 0.42], [0, 1.24, -half * 0.5], '#3a3d40'),
  ];
  for (const sd of [-1, 1] as const)
    for (const sa of [-1, 1] as const)
      parts.push(B([0.32, 0.72, 0.72], [sd * (w / 2 - 0.12), 0.36, sa * (half - 1.0)], C.tyre));
  return model(parts);
}

function coffeeCart(w: number, len: number): BufferGeometry {
  return model(
    [
      B([w, 1.05, len], [0, 0.85, 0], C.cart),
      B([w * 0.9, 0.08, len * 0.9], [0, 1.4, 0], '#d9d3c4'),
      B([0.5, 0.5, 0.4], [0, 1.69, len * 0.2], '#b9bcbf'),
      B([0.05, 1.0, 0.05], [w / 2 - 0.05, 1.9, len / 2 - 0.05], '#444'),
      B([0.05, 1.0, 0.05], [w / 2 - 0.05, 1.9, -len / 2 + 0.05], '#444'),
      B([w + 0.4, 0.12, len + 0.3], [0, 2.32, 0], C.awningB),
      B([w + 0.41, 0.25, len * 0.33], [0, 2.18, 0], C.awningA),
      B([0.06, 0.55, 0.8], [-(w / 2 + 0.02), 1.0, -len * 0.15], '#2b2b2b'),
    ],
    [
      { r: 0.3, h: 0.12, at: [w / 2 - 0.2, 0.3, len / 2 - 0.4], color: C.tyre, lie: false, sides: 8 },
      { r: 0.3, h: 0.12, at: [-(w / 2 - 0.2), 0.3, len / 2 - 0.4], color: C.tyre, sides: 8 },
    ],
  );
}

function stairTower(w: number, len: number, h: number, side: 1 | -1): BufferGeometry {
  return model([
    B([w, h, len], [0, h / 2, 0], C.hullWhite),
    B([0.08, 2.1, 1.0], [-side * (w / 2 + 0.04), 1.05, 0], C.door),
    B([0.08, 0.9, len * 0.7], [-side * (w / 2 + 0.04), 4.4, 0], C.window),
  ]);
}

function stump(size: number, h: number): BufferGeometry {
  return model(
    [],
    [
      { r: size / 2, rTop: size * 0.44, h, at: [0, h / 2, 0], color: C.bark, cap: C.cut, sides: 7 },
      // a root nub on the ground, inside the stump's round (its box's sides: the hitbox audit)
      { r: size * 0.16, h: 0.18, at: [size * 0.33, 0.09, 0], color: C.bark, sides: 5, lie: true },
    ],
  );
}

/** A log deck's pile: logs lying along the road, three layers, filling the hazard's box. */
function logPile(w: number, len: number, h: number): BufferGeometry {
  const prisms: PrismPart[] = [];
  // The bottom row spans the box's whole width (the sim's solid box: the hitbox audit, playtest 4),
  // its logs as near a sixth of the height across as fits a whole number of them.
  const n = Math.max(2, Math.round(w / (h / 3)));
  const r = w / (2 * n);
  const rows = [n, 0, 0];
  rows[1] = Math.max(1, (rows[0] ?? 2) - 1);
  rows[2] = Math.max(1, (rows[1] ?? 1) - 1);
  rows.forEach((n, layer) => {
    for (let i = 0; i < n; i++) {
      const d = (i - (n - 1) / 2) * 2 * r;
      const y = r + layer * r * 1.75;
      const piece = len / 2 - 0.2;
      for (const sa of [-1, 1] as const)
        prisms.push({
          r,
          h: piece,
          at: [d, y, (sa * len) / 4],
          color: C.log,
          cap: C.logEnd,
          sides: 7,
          lie: true,
        });
    }
  });
  return model([], prisms);
}

/** A chainsaw-carved bear on a stump, facing the road; three poses. */
function bear(pose: number, size: number): BufferGeometry {
  const k = size / 1.1;
  const parts: BoxPart[] = [
    B([0.62 * k, 0.95 * k, 0.5 * k], [0, 1.0 * k, 0], C.bearWood),
    B([0.44 * k, 0.4 * k, 0.4 * k], [0, 1.68 * k, 0], C.bearWood),
    B([0.2 * k, 0.16 * k, 0.24 * k], [0, 1.62 * k, 0.26 * k], C.bearDark),
    B([0.12 * k, 0.12 * k, 0.08 * k], [0.15 * k, 1.92 * k, 0], C.bearWood),
    B([0.12 * k, 0.12 * k, 0.08 * k], [-0.15 * k, 1.92 * k, 0], C.bearWood),
    B([0.06 * k, 0.06 * k, 0.04 * k], [0.09 * k, 1.75 * k, 0.21 * k], '#1d1a17'),
    B([0.06 * k, 0.06 * k, 0.04 * k], [-0.09 * k, 1.75 * k, 0.21 * k], '#1d1a17'),
    // the feet
    B([0.2 * k, 0.22 * k, 0.3 * k], [0.16 * k, 0.6 * k, 0.05 * k], C.bearDark),
    B([0.2 * k, 0.22 * k, 0.3 * k], [-0.16 * k, 0.6 * k, 0.05 * k], C.bearDark),
  ];
  if (pose === 0) {
    // waving: one paw up
    parts.push(B([0.16 * k, 0.55 * k, 0.16 * k], [0.4 * k, 1.75 * k, 0], C.bearWood, { rotX: 0 }));
    parts.push(B([0.16 * k, 0.5 * k, 0.16 * k], [-0.38 * k, 1.05 * k, 0.05 * k], C.bearWood));
  } else if (pose === 1) {
    // holding a plank sign across its chest
    parts.push(B([0.8 * k, 0.35 * k, 0.06 * k], [0, 1.12 * k, 0.3 * k], '#c8a06a'));
    parts.push(B([0.16 * k, 0.45 * k, 0.16 * k], [0.36 * k, 1.15 * k, 0.15 * k], C.bearWood));
    parts.push(B([0.16 * k, 0.45 * k, 0.16 * k], [-0.36 * k, 1.15 * k, 0.15 * k], C.bearWood));
  } else {
    // both paws up, mid-roar
    parts.push(B([0.16 * k, 0.55 * k, 0.16 * k], [0.4 * k, 1.8 * k, 0.05 * k], C.bearWood));
    parts.push(B([0.16 * k, 0.55 * k, 0.16 * k], [-0.4 * k, 1.8 * k, 0.05 * k], C.bearWood));
  }
  return model(parts, [
    { r: 0.55 * k, rTop: 0.5 * k, h: 0.5 * k, at: [0, 0.25 * k, 0], color: C.bark, cap: C.cut, sides: 8 },
  ]);
}

function barricade(w: number): BufferGeometry {
  const parts: BoxPart[] = [];
  for (const y of [0.75, 1.1])
    for (let i = 0; i < 4; i++)
      parts.push(
        B([w / 4, 0.18, 0.05], [-w / 2 + w / 8 + (i * w) / 4, y, 0], i % 2 ? C.barricadeB : C.barricadeA),
      );
  for (const sd of [-1, 1] as const) {
    parts.push(B([0.08, 1.2, 0.08], [sd * (w / 2 - 0.2), 0.6, 0.25], '#9a9a9a'));
    parts.push(B([0.08, 1.2, 0.08], [sd * (w / 2 - 0.2), 0.6, -0.25], '#9a9a9a'));
  }
  return model(parts);
}

/**
 * The model a solid hazard draws as, sized to its box (`w` across, `len` along, `h` high; `side` the
 * road side, `v` the feature's hash), and its turn about the up axis; null for an object with none.
 * `once` shares a geometry between hazards of one size. The hitbox audit (scripts/hitboxes.test.ts)
 * measures these against the sim's boxes.
 */
export function solidHazardModel(
  kind: string,
  box: { w: number; len: number; h: number; side: 1 | -1; v: number },
  once: (key: string, make: () => BufferGeometry) => BufferGeometry = (_k, make) => make(),
): { geometry: BufferGeometry; turn: number } | null {
  const { w, len, h, side, v } = box;
  if (kind === 'pickup') {
    const paint = C.pickups[v % C.pickups.length] ?? '#3f5a48';
    return { geometry: once(`pickup:${w}:${len}:${paint}`, () => pickup(w, len, paint)), turn: 0 };
  }
  if (kind === 'coffee-cart')
    return { geometry: once(`cart:${w}:${len}`, () => coffeeCart(w, len)), turn: 0 };
  if (kind === 'stair-tower')
    return { geometry: once(`tower:${w}:${len}:${h}:${side}`, () => stairTower(w, len, h, side)), turn: 0 };
  if (kind === 'stump') {
    const size = Math.round(Math.min(w, len) * 10) / 10;
    return { geometry: once(`stump:${size}:${h}`, () => stump(size, h)), turn: (v % 628) / 100 };
  }
  if (kind === 'log-pile')
    return { geometry: once(`pile:${w}:${len}:${h}`, () => logPile(w, len, h)), turn: 0 };
  if (kind === 'bear') {
    const pose = v % 3;
    // face the road: its front (+Z) turned toward the centre line
    const turn = side > 0 ? Math.PI / 2 : -Math.PI / 2;
    return { geometry: once(`bear:${pose}`, () => bear(pose, Math.min(w, len))), turn };
  }
  if (kind === 'barricade') return { geometry: once(`barricade:${w}`, () => barricade(w)), turn: 0 };
  return null;
}

/** A false-front shop on the main street, its front on the sidewalk's back edge, facing the road. */
function shop(width: number, height: number, paint: string, awning: string, side: 1 | -1): BufferGeometry {
  const depth = 10;
  const dBack = side * (depth / 2);
  const front = 0;
  const parts: BoxPart[] = [
    // the body, from the front wall back
    B([depth, height * 0.8, width], [dBack, (height * 0.8) / 2, 0], paint),
    // the false front, standing taller than the roof
    B([0.3, height, width], [front + side * 0.15, height / 2, 0], paint),
    B([0.35, 0.25, width + 0.2], [front + side * 0.1, height + 0.12, 0], C.hullWhite),
    // the shop window and door, and the upstairs windows
    B([0.08, 1.6, width * 0.55], [front - side * 0.02, 1.4, -width * 0.12], C.glass),
    B([0.08, 2.1, 1.1], [front - side * 0.02, 1.05, width * 0.32], '#3a2c22'),
    B([0.08, 1.0, width * 0.22], [front - side * 0.02, height * 0.68, -width * 0.22], C.glass),
    B([0.08, 1.0, width * 0.22], [front - side * 0.02, height * 0.68, width * 0.22], C.glass),
    // the awning over the sidewalk
    B([1.2, 0.12, width * 0.9], [front - side * 0.6, 2.85, 0], awning),
  ];
  return model(parts);
}

/** A string of bunting across the street at height `y`, from d0 to d1. */
function bunting(d0: number, d1: number, y: number, seed: number): BufferGeometry {
  const parts: BoxPart[] = [B([d1 - d0, 0.04, 0.04], [(d0 + d1) / 2, y, 0], '#2b2b2b')];
  const n = Math.floor((d1 - d0) / 0.9);
  for (let i = 0; i < n; i++) {
    const d = d0 + (i + 0.5) * ((d1 - d0) / n);
    const col = C.bunting[(i + seed) % C.bunting.length] ?? '#c94f3d';
    parts.push(B([0.4, 0.42, 0.04], [d, y - 0.24, 0], col));
  }
  return model(parts);
}

/** The STUMP SOCIAL banner over the street, words on the face riders come up to (-s). */
function banner(halfW: number): BufferGeometry {
  const cell = 0.2;
  const word = 'STUMP SOCIAL';
  const w = wordWidth(word, cell);
  const y = 5.4;
  return model([
    B([halfW * 2, 1.6, 0.1], [0, y + 0.6, 0], '#3f6f5a'),
    ...wordAcross(word, cell, -w / 2, -0.07, y + 0.15, C.awningA),
    B([0.15, y + 1.5, 0.15], [-halfW, (y + 1.5) / 2, 0], '#6b5a48'),
    B([0.15, y + 1.5, 0.15], [halfW, (y + 1.5) / 2, 0], '#6b5a48'),
  ]);
}

/** A side street's mouth: its asphalt running off, the barricade at the sidewalk's edge, two tents. */
function sideStreet(width: number, side: 1 | -1, seed: number, run: number): BufferGeometry {
  const parts: BoxPart[] = [B([run, 0.06, width], [side * (run / 2), 0.03, 0], C.asphalt)];
  for (let i = 0; i < 4; i++)
    parts.push(
      B(
        [0.06, 0.2, width / 4],
        [side * 0.3, 0.9, -width / 2 + width / 8 + (i * width) / 4],
        i % 2 ? C.barricadeB : C.barricadeA,
      ),
    );
  for (const sd of [-1, 1] as const)
    parts.push(B([0.1, 1.0, 0.1], [side * 0.3, 0.5, sd * (width / 2 - 0.3)], '#9a9a9a'));
  for (const [k, at] of [10, 20].entries()) {
    if (at + 2 > run) break;
    const roof = C.bunting[(seed + k) % C.bunting.length] ?? C.awningB;
    const sAt = (k % 2 ? 1 : -1) * (width / 2 - 2);
    parts.push(B([3, 2.2, 3], [side * at, 1.1, sAt], C.tent));
    parts.push(B([3.4, 0.5, 3.4], [side * at, 2.45, sAt], roof));
  }
  return model(parts);
}

// ---- the clear-cut's dressing (past the ridable dirt: nothing solid there) ------------------
function slashPile(size: number, seed: number): BufferGeometry {
  const parts: BoxPart[] = [];
  for (let i = 0; i < 5; i++) {
    const a = scatterHash(seed, i, 1, 3) * Math.PI;
    parts.push(
      B(
        [0.18, 0.18, size * (0.6 + scatterHash(seed, i, 2, 3) * 0.6)],
        [(scatterHash(seed, i, 3, 3) - 0.5) * size * 0.6, 0.15 + i * 0.1, 0],
        i % 2 ? C.slash : C.slashDry,
        { rotY: a },
      ),
    );
  }
  parts.push(B([size * 0.8, 0.3, size * 0.6], [0, 0.15, 0], C.slash));
  return model(parts);
}

function snag(h: number): BufferGeometry {
  return model(
    [B([0.12, 0.12, 1.4], [0.2, h * 0.7, 0], C.snag, { rotX: 0.5 })],
    [{ r: 0.32, rTop: 0.12, h, at: [0, h / 2, 0], color: C.snag, sides: 6 }],
  );
}

function earthPatch(w: number, len: number, colour: string): BufferGeometry {
  return model([B([w, 0.06, len], [0, 0.03, 0], colour)]);
}

function seedlingRow(len: number): BufferGeometry {
  const prisms: PrismPart[] = [];
  for (let s = -len / 2; s <= len / 2; s += 1.6)
    prisms.push({ r: 0.22, rTop: 0, h: 0.55, at: [0, 0.27, s], color: C.seedling, sides: 4 });
  return model([], prisms);
}

// ---- the layer ------------------------------------------------------------------------------

export interface PnwPlacesCounts {
  /** What was placed: props per kind (stumps, pickups, bears...). */
  placed: Readonly<Record<string, number>>;
  /** The hazards drawn, and the solid hazards on the network (every one must be drawn). */
  hazardsDrawn: number;
  hazards: number;
  blocks: number;
  meshes: number;
  triangles: number;
}

interface Item {
  kind: string;
  edge: number;
  s: number;
  d: number;
  /** Lift above the road surface there, m. */
  h?: number;
  /** Turn added to the road's heading there, radians. */
  turn?: number;
  geometry: BufferGeometry;
  /** A solid hazard's prop (drawn to the threat distance). */
  threat?: boolean;
}

const tagRanges = (road: RoadNetwork, edge: number, tag: string) =>
  (road.edges[edge]?.tags ?? []).filter((t) => t.tag === tag);

/** The world spot of (edge, s, d) with the model's +Z along the road there. */
function spotAt(road: RoadNetwork, it: Item): ScenerySpot {
  const e = road.edges[it.edge];
  const len = e?.length ?? 0;
  const a = road.toWorld(it.edge, Math.max(0, it.s - 1), 0, 0);
  const b = road.toWorld(it.edge, Math.min(len, it.s + 1), 0, 0);
  const p = road.toWorld(it.edge, it.s, it.d, it.h ?? 0);
  return {
    kind: 'shack',
    variant: 0,
    p: { x: p.x, y: p.y, z: p.z },
    turn: Math.atan2(b.x - a.x, b.z - a.z) + (it.turn ?? 0),
    size: 1,
    phase: 0,
    edge: it.edge,
    s: it.s,
    d: it.d,
  };
}

const mid = (f: BakedFeature) => ({ s: (f.s0 + f.s1) / 2, d: (f.d0 + f.d1) / 2 });
const objectOf = (f: BakedFeature) => (typeof f.params?.['object'] === 'string' ? f.params['object'] : '');
const heightOf = (f: BakedFeature) => (typeof f.params?.['heightM'] === 'number' ? f.params['heightM'] : 1.5);
const hashOf = (id: string) => {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return h >>> 0;
};

/** Metres of drawn land past the road's verge strip at s on a side (RoadScene.landReach). */
export type LandReach = (edge: number, side: -1 | 1, s: number) => number;
/** The road scene's verge strip past the lanes, m (road-mesh.ts VERGE_M). */
const VERGE_M = 0.6;
/** Props on the verge band stand on it (verge.ts draws it just under the road, -0.045). */
const BAND_TOP_M = -0.04;

/** Every prop the places put on a network, in road terms (the layer merges them; tests read them). */
export function placeItems(road: RoadNetwork, seed: number, landReach: LandReach = () => 24): Item[] {
  const items: Item[] = [];
  const shared = new Map<string, BufferGeometry>();
  const once = (key: string, make: () => BufferGeometry) => {
    let g = shared.get(key);
    if (!g) {
      g = make();
      shared.set(key, g);
    }
    return g;
  };
  for (const e of road.edges) {
    // The solid hazards: each drawn at its own box.
    for (const f of e.features) {
      if (f.kind !== 'hazard' || f.params?.['solid'] !== true) continue;
      const { s, d } = mid(f);
      const w = Math.abs(f.d1 - f.d0);
      const len = Math.abs(f.s1 - f.s0);
      const h = heightOf(f);
      const side: 1 | -1 = d >= 0 ? 1 : -1;
      const v = hashOf(f.id);
      const kind = objectOf(f);
      const drawn = solidHazardModel(kind, { w, len, h, side, v }, once);
      if (!drawn) continue;
      const { geometry, turn } = drawn;
      items.push({ kind, edge: e.index, s, d, h: BAND_TOP_M, turn, geometry, threat: true });
    }

    // The ferry.
    for (const t of tagRanges(road, e.index, 'ferry')) {
      const { n, len, cabin: hasDeck } = ferrySections(t.s0, t.s1);
      const deckY = road.toWorld(e.index, (t.s0 + t.s1) / 2, 0, 0).y;
      for (let i = 0; i < n; i++) {
        const s = t.s0 + (i + 0.5) * len;
        const cabin = hasDeck(i);
        const y = road.toWorld(e.index, s, 0, 0).y;
        items.push({
          kind: 'ferry-hull',
          edge: e.index,
          s,
          d: 0,
          geometry: once(`hull:${len}:${y}:${cabin}:${i % 2}`, () => hullSection(len, y, cabin, i % 2 === 0)),
        });
      }
      items.push({
        kind: 'ferry-end',
        edge: e.index,
        s: t.s0,
        d: 0,
        geometry: once(`end:${deckY}:-1`, () => hullEnd(road.toWorld(e.index, t.s0, 0, 0).y, -1)),
      });
      items.push({
        kind: 'ferry-end',
        edge: e.index,
        s: t.s1,
        d: 0,
        geometry: once(`end:${deckY}:1`, () => hullEnd(road.toWorld(e.index, t.s1, 0, 0).y, 1)),
      });
      const middle = (t.s0 + t.s1) / 2;
      items.push({
        kind: 'ferry-funnel',
        edge: e.index,
        s: middle,
        d: 0,
        geometry: once('funnel', () => ferryTop('funnel')),
      });
      for (const at of [t.s0 + FERRY_DIM.cabinInsetM + 4, t.s1 - FERRY_DIM.cabinInsetM - 4])
        items.push({
          kind: 'ferry-wheelhouse',
          edge: e.index,
          s: at,
          d: 0,
          geometry: once('wheelhouse', () => ferryTop('wheelhouse')),
        });
      items.push({
        kind: 'ferry-name',
        edge: e.index,
        s: middle,
        d: 0,
        geometry: once('name', () => ferryName('EVENTUALLY')),
      });
    }

    // The clear-cut's dressing, past the ridable dirt on each side it covers.
    for (const t of tagRanges(road, e.index, 'clearcut')) {
      for (const side of [-1, 1] as const) {
        if (t.side !== 'both' && t.side !== (side < 0 ? 'left' : 'right')) continue;
        // Past the ridable dirt (nothing solid stands on it but the stumps the sim knows), and only on
        // the land the road scene drew there (its flat strip, never the skirt sloping away).
        const outer = side < 0 ? -e.dMin + VERGE_M : e.dMax + VERGE_M;
        for (let s = Math.max(4, t.s0); s < Math.min(e.length - 4, t.s1); s += 7) {
          const v = road.vergeAt(e.index, s, side < 0 ? 'left' : 'right');
          const past = Math.abs(v.dOuter) + 1.2;
          const land = outer + Math.min(landReach(e.index, side, s - 4), landReach(e.index, side, s + 4)) - 1;
          if (land - past < 2) continue;
          const r = scatterHash(seed, e.index * 2 + (side > 0 ? 1 : 0), s, 11);
          const across = past + scatterHash(seed, e.index, s, 12 + side) * (land - past);
          const d = side * across;
          if (r < 0.42) {
            const size = 0.7 + scatterHash(seed, e.index, s, 13) * 0.7;
            const key = Math.round(size * 5) / 5;
            items.push({
              kind: 'cut-stump',
              edge: e.index,
              s,
              d,
              h: LAND_TOP_M,
              turn: r * 20,
              geometry: once(`stump:${key}:0.7`, () => stump(key, 0.7)),
            });
          } else if (r < 0.6) {
            const size = 2.5 + scatterHash(seed, e.index, s, 14) * 2.5;
            const key = Math.round(size);
            items.push({
              kind: 'slash',
              edge: e.index,
              s,
              d,
              h: LAND_TOP_M,
              turn: r * 30,
              geometry: once(`slash:${key}`, () => slashPile(key, key)),
            });
          } else if (r < 0.66) {
            const h = 6 + Math.round(scatterHash(seed, e.index, s, 15) * 3) * 2;
            items.push({
              kind: 'snag',
              edge: e.index,
              s,
              d: side * (past + (land - past) * 0.85),
              h: LAND_TOP_M,
              turn: r * 40,
              geometry: once(`snag:${h}`, () => snag(h)),
            });
          }
          const patchW = Math.min(6, land - past);
          if (Math.round(s) % 14 < 7 && patchW >= 3) {
            const colour = r < 0.5 ? C.earth : C.earthDry;
            const w = Math.floor(patchW);
            items.push({
              kind: 'earth',
              edge: e.index,
              s,
              d: side * (past + w / 2),
              h: LAND_TOP_M + 0.03,
              turn: (r - 0.5) * 0.4,
              geometry: once(`earth:${colour}:${w}`, () => earthPatch(w, 10, colour)),
            });
          }
        }
      }
      // Seedlings in rows round the replanting billboard.
      for (const f of road.edges[e.index]?.features ?? []) {
        if (f.kind !== 'billboard' || f.item !== 'replanting') continue;
        const side = Math.sign(f.d0 + f.d1) || 1;
        const near = Math.min(Math.abs(f.d0), Math.abs(f.d1));
        for (let row = 0; row < 3; row++)
          items.push({
            kind: 'seedlings',
            edge: e.index,
            s: (f.s0 + f.s1) / 2,
            d: side * (near - 2.5 - row * 1.8),
            h: BAND_TOP_M,
            geometry: once('seedlings', () => seedlingRow(46)),
          });
      }
    }

    // The Stump Social.
    for (const t of tagRanges(road, e.index, 'festival')) {
      const bears = e.features
        .filter((f) => f.kind === 'hazard' && objectOf(f) === 'bear' && f.s0 >= t.s0 && f.s1 <= t.s1)
        .sort((a, b) => a.s0 - b.s0);
      for (const side of [-1, 1] as const) {
        const own = bears.filter((b) => Math.sign(b.d0 + b.d1) === side);
        // A side street is the gap between two bears 8 to 20 m apart.
        const gaps: [number, number][] = [];
        for (let i = 0; i + 1 < own.length; i++) {
          const a = own[i];
          const b = own[i + 1];
          if (a && b && b.s0 - a.s1 >= 8 && b.s0 - a.s1 <= 20) gaps.push([a.s1, b.s0]);
        }
        const v = road.vergeAt(e.index, (t.s0 + t.s1) / 2, side < 0 ? 'left' : 'right');
        const front = side * Math.abs(v.dOuter);
        const outer = side < 0 ? -e.dMin + VERGE_M : e.dMax + VERGE_M;
        for (const [k, [g0, g1]] of gaps.entries()) {
          const c = (g0 + g1) / 2;
          const reach = outer + Math.min(landReach(e.index, side, g0), landReach(e.index, side, g1));
          const run = Math.max(6, Math.min(40, Math.floor(reach - Math.abs(front) - 1)));
          items.push({
            kind: 'side-street',
            edge: e.index,
            s: c,
            d: front,
            h: LAND_TOP_M + 0.02,
            geometry: once(`street:${g1 - g0}:${side}:${k % 3}:${run}`, () =>
              sideStreet(g1 - g0, side, k, run),
            ),
          });
        }
        // Shops between the gaps.
        let s = t.s0 + 1;
        let k = 0;
        while (s < t.s1 - 4) {
          const gap = gaps.find(([g0, g1]) => s < g1 + 0.5 && s + 4 > g0 - 0.5);
          if (gap) {
            s = gap[1] + 0.5;
            continue;
          }
          const next = gaps.find(([g0]) => g0 > s)?.[0] ?? t.s1 - 1;
          const want = 9 + Math.round(scatterHash(seed, e.index, s, 21 + side) * 6);
          const width = Math.min(want, next - 0.5 - s);
          if (width < 4) {
            s = next + 0.5;
            continue;
          }
          const height = 6.5 + Math.round(scatterHash(seed, e.index, s, 23) * 5) * 0.6;
          const paint = C.shops[(k + (side > 0 ? 0 : 3)) % C.shops.length] ?? '#d9cfb4';
          const awning = k % 2 ? C.awningB : C.cart;
          items.push({
            kind: 'shop',
            edge: e.index,
            s: s + width / 2,
            d: front,
            h: LAND_TOP_M,
            geometry: once(`shop:${width}:${height}:${paint}:${awning}:${side}`, () =>
              shop(width, height, paint, awning, side),
            ),
          });
          s += width + 0.3;
          k++;
        }
      }
      // Bunting across the street, and the banner at each end of the closure.
      const vR = road.vergeAt(e.index, (t.s0 + t.s1) / 2, 'right');
      const vL = road.vergeAt(e.index, (t.s0 + t.s1) / 2, 'left');
      for (let s = t.s0 + 24, i = 0; s < t.s1 - 16; s += 32, i++)
        items.push({
          kind: 'bunting',
          edge: e.index,
          s,
          d: 0,
          geometry: once(`bunting:${i % 4}`, () => bunting(vL.dOuter, vR.dOuter, 7.2 - (i % 2) * 0.4, i)),
        });
      const half = Math.min(Math.abs(vL.dOuter), Math.abs(vR.dOuter)) - 0.3;
      for (const s of [t.s0 + 10, t.s1 - 10])
        items.push({ kind: 'banner', edge: e.index, s, d: 0, geometry: once('banner', () => banner(half)) });
    }
  }
  return items;
}

/**
 * The places merge in squares this wide, m: twice the still scenery's, because they are sparse and
 * long (a clear-cut runs on for most of a kilometre): fewer draw calls for a few more triangles.
 */
export const PLACES_BLOCK_M = 320;

/** The places of one network, merged per block of the world and drawn near the camera. */
export class PnwPlacesLayer {
  readonly group = new Group();
  private readonly merged: MergedScenery;
  private readonly placed: Record<string, number> = {};
  private readonly hazards: number;
  private readonly drawnHazards: number;

  constructor(look: LookStyle, opts: { road: RoadNetwork; seed: number; landReach?: LandReach }) {
    this.group.name = 'pnw-places';
    const material = look.material('prop', { vertexColors: true });
    const items = placeItems(opts.road, opts.seed, opts.landReach);
    const merge: MergeItem[] = [];
    for (const it of items) {
      this.placed[it.kind] = (this.placed[it.kind] ?? 0) + 1;
      merge.push({ spot: spotAt(opts.road, it), geometry: it.geometry, material });
    }
    this.hazards = opts.road.edges.reduce(
      (n, e) => n + e.features.filter((f) => f.kind === 'hazard' && f.params?.['solid'] === true).length,
      0,
    );
    this.drawnHazards = items.filter((it) => it.threat).length;
    // One mesh per block for everything: the solid hazards are threats, so the whole layer draws out
    // to at least MIN_THREAT_DRAW_M (the scenery slider's default, 360 m, is further anyway).
    this.merged = new MergedScenery(merge, undefined, PLACES_BLOCK_M);
    this.group.add(this.merged.group);
  }

  /** Builds and shows blocks near the camera; returns the props drawn. */
  update(cameraX: number, cameraZ: number, drawM: number, lodM = SCENERY_LOD_M, builds = 1): number {
    return this.merged.update(cameraX, cameraZ, Math.max(drawM, MIN_THREAT_DRAW_M), lodM, builds);
  }

  counts(): PnwPlacesCounts {
    const c = this.merged.counts();
    return {
      placed: { ...this.placed },
      hazardsDrawn: this.drawnHazards,
      hazards: this.hazards,
      blocks: c.blocks,
      meshes: c.meshes,
      triangles: c.triangles,
    };
  }

  dispose(): void {
    this.merged.dispose();
    this.group.removeFromParent();
  }
}
