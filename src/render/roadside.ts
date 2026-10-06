// Roadside density (run W-P, "fill the world"; the maintainer, 2026-10-01b: "the worlds just feel
// very empty", roadside density close to the road "so speed is felt", and "unique regional flavor
// everywhere, like NW tree species, SF AI stuff"). Each region has a kit of small props (a Blender
// GLB, tools/blender/props/<region>_roadside.py) and rules for where they stand: ferns, fences,
// mailboxes and espresso huts in the Pacific Northwest, and so on. This module scatters them on
// the land the road scene drew (seeded, never on a road, a bridge or the water) and draws them.
//
// Drawing (the phone's budget: about 50 draws for the whole scene): the props of one 110 m stretch
// are merged into ONE vertex-coloured mesh, built when the camera comes near and freed when it has
// gone, so the layer costs a draw call per nearby stretch, however many props it holds. Past
// ROADSIDE_NEAR_M a stretch drops its understory, and past ROADSIDE_MID_M its middling props too
// (trees, huts and fences stay): each level is a prefix of its vertex buffer, so the far triangles
// drop without a second mesh. Past ROADSIDE_MID_M the props that stay draw as their far stand-ins
// (run W-S, scenery-merge.ts), kept in the same buffer. It is a lazy chunk: a race loads it with its region's models, and
// the first load never pays for it.
//
// Playtest 3 (T12.1; the wave-B punch list: Duval "with no Old Town shopfronts"): a rule may draw
// from another model than the kit's (`model`), and may stand its buildings end to end as a street
// front (`Frontage`). Key West's Old Town does both with Codex CX2's Duval kit; a stretch holding
// them draws with the Keys atlas as its map, still one mesh, and past ROADSIDE_FRONT_M its fronts
// draw as their far stand-ins.
import {
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  Matrix4,
  Mesh,
  Quaternion,
  Vector3,
  type Texture,
} from 'three';
import type { RoadNetwork } from '../road';
import type { Point3 } from './geometry';
import type { LookStyle } from './look';
import type { SceneryModel } from './models';
import type { RoadDressing } from './road-mesh';
import { formsOf, writeUv, type FlatForm } from './scenery-merge';
import { placeSurface, type PlacedSurface } from './text-surfaces';
import {
  BLUFF_LAND_M,
  LAKE_LAND_M,
  LAND_TOP_M,
  ridableBandPast,
  scatterHash,
  themeAt,
  type LandTheme,
  type ScenerySpot,
  type SideTag,
} from './scenery';

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
  /**
   * With `face`: turns its back to the road instead, its +Z away from it (playtest 4, P4-19, B9: a madrone
   * on a bluff leans out over the water, which its model does toward +Z).
   */
  away?: boolean;
  /** A run of sections laid end to end along the road (a fence): [min, max] sections, its length. */
  run?: readonly [number, number, number];
  /** Scale range (uniform). */
  size?: readonly [number, number];
  /**
   * Its level of detail: 0 (trees, buildings, fences) draws out to ROADSIDE_DRAW_M, 1 (default:
   * mailboxes, stumps) to ROADSIDE_MID_M, 2 (the understory) to ROADSIDE_NEAR_M.
   */
  tier?: 0 | 1 | 2;
  /** Stands among the trees (ferns and salal grow under the forest canopy). */
  understory?: boolean;
  /** A tree: its ground counts as canopy, so the understory may grow under it. */
  canopy?: boolean;
  /** Stands on the row houses' plots, exactly (no jitter): in the gaps a terrace leaves. */
  align?: boolean;
  /**
   * Stands only where one of these district tags covers that side (run W-Q's distinct keys: a
   * `key-fishing` stretch is the fishing village), and never where one of `notDistrict` does.
   */
  district?: readonly string[];
  notDistrict?: readonly string[];
  /**
   * Stands only this far along a road from its start, m (playtest 4, P4-19, B5: the Key deer stand after the
   * sign that warns of them, which is the first thing on Big Pine Bend). Default: from the start.
   */
  fromS?: number;
  /**
   * Its clear-ground disc (radius `r`) sits this far behind the anchor, m: for a big building or a
   * boat whose body reaches back from its front, the disc covers the body, not the kerb before it.
   */
  discBack?: number;
  /**
   * The model it draws from, when not the kit's own (playtest 3, T12.1: Key West's Old Town draws
   * from the Duval kit, `duvalKit`). Its props are left out when that model has not loaded.
   */
  model?: string;
  /** A street front: buildings stood end to end along the road instead of scattered (see `Frontage`). */
  frontage?: Frontage;
  /**
   * Runs before the kit's other rules, so it claims its ground first, without moving any rule's place in
   * the list: a rule's random stream follows its index, so a rule added at the end leaves every other
   * rule's props where they were (playtest 4, P4-19: Old Town's open bars).
   */
  first?: boolean;
  /**
   * A run section whose body is solid (playtest 4, P4-19, C4: a sandstone cut, 6 m long and 3 m deep): its
   * clear ground covers its length and depth, not only its anchor, so nothing later stands inside the rock.
   */
  body?: boolean;
  /**
   * Stands only where its land theme covers its whole length, both ends too, not only its middle (playtest
   * 4, P4-19, C4: a parapet section half past the bluff's end would stand in the forest's ridable band).
   */
  whole?: boolean;
  /**
   * A low prop (playtest 4, P4-19, C4: a parapet, a boulder, the lip of a bluff): it stands under a tree's crown,
   * so a canopy's clear-ground disc does not keep it off, as it does not keep off the understory.
   */
  low?: boolean;
  /**
   * Stands at the water's level, not the land's (playtest 4, P4-19, C4: a dock's root is at the shore at the
   * waterline): its anchor's height is the water under it (`RoadsideInput.waterAt`), at most `BANK_MAX_M`
   * below the land. No water there, or not yet known: it is not placed.
   */
  waterline?: boolean;
}

/** A `waterline` prop stands no more than this far below the land at its anchor, m (a dock under a low bank). [default] */
export const BANK_MAX_M = 6;

/**
 * A street front (playtest 3, T12.1; the wave-B punch list: Duval "with no Old Town shopfronts"): the
 * rule's buildings stood end to end along each side, each by its own width and depth (its model's
 * bounding box), their facades on one line `across[0]` m past the verge band's outer edge (the
 * sidewalk's, for a street; playtest 4, P4-19), facing the road, so a balcony hangs out over the
 * pavement. A building that does not fit (a feature, a landmark, a tree, another road, too little land,
 * or a pedestrian zone behind its facade; a crowd may stand under a balcony) is skipped and the next
 * tried a few metres on; now and then a lot is left empty.
 */
export interface Frontage {
  /** The gap between neighbours, [min, max] m. */
  gap: readonly [number, number];
  /** The share of plots left as an empty lot, and the lot's length, m. */
  lotRate: number;
  lotM: number;
}

/** A street front tries the next building this far on when one does not fit, m. [default] */
const FRONTAGE_STEP_M = 3;

/** Whether one of these tags covers that side of the road at s (a district tag says nothing about the ground). */
export function inDistrict(
  tags: readonly SideTag[] | undefined,
  side: 'left' | 'right',
  s: number,
  names: readonly string[],
): boolean {
  return (tags ?? []).some(
    (t) =>
      names.includes(t.tag) &&
      s >= t.s0 &&
      s <= t.s1 &&
      (t.side === undefined || t.side === 'both' || t.side === side),
  );
}

export interface RoadsideKit {
  id: 'pnw' | 'sf' | 'keys';
  rules: readonly RoadsideRule[];
}

const FOREST: readonly LandTheme[] = ['forest', 'sawmill'];
const TOWN: readonly LandTheme[] = ['commercial'];
const WOODS_AND_TOWN: readonly LandTheme[] = [...FOREST, ...TOWN];

/** A rule, compactly: its id, variants, themes, spacing, rate, offset and radius, then the rest. */
const rule = (
  id: string,
  v: readonly number[],
  on: readonly LandTheme[],
  every: number,
  rate: number,
  across: readonly [number, number],
  r: number,
  more: Partial<RoadsideRule> = {},
): RoadsideRule => ({ id, v, on, every, rate, across, r, ...more });

