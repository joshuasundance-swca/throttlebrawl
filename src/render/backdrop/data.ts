// The backdrop's data (W-P "fill the world", the maintainer, 2026-10-01b: "distance and skyline:
// hills, mountains, city skylines, water, bridges on the horizon"). Each region pack carries its
// backdrop as plain data files under `assets/backdrop/<region>/` (docs/content-packs.md, "Backdrop"):
// - `region.json`: the region's far pieces (ridgelines, volcanoes, bridges, skylines, ships,
//   clouds) and its haze;
// - `networks/<network-id>.json`: one per road network, with the network's map origin (the same
//   as its `crs`, which a unit test checks) and pieces placed in that network's own metres.
// Geographic pieces give points as [latitude, longitude] in degrees; local ones as [x, z] metres
// in the network frame (x east, z south). Sizes are "as it reads from the road", not survey
// numbers: `exaggerate` scales a piece about its base so a far landmark is more than a pixel tall.
// Every number here is [default].

/** A point: [lat, lon] degrees (frame "geo", the default) or [x, z] metres (frame "local"). */
export type Pt = readonly [number, number];
/** A ridge point with its envelope height, metres (falls back to the ridge's own range). */
export type RidgePt = readonly [number, number] | readonly [number, number, number];

interface Base {
  /** Unique within its file; the fixed-shape pieces seed their shape from it. */
  id: string;
  /** "geo" (default): points are [lat, lon]; "local": [x, z] metres in the network frame. */
  frame?: 'geo' | 'local';
  /** Only these networks draw the piece (default: every network of the region). */
  networks?: readonly string[];
  /** Not drawn when it lies farther than this from the network's centre, m (default 160 km). */
  maxDistM?: number;
  /** Drawn only this far from every road point at least, m (default by kind). */
  keepOutM?: number;
  /** Scales the piece's sizes about its base (default 1). Positions are never scaled. */
  exaggerate?: number;
  /** Extra haze on top of the distance haze, 0..1 (default 0). */
  haze?: number;
}

export interface RidgePiece extends Base {
  kind: 'ridge';
  path: readonly RidgePt[];
  /** Crest height range, m: the envelope is the max, the noise dips toward the min. */
  heightM: readonly [number, number];
  /** "peaks" (jagged), "mesa" (flat basalt tops, steep notches) or "rolling" (soft hills). */
  profile?: 'peaks' | 'mesa' | 'rolling';
  colour: string;
  /** Snow above this height, m (none by default). */
  snowM?: number;
  snowColour?: string;
  /** Share of the forest cells that are clear-cut patches, 0..1 (seeded by the race). */
  clearcuts?: number;
  clearcutColour?: string;
  /** Waterfalls down the face: how many (seeded by the race), and their colour. */
  falls?: number;
  fallColour?: string;
}

export interface PeakPiece extends Base {
  kind: 'peak';
  at: Pt;
  /** Ground elevation at the foot, m (default 0). */
  baseM?: number;
  heightM: number;
  radiusM: number;
  /** "cone" (a volcano), "dome" (a rounded hill), "twin" (two domes side by side), "rock" (a monolith). */
  shape?: 'cone' | 'dome' | 'twin' | 'rock';
  colour: string;
  /** Snow above this share of the height, 0..1 (none by default). */
  snowAbove?: number;
  snowColour?: string;
  /** Crater: the summit's radius as a share of the foot's (default 0.05). */
  craterShare?: number;
}

export const BRIDGE_STYLES = ['suspension', 'girder', 'truss', 'lift', 'arch', 'stayed'] as const;
export type BridgeStyle = (typeof BRIDGE_STYLES)[number];

