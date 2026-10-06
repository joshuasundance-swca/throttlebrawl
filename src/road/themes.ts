// The land themes of a road's sides and the scatter hash (moved here from render/scenery.ts, playtest 4,
// "solid but forgiving": the street furniture on a ridable band is planned in road/furniture.ts, which
// the sim reads to meet it and render reads to draw it, so both need the same themes and the same hash).
// Land comes from the road's scenery tags, per side (docs/content-packs.md, "Scenery tags"): a water tag
// means sea, `bridge` or `causeway` alone means no land, and every other tag is land with a theme that
// picks what grows or stands on it. An edge with no tags at all counts as palm land. Pure data and integer
// arithmetic, like the rest of road/.

/** What one side of a road is at some s. */
export type SideTheme =
  | 'none'
  | 'water'
  | 'palms'
  | 'beach'
  | 'mangrove'
  | 'commercial'
  | 'urban'
  | 'industrial'
  | 'sawmill'
  | 'forest'
  // run W-R, San Francisco's downtown (render/downtown.ts draws what stands there)
  | 'crossing'
  | 'plaza'
  | 'downtown'
  // run W-U, San Francisco's Chinatown and North Beach (render/chinatown-northbeach.ts draws them)
  | 'lanterns'
  | 'cafes'
  | 'park'
  // run W-U, San Francisco's mural alleys (render/mission.ts draws what stands there)
  | 'mission'
  // run W-U, San Francisco's waterfront (render/waterfront.ts draws what stands there)
  | 'promenade'
  | 'wharf'
  // run W-U, the Pacific Northwest's places (render/pnw-places.ts draws what stands there)
  | 'festival'
  | 'clearcut'
  // playtest 3 (T10.6), the Marin Headlands: open grass hills, no trees, no poles
  | 'headlands'
  // playtest 3 (T12.6), downtown Portland's blocks (render/downtown.ts draws what stands there)
  | 'blocks'
  // playtest 4 (P4-19), the Presidio: San Francisco's cypress and eucalyptus, no pines, no poles
  | 'presidio'
  // playtest 4 (P4-19), Key West's Old Town: a street, not a palm road (render/roadside.ts stands its fronts)
  | 'oldtown'
  // playtest 4 (P4-19, C4), Chuckanut Drive: the bay side's shelf and drop, and the uphill side's sandstone
  // cuts (render/roadside.ts stands the parapet, the bluff, the cuts and the boulders)
  | 'bluff'
  | 'cut'
  // playtest 4 (P4-19, C4), Lake Samish: the shore drive's lake side, a bank down to the water (the cabins
  // and docks, render/roadside.ts)
  | 'lake';
export type LandTheme = Exclude<SideTheme, 'none' | 'water'>;