/** Turned to face the road, in the far level of detail. */
const BIG = { face: true, tier: 0 } as const;
/** A fence section laid in runs along the road. */
const FENCE = { along: 3, face: true, tier: 0 } as const;
/** Ferns and bushes: they grow under the trees and fade first. */
const UNDER = { understory: true, tier: 2 } as const;
/** A section of Chuckanut's rock or wall (playtest 4, P4-19, C4): from the shore kit, facing the road, laid exactly. */
const ROCK = { model: 'pnwShore', face: true, tier: 0, align: true, whole: true, low: true } as const;

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
    rule('espresso', [9], FOREST, 1100, 0.7, [4, 3], 2.6, { ...BIG, back: 1.6, along: 2.1 }),
    rule('espresso-town', [9], TOWN, 260, 0.8, [3.5, 3], 2.6, { ...BIG, back: 1.6, along: 2.1 }),
    rule('firewood', [5], WOODS_AND_TOWN, 120, 0.55, [3, 4], 1.6, { ...BIG, back: 0.6, along: 1.4 }),
    rule('sign', [8], WOODS_AND_TOWN, 300, 0.7, [0.5, 0.4], 0.8, BIG),
    rule('mailbox', [4], WOODS_AND_TOWN, 70, 0.6, [0.5, 0.3], 0.7, { face: true }),
    rule('split-rail', [6], WOODS_AND_TOWN, 110, 0.6, [1.4, 1.2], 0.4, { ...FENCE, run: [4, 14, 6] }),
    rule('log-fence', [7], FOREST, 170, 0.5, [1.6, 1.5], 0.4, { ...FENCE, run: [3, 10, 6] }),
    rule('broadleaf', [10, 11, 11], WOODS_AND_TOWN, 24, 0.6, [3, 11], 2.2, {
      size: [0.8, 1.15],
      tier: 0,
      canopy: true,
    }),
    rule('stump', [2, 3], FOREST, 18, 0.75, [1, 9], 0.9),
    // The verge: a dense band of fern and salal within 2 m of it, the near parallax at speed.
    rule('verge', [0, 0, 1], WOODS_AND_TOWN, 3.8, 0.75, [0.3, 1.8], 0.45, { ...UNDER, size: [0.75, 1.2] }),
    rule('salal', [1], FOREST, 12, 0.7, [2.4, 7], 0.8, { ...UNDER, size: [0.8, 1.3] }),
    rule('fern', [0], FOREST, 6, 0.85, [2.2, 9], 0.6, { ...UNDER, size: [0.8, 1.35] }),
    // Playtest 4 (P4-19, B9; the maintainer: "The real roads do not have the characteristics of the roads in
    // question in terms of scenery and feel"). Codex CX5's identity kit (`pnwIdentity`: 0 and 1 a madrone,
    // 2 a 6 m section of masonry guard wall), on the two side runs the bake config names (`sideRuns`, found
    // from the ground either side, tbgis/drops.py). The Historic Columbia River Highway's dry-masonry guard
    // wall stands end to end along the side where the ground falls away (`guard-wall`), at the verge's
    // outer edge, where a rider is stopped; Chuckanut Drive's madrones stand over its bay side
    // (`bay-bluff`) with their crowns leaning out over the water, their backs to the road. Both claim their
    // ground first, without moving any other rule's place in the list.
    rule('gorge-wall', [2], FOREST, 6, 1, [0.3, 0], 0.4, {
      ...FENCE,
      run: [1, 1, 6],
      align: true,
      district: ['guard-wall'],
      model: 'pnwIdentity',
      first: true,
    }),
    // Since C4 (playtest 4, P4-19) the madrones stand on Chuckanut's `bluff` shelf too, between the parapet and
    // the drop, where the bay-side runs and the bluff meet.
    rule('madrone', [0, 1], [...FOREST, 'bluff'], 22, 0.7, [1.5, 6], 2, {
      face: true,
      away: true,
      tier: 0,
      canopy: true,
      size: [0.85, 1.2],
      district: ['bay-bluff'],
      model: 'pnwIdentity',
      first: true,
    }),
    // Playtest 4 (P4-19, C4; the identity sheets' H1, H2 and I3; Codex CX6's `pnw-shore` kit, models.ts
    // `pnwShore`: 0 and 1 the cuts, 2 the parapet, 3 the bluff, 4 and 5 the boulders, 6 the cabin, 7 the
    // dock). Last in the list, so no other rule's seeded placements move. Each section lays end to end in a
    // run that follows the road's grade, as a fence's. Chuckanut's bay side (`bluff`): the low parapet all
    // along the shelf, its face on the 4 m band's hard edge (road/cross-section.ts), under the madrones'
    // crowns (`low`); and the 20 m bluff sections, their lip at the drop's edge, the rock falling 40 m away
    // from the road.
    rule('parapet', [2], ['bluff'], 36, 1, [0, 0], 0.1, { ...ROCK, run: [6, 6, 6], along: 3, back: 0.55 }),
    rule('bluff', [3], ['bluff'], 60, 1, [BLUFF_LAND_M, 0], 0.1, {
      ...ROCK,
      run: [3, 3, 20],
      along: 10,
      back: 0,
    }),
    // Its uphill side (`cut`): bedded sandstone at the forest band's edge, low and tall cuts in runs of 24 to
    // 36 m, the firs behind them (scenery.ts THEME_NEAR_M); boulders fallen at the foot between the runs.
    rule('rock-cut', [0, 0, 1], ['cut'], 48, 0.9, [0, 0], 0.3, {
      ...ROCK,
      run: [4, 6, 6],
      along: 3,
      back: 3,
      body: true,
    }),
    rule('boulder', [4, 5], ['cut'], 14, 0.5, [0, 1.5], 1.4, {
      model: 'pnwShore',
      tier: 1,
      low: true,
      size: [0.8, 1.2],
    }),
    // Lake Samish's shore (`lake`): a cabin now and then, its porch to the road and its deck to the water,
    // and a dock whose root is at the shore at the water's level, out over the lake (`waterline`).
    rule('lake-cabin', [6], ['lake'], 40, 0.6, [6, 2], 4.6, {
      model: 'pnwShore',
      ...BIG,
      back: 11,
      along: 4.5,
      discBack: 4.5,
      whole: true,
    }),
    rule('lake-dock', [7], ['lake'], 30, 0.55, [LAKE_LAND_M, 0], 1.2, {
      model: 'pnwShore',
      ...BIG,
      along: 2.5,
      back: 0,
      waterline: true,
      whole: true,
    }),
  ],
};

const CITY: readonly LandTheme[] = ['urban'];
const CITY_AND_DOCKS: readonly LandTheme[] = ['urban', 'industrial'];

/**
 * San Francisco (the maintainer: "SF AI stuff"; the amendment's list): cars parked nose to the kerb
 * in the gaps a terrace leaves, one of them a driverless taxi with a cone on its bonnet, street
 * trees in their sidewalk cut-outs, hydrants, rental scooters dropped on the pavement, A-frame
 * boards selling AI, AGI and GPUs, a corner store now and then, parking meters on the house plots,
 * the blue, green and black bins out on collection day, and street lamps. The kit's variants: 0
 * sedan, 1 hatch, 2 robotaxi, 3 street tree, 4 hydrant, 5 scooter, 6 to 8 the boards, 9 corner
 * store, 10 parking meter, 11 bins, 12 street lamp. The
 * row houses' plots are 7 m apart (scenery.ts), so the plot-bound props use the same spacing.
 */
export const SF_KIT: RoadsideKit = {
  id: 'sf',
  rules: [
    rule('store', [9], CITY, 7, 0.12, [2.6, 0], 3.2, { ...BIG, back: 10, along: 3.4, align: true }),
    rule('parked', [0, 0, 1, 1, 2], CITY_AND_DOCKS, 7, 0.5, [2.6, 0.3], 2.1, {
      ...BIG,
      back: 2.2,
      along: 0.9,
      align: true,
    }),
    rule('street-tree', [3], CITY, 13, 0.75, [0.55, 0.2], 0.45, { tier: 0, canopy: true }),
    rule('board', [6, 7, 8], CITY, 110, 0.65, [0.6, 0.5], 0.7, { face: true }),
    rule('lamp', [12], CITY_AND_DOCKS, 32, 0.85, [0.25, 0], 0.4, BIG),
    // A meter on most house plots: the kerb's beat at speed.
    rule('meter', [10], CITY, 7, 0.6, [0.3, 0], 0.25, { face: true, align: true }),
    rule('bins', [11], CITY, 40, 0.5, [0.7, 0.3], 1.0, { face: true }),
    rule('hydrant', [4], CITY_AND_DOCKS, 55, 0.7, [0.35, 0.2], 0.35),
    rule('scooter', [5], CITY_AND_DOCKS, 30, 0.55, [0.4, 0.8], 0.75, { tier: 2 }),
  ],
};

