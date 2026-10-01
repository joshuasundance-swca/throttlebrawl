// Roadside scenery (playtest 1c, 2026-09-30). Item 3: "they are also mostly inappropriately placed,
// in concrete floating in the river lol", so scenery stands on land or the verge only, never on a
// bridge, the road or the water. Item 2: the scatter derives from the race's seed, so each race
// looks a little different and a fixed seed always gives the same scene. Item 4: the Blender
// scenery pack (palms, mangrove clumps, bait shacks, power poles, boats offshore).
//
// Land comes from the road's scenery tags, per side (docs/content-packs.md, "Scenery tags"): a
// water tag means sea (boats bob there), `bridge` or `causeway` alone means no land, and every other
// tag is land with a theme that picks what grows or stands on it. An edge with no tags at all (a
// test fixture, an untagged bake) counts as palm land. This module only decides; road-mesh.ts
// draws the land and instances the models. Presentation only: nothing here reaches the sim.
import type { Point3 } from './geometry';

/** What one side of a road is at some s. */
export type SideTheme = 'none' | 'water' | 'palms' | 'beach' | 'mangrove' | 'commercial' | 'urban' | 'forest';
export type LandTheme = Exclude<SideTheme, 'none' | 'water'>;

/** Each land tag's theme. Tags not listed here (fog, cable-line) say nothing about the ground. */
const LAND_TAGS: Readonly<Record<string, LandTheme>> = {
  palms: 'palms',
  beach: 'beach',
  mangrove: 'mangrove',
  swamp: 'mangrove',
  marina: 'commercial',
  'strip-mall': 'commercial',
  'trailer-park': 'commercial',
  town: 'commercial',
  landmark: 'commercial',
  'row-houses': 'urban',
  'painted-houses': 'urban',
  warehouses: 'urban',
  piers: 'urban',
  gardens: 'urban',
  sawmill: 'urban',
  forest: 'forest',
};
/** When one side carries several land tags, the first theme in this list wins. */
const THEME_ORDER: readonly LandTheme[] = ['palms', 'mangrove', 'commercial', 'beach', 'urban', 'forest'];

export interface SideTag {
  s0: number;
  s1: number;
  side?: string;
  tag: string;
}

function onSide(t: SideTag, side: 'left' | 'right'): boolean {
  return t.side === undefined || t.side === 'both' || t.side === side;
}

/** The side's theme at s. Water tags win over land tags; bridge and causeway alone mean no land. */
export function themeAt(tags: readonly SideTag[] | undefined, side: 'left' | 'right', s: number): SideTheme {
  if (!tags || tags.length === 0) return 'palms';
  let best: LandTheme | null = null;
  let bridge = false;
  for (const t of tags) {
    if (s < t.s0 || s > t.s1 || !onSide(t, side)) continue;
    if (t.tag.startsWith('water')) return 'water';
    if (t.tag === 'bridge' || t.tag === 'causeway') bridge = true;
    const theme = LAND_TAGS[t.tag];
    if (theme && (best === null || THEME_ORDER.indexOf(theme) < THEME_ORDER.indexOf(best))) best = theme;
  }
  if (bridge && best === null) return 'none';
  return best ?? 'none';
}

export type SceneryKind = 'palm' | 'mangrove' | 'shack' | 'pole' | 'skiff' | 'boat';
export const SCENERY_KINDS: readonly SceneryKind[] = ['palm', 'mangrove', 'shack', 'pole', 'skiff', 'boat'];

export interface ScenerySpot {
  kind: SceneryKind;
  /** Which of the model's variants (palms have 3, mangroves 2). */
  variant: number;
  p: Point3;
  /** Turn about the vertical axis, radians (the model's +Z turns to (sin, cos) in x, z). */
  turn: number;
  size: number;
  /** A boat's bobbing phase, radians (0 for land scenery). */
  phase: number;
  /** The edge and s it was placed from (tests and the debug overlay). */
  edge: number;
  s: number;
  /** Signed lateral offset on that edge, m. */
  d: number;
}

