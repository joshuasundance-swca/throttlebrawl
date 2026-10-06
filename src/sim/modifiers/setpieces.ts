// Road set pieces (W-P "fill the world", the maintainer, 2026-10-01b: "events and set pieces:
// roadwork, crash scenes, parades, a farm truck shedding hay, speed traps"). Each is an event
// modifier whose effect is `set-piece` (docs/content-packs.md, "Event modifiers"); `piece` picks
// one of the behaviours below, a closed list in code, and the entry's data picks the vehicles,
// the look of its people and props, and the words on its sign.
//
// How a race gets them (all from the `modifiers` stream, so no other system's rolls move):
// - At init every resolved modifier rolls its chance (× the `modifiers.setPieceChance` slider),
//   always drawing, so the stream advances the same whatever fires. The fired ones are kept up to
//   the event's `modifiersPerRace`, picked by `weight`, and each is placed at a race progress in its
//   `atProgress` window: on the traffic corridor, on a stretch with no bridge, barrier, split zone,
//   ramp, pad or cop lot, at least SPACING_M from another piece.
// - It stays pending (nothing on the road) until a racer comes within ACTIVATE_M of it. Then it
//   goes live: its vehicles are placed through traffic's public placeVehicle (parked `oddity`
//   types, which traffic edges round, crash a rider who rides into them and score near misses;
//   the hay truck is a moving truck), its props appear, and `modifierStart` fires (the bark cue).
// - Once every racer is END_PAST_M past it (or the race is over) its props go and `modifierEnd`
//   fires. Its vehicles stay with traffic, which recycles them like any other.
//
// The pieces (each takes the route-forward lane nearest the centre line, where traffic parks a
// stopped vehicle, and its shoulder side):
// - roadwork: a work truck with an arrow board, a taper and a line of cones, a sawhorse, and a
//   flagger with a SLOW paddle on the shoulder. Cones scatter when anything rides through them.
// - crash-scene: a stalled car and the tow truck hooking it (a light bar), a taper of road flares
//   and a cop on the shoulder waving traffic by. Nobody is hurt.
// - parade: floats parked in the lane (each with its dressing; `inflatable` puts a giant balloon
//   over the lead float), marchers walking beside them, barricades at its head.
// - hay-spill: a farm truck heading your way at a crawl, its hay stacked high, dropping bales
//   off the back as racers close in. Riding into a bale is a wobble; bales scatter.
// - speed-trap: an officer on the shoulder with a radar on a tripod. He never leaves it: he calls
//   it in. A player who passes him faster than `limitMps` (× the speed multiplier) brings the law:
//   a fielded cop still waiting in the lot is moved to the trap and summoned at once (his siren,
//   cause `speed-trap`, then he pulls out after the speeder); a cop already out chases the speeder
//   (as after chaos near him). The lot cop keeps his own timing until then (sim/cops).
// Every piece puts a warning sign SIGN_LEAD_M ahead of it on its shoulder side.
// People never get hit: anyone a rider bears down on steps out of the way toward the verge.
//
// Run W-T (the pitch deck's #9, "weird events that move"; the numbers are in ./moving.ts):
// - boat-slide: a pickup crawling along with a boat trailer; once a racer closes in, the trailer
//   lets go and the skiff slews across the centre line and stops there (a big hazard while it slides).
// - log-spill: a log truck on a downhill sheds its logs as racers close in; they roll to rest across
//   both lanes, and riding over one is a hop.
// - cable-runaway: on a cable street only (`needsTag: "cable-line"`), a cable car climbing ahead
//   loses its grip as racers close in and rolls back down at them, shoving the cars behind it.
// - lane-vote: a gantry over the road splits two events (`left`, `right`: modifier ids); the side a
//   player rides under picks the one that turns up `voteAheadM` further on (an AI-only race: the
//   first racer through). Both candidates' room is reserved at the start.
// - animal-crossing: a crossing guard and a few animals (`animal`, a traffic-type id) crossing the
//   road through the pedestrian system (a gator crossing for the Keys' vote).
// - Any piece may carry `serial`: one joke over four small signs, punchline last.
// Each moving piece's moment fires `setPieceBeat` (a bell, a bark).
//
// Playtest 3 (the maintainer, 2026-10-03: "The ramp trucks could be in motion"):
// - moving-ramp: a car carrier (`vehicle`, a tow truck's size) drives ahead in the outermost
//   route-forward lane at its cruise speed, on a straight stretch kept clear of bridges and walls.
//   Until a racer is within `MOVING.rampDropM` behind it, it is an ordinary big vehicle. Then its ramp
//   comes down (`setPieceBeat` `rampDown`) and, until the piece ends, its box is a moving deck: each
//   tick the piece publishes it in the `decks` registry (SimMovingDeck, `publishDecks` below), the
//   riders ride up it and jump off its lip like a parked ramp truck's but at the speed relative to
//   it (sim/riders/features.ts), and traffic leaves contacts with it to the riders. The faster a
//   racer catches it, the bigger the air; one barely faster than the truck meets its body.
import { atan2, clamp, cos, nextFloat, sin, type EntityId } from '../../core';
import type { EdgeLink, RoadPos } from '../../road';
import { addHeat, CHAOS_MEMORY_TICKS, COP_CHASING, COP_PARKED, copsState, HEAT } from '../cops';
import { placePed } from '../peds';
import { riderState } from '../riders';
import { slopeAt, startFlight } from '../riders/air';
import { placeVehicle, toCorridor, trafficState, type Corridor } from '../traffic';
import { fromCorridor, lanesAt } from '../traffic/corridor';
import {
  MOVING_DECKS_KEY,
  type PropKind,
  type PropSnapshot,
  type SimConfig,
  type SimModifierDef,
  type SimModifierEffect,
  type SimMovingDeck,
  type SimMovingDecks,
} from '../types';
import { emit, speedMultiplierOf, systemState, type Mover, type World } from '../world';
import {
  gantrySpan,
  hopVy,
  logTargetCd,
  MOVING,
  movingDeckOf,
  rollStep,
  serialLeads,
  slideStep,
  voteSide,
  type Slide,
} from './moving';

/** The pieces this file implements (`set-piece` effects' `piece`). */
export const SET_PIECES = [
  'roadwork',
  'crash-scene',
  'parade',
  'hay-spill',
  'speed-trap',
  'boat-slide',
  'log-spill',
  'cable-runaway',
  'lane-vote',
  'animal-crossing',
  'moving-ramp',
] as const;
export type SetPieceName = (typeof SET_PIECES)[number];

/** [default] starting values, to be tuned on the phone. */
export const SET_PIECE = {
  /** A piece goes live when a racer is this far short of it, m (well past traffic's 125 m fairness range). */
  activateM: 350,
  /** It ends once every racer is this far past it, m. */
  endPastM: 150,
  /** The warning sign stands this far ahead of the piece, m. */
  signLeadM: 160,
  /** Pieces keep at least this far apart along the road, m. */
  spacingM: 220,
  /** Placement tries per piece. */
  placeTries: 40,
  /** Pieces stay inside this share of the route (never on the grid or at the line). */
  minProgress: 0.08,
  maxProgress: 0.94,
  /** Sharpest bend a piece may sit on, 1/m (it must read at speed). */
  maxKappa: 1 / 90,
  /**
   * A shortcut whose bypassed span is longer than this, m, is a junction choice between two real
   * roads (run W-S: Key West's North Roosevelt Blvd, Lake Samish's shore roads), not a short cut:
   * a piece may stand on the main way, and a racer who takes the other road misses it, as with any
   * fork. Only `branchEndM` at each end of the span stays clear. The hand-made shortcuts are all
   * under 1.3 km, so none of their placements move.
   */
  longBranchM: 2000,
  branchEndM: 200,
  /** A rider's box (traffic's). */
  riderLengthM: 2.0,
  riderWidthM: 0.8,
  /** A person steps aside when a rider is this many seconds (plus 6 m) away and this close across. */
  dodgeLeadS: 1.6,
  dodgeAcrossM: 2.2,
  dodgeMps: 4.5,
  /** Speed kept after riding through a cone or flare, a sawhorse, and a hay bale. */
  coneScrub: 0.985,
  barricadeScrub: 0.9,
  baleScrub: 0.8,
  wobbleKickRad: 0.22,
  /** The hay truck: crawl speed, metres between dropped bales, bales, and how close racers must be. */
  hayTruckMps: 12,
  baleEveryM: 16,
  bales: 9,
  baleDropRangeM: 260,
  /** The speed trap's default limit, m/s (about 65 mph), before the speed multiplier. */
  trapLimitMps: 29,
  gravity: 9.81,
};

/** One placed piece. Plain data (it hashes with the world). */
export interface SetPiece {
  /** Index into config.modifiers, and the effect's index in its `effects`. */
  mod: number;
  eff: number;
  piece: string;
  /** Corridor u of the piece's start, and its length along the route. */
  u: number;
  len: number;
  /** The closed lane's centre (corridor cd), its width, and +1 or -1: the outward (shoulder) side in cd. */
  laneCd: number;
  laneW: number;
  side: number;
  /** 0 pending, 1 live, 2 over. */
  phase: number;
  startTick: number;
  /** Entity ids of the vehicles it placed, and their traffic type indices. */
  vehicles: number[];
  vehicleTypes: number[];
  /**
   * Per vehicle, where it is held across the road (corridor cd): pulled off onto the verge, just
   * outside the drivable width, so riders, rivals and traffic all get by. A stopped vehicle in a
   * one-lane direction walls the road: neither the rival AI nor the bot ever passes it (the parked
   * boat's known AI follow-up), and one on the shoulder is where rivals ride. 0 leaves it to traffic
   * (the moving hay truck).
   */
  vehicleCd: number[];
  /** Hay bales dropped, and the u where the next one drops. */
  dropped: number;
  nextDropU: number;
  /** The cop the speed trap brought (entity id, -1 for none yet) and whether a player has tripped it. */
  cop: number;
  tripped: number;
  /** W-T: 1 once the piece's moment has happened (unhitched, lost its grip, shedding, voted). */
  beat: number;
  /** The vehicle this piece drives itself (index into `vehicles`, -1 none): the skiff, the cable car. */
  drive: number;
  /** The driven vehicle's corridor u and cd, its speed along the route (m/s; negative rolls back), its yaw. */
  mu: number;
  mcd: number;
  mv: number;
  myaw: number;
  /** How far the cable car has rolled back, m. */
  rolled: number;
  /**
   * #391: how many times a moving piece has put its vehicle on the road (it waits for the leading
   * racer, and puts it back if traffic took it before the beat, up to `MOVING.respawns` times).
   */
  spawns: number;
  /** The furthest of its signs ahead of it, m (the warning sign, or the first serial sign). */
  lead: number;
  /**
   * Lane vote: where the picked event goes (corridor u), the two candidates (modifier indices, -1
   * none), the split across the road (cd), the gantry's width, and the side that won (0 not yet,
   * -1 left, 1 right).
   */
  voteU: number;
  voteLeft: number;
  voteRight: number;
  splitCd: number;
  span: number;
  voted: number;
}