const KEYS_TOWN: readonly LandTheme[] = ['commercial'];
const SHORE: readonly LandTheme[] = ['palms', 'beach'];
const KEYS_LAND: readonly LandTheme[] = ['palms', 'beach', 'mangrove', 'commercial'];

/**
 * The Florida Keys ("likewise local"): sea grape crowding the verge and gone to tree among the
 * palms, pastel conch cottages up on piers behind white picket fences, mailboxes with a fish on
 * top, lobster traps stacked with their buoys, skiffs on their trailers, a pelican on a piling,
 * BAIT ICE boards and a key lime pie stand. The kit's variants: 0 sea grape, 1 sea grape tree,
 * 2 traps, 3 pelican, 4 trailer, 5 and 6 cottages, 7 picket fence section, 8 mailbox, 9 bait board,
 * 10 pie stand. The Keys' own palms, mangroves, shacks and boats stay as they were.
 *
 * Run W-Q, distinct keys (interview, 2026-10-02: "KEYS FIRST = DISTINCT KEYS", a fishing village,
 * a resort strip, a junkyard key and a party key "each with its own look"). A road's district tag
 * (`key-fishing`, `key-resort`, `key-junkyard`, `key-party`) picks each key's own props, and the
 * conch-town props stay out of the keys they do not belong in. Variants: 11 shrimp boat on blocks,
 * 12 fish house, 13 buoy line; 14 and 15 pastel hotels, 16 pool deck, 17 tiki bar, 18 rental
 * scooters; 19 boat rack, 20 bus stack, 21 junk-art robot; 22 bunting, 23 coolers, 24 the closed
 * bar, 25 a deflated pool flamingo.
 */
const FISHING = ['key-fishing'];
const RESORT = ['key-resort'];
const JUNKYARD = ['key-junkyard'];
const PARTY = ['key-party'];
// Run W-U: Unlisted Key, the secret island off the sandbar: a tiki bar nobody has found, its coolers
// and a flamingo, and none of the conch town's cottages, pickets, mailboxes or pie.
const SECRET = ['key-secret'];
// Playtest 3 (T12.1): Key West's Old Town (Duval and Whitehead Streets). Its street front comes from
// the Duval kit (models.ts `duvalKit`): balconied shopfronts, conch houses and the corner bar, with
// planters and scooter racks on the sidewalk; no trailers, traps, pelicans or bait boards there.
// Playtest 4 (P4-19; the maintainer: "The real roads do not have the characteristics of the roads in
// question in terms of scenery and feel"): it is a street, the `oldtown` theme (scenery.ts) and a 4 m
// sidewalk (road/cross-section.ts): the fronts stand on the sidewalk's edge with their balconies over it,
// and the scatter's palms, bait shacks and power poles are gone. Codex CX5's identity kit
// (`keysIdentity`) adds an open-fronted bar among the shops and the Old Town's own trees: frangipanis on
// the sidewalk, royal poincianas and banyans in the yards behind the row.
const OLDTOWN = ['key-oldtown'];
const OLDTOWN_LAND: readonly LandTheme[] = ['oldtown'];
/** Keys where mailboxes do not stand (the hotels, the junk, the party). */
const NOT_TOWN = [...RESORT, ...JUNKYARD, ...PARTY, ...SECRET];
/** Every key with its own look: conch cottages and their pickets stand only in the conch town. */
const ANY_KEY = [...FISHING, ...NOT_TOWN];
const TOWN_AND_SHORE: readonly LandTheme[] = [...KEYS_TOWN, ...SHORE];