/** Metres between candidate spots of each kind on one side, at density 1. [default] */
export const SCATTER_SPACING_M: Readonly<Record<SceneryKind, number>> = {
  palm: 18,
  mangrove: 15,
  shack: 90,
  pole: 45,
  skiff: 110,
  boat: 110,
};
/** Share of a theme's candidate spots that get each kind. [default] */
const RATE: Readonly<Record<LandTheme, Partial<Record<SceneryKind, number>>>> = {
  palms: { palm: 1, shack: 0.3 },
  beach: { palm: 0.3 },
  mangrove: { mangrove: 1, palm: 0.12 },
  commercial: { palm: 0.45, shack: 1 },
  urban: {},
  forest: {},
};
/** Where each kind stands past the verge: the nearest offset and the random spread beyond it, m. */
const ACROSS_M: Readonly<Record<SceneryKind, readonly [number, number]>> = {
  palm: [2.2, 5.5],
  mangrove: [2.8, 9],
  shack: [8.5, 6],
  pole: [1.6, 0],
  skiff: [30, 45],
  boat: [34, 45],
};
/** Clear ground each kind needs around its anchor (other roads, features), m. */
export const SCENERY_RADIUS_M: Readonly<Record<SceneryKind, number>> = {
  palm: 1.6,
  mangrove: 3,
  shack: 3.6,
  pole: 1.4,
  skiff: 4,
  boat: 5,
};
const VARIANTS: Readonly<Record<SceneryKind, number>> = {
  palm: 3,
  mangrove: 2,
  shack: 1,
  pole: 1,
  skiff: 1,
  boat: 1,
};

/** Tags that mark a network as tropical (the Keys): only there do palms and mangroves grow. */
const TROPICAL_TAGS = new Set(['palms', 'beach', 'mangrove', 'swamp']);

/** Whether a network's tags say tropical. A network with no tags at all counts as tropical (base). */
export function isTropical(tagLists: readonly (readonly SideTag[] | undefined)[]): boolean {
  let any = false;
  for (const tags of tagLists) {
    for (const t of tags ?? []) {
      any = true;
      if (TROPICAL_TAGS.has(t.tag)) return true;
    }
  }
  return !any;
}

/** A small seeded hash to 0..1 (placement only; never the sim's RNG). */
export function scatterHash(seed: number, a: number, b: number, c: number): number {
  let h = Math.imul((seed | 0) ^ 0x5bd1e995, 0x85ebca6b);
  h = Math.imul(h ^ (a + 0x9e3779b9), 0xc2b2ae35);
  h = Math.imul(h ^ (Math.round(b * 16) + 0x27d4eb2f), 0x85ebca6b);
  h ^= Math.imul(c + 0x165667b1, 0x27d4eb2f);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h ^ (h >>> 13), 0x297a2d39);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** What the scatter needs from the road builder, for one edge. */
export interface ScatterEdge {
  seed: number;
  edge: number;
  length: number;
  /** Candidate spots per stretch, 1 = the spacing above, 0 = no scenery (`render.roadsideDensity`). */
  density: number;
  /** Tropical networks grow palms and mangroves; elsewhere only the buildings and poles stand. */
  tropical: boolean;
  /** The verge's outer edge, as a distance from the centre line on that side (positive), m. */
  outer(side: -1 | 1): number;
  theme(side: -1 | 1, s: number): SideTheme;
  /** Metres of drawn land past the verge at s on that side (0 = none: a bridge, a rail, the sea). */
  landReach(side: -1 | 1, s: number): number;
  /** Whether a spot of this radius is free of roads, features and roadside zones. */
  clear(s: number, d: number, radius: number): boolean;
  /** Whether a boat may float here: open water, clear of every road and its land. */
  openWater(s: number, d: number): boolean;
  world(s: number, d: number, h: number): Point3;
}

/** The turn that points a model's +Z from a toward b. */
function turnToward(a: Point3, b: Point3): number {
  return Math.atan2(b.x - a.x, b.z - a.z);
}

const LAND_KINDS: readonly SceneryKind[] = ['palm', 'mangrove', 'shack'];