export interface BridgePiece extends Base {
  kind: 'bridge';
  from: Pt;
  to: Pt;
  /**
   * "suspension" (towers and cables), "girder" (a long deck on piers), and, for the real roads'
   * bridges (playtest 3): "truss" (camelback spans, honouring `gaps`: the old Bahia Honda and Seven
   * Mile bridges), "lift" (two towers with counterweights: the Hawthorne and Steel bridges) and
   * "arch" (a tied arch: Fremont) and, for Bridge City's skyline (playtest 4, P4-20), "stayed" (towers
   * with straight stays fanned down to the deck on both sides: the Tilikum Crossing).
   */
  style: BridgeStyle;
  deckM: number;
  colour: string;
  /** Tower positions along the span, 0..1, and their height over the water, m. */
  towersAt?: readonly number[];
  towerM?: number;
  /** A truss bridge's span between piers (default 60 m) and the height of its camelback (default 9 m). */
  spanM?: number;
  trussM?: number;
  /** A truss with the deck on top of it, the truss hanging under (default: a through truss, over the deck). */
  deckOnTop?: boolean;
  /** A tied arch's springings along the span, 0..1 (default 0.25 and 0.75), and its rise over the deck, m. */
  archAt?: readonly [number, number];
  archM?: number;
  /** Where the cables come down to the deck between two suspension spans, 0..1. */
  anchorsAt?: readonly number[];
  /** A girder bridge's piers, m apart (default 160). */
  pierEveryM?: number;
  /** A raised navigation hump: where (0..1) and how much higher, m. */
  humpAt?: number;
  humpM?: number;
  /** Missing spans, as [from, to] shares of the length (an old bridge with a span taken out). */
  gaps?: readonly (readonly [number, number])[];
  /**
   * Traffic crawling across (W-T, the horizon comes alive): this many lights each way, headlights
   * one way and tail lights the other, sliding end to end and fading out at each end (none by
   * default). A flat deck only: the lights ride at deck height and ignore a hump.
   */
  traffic?: number;
  /** The head and tail lights' colours (default warm white and red). */
  trafficColours?: readonly [string, string];
  /** How fast the traffic crawls, m/s (default 15). */
  trafficSpeedMps?: number;
}

/** The crowns an authored tower may wear (playtest 4, P4-20): what a skyline's silhouette is read by. */
export const TOWER_CROWNS = ['flat', 'stepped', 'pyramid', 'slant', 'spire'] as const;
export type TowerCrown = (typeof TOWER_CROWNS)[number];

/** One authored tower of a skyline: it stands where it says, so a city's known silhouettes are there. */
export interface SkylineTower {
  at: Pt;
  heightM: number;
  widthM: number;
  /** Its depth, m (default 0.85 of its width). */
  depthM?: number;
  colour: string;
  /**
   * "flat" (a plant box on the roof), "stepped" (two setbacks), "pyramid" (the top tenth tapers to a
   * point), "slant" (a roof that slopes to a ridge) or "spire" (a needle); default "flat".
   */
  crown?: TowerCrown;
}

export interface SkylinePiece extends Base {
  kind: 'skyline';
  centre: Pt;
  radiusM: number;
  count: number;
  heightM: readonly [number, number];
  widthM: readonly [number, number];
  colours: readonly string[];
  /** How many towers get a tapered spire, and how many an odd glowing orb on top. */
  spires?: number;
  orbs?: number;
  orbColour?: string;
  /** Ground height under the skyline, m (default 0): the towers rise this much more (a city on a plateau). */
  baseM?: number;
  /** The city grid's heading, degrees (the towers' long axis; default: one seeded by the piece's id). */
  gridDeg?: number;
  /** Authored towers, beside the scatter (`count` may be 0 for these alone). */
  towers?: readonly SkylineTower[];
}

export interface BlocksPiece extends Base {
  kind: 'blocks';
  /** The land the low blocks stand on (a polygon). */
  area: readonly Pt[];
  count: number;
  heightM: readonly [number, number];
  sizeM: readonly [number, number];
  colours: readonly string[];
  baseM?: number;
}

export interface VesselsPiece extends Base {
  kind: 'vessels';
  /** `shrimper`: a shrimp boat with its outriggers down, trawling back and forth (W-T). */
  style: 'container' | 'sailboat' | 'ferry' | 'tug' | 'shrimper';
  /** Either a scatter round a point (centre and radius) or round the network (bearings and
   * distances), `count` of them, placed by the race's seed ... */
  centre?: Pt;
  radiusM?: number;
  bearingDeg?: readonly [number, number];
  distanceM?: readonly [number, number];
  count?: number;
  /** ... or one vessel shuttling along a path's two ends (a ferry), with its round-trip time. */
  path?: readonly [Pt, Pt];
  periodS?: number;
  colour?: string;
  /** The containers' colours (container ships), plain and logo-free. */
  colours?: readonly string[];
}