export const KEYS_KIT: RoadsideKit = {
  id: 'keys',
  rules: [
    // Old Town's street front first (playtest 3, T12.1), its facades on the sidewalk's edge (playtest 4,
    // P4-19; `across[0]` is past the verge band): the Duval kit's variants 0 to 2 are balconied shopfronts,
    // 3 and 4 conch houses, 5 the corner bar; the sidewalk's planters and scooter racks. The Old Town's open
    // bars and trees follow the kit's last rule below (a rule's place in this list is its random stream).
    rule('oldtown-front', [0, 0, 1, 1, 2, 2, 3, 4, 5], OLDTOWN_LAND, 0, 1, [0.3, 0], 0, {
      model: 'duvalKit',
      frontage: { gap: [0.6, 3], lotRate: 0.08, lotM: 9 },
      district: OLDTOWN,
      face: true,
      tier: 0,
    }),
    // The sidewalk's furniture: within its 4 m (it spans 0 to 3.4 m past the drawn verge).
    rule('oldtown-planter', [7], OLDTOWN_LAND, 22, 0.55, [1.4, 0.8], 1.3, {
      model: 'duvalKit',
      district: OLDTOWN,
      tier: 1,
    }),
    rule('oldtown-scooters', [6], OLDTOWN_LAND, 40, 0.5, [1.2, 0.6], 0.9, {
      model: 'duvalKit',
      district: OLDTOWN,
      face: true,
      along: 2.1,
      tier: 2,
    }),
    // Each key's big pieces first: they claim their ground before the clutter. Their clear-ground
    // disc covers the body behind the front (`discBack`), and the hotels stand back behind the
    // power poles with a lot before them.
    rule('hotel', [14, 15], TOWN_AND_SHORE, 30, 0.85, [5.5, 3], 7.6, {
      ...BIG,
      back: 8.4,
      along: 7.3,
      discBack: 4,
      district: RESORT,
    }),
    rule('bus-stack', [20], KEYS_LAND, 60, 0.8, [3.5, 4], 6.3, {
      ...BIG,
      back: 2.6,
      along: 6.5,
      discBack: 1.3,
      district: JUNKYARD,
    }),
    rule('fish-house', [12], TOWN_AND_SHORE, 110, 0.85, [4, 3], 5.6, {
      ...BIG,
      back: 5.5,
      along: 5.3,
      discBack: 2.4,
      district: FISHING,
    }),
    rule('shrimp-boat', [11], TOWN_AND_SHORE, 90, 0.8, [4, 4], 6, {
      ...BIG,
      back: 4.3,
      along: 6,
      discBack: 2,
      district: FISHING,
    }),
    rule('closed-bar', [24], KEYS_LAND, 260, 1, [2, 2], 4, {
      ...BIG,
      back: 4.5,
      along: 3.5,
      discBack: 1.4,
      district: PARTY,
    }),
    rule('pool', [16], TOWN_AND_SHORE, 45, 0.7, [3, 3], 5.2, {
      ...BIG,
      back: 5.7,
      along: 5,
      discBack: 2.8,
      district: RESORT,
    }),
    rule('tiki', [17], TOWN_AND_SHORE, 150, 0.9, [1.5, 2], 2.8, {
      ...BIG,
      back: 3.6,
      along: 2.2,
      discBack: 1.4,
      district: [...RESORT, ...SECRET],
    }),
    rule('boat-stack', [19], KEYS_LAND, 30, 0.75, [2.5, 6], 3.4, {
      ...BIG,
      back: 2.1,
      along: 3.3,
      discBack: 1,
      district: JUNKYARD,
    }),
    rule('junk-art', [21], KEYS_LAND, 90, 0.9, [1.2, 2], 1.4, {
      ...BIG,
      back: 1.1,
      along: 1.3,
      district: JUNKYARD,
    }),
    rule('bunting', [22], KEYS_LAND, 45, 0.75, [0.8, 0.6], 0.4, {
      along: 3,
      face: true,
      tier: 0,
      run: [2, 4, 6],
      district: PARTY,
    }),
    rule('buoy-line', [13], TOWN_AND_SHORE, 65, 0.6, [0.8, 1.5], 0.8, {
      along: 2.1,
      face: true,
      tier: 0,
      district: FISHING,
    }),
    rule('scooters', [18], TOWN_AND_SHORE, 50, 0.6, [0.6, 0.8], 1.6, {
      face: true,
      along: 4.3,
      district: RESORT,
    }),
    rule('coolers', [23], KEYS_LAND, 24, 0.6, [0.8, 4], 1.5, { face: true, district: [...PARTY, ...SECRET] }),
    rule('flamingo', [25], KEYS_LAND, 70, 0.6, [1, 6], 1.6, { district: [...PARTY, ...SECRET] }),
    rule('traps-village', [2], TOWN_AND_SHORE, 26, 0.6, [1.2, 5], 1.1, { face: true, district: FISHING }),
    // The conch town's and the whole Keys' props (run W-P).
    rule('cottage', [5, 6], KEYS_TOWN, 18, 0.55, [6, 3], 3.4, {
      ...BIG,
      back: 7.5,
      along: 3.2,
      notDistrict: ANY_KEY,
    }),
    rule('pie', [10], TOWN_AND_SHORE, 600, 0.7, [1.2, 1], 1.6, {
      ...BIG,
      back: 0.8,
      along: 1.4,
      notDistrict: [...JUNKYARD, ...PARTY, ...SECRET],
    }),
    rule('bait', [9], [...KEYS_TOWN, 'beach'], 160, 0.7, [0.5, 0.5], 1.2, {
      ...BIG,
      along: 1.1,
      notDistrict: OLDTOWN,
    }),
    rule('picket', [7], KEYS_TOWN, 60, 0.5, [2.4, 0.4], 0.3, {
      along: 2,
      face: true,
      tier: 0,
      run: [2, 6, 4],
      notDistrict: ANY_KEY,
    }),
    rule('trailer', [4], KEYS_LAND, 120, 0.45, [3, 4], 2.4, {
      ...BIG,
      back: 2.6,
      along: 0.9,
      notDistrict: OLDTOWN,
    }),
    rule('pelican', [3], [...SHORE, 'mangrove'], 90, 0.5, [10, 10], 0.6, { tier: 0, notDistrict: OLDTOWN }),
    rule('seagrape-tree', [1], [...SHORE, ...KEYS_TOWN], 25, 0.6, [3, 8], 1.8, { tier: 0, canopy: true }),
    rule('traps', [2], TOWN_AND_SHORE, 70, 0.5, [1.5, 4], 1.1, {
      face: true,
      notDistrict: [...RESORT, ...PARTY, ...OLDTOWN],
    }),
    rule('mailbox', [8], KEYS_TOWN, 30, 0.6, [0.6, 0.3], 0.5, { face: true, notDistrict: NOT_TOWN }),
    // The verge: sea grape crowding the road's edge, the near parallax at speed.
    rule('seagrape', [0], KEYS_LAND, 6, 0.7, [0.4, 2.5], 0.9, { ...UNDER, size: [0.8, 1.3] }),
    // Playtest 4, P4-19 (Codex CX5's identity kit: variants 3 a banyan, 4 a royal poinciana, 5 a frangipani,
    // 6 and 7 two open-fronted bars). The open bars claim their ground before the street front does
    // (`first`), a long way apart, and stand on the sidewalk's edge like the shops around them.
    rule('oldtown-bar', [6, 7], OLDTOWN_LAND, 0, 1, [0.3, 0], 0, {
      model: 'keysIdentity',
      frontage: { gap: [70, 150], lotRate: 0, lotM: 0 },
      district: OLDTOWN,
      face: true,
      tier: 0,
      first: true,
    }),
    // A frangipani on the sidewalk now and then.
    rule('oldtown-frangipani', [5], OLDTOWN_LAND, 26, 0.6, [1.1, 0.5], 1.1, {
      model: 'keysIdentity',
      district: OLDTOWN,
      size: [0.85, 1.15],
      tier: 0,
      canopy: true,
    }),
    // The yards behind the row: a royal poinciana and a banyan now and then, their crowns over the roofs
    // (the banyan is 12 m high and 17 m across). Behind the front's deepest building (about 12 m past the
    // drawn verge) so no trunk stands in a shop.
    rule('oldtown-poinciana', [4], OLDTOWN_LAND, 52, 0.55, [14.5, 3], 3.2, {
      model: 'keysIdentity',
      district: OLDTOWN,
      size: [0.85, 1.15],
      tier: 0,
      canopy: true,
    }),
    rule('oldtown-banyan', [3], OLDTOWN_LAND, 90, 0.6, [15.5, 3], 3.4, {
      model: 'keysIdentity',
      district: OLDTOWN,
      size: [0.9, 1.1],
      tier: 0,
      canopy: true,
    }),
    // Playtest 4, P4-19 (the identity study's S5; Codex CX6's `keys_osprey_post`, variant 8): ospreys nest on
    // the poles beside the Overseas Highway. A 9 m pole with a stick nest and the bird on it stands on the
    // shore and mangrove sides, a few metres past the verge, one now and then (every 420 m at half the
    // chances, so a territory apart), and never on a street: not in Old Town (the `oldtown` theme is not one
    // it stands on, and the district is kept out as well). The kit file loads only where open water is
    // (models.ts `modelKindsFor`).
    rule('osprey-post', [8], [...SHORE, 'mangrove'], 420, 0.5, [3, 6], 2, {
      model: 'keysIdentity',
      notDistrict: OLDTOWN,
      tier: 0,
    }),
    // Playtest 4 (P4-19, B5; the identity sheets' B2): Big Pine's Key deer, CX5's buck and doe (models.ts
    // `keysIdentity`, variant 0 the buck and 1 the doe, mostly does), grazing the verges of the road tagged
    // `key-deer`, past the sign that warns of them (`fromS`), each facing its own way. Last in the list, so
    // adding it moves no other rule's seeded placements.
    rule('key-deer', [0, 1, 1], KEYS_LAND, 38, 0.65, [1.4, 3.5], 0.9, {
      model: 'keysIdentity',
      district: ['key-deer'],
      fromS: 40,
      size: [0.95, 1.1],
    }),
  ],
};

/**
 * The kit a race draws: the one its network's own needs name (models.ts `modelKindsFor`), once its
 * model has loaded, and never another region's. Models stay loaded across regions, and the menu's
 * Keys road loads the Keys kit before any race (run W-P: a PNW race once drew the Keys kit).
 */
export function kitFor(needed: readonly string[], loaded: Readonly<Record<string, unknown>>): string | null {
  return needed.find((k) => k in KITS && !!loaded[k]) ?? null;
}

/** The kit a region's loaded model draws, by the model's kind. */
export const KITS: Readonly<Record<string, RoadsideKit>> = {
  pnwRoadside: PNW_KIT,
  sfRoadside: SF_KIT,
  keysRoadside: KEYS_KIT,
};

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
  tier: 0 | 1 | 2;
  /**
   * A street-front building's footprint (`Frontage`): half its width along the road, and how far it
   * reaches toward the road (its front, the balcony) and back from its anchor, m.
   */
  foot?: { half: number; front: number; back: number };
}

/**
 * Each merged mesh holds one stretch of one road, both sides, this long, m. [default] Stretches,
 * not squares: a view down a winding road meets a few stretches, but many squares.
 */
export const ROADSIDE_STRETCH_M = 110;
/** Roadside props farther than this from the camera are not drawn, m (never past sceneryDrawM). [default] */
export const ROADSIDE_DRAW_M = 200;
/** Past these a stretch drops its understory, then its middling props, m. [default] */
export const ROADSIDE_NEAR_M = 50;
export const ROADSIDE_MID_M = 120;
/**
 * Past this a street front (Old Town's buildings, `Frontage`) draws as its far stand-ins, m: a long
 * straight street shows hundreds of metres of fronts, and the full models only matter close by.
 * [default] (playtest 3, T12.1: Duval's busiest view, triangles held under the still scene's share)
 */
export const ROADSIDE_FRONT_M = 80;
/** A built stretch farther than this is freed, m. */
const ROADSIDE_KEEP_M = ROADSIDE_DRAW_M + 160;
/** Milliseconds a frame spent placing props while a race starts. [default] */
const SCATTER_MS_PER_FRAME = 3;
/** A stretch is built this far before it comes into range, one a frame, so no frame builds two. */
const ROADSIDE_PREFETCH_M = 80;
/** Features no prop stands in (as the scenery's KEEP_CLEAR), with room round them, m. */
const KEEP_CLEAR = new Set(['billboard', 'boostPad', 'rampTruck', 'roadsideZone', 'copSpawn']);
const FEATURE_CLEAR_M = 3;
/** How far past its verge another road's land may reach over a prop, m (its 24 m strip and more). */
const HIGHER_LAND_M = 40;
/** The road scene's land strip and skirt slope (road-mesh.ts SCENERY_LAND_M, SKIRT_RUN_PER_M). */
const LAND_STRIP_M = 24;
const SKIRT_RUN_PER_M = 2.2;
const VERGE_M = 0.6;
/**
 * The scenery's own footprints, as discs back from each anchor: a row house is two (front and back
 * of its 6.4 m by 11.5 m body), so a prop fits in a terrace's gap but never in a house.
 */