/** One prop. Positions are corridor coordinates: u, cd, and h above the road surface. */
export interface SetProp {
  id: number;
  piece: number;
  kind: PropKind;
  variant: string;
  label: string;
  u: number;
  cd: number;
  h: number;
  vu: number;
  vcd: number;
  vh: number;
  /** Heading offset from the route direction, radians; tilt and its rate (knocked over). */
  yaw: number;
  tilt: number;
  spin: number;
  moving: boolean;
  /** A person stepping aside: 1 while they do, the cd they head for. */
  dodging: number;
  dodgeTo: number;
  /** Riding on a vehicle (entity id, -1 for none), offset ahead along the route and height. */
  attach: number;
  along: number;
  up: number;
  /** Walking speed along the route, m/s (marchers), 0 standing. */
  walk: number;
  /** W-T: a gantry's width, m (0 for every other kind). */
  span: number;
  /** W-T: the last rider who hopped this log (-1 none), so one log is one hop each. */
  hit: number;
}

export interface SetPieceState {
  pieces: SetPiece[];
  props: SetProp[];
  nextPropId: number;
  /** The route's start on the corridor, and its length there. */
  u0: number;
  routeLen: number;
}

export function setPieceState(world: World): SetPieceState {
  return systemState<SetPieceState>(world, 'setPieces', () => ({
    pieces: [],
    props: [],
    nextPropId: 1,
    u0: 0,
    routeLen: 0,
  }));
}

// ---- data helpers -------------------------------------------------------------------------

function str(e: SimModifierEffect, key: string, fallback: string): string {
  const v = e[key];
  return typeof v === 'string' && v !== '' ? v : fallback;
}