export interface CloudsPiece extends Base {
  kind: 'clouds';
  /**
   * "thunderhead" (a tower with an anvil), "bank" (a low flat cloud), "fog" (a rolling fog bank),
   * or "pour" (W-T): fog lying on a crest `path` at `baseM` and pouring down its far side toward
   * `driftBearingDeg`, `driftM` out and `dropM` down, in tongues that slide down, thin into the
   * haze and start again at the crest, one round every `driftPeriodS`.
   */
  style: 'thunderhead' | 'bank' | 'fog' | 'pour';
  /** A scatter around the network's centre: compass bearings (0 = north, clockwise) and distances. */
  bearingDeg?: readonly [number, number];
  distanceM?: readonly [number, number];
  count?: number;
  /** Or along a path (a fog bank lying offshore). */
  path?: readonly Pt[];
  /** Cloud base and top, m. */
  baseM: number;
  topM: readonly [number, number];
  colour: string;
  shadeColour?: string;
  /** Drift: how far (m) toward which bearing, and the period of the back-and-forth, s. */
  driftM?: number;
  driftBearingDeg?: number;
  driftPeriodS?: number;
  /** A pour's fall from the crest, m (default `baseM`, down to the sea). */
  dropM?: number;
}

/**
 * A freight train on a straight track (W-T, the horizon comes alive: "a freight train on the far
 * bank"): it runs from the first end to the second at `speedMps`, thins into the haze near each
 * end and comes round again. Place the ends where a train may run (along a shore, a gorge's foot).
 */
export interface TrainPiece extends Base {
  kind: 'train';
  path: readonly [Pt, Pt];
  /** Freight cars behind the two locomotives. */
  cars: number;
  /** The track's height over the sea, m (default 6). */
  baseM?: number;
  /** Real speed, m/s (default 14). */
  speedMps?: number;
  /** The locomotives' colour, and the cars' (plain, logo-free). */
  colour: string;
  colours: readonly string[];
}

/**
 * A small plane on a straight line (W-T: "a seaplane in the Keys"), from `altitudeM[0]` down (or
 * up) to `altitudeM[1]`: with an end at 0 it comes in and lands on the water, thins into the haze
 * and comes round again. Its line is `path`, or seeded by the race round the network (`bearingDeg`,
 * `distanceM`, `lengthM`).
 */
export interface AircraftPiece extends Base {
  kind: 'aircraft';
  style: 'seaplane';
  path?: readonly [Pt, Pt];
  bearingDeg?: readonly [number, number];
  distanceM?: readonly [number, number];
  /** The seeded line's length, m (default 9000). */
  lengthM?: number;
  /** Height at the start and at the end of the line, m (default [220, 0]: a landing). */
  altitudeM?: readonly [number, number];
  /** Real speed, m/s (default 45). */
  speedMps?: number;
  colour: string;
  /** The floats, the struts and the tail's stripe (default a dark blue). */
  trimColour?: string;
}

export interface IslandsPiece extends Base {
  kind: 'islands';
  bearingDeg?: readonly [number, number];
  distanceM: readonly [number, number];
  count: number;
  widthM: readonly [number, number];
  heightM: readonly [number, number];
  colour: string;
}

export interface LighthousePiece extends Base {
  kind: 'lighthouse';
  at: Pt;
  heightM: number;
  colour: string;
  lanternColour: string;
}

export interface MastPiece extends Base {
  kind: 'mast';
  at: Pt;
  baseM?: number;
  heightM: number;
  colour: string;
  bandColour: string;
}

export interface FloorPiece extends Base {
  kind: 'floor';
  /** "land" or "water": water lies a hair above land where they overlap. */
  surface: 'land' | 'water';
  area: readonly Pt[];
  colour: string;
  /** Height of the surface, m (default 0). */
  y?: number;
}

export type Piece =
  | RidgePiece
  | PeakPiece
  | BridgePiece
  | SkylinePiece
  | BlocksPiece
  | VesselsPiece
  | CloudsPiece
  | TrainPiece
  | AircraftPiece
  | IslandsPiece
  | LighthousePiece
  | MastPiece
  | FloorPiece;

export type PieceKind = Piece['kind'];

export interface BackdropRegionFile {
  formatVersion: 1;
  region: string;
  /** Distance at which the far haze reaches 63 % (1 − 1/e), m. */
  hazeM: number;
  /** The most the far haze ever hides, 0..1 (default 0.8), so the farthest ridges still show. */
  hazeMax?: number;
  /** The far ground and sea past the near fog, all round (the colour of the region's surroundings). */
  floorColour: string;
  pieces: readonly Piece[];
}

export interface BackdropNetworkFile {
  formatVersion: 1;
  network: string;
  /** Must equal the network's `crs` origin. */
  originLatDeg: number;
  originLonDeg: number;
  pieces?: readonly Piece[];
}

