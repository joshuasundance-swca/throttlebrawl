// The ground's closed vocabularies (W-Q, "career and freedom"; interview, 2026-10-02: "Anywhere with
// ground"). Shared by road/ (the cross-section queries), content/ (the pack schema) and the sim
// (grip and speed per surface), so each list is written once. A contract: a new value is a small
// contract PR, because the sim's tuning and the renderer key on these strings.

/** What a road's own lanes are made of (a road file's `surface`; asphalt when absent). */
export const ROAD_SURFACES = [
  'asphalt',
  'concrete',
  'brick',
  'cobbles',
  'gravel',
  'dirt',
  'sand',
  'grass',
] as const;
export type RoadSurface = (typeof ROAD_SURFACES)[number];

/**
 * What a verge band beside the road is made of: a paved `shoulder` apron, loose `dirt`, `gravel`
 * or `sand`, `grass`, or a city `kerb` and pavement.
 */
export const VERGE_SURFACES = ['shoulder', 'dirt', 'gravel', 'sand', 'grass', 'kerb'] as const;
export type VergeSurface = (typeof VERGE_SURFACES)[number];

/**
 * What stops a rider at a verge band's outer edge [default]:
 * - `soft`: the ground just runs on (a fall-off; the rider slows, nothing is hit);
 * - `brush`: ferns, salal or bushes (a soft stop that slows hard);
 * - `water`: the sea, a channel or a swamp (a splash, as over a bridge rail);
 * - `hard`: a building front, a cliff or a retaining wall (a wall, as the M1 barrier);
 * - `fence`: a fence that a hard enough hit smashes;
 * - `rail`: a guard rail, only on bridges and drops (the rail's own over-the-rail rule).
 */
export const VERGE_EDGES = ['soft', 'brush', 'water', 'hard', 'fence', 'rail'] as const;
export type VergeEdge = (typeof VERGE_EDGES)[number];

/** What divides the two directions of a road with a median: paint, a kerbed island, grass or a barrier. */
export const MEDIAN_KINDS = ['paint', 'kerb', 'grass', 'barrier'] as const;
export type MedianKind = (typeof MEDIAN_KINDS)[number];

/** Anything a wheel can be on: a road surface or a verge surface. */
export type GroundSurface = RoadSurface | VergeSurface;

/** Every ground surface, road surfaces first (the order the sim's surface tuning is declared in). */
export const GROUND_SURFACES: readonly GroundSurface[] = [
  ...ROAD_SURFACES,
  ...VERGE_SURFACES.filter((v) => !(ROAD_SURFACES as readonly string[]).includes(v)),
];

/** Drive lanes per direction a two-way section may carry: 1 to 3, so 2 to 6 lanes in all. */
export const LANES_PER_DIRECTION_MAX = 3;