function num(e: SimModifierEffect, key: string, fallback: number): number {
  const v = e[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function list(e: SimModifierEffect, key: string): readonly string[] {
  const v = e[key];
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

function effectOf(config: SimConfig, p: SetPiece): SimModifierEffect | undefined {
  return config.modifiers[p.mod]?.effects[p.eff];
}

function isSetPiece(e: SimModifierEffect): boolean {
  return e.kind === 'set-piece' && (SET_PIECES as readonly string[]).includes(String(e['piece']));
}

/** A piece's serial-sign lines (at most four). */
function serialOf(e: SimModifierEffect): readonly string[] {
  return list(e, 'serial').slice(0, 4);
}

/** Whether a piece keeps its own warning sign: always, unless serial signs stand in for it. */
function keepsSign(e: SimModifierEffect): boolean {
  return str(e, 'signText', '') !== '' || serialOf(e).length === 0;
}

/** The furthest of an effect's signs ahead of its piece, m. */
function leadOf(e: SimModifierEffect): number {
  const serial = serialOf(e);
  return serial.length > 0
    ? Math.max(...serialLeads(serial.length, SET_PIECE.signLeadM, keepsSign(e)))
    : SET_PIECE.signLeadM;
}

/** A piece goes live this far ahead of a racer: further when its signs stand further out. */
function activateFor(p: SetPiece): number {
  return Math.max(SET_PIECE.activateM, p.lead + 190);
}

/** The modifier index a lane vote names (a content id, or a bare id in any pack), or -1. */
function modByRef(config: SimConfig, ref: string): number {
  if (ref === '') return -1;
  return config.modifiers.findIndex((m) => m.contentId === ref || m.contentId.endsWith(`:${ref}`));
}

/** A modifier's first set-piece effect a vote may pick (not a vote, not tied to a road tag), or -1. */
function votableEffect(config: SimConfig, mi: number): number {
  const effects = config.modifiers[mi]?.effects ?? [];
  return effects.findIndex(
    (e) => isSetPiece(e) && e['piece'] !== 'lane-vote' && str(e, 'needsTag', '') === '',
  );
}

/** Whether any of the route's roads carries the scenery tag (sampled every 20 m of the corridor). */
function routeHasTag(config: SimConfig, c: Corridor, tag: string): boolean {
  const pos: RoadPos = { edge: 0, s: 0, d: 0, dir: 1 };
  for (let u = c.lo; u <= c.hi; u += 20) {
    fromCorridor(c, u, 0, c.routeDir, pos);
    if (!config.route.allows(pos.edge)) continue;
    const edge = config.road.edges[pos.edge];
    if (edge?.tags.some((t) => t.tag === tag && pos.s >= t.s0 && pos.s <= t.s1)) return true;
  }
  return false;
}

/** The route's mean grade over [u, u + dir·len], in the route's direction (negative: downhill). */
function routeGrade(config: SimConfig, c: Corridor, u: number, len: number): number {
  const pos: RoadPos = { edge: 0, s: 0, d: 0, dir: 1 };
  let sum = 0;
  let n = 0;
  for (let a = 0; a <= len; a += 10) {
    fromCorridor(c, u + c.routeDir * a, 0, c.routeDir, pos);
    sum += config.road.frameAt(pos.edge, pos.s).grade * pos.dir;
    n++;
  }
  return n > 0 ? sum / n : 0;
}

/** A traffic type's index by content id, or -1. */
function typeIndex(config: SimConfig, contentId: string): number {
  return contentId === '' ? -1 : config.trafficTypes.findIndex((t) => t.contentId === contentId);
}

// ---- placement ----------------------------------------------------------------------------

/** The route-forward length a piece covers from its start, m. */
function pieceLength(piece: string, floats: number): number {
  switch (piece) {
    case 'roadwork':
      return 78;
    case 'crash-scene':
      return 66;
    case 'parade':
      return 34 + 16 * Math.max(1, floats);
    case 'hay-spill':
    case 'log-spill':
      return 40;
    case 'boat-slide':
      return 60;
    case 'cable-runaway':
      return 150;
    case 'moving-ramp':
      return MOVING.rampReachM;
    case 'animal-crossing':
      return 10 + MOVING.animals * MOVING.animalGapM;
    default:
      return 12;
  }
}

// Run W-U: a piece's verge vehicles never stand among a road's solid hazards (the ferry's pickups,
// the festival's bears), and no piece stands on a ferry (NO_PIECE_TAGS).
const AVOID_FEATURES = new Set(['ramp', 'gap', 'rampTruck', 'boostPad', 'copSpawn', 'hazard']);
const NO_PIECE_TAGS = new Set(['bridge', 'ferry']);

/**
 * The pieces that put nothing on the verge (#391): the cable car climbs and rolls in its lane, so it
 * may stand between walls, as SF's cable streets are built (sf-cable-line-grade is walled for 440
 * of its 760 m, which left the default route no stretch for it).
 */
const WALLS_OK = new Set(['cable-runaway']);

/**
 * Whether a stretch [u, u + dir·len] (plus the sign lead behind it) can hold a piece; with `tag`,
 * the piece itself (not its signs' run-up) must lie on roads carrying that scenery tag. With
 * `walls`, a rail or wall beside it is fine.
 */
function stretchOk(
  config: SimConfig,
  c: Corridor,
  u: number,
  len: number,
  lead = SET_PIECE.signLeadM,
  tag = '',
  walls = false,
): boolean {
  const road = config.road;
  const dir = c.routeDir;
  const pos: RoadPos = { edge: 0, s: 0, d: 0, dir: 1 };
  for (let a = -lead - 10; a <= len + 10; a += 8) {
    const uu = u + dir * a;
    if (uu < c.lo + 20 || uu > c.hi - 20) return false;
    fromCorridor(c, uu, 0, dir, pos);
    if (!config.route.allows(pos.edge)) return false;
    if (road.branchSideAt(pos.edge, pos.s) !== 0) return false;
    // The sign's run-up needs only to be on the route; the piece itself needs open road.
    if (a < -10) continue;
    if (
      !walls &&
      (road.barrierAt(pos.edge, pos.s, 'left') !== null || road.barrierAt(pos.edge, pos.s, 'right') !== null)
    )
      return false;
    if (Math.abs(road.kappaAt(pos.edge, pos.s)) > SET_PIECE.maxKappa) return false;
    if (lanesAt(road, c, uu, dir).length === 0) return false;
    const edge = road.edges[pos.edge];
    if (!edge) return false;
    if (edge.tags.some((t) => NO_PIECE_TAGS.has(t.tag) && pos.s >= t.s0 - 10 && pos.s <= t.s1 + 10))
      return false;
    if (tag !== '' && !edge.tags.some((t) => t.tag === tag && pos.s >= t.s0 && pos.s <= t.s1)) return false;
    for (const f of edge.features) {
      if (f.s0 > pos.s + 25) break;
      if (AVOID_FEATURES.has(f.kind) && pos.s >= f.s0 - 25 && pos.s <= f.s1 + 25) return false;
    }
  }
  return true;
}

/**
 * Whether the moving ramp truck's stretch [u, u + len] is straight enough to land on, |kappa| at
 * most `MOVING.rampMaxKappa` (a flight follows most of a bend, but a tight one would send it off
 * the road): the jump it gives comes down on the stretch ahead of the truck.
 */
function straightEnough(config: SimConfig, c: Corridor, u: number, len: number): boolean {
  const dir = c.routeDir;
  const pos: RoadPos = { edge: 0, s: 0, d: 0, dir: 1 };
  for (let a = 0; a <= len; a += 10) {
    fromCorridor(c, u + dir * a, 0, dir, pos);
    if (Math.abs(config.road.kappaAt(pos.edge, pos.s)) > MOVING.rampMaxKappa) return false;
  }
  return true;
}

/**
 * The route-progress spans a shortcut skips: from its split zone to where its connector rejoins the
 * main path (following each connector's default way on, at most a few roads). A rider on the
 * shortcut never passes a piece placed there, so none is.
 */
export function bypassedSpans(config: SimConfig): [number, number][] {
  const { road, route } = config;
  const main = new Set(route.mainEdges);
  const out: [number, number][] = [];
  for (const z of route.shortcuts) {
    const a = Math.min(route.progressAt(z.edge, z.s0), route.progressAt(z.edge, z.s1));
    let edge = z.toEdge;
    let end: 'from' | 'to' = 'to';
    let b = Number.NaN;
    for (let hop = 0; hop < 8; hop++) {
      const link: EdgeLink | undefined = road.nextEdges(edge, end)[0];
      if (!link) break;
      if (main.has(link.edge)) {
        const len = road.edges[link.edge]?.length ?? 0;
        b = route.progressAt(link.edge, link.entersAt === 'from' ? 0 : len);
        break;
      }
      edge = link.edge;
      end = link.entersAt === 'from' ? 'to' : 'from';
    }
    // A rejoin that cannot be found: assume the rest of the route is bypassed.
    out.push([Number.isFinite(a) ? a : 0, Number.isFinite(b) && b > a ? b : Infinity]);
  }
  return out;
}

/** Rolls and places the race's set pieces (the modifiers phase's init). */
export function initSetPieces(world: World, config: SimConfig): void {
  const st = setPieceState(world);
  const tr = trafficState(world);
  const c = tr.corridor;
  const rng = world.rng.modifiers;
  if (config.modifiers.length === 0 || c.edges.length === 0) return;
  const start = toCorridor(c, { edge: config.route.start.edge, s: config.route.start.s, d: 0, dir: 1 });
  if (!start) return;
  st.u0 = start.u;
  st.routeLen = Math.max(0, c.routeDir === 1 ? c.hi - start.u : start.u - c.lo);
  // A long bypass is a junction choice (SET_PIECE.longBranchM): only its two ends stay clear.
  const bypassed = bypassedSpans(config).flatMap(([a, b]): [number, number][] =>
    Number.isFinite(b) && b - a > SET_PIECE.longBranchM
      ? [
          [a, a + SET_PIECE.branchEndM],
          [b - SET_PIECE.branchEndM, b],
        ]
      : [[a, b]],
  );
  const scale = Math.max(0, world.params['modifiers.setPieceChance'] ?? 1);
  // Every modifier rolls, always drawing, so the stream advances the same whatever fires.
  const fired: number[] = [];
  config.modifiers.forEach((m, i) => {
    const roll = nextFloat(rng);
    if (roll < clamp(m.chance * scale, 0, 1) && m.effects.some(isSetPiece)) fired.push(i);
  });
  // A piece tied to a road tag (the cable car's cable street) is dropped before the pick on a route
  // without that tag, so it never takes a slot it cannot fill. The rolls above are already drawn.
  const tags = new Map<string, boolean>();
  const fits = (i: number) =>
    (config.modifiers[i]?.effects ?? []).every((e) => {
      const tag = isSetPiece(e) ? str(e, 'needsTag', '') : '';
      if (tag === '') return true;
      if (!tags.has(tag)) tags.set(tag, routeHasTag(config, c, tag));
      return tags.get(tag) === true;
    });
  for (let k = fired.length - 1; k >= 0; k--) if (!fits(fired[k] ?? -1)) fired.splice(k, 1);
  // Over the event's cap: a weighted pick without replacement.
  const cap = Math.max(0, Math.floor(config.event.modifiersPerRace ?? fired.length));
  const chosen: number[] = [];
  const pool = [...fired];
  while (chosen.length < cap && pool.length > 0) {
    const weights = pool.map((i) => Math.max(0.0001, config.modifiers[i]?.weight ?? 1));
    let r = nextFloat(rng) * weights.reduce((a, b) => a + b, 0);
    let k = 0;
    while (k < pool.length - 1 && r >= (weights[k] ?? 0)) r -= weights[k++] ?? 0;
    chosen.push(pool[k] ?? 0);
    pool.splice(k, 1);
  }
  chosen.sort((a, b) => a - b);
  for (const mi of chosen) {
    const m = config.modifiers[mi] as SimModifierDef;
    m.effects.forEach((e, ei) => {
      if (!isSetPiece(e)) return;
      const piece = String(e['piece']);
      const len = pieceLength(piece, list(e, 'floats').length);
      const lead = leadOf(e);
      const tag = str(e, 'needsTag', '');
      // A log spill wants a downhill (`minDownGrade`): the first half of the tries insist on one.
      const downhill = num(e, 'minDownGrade', 0);
      const lo = Math.max(SET_PIECE.minProgress, m.atProgress[0]);
      const hi = Math.min(SET_PIECE.maxProgress, m.atProgress[1]);
      const walls = WALLS_OK.has(piece);
      if (tag !== '' || piece === 'moving-ramp') {
        // #391: a piece tied to a road tag picks among the spots that fit, every 10 m of its window,
        // rather than hoping a random try lands on a street that may be a fifth of the route.
        const fits: number[] = [];
        const step = 10 / Math.max(1, st.routeLen);
        for (let p = lo; p <= hi; p += step) {
          const u = st.u0 + c.routeDir * p * st.routeLen;
          if (
            roomFor(st, bypassed, u, len, lead, piece === 'moving-ramp' ? MOVING.rampTailM : undefined) &&
            stretchOk(config, c, u, len, lead, tag, walls) &&
            (piece !== 'moving-ramp' || straightEnough(config, c, u, len))
          )
            fits.push(u);
        }
        const u = fits[Math.min(fits.length - 1, Math.floor(nextFloat(rng) * fits.length))];
        const placed = u === undefined ? null : newPiece(config, c, mi, ei, piece, u, len, lead);
        if (placed) st.pieces.push(placed);
        return;
      }
      for (let t = 0; t < SET_PIECE.placeTries; t++) {
        const p = lo + (Math.max(lo, hi) - lo) * nextFloat(rng);
        const u = st.u0 + c.routeDir * p * st.routeLen;
        if (!roomFor(st, bypassed, u, len, lead) || !stretchOk(config, c, u, len, lead, tag)) continue;
        if (piece === 'moving-ramp' && !straightEnough(config, c, u, len)) continue;
        if (downhill > 0 && t < SET_PIECE.placeTries / 2 && routeGrade(config, c, u, len) > -downhill)
          continue;
        const placed = newPiece(config, c, mi, ei, piece, u, len, lead);
        if (!placed) continue;
        if (piece === 'lane-vote' && !reserveVote(config, c, st, bypassed, placed, e)) continue;
        st.pieces.push(placed);
        return;
      }
    });
  }
}

/**
 * Whether a piece at u (len long, its signs `lead` ahead) keeps clear of the others and of every
 * bypass. With `tail`, only the last `tail` metres of the piece must clear the bypasses (the signs
 * and the rest of its stretch may overlap one): a piece that drives on ahead of the field, whose
 * end every racer who took a shortcut still rides to once it rejoins.
 */
function roomFor(
  st: SetPieceState,
  bypassed: readonly [number, number][],
  u: number,
  len: number,
  lead: number,
  tail?: number,
): boolean {
  const near = (at: number, l: number) => Math.abs(at - u) < SET_PIECE.spacingM + l;
  if (st.pieces.some((q) => near(q.u, q.len) || (q.voteLeft >= 0 && near(q.voteU, q.len)))) return false;
  // Never on a stretch a shortcut bypasses: every racer must ride past it.
  const from = tail === undefined ? Math.abs(u - st.u0) - lead - 10 : Math.abs(u - st.u0) + len - tail;
  const to = Math.abs(u - st.u0) + len + 10;
  return !bypassed.some(([a, b]) => from < b && to > a);
}

/** A pending piece at u in the route-forward lane nearest the centre line, or null without a lane. */
function newPiece(
  config: SimConfig,
  c: Corridor,
  mod: number,
  eff: number,
  piece: string,
  u: number,
  len: number,
  lead: number,
): SetPiece | null {
  const lane = lanesAt(config.road, c, u, c.routeDir)[0];
  if (!lane) return null;
  return {
    mod,
    eff,
    piece,
    u,
    len,
    laneCd: lane.cd,
    laneW: lane.width,
    side: lane.cd < 0 ? -1 : 1,
    phase: 0,
    startTick: -1,
    vehicles: [],
    vehicleTypes: [],
    vehicleCd: [],
    dropped: 0,
    nextDropU: 0,
    cop: -1,
    tripped: 0,
    beat: 0,
    drive: -1,
    mu: 0,
    mcd: 0,
    mv: 0,
    myaw: 0,
    rolled: 0,
    spawns: 0,
    lead,
    voteU: 0,
    voteLeft: -1,
    voteRight: -1,
    splitCd: 0,
    span: 0,
    voted: 0,
  };
}

/**
 * A lane vote reserves room for whichever event it picks, `voteAheadM` (to `voteSearchM` more)
 * past the gantry, long enough for the longer of the two; and its gantry's split and width. False
 * when either candidate is missing from the race or there is no room.
 */
function reserveVote(
  config: SimConfig,
  c: Corridor,
  st: SetPieceState,
  bypassed: readonly [number, number][],
  p: SetPiece,
  e: SimModifierEffect,
): boolean {
  const left = modByRef(config, str(e, 'left', ''));
  const right = modByRef(config, str(e, 'right', ''));
  const le = votableEffect(config, left);
  const re = votableEffect(config, right);
  if (left < 0 || right < 0 || le < 0 || re < 0) return false;
  const effects = [config.modifiers[left]?.effects[le], config.modifiers[right]?.effects[re]];
  let len = 0;
  let lead = 0;
  for (const x of effects) {
    if (!x) return false;
    len = Math.max(len, pieceLength(String(x['piece']), list(x, 'floats').length));
    lead = Math.max(lead, leadOf(x));
  }
  for (let a = MOVING.voteAheadM; a <= MOVING.voteAheadM + MOVING.voteSearchM; a += 20) {
    const u = p.u + c.routeDir * a;
    // Like any piece, never at the line.
    if (Math.abs(u - st.u0) + len > SET_PIECE.maxProgress * st.routeLen) break;
    if (!roomFor(st, bypassed, u, len, lead) || !stretchOk(config, c, u, len, lead)) continue;
    const g = gantrySpan(lanesAt(config.road, c, p.u, c.routeDir), p.side);
    p.voteU = u;
    p.voteLeft = left;
    p.voteRight = right;
    p.splitCd = g.splitCd;
    p.span = g.spanM;
    return true;
  }
  return false;
}

/**
 * A cd on the piece's shoulder side: `out` metres outside the closed lane's outer edge, kept on the
 * drivable width (lanes and shoulders) when it is wide enough.
 */
function shoulderCd(config: SimConfig, c: Corridor, p: SetPiece, u: number, out: number): number {
  const pos: RoadPos = { edge: 0, s: 0, d: 0, dir: 1 };
  fromCorridor(c, u, 0, c.routeDir, pos);
  const o = c.o[c.edges.indexOf(pos.edge)] ?? 1;
  const limit = bandEdge(config, c, p, u);
  const want = Math.abs(p.laneCd) + p.laneW / 2 + out;
  // Never further than 0.6 m past the drivable edge (the verge, on land: pieces avoid bridges),
  // and inside a rail or wall where one runs (a sign's run-up may cross a bridge).
  const sideName = p.side * o > 0 ? 'right' : 'left';
  const walled = config.road.barrierAt(pos.edge, pos.s, sideName) !== null;
  return p.side * Math.min(want, walled ? limit - 0.3 : limit + 0.6);
}

/** The drivable band's outer edge on the piece's side at u, as a distance from the centre line. */
function bandEdge(config: SimConfig, c: Corridor, p: SetPiece, u: number): number {
  const pos: RoadPos = { edge: 0, s: 0, d: 0, dir: 1 };
  fromCorridor(c, u, 0, c.routeDir, pos);
  const edge = config.road.edges[pos.edge];
  const o = c.o[c.edges.indexOf(pos.edge)] ?? 1;
  const a = (edge?.dMin ?? -5) * o;
  const b = (edge?.dMax ?? 5) * o;
  return Math.max(Math.abs(p.laneCd) + p.laneW / 2, p.side > 0 ? Math.max(a, b) : -Math.min(a, b));
}

// ---- going live ---------------------------------------------------------------------------

function addProp(
  st: SetPieceState,
  piece: number,
  spec: Partial<SetProp> & { kind: PropKind; u: number; cd: number },
): SetProp {
  const prop: SetProp = {
    id: st.nextPropId++,
    piece,
    variant: '',
    label: '',
    h: 0,
    vu: 0,
    vcd: 0,
    vh: 0,
    yaw: 0,
    tilt: 0,
    spin: 0,
    moving: false,
    dodging: 0,
    dodgeTo: 0,
    attach: -1,
    along: 0,
    up: 0,
    walk: 0,
    span: 0,
    hit: -1,
    ...spec,
  };
  st.props.push(prop);
  return prop;
}

/**
 * Places a vehicle `along` metres route-forward of the piece's start; its entity id, or -1. A
 * parked one stands on the verge, its inner side just outside the drivable width. A moving one
 * takes the route-forward lane of `rank` (0 the innermost; a rank past the last is the outermost).
 */
function placeOn(
  world: World,
  config: SimConfig,
  c: Corridor,
  p: SetPiece,
  contentId: string,
  along: number,
  moving: boolean,
  rank = 0,
): number {
  const type = typeIndex(config, contentId);
  if (type < 0) return -1;
  const t = config.trafficTypes[type];
  const v0 = moving ? (t && t.cruiseMps > 0 ? t.cruiseMps : SET_PIECE.hayTruckMps) : 0;
  const dir = c.routeDir === 1 ? 1 : -1;
  const tr = trafficState(world);
  const slot = placeVehicle(world, config, { type, u: p.u + dir * along, dir, rank, v0, speed: v0 });
  const id = tr.id[slot] ?? -1;
  if (id >= 0) {
    p.vehicles.push(id);
    p.vehicleTypes.push(type);
    const half = (t?.widthM ?? 2.4) / 2;
    p.vehicleCd.push(moving ? 0 : p.side * (bandEdge(config, c, p, p.u + dir * along) + half + 0.3));
    pinVehicles(world, p);
  }
  return id;
}

/** Holds the piece's parked vehicles on the shoulder (traffic would ease them back into the lane). */
function pinVehicles(world: World, p: SetPiece): void {
  const tr = trafficState(world);
  for (let k = 0; k < p.vehicles.length; k++) {
    const cd = p.vehicleCd[k] ?? 0;
    const slot = cd === 0 ? -1 : stillOurs(world, p, k);
    const mover = world.movers[p.vehicles[k] ?? -1];
    if (slot < 0 || !mover) continue;
    tr.cd[slot] = cd;
    fromCorridor(tr.corridor, tr.u[slot] ?? 0, cd, tr.dir[slot] ?? 1, mover.pos);
  }
}

function goLive(world: World, config: SimConfig, st: SetPieceState, index: number): void {
  const p = st.pieces[index];
  const e = p && effectOf(config, p);
  const m = p && config.modifiers[p.mod];
  if (!p || !e || !m) return;
  const c = trafficState(world).corridor;
  const dir = c.routeDir;
  const at = (along: number) => p.u + dir * along;
  // The cone or flare line narrows the lane to its inner half (a rider fits by; riding through the
  // cones scatters them), and the lane's outer edge, as distances from the centre line.
  const inner = Math.abs(p.laneCd) + 0.1;
  const outer = Math.abs(p.laneCd) + p.laneW / 2;
  const x = (outward: number) => p.side * outward; // outward distance from the centre line to cd
  const theme = str(e, 'theme', '');
  p.phase = 1;
  p.startTick = world.tick;
  // The warning sign, on the shoulder side, ahead of everything (unless serial signs stand in for it).
  if (keepsSign(e))
    addProp(st, index, {
      kind: 'sign',
      variant: p.piece,
      label: str(e, 'signText', ''),
      u: at(-SET_PIECE.signLeadM),
      cd: shoulderCd(config, c, p, at(-SET_PIECE.signLeadM), 1.2),
    });
  // Serial signs (W-T): one joke over up to four small signs, punchline last.
  const serial = serialOf(e);
  serialLeads(serial.length, SET_PIECE.signLeadM, keepsSign(e)).forEach((lead, i) =>
    addProp(st, index, {
      kind: 'sign',
      variant: 'serial',
      label: serial[i] ?? '',
      u: at(-lead),
      cd: shoulderCd(config, c, p, at(-lead), 0.9),
    }),
  );
  switch (p.piece) {
    case 'roadwork': {
      // A taper from the shoulder edge to the lane's inner edge over 30 m, then a line to the truck.
      for (let i = 0; i <= 6; i++) {
        const k = i / 6;
        addProp(st, index, { kind: 'cone', u: at(k * 30), cd: x(outer - k * (outer - inner)) });
      }
      for (let a = 36; a <= 72; a += 6) addProp(st, index, { kind: 'cone', u: at(a), cd: x(inner) });
      addProp(st, index, { kind: 'barricade', u: at(14), cd: x(outer - 0.6), variant: theme });
      const truck = placeOn(world, config, c, p, str(e, 'vehicle', ''), 50, false);
      if (truck >= 0)
        addProp(st, index, {
          kind: 'arrowBoard',
          u: at(50),
          cd: p.laneCd,
          attach: truck,
          along: -3.2,
          up: 2.6,
          variant: theme,
        });
      addProp(st, index, {
        kind: 'person',
        variant: str(e, 'person', 'flagger'),
        u: at(-6),
        cd: shoulderCd(config, c, p, at(-6), 0.6),
      });
      break;
    }
    case 'crash-scene': {
      for (let i = 0; i <= 7; i++) {
        const k = i / 7;
        addProp(st, index, { kind: 'flare', u: at(k * 36), cd: x(outer + 0.3 - k * (outer + 0.3 - inner)) });
      }
      placeOn(world, config, c, p, str(e, 'vehicle2', ''), 44, false);
      const tow = placeOn(world, config, c, p, str(e, 'vehicle', ''), 56, false);
      if (tow >= 0)
        addProp(st, index, {
          kind: 'lightbar',
          u: at(56),
          cd: p.laneCd,
          attach: tow,
          along: 2.2,
          up: 2.5,
          variant: theme,
        });
      addProp(st, index, {
        kind: 'person',
        variant: str(e, 'person', 'cop-waving'),
        u: at(-4),
        cd: shoulderCd(config, c, p, at(-4), 0.6),
      });
      break;
    }
    case 'parade': {
      const floats = list(e, 'floats');
      for (let k = 0; k < 2; k++)
        addProp(st, index, {
          kind: 'barricade',
          u: at(4 + k * 3),
          cd: x(inner + 0.5 + k * 1.1),
          variant: theme,
        });
      floats.forEach((id, i) => {
        const along = 30 + 16 * i;
        const v = placeOn(world, config, c, p, id, along, false);
        if (v >= 0) {
          addProp(st, index, {
            kind: 'floatDecor',
            variant: `${theme}-${i}`,
            u: at(along),
            cd: p.laneCd,
            attach: v,
            along: 0,
            up: 1.2,
          });
          if (i === 0 && e['inflatable'] === true)
            addProp(st, index, {
              kind: 'inflatable',
              variant: theme,
              u: at(along),
              cd: p.laneCd,
              attach: v,
              along: 0,
              up: 7,
            });
        }
      });
      const marchers = Math.max(0, Math.round(num(e, 'marchers', 6)));
      for (let i = 0; i < marchers; i++) {
        addProp(st, index, {
          kind: 'person',
          variant: str(e, 'person', 'marcher'),
          u: at(16 + i * ((16 * Math.max(1, floats.length)) / Math.max(1, marchers))),
          cd: x(inner + (i % 2 === 0 ? 0.4 : 1.0)),
          walk: 1.1,
        });
      }
      break;
    }
    case 'hay-spill': {
      const truck = placeOn(world, config, c, p, str(e, 'vehicle', ''), 20, true);
      if (truck >= 0) {
        addProp(st, index, {
          kind: 'hayLoad',
          variant: theme,
          u: at(20),
          cd: p.laneCd,
          attach: truck,
          along: -1.4,
          up: 1.3,
        });
        p.nextDropU = at(20);
      }
      // Two bales already on the road: the spill started before you got here.
      addProp(st, index, {
        kind: 'hayBale',
        variant: theme,
        u: at(0),
        cd: x(Math.abs(p.laneCd) - 0.4),
        yaw: 0.4,
      });
      addProp(st, index, {
        kind: 'hayBale',
        variant: theme,
        u: at(7),
        cd: x(Math.abs(p.laneCd) + 0.7),
        yaw: -0.3,
      });
      break;
    }
    case 'speed-trap': {
      addProp(st, index, {
        kind: 'radar',
        variant: theme,
        u: at(2.5),
        cd: shoulderCd(config, c, p, at(2.5), 1.0),
      });
      // The radar officer: he stays with the radar and calls it in.
      addProp(st, index, {
        kind: 'person',
        variant: 'cop-radar',
        u: at(0),
        cd: shoulderCd(config, c, p, at(0), 0.6),
      });
      break;
    }
    case 'boat-slide':
    case 'log-spill':
    case 'cable-runaway':
    case 'moving-ramp':
      // #391: their vehicles go on the road as the leading racer nears (keepVehicle), not now: from
      // here they would stand past traffic's keep-alive range, and traffic would take them.
      break;
    case 'lane-vote':
      addProp(st, index, {
        kind: 'gantry',
        variant: '',
        label: `${str(e, 'leftText', 'LEFT')} | ${str(e, 'rightText', 'RIGHT')}`,
        u: at(MOVING.gantryAlongM),
        cd: p.splitCd,
        span: p.span,
      });
      break;
    case 'animal-crossing': {
      addProp(st, index, {
        kind: 'person',
        variant: str(e, 'person', 'crossing-guard'),
        u: at(-6),
        cd: shoulderCd(config, c, p, at(-6), 0.6),
      });
      const animal = typeIndex(config, str(e, 'animal', ''));
      const t = config.trafficTypes[animal];
      if (animal < 0 || (t?.category !== 'animal' && t?.category !== 'pedestrian')) break;
      const count = Math.max(0, Math.min(8, Math.round(num(e, 'count', MOVING.animals))));
      const pos: RoadPos = { edge: 0, s: 0, d: 0, dir: 1 };
      for (let i = 0; i < count; i++) {
        // Alternate verges, staggered so they are mid-road at different moments.
        const from = (i % 2 === 0 ? 1 : -1) * p.side * (bandEdge(config, c, p, at(10)) + 0.4);
        fromCorridor(c, at(10 + i * MOVING.animalGapM), from, dir, pos);
        placePed(world, config, {
          type: animal,
          edge: pos.edge,
          s: pos.s,
          d: pos.d,
          crosses: true,
          timer: 0.2 + 0.9 * i,
        });
      }
      break;
    }
    default:
      break;
  }
  emit(world, 'modifierStart', -1, { id: m.contentId, kind: m.kind, piece: p.piece });
}

/**
 * Puts a vehicle the piece drives where the piece says: corridor u and cd, its speed (it is also
 * the speed traffic would carry it on at, so its own step barely moves it) and its yaw.
 */
function drive(world: World, p: SetPiece, k: number, u: number, cd: number, v: number, yaw: number): boolean {
  const slot = stillOurs(world, p, k);
  const tr = trafficState(world);
  const mover = world.movers[p.vehicles[k] ?? -1];
  if (slot < 0 || !mover) return false;
  const speed = Math.max(0, v);
  tr.u[slot] = u;
  tr.cd[slot] = cd;
  tr.v0[slot] = speed;
  mover.speed = speed;
  fromCorridor(tr.corridor, u, cd, tr.dir[slot] ?? 1, mover.pos);
  mover.yaw = yaw;
  return true;
}

/** A setPieceBeat event (W-T): the piece's moment, for sound, barks and the camera. */
function beat(
  world: World,
  config: SimConfig,
  p: SetPiece,
  name: string,
  actor: number,
  extra: Record<string, string> = {},
  target?: number,
): void {
  p.beat = 1;
  const id = config.modifiers[p.mod]?.contentId ?? '';
  emit(
    world,
    'setPieceBeat',
    actor,
    { beat: name, piece: p.piece, id, ...extra },
    target === undefined ? {} : { target },
  );
}

function end(world: World, config: SimConfig, st: SetPieceState, index: number): void {
  const p = st.pieces[index];
  const m = p && config.modifiers[p.mod];
  if (!p || !m) return;
  p.phase = 2;
  st.props = st.props.filter((q) => q.piece !== index);
  // W-T: a skiff at rest stays where it stopped (pinned, not moving); a cable car's grip catches and
  // it climbs on as traffic.
  if (p.piece === 'boat-slide' && p.drive >= 0 && drive(world, p, p.drive, p.mu, p.mcd, 0, p.myaw))
    p.vehicleCd[p.drive] = p.mcd === 0 ? 0.01 : p.mcd;
  if (p.piece === 'cable-runaway' && p.drive >= 0) {
    const slot = stillOurs(world, p, 0);
    if (slot >= 0)
      trafficState(world).v0[slot] = config.trafficTypes[p.vehicleTypes[0] ?? -1]?.cruiseMps ?? 4;
    p.drive = -1;
  }
  emit(world, 'modifierEnd', -1, { id: m.contentId, kind: m.kind, piece: p.piece });
}

// ---- each tick ----------------------------------------------------------------------------

interface RiderAt {
  m: Mover;
  u: number;
  cd: number;
  /** +1 riding route-forward, -1 the other way. */
  dir: number;
  racer: boolean;
  player: boolean;
}

function ridersOn(world: World, config: SimConfig, c: Corridor): RiderAt[] {
  const out: RiderAt[] = [];
  for (const m of world.movers) {
    if (m.kind !== 'rider') continue;
    const p = toCorridor(c, m.pos);
    if (!p) continue;
    const def = config.riders[m.riderIndex];
    out.push({
      m,
      u: p.u,
      cd: p.cd,
      dir: p.dir * c.routeDir >= 0 ? 1 : -1,
      racer: def?.faction !== 'law',
      player: def?.controller.kind === 'player',
    });
  }
  return out;
}

/** Whether a vehicle slot still holds what the piece placed there. */
function stillOurs(world: World, p: SetPiece, k: number): number {
  const tr = trafficState(world);
  const id = p.vehicles[k] ?? -1;
  const slot = tr.id.indexOf(id);
  return slot >= 0 && tr.type[slot] === p.vehicleTypes[k] ? slot : -1;
}

/**
 * Where each moving piece's vehicle starts, m route-forward of the piece's start (the boat slide's:
 * the tow's), and which of its vehicles its beat needs (the skiff is the boat slide's second).
 */
const MOVER_ALONG: Readonly<Record<string, number>> = {
  'boat-slide': 40,
  'log-spill': 20,
  'cable-runaway': 120,
  'moving-ramp': 40,
};
const moverIndex = (p: SetPiece) => (p.piece === 'boat-slide' ? 1 : 0);

/**
 * #391: a moving piece's vehicle goes on the road relative to the field. It waits until the leading
 * racer is within `spawnAheadM` of its spot (inside traffic's keep-alive range), and if traffic took
 * it before its beat, it goes back `spawnAheadM` ahead of the leader (a cable car only on its own
 * street, so only at its spot), at most `respawns` times. A piece that cannot place it plays on
 * without it and ends as any piece does.
 */
function keepVehicle(
  world: World,
  config: SimConfig,
  st: SetPieceState,
  p: SetPiece,
  racers: readonly RiderAt[],
): void {
  const spot = MOVER_ALONG[p.piece];
  if (spot === undefined || p.beat !== 0 || racers.length === 0 || p.spawns > MOVING.respawns) return;
  const k = moverIndex(p);
  if (p.vehicles.length > k && stillOurs(world, p, k) >= 0) return;
  const c = trafficState(world).corridor;
  const dir = c.routeDir;
  // The leading racer's place, m route-forward of the piece's start.
  let lead = -Infinity;
  for (const r of racers) lead = Math.max(lead, dir * (r.u - p.u));
  let along = spot;
  if (along - lead > MOVING.spawnAheadM) return; // the field is still far off
  if (along - lead < MOVING.spawnMinM) {
    along = lead + MOVING.spawnAheadM;
    const u = p.u + dir * along;
    const onRoute =
      p.piece !== 'cable-runaway' &&
      Math.abs(u - st.u0) < SET_PIECE.maxProgress * st.routeLen &&
      u > c.lo + 20 &&
      u < c.hi - 20 &&
      lanesAt(config.road, c, u, dir).length > 0;
    if (!onRoute) {
      p.spawns = MOVING.respawns + 1;
      return;
    }
  }
  p.spawns++;
  p.vehicles = [];
  p.vehicleTypes = [];
  p.vehicleCd = [];
  p.drive = -1;
  placeMover(world, config, c, p, along);
}

/** Puts a moving piece's vehicle(s) on the road `along` metres route-forward of its start. */
function placeMover(world: World, config: SimConfig, c: Corridor, p: SetPiece, along: number): void {
  const e = effectOf(config, p);
  if (!e) return;
  const at = (a: number) => p.u + c.routeDir * a;
  switch (p.piece) {
    case 'boat-slide': {
      // The pickup crawls along in the lane, the boat trailer on its hitch right behind it.
      const tow = placeOn(world, config, c, p, str(e, 'vehicle', ''), along, true);
      const boatType = typeIndex(config, str(e, 'vehicle2', ''));
      const towLen = config.trafficTypes[p.vehicleTypes[0] ?? -1]?.lengthM ?? 5.4;
      const boatLen = config.trafficTypes[boatType]?.lengthM ?? 6;
      const behind = along - (towLen + boatLen) / 2 - MOVING.towGapM;
      if (tow >= 0 && placeOn(world, config, c, p, str(e, 'vehicle2', ''), behind, true) >= 0) {
        p.drive = p.vehicles.length - 1;
        p.mu = at(behind);
        p.mcd = laneAt(config, c, p.mu, p).cd;
      }
      break;
    }
    case 'log-spill': {
      const truck = placeOn(world, config, c, p, str(e, 'vehicle', ''), along, true);
      if (truck >= 0) p.nextDropU = at(along);
      break;
    }
    case 'cable-runaway':
      // Climbing its street ahead, at a cable car's crawl.
      placeOn(world, config, c, p, str(e, 'vehicle', ''), along, true);
      break;
    case 'moving-ramp':
      // Driving in the outermost forward lane, so the faster lanes stay free for anyone who would
      // rather pass it than ride it.
      placeOn(world, config, c, p, str(e, 'vehicle', ''), along, true, Number.MAX_SAFE_INTEGER);
      break;
    default:
      break;
  }
}

/**
 * How far route-forward of its start a moving piece reaches while the field has yet to meet it, m:
 * its vehicle (the tow, the log truck, the cable car) until its beat, the log truck until it has
 * shed every log, and the ramp truck for as long as the piece lasts (its ramp is down from the beat
 * on, and the field still has to pass it). 0 for the other pieces.
 */
function moverReach(world: World, config: SimConfig, p: SetPiece): number {
  if (MOVER_ALONG[p.piece] === undefined) return 0;
  const logs = Math.round(num(effectOf(config, p) ?? { kind: '' }, 'logs', MOVING.logs));
  if (p.beat !== 0 && p.piece !== 'moving-ramp' && !(p.piece === 'log-spill' && p.dropped < logs)) return 0;
  const slot = stillOurs(world, p, 0);
  const tr = trafficState(world);
  return slot < 0 ? 0 : tr.corridor.routeDir * ((tr.u[slot] ?? p.u) - p.u);
}

/** Steps the set pieces: activation, the props' physics and contacts, the hay, the trap, the end. */
export function stepSetPieces(world: World, config: SimConfig, over: boolean): void {
  const st = setPieceState(world);
  if (st.pieces.length === 0) return;
  const tr = trafficState(world);
  const c = tr.corridor;
  const dir = c.routeDir;
  const dt = world.timeScale / 60;
  const riders = ridersOn(world, config, c);
  const racers = riders.filter((r) => r.racer);
  st.pieces.forEach((p, i) => {
    // Its parked vehicles stay on the verge for as long as traffic keeps them (a stopped one left
    // to drift back into a lane would wall it for whoever comes later: the cop, a straggler).
    if (p.phase === 2) {
      pinVehicles(world, p);
      return;
    }
    // Route-forward position of each racer relative to the piece's start.
    const rel = racers.map((r) => dir * (r.u - p.u));
    if (p.phase === 0) {
      if (rel.some((d) => d >= -activateFor(p) && d <= p.len)) goLive(world, config, st, i);
      else return;
    }
    // The end of the piece: its own length, or wherever the hay truck, a log or the skiff has got to.
    let endAlong = p.len;
    for (const q of st.props) if (q.piece === i) endAlong = Math.max(endAlong, dir * (q.u - p.u));
    if (p.drive >= 0 && p.piece === 'boat-slide') endAlong = Math.max(endAlong, dir * (p.mu - p.u));
    // #391: a moving piece lasts until the field has met its vehicle, wherever it has got to.
    endAlong = Math.max(endAlong, moverReach(world, config, p));
    if (over || (rel.length > 0 && rel.every((d) => d > endAlong + SET_PIECE.endPastM))) {
      end(world, config, st, i);
      return;
    }
    keepVehicle(world, config, st, p, racers);
    pinVehicles(world, p);
    if (p.piece === 'hay-spill') stepHay(world, config, st, p, i, racers);
    if (p.piece === 'speed-trap') stepTrap(world, config, p, riders);
    if (p.piece === 'boat-slide') stepBoat(world, config, p, racers, dt);
    if (p.piece === 'log-spill') stepLogTruck(world, config, st, p, i, racers);
    if (p.piece === 'cable-runaway') stepCable(world, config, p, racers, dt);
    if (p.piece === 'moving-ramp') stepRamp(world, config, p, racers);
    if (p.piece === 'lane-vote') stepVote(world, config, st, p, i, racers, dt);
  });
  stepProps(world, config, st, riders, dt);
  publishDecks(world, config, st);
}

/**
 * The moving ramp truck: until a racer is within `rampDropM` behind it, it is an ordinary big vehicle;
 * then its ramp comes down (`setPieceBeat` `rampDown`, the truck as the actor), for good.
 */
function stepRamp(world: World, config: SimConfig, p: SetPiece, racers: readonly RiderAt[]): void {
  if (p.beat !== 0) return;
  const tr = trafficState(world);
  const slot = stillOurs(world, p, 0);
  if (slot < 0) return;
  const dir = tr.corridor.routeDir;
  const u = tr.u[slot] ?? 0;
  const close = racers.some((r) => {
    const behind = dir * (u - r.u);
    return behind > 0 && behind < MOVING.rampDropM;
  });
  if (close) beat(world, config, p, 'rampDown', tr.id[slot] ?? -1);
}

/**
 * Publishes the moving decks (SimMovingDeck) for the tick the riders will step next: each ramp
 * truck whose ramp is down, where it stands now. Where its box crosses the join of two roads it is
 * on both, one entry for each edge (its rear, middle and front are mapped through the traffic
 * corridor), so a rider on either road meets the same deck. The registry is created with the first
 * deck and never otherwise, so a race with no moving ramp hashes as before; traffic skips contacts
 * with a vehicle named in it, and the riders ride it (sim/riders/features.ts).
 */
function publishDecks(world: World, config: SimConfig, st: SetPieceState): void {
  const live: SimMovingDeck[] = [];
  for (const p of st.pieces) {
    if (p.piece !== 'moving-ramp' || p.phase !== 1 || p.beat !== 1) continue;
    const tr = trafficState(world);
    const slot = stillOurs(world, p, 0);
    const id = slot < 0 ? -1 : (tr.id[slot] ?? -1);
    const mover = world.movers[id];
    const t = config.trafficTypes[p.vehicleTypes[0] ?? -1];
    if (slot < 0 || !mover || !t) continue;
    const e = effectOf(config, p);
    const run = e ? num(e, 'rampLengthM', MOVING.rampRunM) : MOVING.rampRunM;
    const lip = e ? num(e, 'lipHeightM', run * MOVING.rampSlope) : run * MOVING.rampSlope;
    // Rear, middle and front of its box along its travel, as corridor u and as road positions.
    const dir = tr.dir[slot] ?? 1;
    const rearU = (tr.u[slot] ?? 0) - (dir * t.lengthM) / 2;
    const pos: RoadPos = { edge: 0, s: 0, d: 0, dir: 1 };
    const edges = new Set<number>();
    for (const along of [0, t.lengthM / 2, t.lengthM]) {
      fromCorridor(tr.corridor, rearU + dir * along, tr.cd[slot] ?? 0, dir, pos);
      if (edges.has(pos.edge)) continue;
      edges.add(pos.edge);
      live.push(
        movingDeckOf(
          {
            vehicle: id,
            edge: pos.edge,
            foot: pos.s - pos.dir * along,
            dir: pos.dir,
            d: pos.d,
            speedMps: mover.speed,
            lengthM: t.lengthM,
            widthM: t.widthM,
          },
          run,
          lip,
        ),
      );
    }
  }
  const registry = world.systems[MOVING_DECKS_KEY] as SimMovingDecks | undefined;
  if (registry) registry.live = live;
  else if (live.length > 0) systemState<SimMovingDecks>(world, MOVING_DECKS_KEY, () => ({ live }));
}

/**
 * The route-forward lane nearest the centre line at u (its cd, and its outward sign), or the
 * piece's own lane where none is found. Lanes move across the corridor along the road, so a piece
 * that travels reads the lane where it is.
 */
export function laneAt(
  config: SimConfig,
  c: Corridor,
  u: number,
  p: SetPiece,
): { cd: number; side: number; width: number } {
  const lane = lanesAt(config.road, c, u, c.routeDir)[0];
  if (!lane) return { cd: p.laneCd, side: p.side, width: p.laneW };
  // Outward is away from the oncoming lanes (where there are none, away from cd 0).
  const oncoming = lanesAt(config.road, c, u, c.routeDir === 1 ? -1 : 1)[0];
  const away = oncoming ? lane.cd - oncoming.cd : lane.cd;
  return { cd: lane.cd, side: away < 0 ? -1 : 1, width: lane.width };
}

/**
 * The boat slide: the boat rides its hitch until a racer is within `unhitchM` behind it on open
 * road, then slides free (slideStep) and comes to rest across the centre line.
 */
function stepBoat(
  world: World,
  config: SimConfig,
  p: SetPiece,
  racers: readonly RiderAt[],
  dt: number,
): void {
  if (p.drive < 0) return;
  const tr = trafficState(world);
  const c = tr.corridor;
  const dir = c.routeDir;
  if (p.beat === 0) {
    const tow = stillOurs(world, p, 0);
    if (tow >= 0) {
      const towLen = config.trafficTypes[tr.type[tow] ?? -1]?.lengthM ?? 5.4;
      const boatLen = config.trafficTypes[p.vehicleTypes[p.drive] ?? -1]?.lengthM ?? 6;
      const tu = tr.u[tow] ?? p.mu;
      // The pickup holds its lane until the hitch goes: traffic would edge it round the boat (a
      // parked oddity right behind it), and the boat would follow it across the road.
      const lane = laneAt(config, c, tu, p);
      p.mv = world.movers[tr.id[tow] ?? -1]?.speed ?? p.mv;
      drive(world, p, 0, tu, lane.cd, p.mv, 0);
      p.mu = tu - dir * ((towLen + boatLen) / 2 + MOVING.towGapM);
      p.mcd = laneAt(config, c, p.mu, p).cd;
    }
    if (!drive(world, p, p.drive, p.mu, p.mcd, p.mv, 0)) return;
    const close = racers.some((r) => {
      const behind = dir * (p.mu - r.u);
      return behind > 0 && behind < MOVING.unhitchM;
    });
    // It lets go only on open road (no bridge, rail or tight bend under the slide), or when the hitch is gone.
    if ((close && stretchOk(config, c, p.mu - dir * 10, 40, 0)) || tow < 0)
      beat(world, config, p, 'unhitch', p.vehicles[p.drive] ?? -1);
    return;
  }
  // The lane where the boat is now (lanes shift across the corridor along the road), not where the
  // piece was placed.
  const lane = laneAt(config, c, p.mu, p);
  const s: Slide = { v: p.mv, cd: p.mcd, yaw: p.myaw };
  slideStep(s, lane.cd, lane.side, dt);
  p.mu += dir * s.v * dt;
  p.mv = s.v;
  p.mcd = s.cd;
  p.myaw = s.yaw;
  drive(world, p, p.drive, p.mu, p.mcd, p.mv, p.myaw);
}

/** The log truck: once a racer is within `shedRangeM` behind it, a log off the back every `logEveryM`. */
function stepLogTruck(
  world: World,
  config: SimConfig,
  st: SetPieceState,
  p: SetPiece,
  index: number,
  racers: readonly RiderAt[],
): void {
  const tr = trafficState(world);
  const dir = tr.corridor.routeDir;
  const slot = stillOurs(world, p, 0);
  if (slot < 0 || p.dropped >= Math.round(num(effectOf(config, p) ?? { kind: '' }, 'logs', MOVING.logs)))
    return;
  const u = tr.u[slot] ?? 0;
  const close = racers.some((r) => {
    const behind = dir * (u - r.u);
    return behind > 0 && behind < MOVING.shedRangeM;
  });
  if (!close || dir * (u - p.nextDropU) < 0) return;
  if (p.beat === 0) beat(world, config, p, 'shed', tr.id[slot] ?? -1);
  const t = config.trafficTypes[tr.type[slot] ?? -1];
  const speed = world.movers[tr.id[slot] ?? -1]?.speed ?? 0;
  const cd = tr.cd[slot] ?? p.laneCd;
  const back = u - dir * ((t?.lengthM ?? 16) / 2 + 0.8);
  // Across both lanes where the log lands (lanes shift across the corridor along the road): the
  // pattern is about the centre line between the forward lane and its oncoming twin.
  const lane = laneAt(config, tr.corridor, back, p);
  const centre = lane.cd - (lane.side * lane.width) / 2;
  const target = centre + logTargetCd(p.dropped, lane.cd - centre, lane.side);
  addProp(st, index, {
    kind: 'log',
    variant: str(effectOf(config, p) ?? { kind: '' }, 'theme', ''),
    u: back,
    cd,
    h: 1.9,
    vu: dir * speed * MOVING.logShare,
    vh: 0.5,
    vcd: (target - cd) * 0.9,
    dodgeTo: target,
    moving: true,
  });
  p.dropped++;
  p.nextDropU = u + dir * MOVING.logEveryM;
}

/**
 * The cable car: it climbs (traffic drives it) until a racer is within `runawayM` behind it, then
 * the grip goes and it rolls back down its street (rollStep), facing uphill, for up to `rollMaxM`.
 * Traffic's no-overlap rule shoves back any car behind it in its lane.
 */
function stepCable(
  world: World,
  config: SimConfig,
  p: SetPiece,
  racers: readonly RiderAt[],
  dt: number,
): void {
  const tr = trafficState(world);
  const dir = tr.corridor.routeDir;
  const slot = stillOurs(world, p, 0);
  if (slot < 0) return;
  if (p.beat === 0) {
    const u = tr.u[slot] ?? 0;
    const close = racers.some((r) => {
      const behind = dir * (u - r.u);
      return behind > 0 && behind < MOVING.runawayM;
    });
    if (!close) return;
    p.drive = 0;
    p.mu = u;
    p.mcd = tr.cd[slot] ?? p.laneCd;
    p.mv = world.movers[tr.id[slot] ?? -1]?.speed ?? 0;
    beat(world, config, p, 'runaway', tr.id[slot] ?? -1);
  }
  if (p.rolled < MOVING.rollMaxM) {
    p.mv = rollStep(p.mv, dt);
    p.mu += dir * p.mv * dt;
    if (p.mv < 0) p.rolled -= p.mv * dt;
  } else p.mv = 0; // the grip catches at last
  // In its lane wherever it has rolled to; traffic carries it at no speed of its own: the piece moves it.
  p.mcd = laneAt(config, tr.corridor, p.mu, p).cd;
  drive(world, p, 0, p.mu, p.mcd, 0, 0);
}

/**
 * The lane vote: the first player through under the gantry (an AI-only race: the first racer) picks
 * the event on the side they ride under; it goes in at the reserved spot and runs like any other.
 */
function stepVote(
  world: World,
  config: SimConfig,
  st: SetPieceState,
  p: SetPiece,
  index: number,
  racers: readonly RiderAt[],
  dt: number,
): void {
  if (p.voted !== 0 || p.voteLeft < 0) return;
  const dir = trafficState(world).corridor.routeDir;
  const gantryU = p.u + dir * MOVING.gantryAlongM;
  const players = racers.filter((r) => r.player);
  const voters = players.length > 0 ? players : racers;
  const voter = voters.find((r) => {
    const past = dir * (r.u - gantryU);
    return r.m.mode === 'Road' && past >= 0 && past <= r.m.speed * dt + 0.5;
  });
  if (!voter) return;
  const side = voteSide(voter.cd, p.splitCd, p.side);
  p.voted = side === 'right' ? 1 : -1;
  const mi = side === 'right' ? p.voteRight : p.voteLeft;
  const ei = votableEffect(config, mi);
  const e = config.modifiers[mi]?.effects[ei];
  const gantry = st.props.find((q) => q.piece === index && q.kind === 'gantry');
  if (gantry) gantry.variant = side;
  beat(world, config, p, 'vote', -1, { side, pick: config.modifiers[mi]?.contentId ?? '' }, voter.m.id);
  if (!e) return;
  const c = trafficState(world).corridor;
  const piece = String(e['piece']);
  const picked = newPiece(
    config,
    c,
    mi,
    ei,
    piece,
    p.voteU,
    pieceLength(piece, list(e, 'floats').length),
    leadOf(e),
  );
  if (picked) st.pieces.push(picked);
}

function stepHay(
  world: World,
  config: SimConfig,
  st: SetPieceState,
  p: SetPiece,
  index: number,
  racers: readonly RiderAt[],
): void {
  const tr = trafficState(world);
  const dir = tr.corridor.routeDir;
  const slot = stillOurs(world, p, 0);
  if (slot < 0 || p.dropped >= SET_PIECE.bales) return;
  const u = tr.u[slot] ?? 0;
  const close = racers.some((r) => {
    const behind = dir * (u - r.u);
    return behind > 0 && behind < SET_PIECE.baleDropRangeM;
  });
  if (!close || dir * (u - p.nextDropU) < 0) return;
  const t = config.trafficTypes[tr.type[slot] ?? -1];
  const speed = world.movers[tr.id[slot] ?? -1]?.speed ?? 0;
  const back = (t?.lengthM ?? 8) / 2 + 0.6;
  const wobble = p.dropped % 3 === 0 ? -0.5 : p.dropped % 3 === 1 ? 0.5 : 0;
  addProp(st, index, {
    kind: 'hayBale',
    variant: str(effectOf(config, p) ?? { kind: '' }, 'theme', ''),
    u: u - dir * back,
    cd: (tr.cd[slot] ?? p.laneCd) + wobble,
    h: 1.7,
    vu: dir * speed * 0.6,
    vh: 0.8,
    vcd: wobble * 0.8,
    spin: 1.5,
    moving: true,
  });
  p.dropped++;
  p.nextDropU = u + dir * SET_PIECE.baleEveryM;
}

function stepTrap(world: World, config: SimConfig, p: SetPiece, riders: readonly RiderAt[]): void {
  if (p.tripped) return;
  const c = trafficState(world).corridor;
  const dir = c.routeDir;
  const limit =
    num(effectOf(config, p) ?? { kind: '' }, 'limitMps', SET_PIECE.trapLimitMps) * speedMultiplierOf(config);
  for (const r of riders) {
    if (!r.player || r.m.mode !== 'Road') continue;
    const past = dir * (r.u - p.u);
    // Crossing his position this tick (within one tick's travel), going faster than the limit.
    if (past < 0 || past > r.m.speed * (world.timeScale / 60) + 0.5 || r.m.speed <= limit) continue;
    p.tripped = 1;
    callItIn(world, config, c, p, r.m.id);
    return;
  }
}

/**
 * The radar officer calls it in: a cop still in the lot (his siren not yet going) is moved to the
 * trap's shoulder, behind the speeder, and summoned at once; otherwise every cop already out
 * chases the speeder for the next CHAOS_MEMORY_TICKS, as after chaos near him.
 */
function callItIn(world: World, config: SimConfig, c: Corridor, p: SetPiece, speeder: EntityId): void {
  const cops = copsState(world);
  // Playtest 2 (sim/cops): the speeder's heat rises, and a cop from the lot answers before one
  // waiting up the road on patrol.
  addHeat(world, config, speeder, HEAT.speedTrap);
  const waiting = (id: number) => cops.phase[id] === COP_PARKED && cops.sirenOn[id] !== 1;
  const lot = cops.cops.find((id) => waiting(id) && (cops.patrolAt[id] ?? -1) < 0) ?? cops.cops.find(waiting);
  const cop = lot === undefined ? undefined : world.movers[lot];
  if (lot !== undefined && cop && cop.mode === 'Road') {
    const pos: RoadPos = { edge: 0, s: 0, d: 0, dir: 1 };
    fromCorridor(c, p.u - c.routeDir * 4, trapCopCd(config, c, p), c.routeDir, pos);
    cop.pos = pos;
    cop.speed = 0;
    cop.yaw = 0;
    cop.h = 0;
    cops.spawns[lot] = 1;
    cops.summonAt[lot] = cops.clock;
    cops.cause[lot] = 'speed-trap';
    p.cop = lot;
    return;
  }
  for (const id of cops.cops) {
    if (cops.phase[id] !== COP_CHASING) continue;
    cops.target[id] = speeder;
    cops.chaosUntil[id] = cops.clock + CHAOS_MEMORY_TICKS;
    if (p.cop < 0) p.cop = id;
  }
}

/** Where the summoned cop waits to pull out: on the shoulder, clear of every drive lane. */
function trapCopCd(config: SimConfig, c: Corridor, p: SetPiece): number {
  const edge = bandEdge(config, c, p, p.u);
  const outer = Math.abs(p.laneCd) + p.laneW / 2;
  return p.side * Math.max(outer + 0.6, Math.min(edge - 0.6, outer + 1.2));
}

/** A prop's half extents along and across the road, for contacts (0: not touchable). */
export function extent(kind: PropKind): [number, number] {
  switch (kind) {
    // Matched to render's read-at-speed sizes (render/event-props.ts, READ_SCALE): the flare's stick
    // and glow, the sawhorse's splayed feet, the bale's width (playtest 4 hitbox audit,
    // scripts/hitboxes.test.ts).
    case 'cone':
      return [0.36, 0.36];
    case 'flare':
      return [0.35, 0.25];
    case 'barricade':
      return [0.55, 1.2];
    case 'hayBale':
      return [0.7, 0.4];
    default:
      return [0, 0];
  }
}

function stepProps(
  world: World,
  config: SimConfig,
  st: SetPieceState,
  riders: readonly RiderAt[],
  dt: number,
): void {
  if (st.props.length === 0) return;
  if (st.props.some((q) => q.attach === -2)) st.props = st.props.filter((q) => q.attach !== -2);
  const tr = trafficState(world);
  const c = tr.corridor;
  const dir = c.routeDir;
  const g = SET_PIECE.gravity;
  for (const q of st.props) {
    // Riding on a vehicle: follow it.
    if (q.attach >= 0) {
      const p = st.pieces[q.piece];
      const v = world.movers[q.attach];
      const at =
        v && p && stillOurs(world, p, p.vehicles.indexOf(q.attach)) >= 0 ? toCorridor(c, v.pos) : null;
      // Traffic recycled the vehicle (everyone is long past): its dressing goes with it.
      if (!at) q.attach = -2;
      else {
        q.u = at.u + dir * q.along;
        q.cd = at.cd;
        q.h = q.up;
      }
      continue;
    }
    if (q.kind === 'person') {
      stepPerson(q, riders, dir, dt);
      continue;
    }
    if (q.kind === 'log') {
      stepLog(world, config, q, riders, dir, dt);
      continue;
    }
    const [hu, hd] = extent(q.kind);
    if (hu > 0 && !q.moving) {
      // Riders through it: the prop flies, the rider pays a little (a bale or a sawhorse wobbles).
      for (const r of riders) {
        if (r.m.mode !== 'Road' || r.m.h > 0.8) continue;
        if (
          Math.abs(r.u - q.u) > hu + SET_PIECE.riderLengthM / 2 ||
          Math.abs(r.cd - q.cd) > hd + SET_PIECE.riderWidthM / 2
        )
          continue;
        knock(q, r.dir * dir * r.m.speed, q.cd >= r.cd ? 1 : -1, r.m.speed);
        if (q.kind === 'cone' || q.kind === 'flare') r.m.speed *= SET_PIECE.coneScrub;
        else {
          r.m.speed *= q.kind === 'hayBale' ? SET_PIECE.baleScrub : SET_PIECE.barricadeScrub;
          const away = q.cd >= r.cd ? -1 : 1;
          r.m.yaw = clamp(r.m.yaw + away * r.dir * SET_PIECE.wobbleKickRad, -1.2, 1.2);
          emit(world, 'wobble', r.m.id, {
            cause: 'setPiece',
            prop: q.kind,
            piece: st.pieces[q.piece]?.piece ?? '',
          });
        }
        break;
      }
      // Traffic through it: knocked aside, no harm done to the car.
      if (!q.moving) {
        for (let k = 0; k < tr.id.length; k++) {
          const t = config.trafficTypes[tr.type[k] ?? -1];
          if (!t || (t.cruiseMps <= 0 && t.category === 'oddity')) continue;
          const du = Math.abs((tr.u[k] ?? 0) - q.u);
          const dd = Math.abs((tr.cd[k] ?? 0) - q.cd);
          if (du > hu + t.lengthM / 2 || dd > hd + t.widthM / 2) continue;
          const speed = world.movers[tr.id[k] ?? -1]?.speed ?? 0;
          knock(q, (tr.dir[k] ?? 1) * speed, q.cd >= (tr.cd[k] ?? 0) ? 1 : -1, speed);
          break;
        }
      }
    }
    if (!q.moving) continue;
    // Ballistic, then sliding on the road until it settles.
    q.vh -= g * dt;
    q.u += q.vu * dt;
    q.cd += q.vcd * dt;
    q.h += q.vh * dt;
    q.tilt = clamp(q.tilt + q.spin * dt, 0, q.kind === 'hayBale' ? 0.2 : 1.57);
    if (q.h <= 0) {
      q.h = 0;
      q.vh = q.vh < -1.2 ? -q.vh * 0.3 : 0;
      const f = Math.max(0, 1 - 4 * dt);
      q.vu *= f;
      q.vcd *= f;
      if (q.vh === 0 && Math.abs(q.vu) + Math.abs(q.vcd) < 0.25) {
        q.vu = 0;
        q.vcd = 0;
        q.moving = false;
      }
    }
  }
}

/**
 * A log (W-T): off the truck it falls, then rolls along the road (its `tilt` is the roll) and
 * across to where it comes to rest (`dodgeTo`), slowing to a stop. A rider low over it hops it
 * (once per log); traffic rolls over it and nudges it on.
 */
function stepLog(
  world: World,
  config: SimConfig,
  q: SetProp,
  riders: readonly RiderAt[],
  dir: number,
  dt: number,
): void {
  for (const r of riders) {
    if (r.m.mode !== 'Road' || r.m.h > MOVING.hopMaxH || q.hit === r.m.id || q.h > 0.6) continue;
    if (Math.abs(r.u - q.u) > MOVING.logHalfDepthM + SET_PIECE.riderLengthM / 4) continue;
    if (Math.abs(r.cd - q.cd) > MOVING.logHalfLenM + SET_PIECE.riderWidthM / 2) continue;
    q.hit = r.m.id;
    hop(world, config, r.m);
    // A rolling log shoves on a little from whoever hops it.
    q.vu += r.dir * dir * 0.6;
    q.moving = true;
  }
  if (!q.moving) return;
  const g = SET_PIECE.gravity;
  if (q.h > 0 || q.vh > 0) {
    q.vh -= g * dt;
    q.h = Math.max(0, q.h + q.vh * dt);
    if (q.h === 0) q.vh = q.vh < -2 ? -q.vh * 0.25 : 0;
  }
  q.u += q.vu * dt;
  q.tilt += (dir * q.vu * dt) / MOVING.logRadiusM;
  // Across to its resting place, and slowing along the road.
  const across = q.dodgeTo - q.cd;
  const step = Math.max(0.8, Math.abs(q.vcd)) * dt;
  q.cd += clamp(across, -step, step);
  const speed = Math.abs(q.vu);
  const slowed = Math.max(0, speed * (1 - MOVING.logRollDrag * dt) - MOVING.logRollFriction * dt);
  q.vu = speed > 0 ? (q.vu / speed) * slowed : 0;
  if (q.h === 0 && q.vh === 0 && slowed < 0.25 && Math.abs(across) < 0.05) {
    q.vu = 0;
    q.vcd = 0;
    q.moving = false;
  }
}

/**
 * Riding over a log (W-T: "riding over one is a hop"): the rider leaves the road with a small lift
 * that grows with speed, as off a lip (sim/riders flies and lands it), and loses a little speed.
 */
function hop(world: World, config: SimConfig, m: Mover): void {
  const rs = riderState(world);
  const vy = hopVy(m.speed);
  const surface = config.road.surfaceHeight(m.pos.edge, m.pos.s, m.pos.d);
  m.mode = 'Airborne';
  m.h = 0.05;
  m.speed *= MOVING.hopScrub;
  rs.yAbs[m.id] = surface + m.h;
  rs.vy[m.id] = vy;
  rs.airTicks[m.id] = 0;
  startFlight(rs, m, world.inputs[m.id], rs.pitch[m.id] ?? slopeAt(config, m));
  emit(world, 'jump', m.id, { speed: m.speed, vyMps: vy, hop: true, cause: 'log' });
}

/** Sends a prop flying from something at speed `along` (corridor u velocity) passing on side `side`. */
function knock(q: SetProp, along: number, side: number, speed: number): void {
  const heavy = q.kind === 'hayBale' || q.kind === 'barricade';
  q.vu = along * (heavy ? 0.45 : 0.8);
  q.vcd = side * (1.5 + (heavy ? 0.05 : 0.12) * speed);
  q.vh = heavy ? 1.2 + 0.03 * speed : 2 + 0.08 * speed;
  q.spin = heavy ? 1 : 6;
  q.yaw += side * 0.6;
  q.moving = true;
}

/** People step toward the verge when a rider bears down on them, and marchers walk on. */
function stepPerson(q: SetProp, riders: readonly RiderAt[], dir: number, dt: number): void {
  if (q.dodging === 0) {
    for (const r of riders) {
      if (r.m.mode !== 'Road') continue;
      const ahead = r.dir * dir * (q.u - r.u); // how far ahead of the rider, along its travel
      const reach = r.m.speed * SET_PIECE.dodgeLeadS + 6;
      if (ahead < -1 || ahead > reach || Math.abs(q.cd - r.cd) > SET_PIECE.dodgeAcrossM) continue;
      q.dodging = 1;
      // Away from the rider, toward whichever side is further from its line.
      q.dodgeTo = q.cd + (q.cd >= r.cd ? 1 : -1) * (SET_PIECE.dodgeAcrossM + 1.5);
      q.yaw = q.cd >= r.cd ? 1.2 : -1.2;
      q.moving = true;
      q.walk = 0;
      break;
    }
  }
  if (q.dodging === 1) {
    const step = SET_PIECE.dodgeMps * dt;
    const d = q.dodgeTo - q.cd;
    q.cd += clamp(d, -step, step);
    if (Math.abs(d) <= step) {
      q.dodging = 2;
      q.moving = false;
    }
  }
  if (q.walk > 0) q.u += dir * q.walk * dt;
}

// ---- snapshot -----------------------------------------------------------------------------

/** The live props in world terms, for the snapshot. */
export function propSnapshots(world: World, config: SimConfig): PropSnapshot[] {
  const st = setPieceState(world);
  if (st.props.length === 0) return [];
  const c = trafficState(world).corridor;
  const road = config.road;
  const pos: RoadPos = { edge: 0, s: 0, d: 0, dir: 1 };
  return st.props.map((q) => {
    fromCorridor(c, q.u, q.cd, c.routeDir, pos);
    const w = road.toWorld(pos.edge, pos.s, pos.d, q.h);
    const f = road.frameAt(pos.edge, pos.s);
    const tx = f.tx * pos.dir;
    const tz = f.tz * pos.dir;
    const cs = cos(q.yaw);
    const sn = sin(q.yaw);
    const fx = cs * tx - sn * tz;
    const fz = cs * tz + sn * tx;
    const m = config.modifiers[st.pieces[q.piece]?.mod ?? -1];
    return {
      id: q.id,
      kind: q.kind,
      variant: q.variant,
      label: q.label,
      piece: m?.contentId ?? '',
      x: w.x,
      y: w.y,
      z: w.z,
      heading: atan2(-fx, -fz),
      tilt: q.tilt,
      moving: q.moving,
      ...(q.kind === 'gantry' ? { spanM: q.span } : {}),
    };
  });
}