const SPOT_REACH: Partial<Record<ScenerySpot['kind'], readonly { r: number; back: number }[]>> = {
  house: [
    { r: 3.3, back: 2.8 },
    { r: 3.3, back: 8.4 },
  ],
  sawmill: [{ r: 16, back: 8.5 }],
  shack: [{ r: 3.8, back: 0 }],
  conifer: [{ r: 1.2, back: 0 }],
  palm: [{ r: 1, back: 0 }],
  mangrove: [{ r: 2.5, back: 0 }],
  pole: [{ r: 0.8, back: 0 }],
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
  /** Ground already taken by the staged roadside scenes (run W-T): discs, world m. */
  reserved?: readonly { x: number; z: number; r: number }[];
  /**
   * The loaded models by kind, for rules that draw from a model other than the kit's (`model`:
   * Old Town's Duval kit). A rule whose model is missing places nothing.
   */
  models?: Readonly<Partial<Record<string, SceneryModel>>>;
  /**
   * The level of the network's own water over a world point, m, or null (playtest 4, P4-19, C4: Lake
   * Samish, from its backdrop's water floor, backdrop/water.ts). A `waterline` rule places nothing without it.
   */
  waterAt?: (x: number, z: number) => number | null;
}

/** A grid of discs, for keeping props apart. Discs over 8 m (the sawmill) are kept in a list. */
class Discs {
  private readonly cells = new Map<string, { x: number; z: number; r: number; under: boolean }[]>();
  private readonly big: { x: number; z: number; r: number; under: boolean }[] = [];
  private static readonly CELL = 8;

  add(x: number, z: number, r: number, under = false) {
    const disc = { x, z, r, under };
    if (r > Discs.CELL) {
      this.big.push(disc);
      return;
    }
    const k = `${Math.floor(x / Discs.CELL)},${Math.floor(z / Discs.CELL)}`;
    const list = this.cells.get(k);
    if (list) list.push(disc);
    else this.cells.set(k, [disc]);
  }

  /** Whether a disc of radius r at (x, z) overlaps any (understory props ignore trees' discs). */
  hits(x: number, z: number, r: number, understory: boolean): boolean {
    const hit = (d: { x: number; z: number; r: number; under: boolean }) =>
      !(understory && d.under) && (d.x - x) ** 2 + (d.z - z) ** 2 < (d.r + r) ** 2;
    if (this.big.some(hit)) return true;
    const reach = Math.ceil((r + Discs.CELL) / Discs.CELL);
    const ci = Math.floor(x / Discs.CELL);
    const cj = Math.floor(z / Discs.CELL);
    for (let i = ci - reach; i <= ci + reach; i++)
      for (let j = cj - reach; j <= cj + reach; j++) {
        const list = this.cells.get(`${i},${j}`);
        if (list?.some(hit)) return true;
      }
    return false;
  }
}

interface RoadPoint {
  edge: number;
  s: number;
  x: number;
  z: number;
  y: number;
  /** Half the road's drawn width, verges included, m. */
  half: number;
}

/**
 * Every road's centre line, sampled into a grid, for two questions a prop asks of the roads round
 * it: does another road (or this road further along, round a loop) lie under it, and does one stand
 * higher close by, with its own land over it (a stacked loop, a spur on the hill above)? Another
 * road's land is its strip (24 m past its verge) at its own height, then its skirt sloping down
 * 1 m per 2.2 m out (road-mesh.ts). Each edge also keeps, every few metres, whether any higher
 * road is near at all, so most spots skip the wide search.
 */
class RoadGrid {
  private readonly cells = new Map<string, RoadPoint[]>();
  private readonly stacked: { step: number; near: boolean[] }[] = [];
  private static readonly CELL = 16;
  private static readonly STACK_STEP_M = 8;

  constructor(road: RoadNetwork) {
    for (const e of road.edges) {
      const half = Math.max(-e.dMin, e.dMax) + VERGE_M;
      for (let i = 0; i < e.count; i++) {
        const pt = { edge: e.index, s: i * e.spacing, x: e.x[i] ?? 0, z: e.z[i] ?? 0, y: e.y[i] ?? 0, half };
        const key = `${Math.floor(pt.x / RoadGrid.CELL)},${Math.floor(pt.z / RoadGrid.CELL)}`;
        const list = this.cells.get(key);
        if (list) list.push(pt);
        else this.cells.set(key, [pt]);
      }
    }
    for (const e of road.edges) {
      const near: boolean[] = [];
      for (let s = 0; s <= e.length + RoadGrid.STACK_STEP_M; s += RoadGrid.STACK_STEP_M) {
        const c = road.toWorld(e.index, Math.min(s, e.length), 0, 0);
        // Any other road point within reach and not far below this road here (props stand near
        // its height, and only a road above them can lay land over them).
        near.push(
          this.some(c.x, c.z, HIGHER_LAND_M + 40, (p) => !this.same(p, e.index, s, 60) && p.y > c.y - 30),
        );
      }
      this.stacked[e.index] = { step: RoadGrid.STACK_STEP_M, near };
    }
  }

  private same(p: RoadPoint, edge: number, s: number, m: number) {
    return p.edge === edge && Math.abs(p.s - s) < m;
  }

  private some(x: number, z: number, reachM: number, test: (p: RoadPoint) => boolean): boolean {
    const reach = Math.ceil(reachM / RoadGrid.CELL);
    const ci = Math.floor(x / RoadGrid.CELL);
    const cj = Math.floor(z / RoadGrid.CELL);
    for (let i = ci - reach; i <= ci + reach; i++)
      for (let j = cj - reach; j <= cj + reach; j++) {
        const list = this.cells.get(`${i},${j}`);
        if (list?.some(test)) return true;
      }
    return false;
  }

  /** Whether another road's surface or verges lie within r of (x, z) (this road's own loops too). */
  roadUnder(edge: number, s: number, x: number, z: number, r: number): boolean {
    return this.some(
      x,
      z,
      12,
      (p) => !this.same(p, edge, s, 40) && Math.hypot(p.x - x, p.z - z) < p.half + r + 1,
    );
  }

  /** Whether some road's land lies above (x, y, z): another road, or this one further along. */
  landOver(edge: number, s: number, x: number, z: number, y: number): boolean {
    const st = this.stacked[edge];
    const i = st ? Math.round(s / st.step) : 0;
    if (st && !st.near[i] && !st.near[i - 1] && !st.near[i + 1]) return false;
    return this.some(x, z, HIGHER_LAND_M + 8, (p) => {
      if (this.same(p, edge, s, HIGHER_LAND_M + 20)) return false;
      const past = Math.hypot(p.x - x, p.z - z) - p.half;
      if (past > HIGHER_LAND_M + 8) return false;
      // Its ground over this spot: level across its strip, then down its skirt.
      return p.y - Math.max(0, past - LAND_STRIP_M) / SKIRT_RUN_PER_M > y + 0.25;
    });
  }
}

/**
 * Scatters a kit along every edge: seeded, on drawn land, clear of everything else. It works in
 * small units (one rule on one side of one road), so a layer can spread the work over the first
 * frames of a race (RoadsideLayer.update) instead of stalling one; the units run in a fixed order,
 * so the props are the same however the work is sliced.
 */
export class RoadsideScatter {
  readonly items: RoadsideItem[] = [];
  private readonly roads: RoadGrid;
  private readonly taken = new Discs();
  private edge = 0;
  private unit = 0;
  /** The order the rules run in: the `first` ones, then the rest, each in list order (the index is the rule's stream). */
  private readonly order: number[];
  private readonly density: number;
  /**
   * The painted split zones (road-mesh.ts), by edge. One may reach past its road's edge onto the
   * verge (I-5's Lake Samish turn-off paints 1 m of it), and no prop stands in the paint (the
   * geometry sweep, tests/sim/geometry-scenery.ts, found verge grass standing in it, 12 places
   * over its 24 seeds).
   */
  private readonly zones = new Map<number, { s0: number; s1: number; lo: number; hi: number }[]>();