/** Places one edge's scenery: land kinds on land by theme, poles along one side, boats on water. */
export function scatterEdge(e: ScatterEdge): ScenerySpot[] {
  const out: ScenerySpot[] = [];
  if (e.density <= 0) return out;
  const h = (kind: number, k: number, side: number, salt: number) =>
    scatterHash(e.seed, e.edge * 977 + kind * 31 + salt, k, side + 3);
  const place = (
    kind: SceneryKind,
    s: number,
    d: number,
    y: number,
    turn: number,
    k: number,
    side: number,
  ) => {
    const ki = SCENERY_KINDS.indexOf(kind);
    out.push({
      kind,
      variant: Math.floor(h(ki, k, side, 5) * VARIANTS[kind]) % VARIANTS[kind],
      p: e.world(s, d, y),
      turn,
      size:
        kind === 'palm'
          ? 0.85 + 0.3 * h(ki, k, side, 6)
          : kind === 'mangrove'
            ? 0.8 + 0.45 * h(ki, k, side, 6)
            : 1,
      phase: kind === 'skiff' || kind === 'boat' ? h(ki, k, side, 7) * Math.PI * 2 : 0,
      edge: e.edge,
      s,
      d,
    });
  };
  // The poles run down one side of the road, chosen by the seed.
  const poleSide: -1 | 1 = h(99, 0, 0, 1) < 0.5 ? -1 : 1;
  for (const side of [-1, 1] as const) {
    const outer = e.outer(side);
    for (const kind of [...LAND_KINDS, 'pole' as const]) {
      if (kind === 'pole' && side !== poleSide) continue;
      const ki = SCENERY_KINDS.indexOf(kind);
      const spacing = SCATTER_SPACING_M[kind] / e.density;
      for (let k = 0; ; k++) {
        const s = (k + 0.15 + 0.7 * h(ki, k, side, 0)) * spacing;
        if (s > e.length) break;
        const theme = e.theme(side, s);
        if (theme === 'none' || theme === 'water') continue;
        if (!e.tropical && (kind === 'palm' || kind === 'mangrove')) continue;
        if (kind !== 'pole' && h(ki, k, side, 1) >= (RATE[theme][kind] ?? 0)) continue;
        const [near, spread] = ACROSS_M[kind];
        const across = near + spread * h(ki, k, side, 2);
        const radius = SCENERY_RADIUS_M[kind];
        // On the drawn land, with room for the model, and clear of everything else.
        if (across + radius > e.landReach(side, s)) continue;
        const d = side * (outer + across);
        if (!e.clear(s, d, radius)) continue;
        // Shacks face the road; poles carry their wires along it; the rest turn at random.
        const turn =
          kind === 'shack'
            ? turnToward(e.world(s, d, 0), e.world(s, 0, 0))
            : kind === 'pole'
              ? turnToward(e.world(s, d, 0), e.world(Math.min(e.length, s + 1), d, 0))
              : h(ki, k, side, 3) * Math.PI * 2;
        place(kind, s, d, LAND_TOP_M, turn, k, side);
      }
    }
    // Boats offshore: skiffs mostly, now and then the bigger centre-console boat.
    const spacing = SCATTER_SPACING_M.skiff / e.density;
    const ki = SCENERY_KINDS.indexOf('skiff');
    for (let k = 0; ; k++) {
      const s = (k + 0.15 + 0.7 * h(ki, k, side, 0)) * spacing;
      if (s > e.length) break;
      if (e.theme(side, s) !== 'water') continue;
      const kind: SceneryKind = h(ki, k, side, 4) < 0.75 ? 'skiff' : 'boat';
      const [near, spread] = ACROSS_M[kind];
      const d = side * (outer + near + spread * h(ki, k, side, 2));
      if (!e.openWater(s, d)) continue;
      const p = e.world(s, d, 0);
      const along = turnToward(p, e.world(Math.min(e.length, s + 1), d, 0));
      const turn = along + (h(ki, k, side, 3) - 0.5) * 1.4 + (h(ki, k, side, 8) < 0.5 ? Math.PI : 0);
      out.push({
        kind,
        variant: 0,
        p: { x: p.x, y: 0, z: p.z },
        turn,
        size: 1,
        phase: h(ki, k, side, 7) * Math.PI * 2,
        edge: e.edge,
        s,
        d,
      });
    }
  }
  return out;
}

/** Land scenery stands on the land strip, which sits this far under the road (road-mesh.ts). */
export const LAND_TOP_M = -0.09;

/** A boat's bob at time t: rise (m), roll and pitch (radians). [default] gentle swell. */
export function boatBob(t: number, phase: number): { rise: number; roll: number; pitch: number } {
  return {
    rise: 0.12 * Math.sin(t * 1.3 + phase),
    roll: 0.06 * Math.sin(t * 1.1 + phase * 1.7),
    pitch: 0.035 * Math.sin(t * 0.9 + phase * 0.6 + 1),
  };
}