export const PIECE_KINDS: readonly PieceKind[] = [
  'ridge',
  'peak',
  'bridge',
  'skyline',
  'blocks',
  'vessels',
  'clouds',
  'train',
  'aircraft',
  'islands',
  'lighthouse',
  'mast',
  'floor',
];

const HEX = /^#[0-9a-f]{6}$/i;

/** Checks one file's shape; returns the problems found (empty: fine). */
export function backdropProblems(json: unknown, kind: 'region' | 'network'): string[] {
  const out: string[] = [];
  const o = json as Record<string, unknown> | null;
  if (!o || typeof o !== 'object') return ['not an object'];
  if (o['formatVersion'] !== 1) out.push('formatVersion must be 1');
  if (kind === 'region') {
    if (typeof o['region'] !== 'string') out.push('region must be a string');
    if (!(typeof o['hazeM'] === 'number' && o['hazeM'] > 0)) out.push('hazeM must be > 0');
    const hm = o['hazeMax'];
    if (hm !== undefined && !(typeof hm === 'number' && hm >= 0 && hm <= 1)) out.push('hazeMax must be 0..1');
    if (typeof o['floorColour'] !== 'string' || !HEX.test(o['floorColour']))
      out.push('floorColour must be #rrggbb');
  } else {
    if (typeof o['network'] !== 'string') out.push('network must be a string');
    for (const k of ['originLatDeg', 'originLonDeg'])
      if (typeof o[k] !== 'number' || !Number.isFinite(o[k])) out.push(`${k} must be a number`);
  }
  const pieces = (o['pieces'] ?? []) as unknown[];
  if (!Array.isArray(pieces)) return [...out, 'pieces must be an array'];
  const ids = new Set<string>();
  for (const [i, p] of pieces.entries()) {
    const at = `pieces[${i}]`;
    const q = p as Record<string, unknown>;
    if (typeof q['id'] !== 'string' || !q['id']) out.push(`${at}: id missing`);
    else if (ids.has(q['id'])) out.push(`${at}: duplicate id ${q['id']}`);
    else ids.add(q['id']);
    if (!PIECE_KINDS.includes(q['kind'] as PieceKind)) out.push(`${at}: unknown kind ${String(q['kind'])}`);
    for (const [k, v] of Object.entries(q)) {
      if (/[cC]olour$/.test(k) && (typeof v !== 'string' || !HEX.test(v)))
        out.push(`${at}.${k}: not #rrggbb`);
      if (
        k === 'colours' &&
        (!Array.isArray(v) || !v.length || v.some((c) => typeof c !== 'string' || !HEX.test(c)))
      )
        out.push(`${at}.colours: a list of #rrggbb`);
    }
    if (q['frame'] !== undefined && q['frame'] !== 'geo' && q['frame'] !== 'local')
      out.push(`${at}: bad frame`);
    const pts: unknown[] = [];
    for (const k of ['at', 'from', 'to', 'centre']) if (q[k] !== undefined) pts.push(q[k]);
    for (const k of ['path', 'area']) if (Array.isArray(q[k])) pts.push(...(q[k] as unknown[]));
    for (const pt of pts)
      if (!Array.isArray(pt) || pt.length < 2 || pt.length > 3 || pt.some((n) => typeof n !== 'number'))
        out.push(`${at}: a point must be [a, b] numbers`);
    const required: Partial<Record<PieceKind, string[]>> = {
      ridge: ['path', 'heightM', 'colour'],
      peak: ['at', 'heightM', 'radiusM', 'colour'],
      bridge: ['from', 'to', 'style', 'deckM', 'colour'],
      skyline: ['centre', 'radiusM', 'count', 'heightM', 'widthM', 'colours'],
      blocks: ['area', 'count', 'heightM', 'sizeM', 'colours'],
      vessels: ['style'],
      clouds: ['style', 'baseM', 'topM', 'colour'],
      train: ['path', 'cars', 'colour', 'colours'],
      aircraft: ['style', 'colour'],
      islands: ['distanceM', 'count', 'widthM', 'heightM', 'colour'],
      lighthouse: ['at', 'heightM', 'colour', 'lanternColour'],
      mast: ['at', 'heightM', 'colour', 'bandColour'],
      floor: ['surface', 'area', 'colour'],
    };
    for (const k of required[q['kind'] as PieceKind] ?? [])
      if (q[k] === undefined) out.push(`${at}: ${k} missing`);
    if (
      q['kind'] === 'vessels' &&
      !q['path'] &&
      !((q['centre'] && q['radiusM']) || q['distanceM']) &&
      !q['count']
    )
      out.push(`${at}: vessels need a path, or a count with a centre and radiusM or distanceM`);
    if (q['kind'] === 'clouds' && !q['path'] && !(q['distanceM'] && q['count']))
      out.push(`${at}: clouds need a path or distanceM and count`);
    if (q['kind'] === 'clouds' && q['style'] === 'pour' && !q['path'])
      out.push(`${at}: a pour needs its crest as a path`);
    if (q['kind'] === 'train' && (!Array.isArray(q['path']) || (q['path'] as unknown[]).length !== 2))
      out.push(`${at}: a train's path is its track's two ends`);
    if (q['kind'] === 'aircraft' && !q['path'] && !q['distanceM'])
      out.push(`${at}: an aircraft needs a path or distanceM`);
    if (q['kind'] === 'bridge' && q['traffic'] !== undefined) {
      const tc = q['trafficColours'];
      if (!(typeof q['traffic'] === 'number' && q['traffic'] >= 0 && q['traffic'] <= 60))
        out.push(`${at}: traffic must be 0..60 lights each way`);
      if (tc !== undefined && (!Array.isArray(tc) || tc.length !== 2 || tc.some((c) => !HEX.test(String(c)))))
        out.push(`${at}: trafficColours must be two #rrggbb`);
    }
    if (q['kind'] === 'bridge') {
      if (!BRIDGE_STYLES.some((st) => st === q['style']))
        out.push(`${at}: style must be one of ${BRIDGE_STYLES.join(', ')}`);
      const gaps = q['gaps'];
      if (
        gaps !== undefined &&
        (!Array.isArray(gaps) ||
          gaps.some(
            (g) =>
              !Array.isArray(g) ||
              g.length !== 2 ||
              typeof g[0] !== 'number' ||
              typeof g[1] !== 'number' ||
              !(g[0] >= 0 && g[0] < g[1] && g[1] <= 1),
          ))
      )
        out.push(`${at}: gaps must be [from, to] shares of the length, 0 <= from < to <= 1`);
      for (const k of ['spanM', 'trussM', 'archM'])
        if (q[k] !== undefined && !(typeof q[k] === 'number' && q[k] > 0))
          out.push(`${at}: ${k} must be > 0`);
      const arch = q['archAt'];
      if (
        arch !== undefined &&
        (!Array.isArray(arch) ||
          arch.length !== 2 ||
          typeof arch[0] !== 'number' ||
          typeof arch[1] !== 'number' ||
          !(arch[0] >= 0 && arch[0] < arch[1] && arch[1] <= 1))
      )
        out.push(`${at}: archAt must be [from, to] shares of the length, 0 <= from < to <= 1`);
      if (q['deckOnTop'] !== undefined && typeof q['deckOnTop'] !== 'boolean')
        out.push(`${at}: deckOnTop must be true or false`);
    }
    if (q['kind'] === 'skyline') {
      const towers = q['towers'];
      if (towers !== undefined) {
        if (!Array.isArray(towers)) out.push(`${at}: towers must be a list`);
        else
          for (const [j, t] of (towers as Record<string, unknown>[]).entries()) {
            const tt = `${at}.towers[${j}]`;
            const at2 = t['at'];
            if (!Array.isArray(at2) || at2.length !== 2 || at2.some((n) => typeof n !== 'number'))
              out.push(`${tt}: at must be [a, b] numbers`);
            for (const k of ['heightM', 'widthM'])
              if (!(typeof t[k] === 'number' && t[k] > 0)) out.push(`${tt}: ${k} must be > 0`);
            if (t['depthM'] !== undefined && !(typeof t['depthM'] === 'number' && t['depthM'] > 0))
              out.push(`${tt}: depthM must be > 0`);
            if (typeof t['colour'] !== 'string' || !HEX.test(t['colour']))
              out.push(`${tt}: colour not #rrggbb`);
            if (t['crown'] !== undefined && !TOWER_CROWNS.some((c) => c === t['crown']))
              out.push(`${tt}: crown must be one of ${TOWER_CROWNS.join(', ')}`);
          }
      }
      for (const k of ['baseM', 'gridDeg'])
        if (q[k] !== undefined && !(typeof q[k] === 'number' && Number.isFinite(q[k])))
          out.push(`${at}: ${k} must be a number`);
    }
    if (q['kind'] === 'floor' && Array.isArray(q['area']) && (q['area'] as unknown[]).length < 3)
      out.push(`${at}: a floor area needs at least 3 points`);
  }
  return out;
}