  constructor(private readonly input: RoadsideInput) {
    const { road } = input;
    this.density = Math.max(0, input.density);
    this.order = input.kit.rules
      .map((_, i) => i)
      .sort((a, b) => Number(!!input.kit.rules[b]?.first) - Number(!!input.kit.rules[a]?.first) || a - b);
    this.roads = new RoadGrid(road);
    for (const z of road.splitZones()) {
      const list = this.zones.get(z.edge) ?? [];
      list.push({ s0: z.s0, s1: z.s1, lo: Math.min(z.d0, z.d1), hi: Math.max(z.d0, z.d1) });
      this.zones.set(z.edge, list);
    }
    // The scenery that stands already: trees count as canopy (ferns may grow under them).
    for (const sp of input.spots) {
      const e = road.edges[sp.edge];
      if (!e) continue;
      const tree = sp.kind === 'conifer' || sp.kind === 'palm' || sp.kind === 'mangrove';
      for (const disc of SPOT_REACH[sp.kind] ?? []) {
        const c = disc.back > 0 ? road.toWorld(e.index, sp.s, sp.d + Math.sign(sp.d) * disc.back, 0) : sp.p;
        this.taken.add(c.x, c.z, disc.r * sp.size, tree);
      }
    }
    // The staged scenes' ground (run W-T, scenes/): nothing of the kit stands in a scene, ferns included.
    for (const q of input.reserved ?? []) this.taken.add(q.x, q.z, q.r, false);
    if (this.density <= 0) this.edge = road.edges.length;
  }

  get done(): boolean {
    return this.edge >= this.input.road.edges.length;
  }

  /**
   * Runs units until `budgetMs` has passed (at least one). Returns the roads finished meanwhile:
   * their props are all placed, so their stretches can be built.
   */
  step(budgetMs: number): number[] {
    const finished: number[] = [];
    const t0 = performance.now();
    const units = this.input.kit.rules.length * 2;
    while (!this.done) {
      this.runUnit(this.edge, this.order[Math.floor(this.unit / 2)] ?? 0, this.unit % 2 === 0 ? -1 : 1);
      if (++this.unit >= units) {
        finished.push(this.edge);
        this.edge++;
        this.unit = 0;
      }
      if (performance.now() - t0 >= budgetMs) break;
    }
    return finished;
  }

  private runUnit(edgeIndex: number, ri: number, side: -1 | 1): void {
    const input = this.input;
    const { road, dressing, seed } = input;
    const e = road.edges[edgeIndex];
    const rule = input.kit.rules[ri];
    if (!e || !rule) return;
    // A rule drawing from another model (Old Town's kit) places nothing until that model is in.
    if (rule.model && !input.models?.[rule.model]) return;
    const taken = this.taken;
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
    const zones = this.zones.get(e.index) ?? [];
    const zoneClear = (s: number, d: number, r: number) =>
      !zones.some((z) => s >= z.s0 - r && s <= z.s1 + r && d >= z.lo - r && d <= z.hi + r);
    const otherRoad = (s: number, x: number, z: number, r: number) =>
      this.roads.roadUnder(e.index, s, x, z, r);
    // A road standing higher close by (a stacked loop, a spur on the hill above) lays its own land
    // over this spot: a prop here would poke up through it.
    const underHigher = (x: number, z: number, y: number, s: number) =>
      this.roads.landOver(e.index, s, x, z, y);
    const h = (k: number, sd: number, salt: number) =>
      scatterHash(seed, 7919 + e.index * 977 + ri * 131, k, sd * 17 + salt + 40);
    const outer = side < 0 ? -e.dMin + VERGE_M : e.dMax + VERGE_M;
    if (rule.frontage) {
      const model = rule.model ? input.models?.[rule.model] : undefined;
      if (!model) return;
      const fr = rule.frontage;
      // A building keeps off the landmarks' footprints too (the buoy, the Mile 0 marker).
      const blocks = (dress?.features ?? []).filter(
        (f) => KEEP_CLEAR.has(f.kind) || (f.kind === 'landmark' && f.params?.['overRoad'] !== true),
      );
      const sideName = side < 0 ? 'left' : 'right';
      const onLand = (u: number) =>
        (rule.on as readonly string[]).includes(themeAt(tags, sideName, u)) &&
        (!rule.district || inDistrict(tags, sideName, u, rule.district)) &&
        !(rule.notDistrict && inDistrict(tags, sideName, u, rule.notDistrict));
      let s = h(0, side, 0) * fr.gap[1];
      for (let k = 0; s < e.length; k++) {
        const variant = rule.v[Math.floor(h(k, side, 4) * rule.v.length) % rule.v.length] ?? 0;
        const box = model.variants[variant]?.boundingBox;
        if (!box) break;
        if (h(k, side, 7) < fr.lotRate) {
          s += fr.lotM;
          continue;
        }
        const half = Math.max(-box.min.x, box.max.x);
        const front = Math.max(0, box.max.z);
        const back = Math.max(0, -box.min.z);
        const depth = front + back;
        const sc = s + half;
        if (sc + half > e.length) break;
        const ends = [sc - half, sc, sc + half];
        // Its facade `across[0]` past the verge band's outer edge, whatever the band is made of (a
        // sidewalk, a loose band the rider rides), so the front stands on the street's edge and the
        // balcony, `front` further out, hangs over the pavement; its whole depth on the drawn land.
        const sideKey = side < 0 ? 'left' : 'right';
        const bandPast = Math.max(
          ...ends.map((u) => Math.max(0, Math.abs(road.vergeAt(e.index, u, sideKey).dOuter) - outer)),
        );
        const across = bandPast + rule.across[0] - front;
        let fits =
          ends.every(onLand) && ends.every((u) => across + depth <= input.landReach(e.index, side, u));
        const dFront = side * (outer + across);
        const dFacade = side * (outer + across + front);
        const dBack = side * (outer + across + depth);
        const overlaps = (s0: number, s1: number, d0: number, d1: number, from: number, to: number) =>
          sc + half > Math.min(s0, s1) - 1 &&
          sc - half < Math.max(s0, s1) + 1 &&
          Math.max(from, to) > Math.min(d0, d1) - 1 &&
          Math.min(from, to) < Math.max(d0, d1) + 1;
        // A crowd stands on the pavement, under the balcony: only the building's body is in its way.
        // Everything else (a board's posts, a pad, a landmark) keeps off the balcony too.
        if (fits)
          fits = !blocks.some((f) =>
            f.kind === 'roadsideZone'
              ? overlaps(f.s0, f.s1, f.d0, f.d1, dFacade, dBack)
              : overlaps(f.s0, f.s1, f.d0, f.d1, dFront, dBack),
          );
        if (fits) fits = !zones.some((z) => overlaps(z.s0, z.s1, z.lo, z.hi, dFront, dBack));
        // Its ground as discs along its body (facade to back): clear of the scenery, the scenes and
        // the landmarks.
        const r = Math.min(back, 2 * half) / 2;
        const discs: { x: number; z: number }[] = [];
        if (fits) {
          const mid = side * (outer + across + front + back / 2);
          if (2 * half >= back) {
            for (let u = -half + r; u < half - r + r / 2; u += r)
              discs.push(road.toWorld(e.index, sc + u, mid, 0));
            discs.push(road.toWorld(e.index, sc + half - r, mid, 0));
          } else {
            for (let t = r; t < back - r + r / 2; t += r)
              discs.push(road.toWorld(e.index, sc, side * (outer + across + front + t), 0));
            discs.push(road.toWorld(e.index, sc, side * (outer + across + front + back - r), 0));
          }
          fits = !discs.some((c) => taken.hits(c.x, c.z, r, false));
        }
        // No other road under any corner, and no higher road's land over it.
        if (fits)
          fits = ends.every((u) =>
            [dFront, dBack].every((dd) => {
              const q = road.toWorld(e.index, u, dd, LAND_TOP_M);
              return !otherRoad(u, q.x, q.z, 1) && !underHigher(q.x, q.z, q.y, u);
            }),
          );
        if (!fits) {
          s += FRONTAGE_STEP_M;
          continue;
        }
        const d = side * (outer + across + front);
        const p = road.toWorld(e.index, sc, d, LAND_TOP_M);
        const toRoad = road.toWorld(e.index, sc, 0, 0);
        for (const c of discs) taken.add(c.x, c.z, r);
        this.items.push({
          rule: rule.id,
          variant,
          edge: e.index,
          s: sc,
          d,
          p,
          turn: Math.atan2(toRoad.x - p.x, toRoad.z - p.z),
          pitch: 0,
          size: 1,
          tier: rule.tier ?? 0,
          foot: { half, front, back },
        });
        s = sc + half + fr.gap[0] + (fr.gap[1] - fr.gap[0]) * h(k, side, 8);
      }
      return;
    }
    const spacing = rule.every / this.density;
    for (let k = 0; ; k++) {
      const s0 = (k + 0.15 + (rule.align ? 0 : 0.7 * h(k, side, 0))) * spacing;
      if (s0 > e.length) break;
      if (rule.fromS !== undefined && s0 < rule.fromS) continue;
      if (h(k, side, 1) >= rule.rate) continue;
      const [near, spread] = rule.across;
      // Off-road (run W-R): a solid prop stands clear of the ridable band; the understory may grow on it.
      const clearOf = rule.understory ? 0 : ridableBandPast(road, e.index, side, s0, outer) + rule.r;
      const across = Math.max(near + spread * h(k, side, 2), clearOf);
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
        const sideName = side < 0 ? 'left' : 'right';
        const theme = themeAt(tags, sideName, s);
        if (!(rule.on as readonly string[]).includes(theme)) break;
        if (
          rule.whole &&
          [s - along, s + along].some(
            (u) => !(rule.on as readonly string[]).includes(themeAt(tags, sideName, u)),
          )
        )
          break;
        if (rule.district && !inDistrict(tags, sideName, s, rule.district)) break;
        if (rule.notDistrict && inDistrict(tags, sideName, s, rule.notDistrict)) break;
        // On the drawn land, all of it: across its depth and along its length.
        const land = Math.min(
          input.landReach(e.index, side, s),
          input.landReach(e.index, side, s - along),
          input.landReach(e.index, side, s + along),
        );
        if (across + back > land) break;
        const d = side * (outer + across);
        const p = road.toWorld(e.index, s, d, LAND_TOP_M);
        if (rule.waterline) {
          // At the water's level under it, a low bank below the land (playtest 4, P4-19, C4: a dock).
          const water = input.waterAt?.(p.x, p.z) ?? null;
          if (water === null || water > p.y || p.y - water > BANK_MAX_M) break;
          p.y = water;
        }
        const r = rule.r * (rule.run ? 1 : (rule.size?.[1] ?? 1));
        // Its clear ground: round the anchor, or round its body behind it (`discBack`).
        const dc = rule.discBack ? side * (outer + across + rule.discBack) : d;
        const c = rule.discBack ? road.toWorld(e.index, s, dc, LAND_TOP_M) : p;
        if (!featureClear(s, dc, r) || !zoneClear(s, d, r)) break;
        if (taken.hits(c.x, c.z, r, !!rule.understory || !!rule.low)) {
          if (rule.run) break;
          continue;
        }
        if (otherRoad(s, c.x, c.z, r) || underHigher(p.x, p.z, p.y, s)) break;
        // A long prop (a fence section, a hut) must be clear of higher ground at its ends too.
        if (
          along > r &&
          [-along, along].some((u) => {
            const q = road.toWorld(e.index, s + u, d, LAND_TOP_M);
            return underHigher(q.x, q.z, q.y, s + u);
          })
        )
          break;
        const toRoad = road.toWorld(e.index, s, 0, 0);
        let turn: number;
        let pitch = 0;
        if (rule.face) {
          turn = Math.atan2(toRoad.x - p.x, toRoad.z - p.z) + (rule.away ? Math.PI : 0);
          if (rule.run) {
            // A section follows the road's grade, so neither end floats or sinks.
            const a = road.toWorld(e.index, Math.max(0, s - along), d, LAND_TOP_M);
            const b = road.toWorld(e.index, Math.min(e.length, s + along), d, LAND_TOP_M);
            pitch = Math.atan2(b.y - a.y, Math.hypot(b.x - a.x, b.z - a.z)) * -side;
          }
        } else turn = h(k * 31 + j, side, 5) * Math.PI * 2;
        const size = rule.size ? rule.size[0] + (rule.size[1] - rule.size[0]) * h(k * 31 + j, side, 6) : 1;
        // A section's own disc covers its length; the next one along may touch it.
        if (rule.run) {
          taken.add(p.x, p.z, 0.3);
          // A solid section's body too (playtest 4, P4-19, C4: the sandstone cut): two discs along it, at
          // half its depth, so nothing later stands inside the rock.
          if (rule.body) {
            const reach = Math.max(along, back) / 2 + 0.1;
            for (const u of [-along / 2, along / 2]) {
              const q = road.toWorld(e.index, s + u, side * (outer + across + back / 2), 0);
              taken.add(q.x, q.z, reach);
            }
          }
        } else if (rule.canopy) taken.add(p.x, p.z, r, true);
        else taken.add(c.x, c.z, rule.understory ? r * 0.6 : r);
        this.items.push({
          rule: rule.id,
          variant,
          edge: e.index,
          s,
          d,
          p,
          turn,
          pitch,
          size,
          tier: rule.tier ?? 1,
        });
      }
    }
  }
}