/** Each land tag's theme. Tags not listed here (fog, cable-line) say nothing about the ground. */
export const LAND_TAGS: Readonly<Record<string, LandTheme>> = {
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
  warehouses: 'industrial',
  piers: 'industrial',
  gardens: 'urban',
  sawmill: 'sawmill',
  forest: 'forest',
  // Run W-R (interview, 2026-10-02: "SF first = downtown towers"): a cross street's mouth, a plaza
  // and the towers' sidewalk. Nothing of the scatter's stands there (no houses, no poles); the
  // downtown layer (downtown.ts) draws the towers, the cross streets and the plaza furniture.
  'cross-street': 'crossing',
  'cable-crossing': 'crossing',
  plaza: 'plaza',
  towers: 'downtown',
  // Run W-U (pitch deck #8): Chinatown's shopfronts, North Beach's cafes, a block's side street and
  // the hill's park. Nothing of the scatter's stands there; render/chinatown-northbeach.ts draws it.
  lanterns: 'lanterns',
  cafes: 'cafes',
  'side-street': 'crossing',
  'hill-park': 'park',
  // Run W-U (the pitch deck after playtest 2, #8: "the Mission's mural alleys"): shopfronts, an
  // alley's painted walls and the mascot's corner wall. Nothing of the scatter's stands there; the
  // mission layer (mission.ts) draws the buildings, the murals and the crew.
  shopfronts: 'mission',
  murals: 'mission',
  'mascot-mural': 'mission',
  // Run W-U (the pitch deck's #8): the waterfront. The bay side is the promenade to the seawall (the
  // pier sheds and the ferry hall stand on its edge); the city side is the waterfront blocks, their
  // side streets (`wharf-street`), the ferry plaza and the lot by the bridge. Nothing of the scatter's stands on
  // either; the waterfront layer (waterfront.ts) draws them.
  promenade: 'promenade',
  'pier-shed': 'promenade',
  'ferry-hall': 'promenade',
  wharf: 'wharf',
  'wharf-street': 'wharf',
  'ferry-plaza': 'wharf',
  'wharf-lot': 'wharf',
  // Run W-U (the pitch deck's #12): a closed main street on the day of the Stump Social (Fir County's
  // logging festival), and a fresh clear-cut. The
  // scatter puts nothing there but the forest's far edge past a clear-cut; pnw-places.ts draws the
  // shops, the bears, the stumps and the slash. (A `ferry` stretch is no land: the sea, and the ferry.)
  festival: 'festival',
  clearcut: 'clearcut',
  // Playtest 3 (T10.6; wave B's punch list, "Conzelman Road is lined with dense pines and log
  // fences, which reads as the PNW, not the Marin Headlands' grass hills"): coastal scrub and
  // grass. Land with nothing of the scatter on it, no conifers (the PNW's far trees) and no poles.
  headlands: 'headlands',
  // Playtest 3 (T12.6; wave B's punch list, item 3: Broadway should read as downtown, not as open
  // fields with farmhouses): Portland's brick and cast-iron blocks. Nothing of the scatter's stands there (no
  // palms, no bait shacks, no poles, which the `town` tag beside it would give); the downtown layer
  // (downtown.ts) stands the street fronts, the towers and the cart pod.
  'pdx-blocks': 'blocks',
  // Playtest 4 (P4-19; the identity sheets' G4): the Golden Gate's south approach runs through the
  // Presidio's groves of Monterey cypress and blue gum eucalyptus (Codex CX5's `sf-identity` trees), not
  // the headlands' bare grass and never the Pacific Northwest's conifers. No poles.
  presidio: 'presidio',
  // Playtest 4 (P4-19; the maintainer: "The real roads do not have the characteristics of the roads in
  // question in terms of scenery and feel"): Duval and Whitehead Streets are a street with a sidewalk and
  // a front of shops on it, not a beach road with palms, shacks and a pole line. Nothing of the scatter
  // stands there (no palms, no bait shacks, no poles); the roadside kit's Old Town rules (roadside.ts)
  // stand the fronts, the trees and the sidewalk's planters.
  'key-oldtown': 'oldtown',
  // Playtest 4 (P4-19, C4; the identity sheets' H1, H2 and I3, and their shared seam "a bluff/lake land
  // theme with a drop and no skirt"). Each is a span tag over part of one side (tools/gis `spanTags`),
  // over the road's `forest`: Chuckanut's bay side where the ground really drops to the water (`bluff`),
  // its uphill side where the slope rises from the road (`rock-cut`), and Lake Samish's shore drive where
  // the lake is beside it (`lake`).
  bluff: 'bluff',
  'rock-cut': 'cut',
  lake: 'lake',
};
/** When one side carries several land tags, the first theme in this list wins. */
export const THEME_ORDER: readonly LandTheme[] = [
  'festival',
  'clearcut',
  'crossing',
  'plaza',
  'downtown',
  // Ahead of `commercial`: a Portland block is also tagged `town`.
  'blocks',
  // Ahead of `commercial` and `palms`: Old Town's streets are tagged `town` and `palms` as well.
  'oldtown',
  'park',
  'lanterns',
  'cafes',
  'mission',
  'promenade',
  'wharf',
  // Ahead of `palms` (playtest 4, P4-19): a town street (Key West's Truman, White, Atlantic and the
  // rest, tagged `town` and `palms`) is a street with a kerb, not a beach road. No road that has
  // `commercial` and `mangrove` on one side exists; the road/cross-section.ts verge order agrees.
  'commercial',
  'palms',
  'mangrove',
  'beach',
  'sawmill',
  'urban',
  'industrial',
  // Ahead of the forest (playtest 4, P4-19, C4): each is a span over a road tagged `forest` on both sides.
  'bluff',
  'cut',
  'lake',
  'presidio',
  // Ahead of the forest: a side tagged both is the open hill (the bakes' old stand-in tag).
  'headlands',
  'forest',
];

export interface SideTag {
  s0: number;
  s1: number;
  side?: string;
  tag: string;
}

export function onSide(t: SideTag, side: 'left' | 'right'): boolean {
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