/** Scatters a whole kit at once (tests, and anything that needs every prop now). */
export function scatterRoadside(input: RoadsideInput): RoadsideItem[] {
  const scatter = new RoadsideScatter(input);
  while (!scatter.done) scatter.step(Infinity);
  return scatter.items;
}

interface Chunk {
  items: RoadsideItem[];
  cx: number;
  cz: number;
  radius: number;
  mesh: Mesh | null;
  /**
   * The vertex range each level of detail draws (`levelOf`): every prop out to ROADSIDE_NEAR_M; then
   * without the understory to ROADSIDE_FRONT_M; then with the street fronts as their far stand-ins
   * to ROADSIDE_MID_M; then only the tier-0 props' and street fronts' stand-ins (run W-S). The
   * buffer is laid out so each is one run (`build`).
   */
  levels: [number, number][];
}

/** A stretch's level of detail at a distance from the camera (`Chunk.levels`). */
const levelOf = (dist: number): number =>
  dist <= ROADSIDE_NEAR_M ? 0 : dist <= ROADSIDE_FRONT_M ? 1 : dist <= ROADSIDE_MID_M ? 2 : 3;

export interface RoadsideCounts {
  /** Props placed, by rule. */
  placed: Readonly<Record<string, number>>;
  /** Stretches with props, stretches built now, and meshes and triangles the last update showed. */
  chunks: number;
  built: number;
  meshes: number;
  triangles: number;
}

/** The roadside props of one road scene, drawn as merged stretches near the camera. */
export class RoadsideLayer {
  readonly group = new Group();
  private readonly scatter: RoadsideScatter;
  private readonly chunks: Chunk[] = [];
  private shownMeshes = 0;
  private shownTris = 0;
  /** Whether the last update built a stretch (tests, the debug overlay). */
  builtLast = false;

  /** The model each rule draws from: the kit's own, or the one it names (Old Town's). */
  private readonly modelOf = new Map<string, SceneryModel>();
  private readonly seed: number;

  constructor(
    private readonly model: SceneryModel,
    private readonly look: LookStyle,
    input: RoadsideInput,
  ) {
    this.group.name = 'road-roadside';
    this.seed = input.seed;
    this.scatter = new RoadsideScatter(input);
    for (const r of input.kit.rules) {
      const m = r.model ? input.models?.[r.model] : model;
      if (m) this.modelOf.set(r.id, m);
    }
  }

  private geometryOf(it: RoadsideItem): BufferGeometry | undefined {
    return this.modelOf.get(it.rule)?.variants[it.variant];
  }

  /** Every prop placed so far (all of them once `ready`). */
  get items(): readonly RoadsideItem[] {
    return this.scatter.items;
  }

  /** Whether every prop is placed. */
  get ready(): boolean {
    return this.scatter.done;
  }

  /**
   * The text surfaces of the street-front buildings placed so far (playtest 4, P4-16: Duval's shop
   * names), in the world, for the words of their pack signs to be painted over (text-surfaces.ts). Each
   * carries a `pick` from its building's place, so neighbours of one kind show different names. The
   * blank boards stay in the stretches' meshes: a name that is cut leaves a blank board.
   */
  surfaces(): PlacedSurface[] {
    const out: PlacedSurface[] = [];
    const q = new Quaternion();
    const up = new Vector3(0, 1, 0);
    const at = new Vector3();
    const one = new Vector3(1, 1, 1);
    for (const it of this.scatter.items) {
      if (!it.foot) continue;
      const panels = this.modelOf.get(it.rule)?.surfaces?.[it.variant];
      if (!panels?.length) continue;
      const m = new Matrix4().compose(at.set(it.p.x, it.p.y, it.p.z), q.setFromAxisAngle(up, it.turn), one);
      const pick = Math.floor(
        scatterHash(this.seed, 9001 + it.edge, Math.round(it.s), it.d < 0 ? 1 : 2) * 1024,
      );
      for (const panel of panels) out.push({ ...placeSurface(panel, m), pick });
    }
    return out;
  }

  /** Groups the finished roads' props into stretches. */
  private addStretches(edges: readonly number[]) {
    if (!edges.length) return;
    const done = new Set(edges);
    const byKey = new Map<string, RoadsideItem[]>();
    for (const it of this.scatter.items) {
      if (!done.has(it.edge)) continue;
      const key = `${it.edge}:${Math.floor(it.s / ROADSIDE_STRETCH_M)}`;
      const list = byKey.get(key);
      if (list) list.push(it);
      else byKey.set(key, [it]);
    }
    for (const items of byKey.values()) {
      // Tier by tier: a farther level of detail draws a prefix of the buffer.
      items.sort((a, b) => a.tier - b.tier);
      const cx = items.reduce((n, i) => n + i.p.x, 0) / items.length;
      const cz = items.reduce((n, i) => n + i.p.z, 0) / items.length;
      const radius = Math.max(...items.map((i) => Math.hypot(i.p.x - cx, i.p.z - cz))) + 15;
      this.chunks.push({ items, cx, cz, radius, mesh: null, levels: [] });
    }
  }

  /**
   * Builds, shows, thins and frees stretches by their distance from the camera. A stretch is built a
   * little before it comes into range, at most one a frame, so no frame pays for two.
   */
  update(cameraX: number, cameraZ: number, drawM: number): number {
    // Placing the props: a few milliseconds a frame until done.
    if (!this.scatter.done) this.addStretches(this.scatter.step(SCATTER_MS_PER_FRAME));
    const draw = Math.min(drawM, ROADSIDE_DRAW_M);
    let built = false;
    let shown = 0;
    let meshes = 0;
    let tris = 0;
    // The nearest stretch that is wanted and not built yet: built this frame.
    let next: Chunk | null = null;
    let nextDist = Infinity;
    for (const c of this.chunks) {
      const dist = Math.hypot(c.cx - cameraX, c.cz - cameraZ) - c.radius;
      if (!c.mesh && dist < draw + ROADSIDE_PREFETCH_M && dist < nextDist) {
        next = c;
        nextDist = dist;
      }
    }
    if (next) {
      this.build(next);
      built = true;
    }
    for (const c of this.chunks) {
      const mesh = c.mesh;
      if (!mesh) continue;
      const dist = Math.hypot(c.cx - cameraX, c.cz - cameraZ) - c.radius;
      if (dist < draw) {
        // Past ROADSIDE_MID_M only the tier-0 props draw, as their far stand-ins.
        const [start, end] = c.levels[levelOf(dist)] ?? [0, 0];
        const count = end - start;
        mesh.geometry.setDrawRange(start, count);
        mesh.visible = count > 0;
        if (mesh.visible) {
          meshes++;
          tris += count / 3;
          shown += c.items.length;
        }
      } else {
        mesh.visible = false;
        if (dist > ROADSIDE_KEEP_M) this.free(c);
      }
    }
    this.shownMeshes = meshes;
    this.shownTris = tris;
    this.builtLast = built;
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
    // The near props and the far stand-ins of the tier-0 props and street fronts (run W-S;
    // scenery-merge.ts `formsOf`), laid out by level of detail (`Chunk.levels`).
    let total = 0;
    // A stretch with an atlas model's props in it (Old Town's) draws with the region atlas as its
    // map, every other prop on the atlas's white tile: still one mesh, one draw (playtest 3, T12.1).
    let map: Texture | undefined;
    let doubleSided = this.model.doubleSided;
    for (const it of c.items) {
      const g = this.geometryOf(it);
      if (!g) continue;
      const f = formsOf(g);
      total += f.near.n + (it.tier === 0 ? f.far.n : 0);
      const m = this.modelOf.get(it.rule);
      map ??= m?.map;
      doubleSided ||= m?.doubleSided ?? false;
    }
    const pos = new Float32Array(total * 3);
    const nrm = new Float32Array(total * 3);
    const col = new Float32Array(total * 3);
    const uv = map ? new Float32Array(total * 2) : null;
    const m = new Matrix4();
    const q = new Quaternion();
    const qp = new Quaternion();
    const v = new Vector3();
    const up = new Vector3(0, 1, 0);
    const zAxis = new Vector3(0, 0, 1);
    const one = new Vector3();
    let o = 0;
    const emit = (it: RoadsideItem, form: FlatForm) => {
      const gp = form.pos;
      const gn = form.nrm;
      const n = form.n;
      for (let i = 0; i < n * 3; i++) col[o * 3 + i] = form.col[i] ?? 1;
      if (uv) writeUv(uv, o, form);
      if (it.pitch) {
        // A fence section on a grade: the general transform.
        q.setFromAxisAngle(up, it.turn).multiply(qp.setFromAxisAngle(zAxis, it.pitch));
        m.compose(v.set(it.p.x, it.p.y, it.p.z), q, one.set(it.size, it.size, it.size));
        for (let i = 0; i < n; i++, o++) {
          v.fromArray(gp, i * 3)
            .applyMatrix4(m)
            .toArray(pos, o * 3);
          v.fromArray(gn, i * 3)
            .applyQuaternion(q)
            .toArray(nrm, o * 3);
        }
      } else {
        // Turned about the vertical only (nearly every prop): x' = x cos + z sin, z' = z cos - x sin.
        const cos = Math.cos(it.turn);
        const sin = Math.sin(it.turn);
        const k = it.size;
        for (let i = 0; i < n; i++, o++) {
          const x = gp[i * 3] ?? 0;
          const z = gp[i * 3 + 2] ?? 0;
          pos[o * 3] = it.p.x + k * (x * cos + z * sin);
          pos[o * 3 + 1] = it.p.y + k * (gp[i * 3 + 1] ?? 0);
          pos[o * 3 + 2] = it.p.z + k * (z * cos - x * sin);
          const nx = gn[i * 3] ?? 0;
          const nz = gn[i * 3 + 2] ?? 0;
          nrm[o * 3] = nx * cos + nz * sin;
          nrm[o * 3 + 1] = gn[i * 3 + 1] ?? 0;
          nrm[o * 3 + 2] = nz * cos - nx * sin;
        }
      }
    };
    // The buffer, so each level is one run: [tier-0 stand-ins | street-front stand-ins | tier-0 and
    // tier-1 props | street fronts | the understory]. Near: the last four; to ROADSIDE_FRONT_M: the
    // middle three; to ROADSIDE_MID_M: the street fronts' stand-ins and the tier-0 and tier-1 props;
    // past it: the stand-ins.
    const fronts = c.items.filter((it) => it.foot);
    const others = c.items.filter((it) => !it.foot);
    const run = (
      list: readonly RoadsideItem[],
      pass: 'near' | 'far',
      keep: (it: RoadsideItem) => boolean,
    ) => {
      for (const it of list) {
        const g = this.geometryOf(it);
        if (g && keep(it)) emit(it, formsOf(g)[pass]);
      }
    };
    const a0 = o;
    run(others, 'far', (it) => it.tier === 0);
    const b0 = o;
    run(fronts, 'far', () => true);
    const c0 = o;
    run(others, 'near', (it) => it.tier < 2);
    const d1 = o;
    run(fronts, 'near', () => true);
    const e1 = o;
    run(others, 'near', (it) => it.tier === 2);
    c.levels = [
      [c0, o],
      [c0, e1],
      [b0, d1],
      [a0, c0],
    ];
    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new Float32BufferAttribute(nrm, 3));
    geo.setAttribute('color', new Float32BufferAttribute(col, 3));
    if (uv) geo.setAttribute('uv', new Float32BufferAttribute(uv, 2));
    geo.computeBoundingSphere();
    const mesh = new Mesh(
      geo,
      this.look.material('prop', { vertexColors: true, doubleSided, ...(map ? { map } : {}) }),
    );
    mesh.name = 'road-roadside';
    mesh.matrixAutoUpdate = false;
    mesh.visible = false;
    this.group.add(mesh);
    c.mesh = mesh;
  }
}
