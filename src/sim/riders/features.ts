// Road features the riding model reads (playtest 1b quick wins, [decided] 2026-09-30): speed-boost
// pads and the car-carrier tow truck whose rear deck is a jump ramp. Both are pack data on a road
// (docs/content-packs.md, "Road file"); the numbers below are [default] tuning starting points.
// - A `boostPad` is a box in road space. A grounded rider who rides into it gets a boost: for
//   `holdS` seconds its top speed is raised by `boostMps` and an extra push drives it there.
// - A `rampTruck` is a solid box with a deck. The deck rises from the road at s0 to `lipHeightM`
//   over `rampLengthM`; riders ride up it and leave the lip airborne (the ordinary take-off rule).
//   Past a short lip platform the truck is its body: the car parked on the top deck, then the cab
//   (the integration skeptic's F2: the old level deck to s1 let a slow rider roll along inside
//   that car). The body is solid: a grounded rider meets it as a wall (from the deck, a crash: thrown
//   off the truck, never stuck on it), and an airborne rider who left the lip too slowly to clear
//   the truck hits it (a crash) instead of landing inside it; a rider fast enough to clear the truck
//   never lands on it. Only riders see the truck: it is not in the road's surface, so tumble bodies,
//   traffic and render's road mesh are unchanged. Riding into its side or front higher than a kerb
//   is a barrier contact. It faces riders travelling toward +s.
// - Set pieces from the race seed (playtest 1c item 2): a pad or truck with `params.slot` is one
//   candidate for that slot, there only when the race seed picks it (road/setpieces).
// - Moving decks (playtest 3, "the ramp trucks could be in motion"): a truck with its ramp down that
//   drives on (sim/modifiers' moving-ramp piece) publishes a SimMovingDeck each tick. `movingDecks`
//   turns the registry into the same box a parked truck is, at two moments of the tick: `now`, where
//   the trucks stand as the tick starts, for the rider's old position, and `next`, one step on, for
//   the position it moves to. A rider then rides up a deck exactly as it rides up a parked ramp, but
//   its climb is the RELATIVE speed times the slope (the deck under it moves too), so the faster it
//   catches the truck the bigger its air, and a rider barely faster than the truck meets its body.
import { HAZARD_FALLBACK_HEIGHT_M, hazardHeightM } from '../../core';
import {
  chooseSetPieces,
  RAMP_TRUCK_DEFAULTS,
  rampTruckShape,
  setPieceActive,
  type BakedFeature,
} from '../../road';
import type { FurnitureShape } from '../../road';
import { MOVING_DECKS_KEY, type SimConfig, type SimMovingDeck, type SimMovingDecks } from '../types';
import type { World } from '../world';

/** A boostPad's defaults: speed added (m/s) and how long the boost lasts (s). */
export const BOOST_DEFAULT_MPS = 8;
export const BOOST_DEFAULT_HOLD_S = 1.5;
/** The push toward the raised top speed while boosting, m/s² (before the speed multiplier). */
export const BOOST_ACCEL_MPS2 = 12;
/** A rampTruck's defaults, from the prop brief: 13.7° over an 11.5 m run to a 2.8 m lip (road/). */
export const RAMP_TRUCK_LENGTH_M = RAMP_TRUCK_DEFAULTS.rampLengthM;
export const RAMP_TRUCK_LIP_M = RAMP_TRUCK_DEFAULTS.lipHeightM;
/** A step up onto a deck higher than this, in one tick, is riding into the truck, m. */
export const KERB_M = 0.3;
/**
 * The truck body past the lip, from the truck model (tools/blender, `tow-truck`) at its 11.5 m run
 * and 2.8 m lip, and scaled with the ramp as render scales the model: the lip platform runs 0.45 m
 * to the top-deck car's rear, and that car's roof stands 1.16 m above the lip [default].
 */
export const TRUCK_PLATFORM_M = 0.45;
export const TRUCK_BODY_ABOVE_LIP_M = 1.16;

/** The candidates this race's seed picked, once per config (a race's config never changes). */
const picked = new WeakMap<SimConfig, ReadonlySet<string>>();
function pickedFor(config: SimConfig): ReadonlySet<string> {
  let chosen = picked.get(config);
  if (!chosen) {
    chosen = chooseSetPieces(config.road.edges, config.seed);
    picked.set(config, chosen);
  }
  return chosen;
}

/** Whether a set piece is there this race: no slot, or the seed picked it. */
function present(config: SimConfig, f: BakedFeature): boolean {
  return setPieceActive(f, pickedFor(config));
}

/**
 * A staging road's gap begins within this far past its truck's lip, m [default]. The Seven Mile's
 * hop starts 2 m past the lip (baked: truck s1 32, gap s0 34); a carrier truck on an ordinary road
 * has no gap beside it.
 */
const STAGING_GAP_AFTER_LIP_M = 10;
/** The short road into a staging road (the turn-off's connector) is at most this long, m [default]. */
export const STAGING_APPROACH_M = 100;

const stagings = new WeakMap<SimConfig, Map<number, boolean>>();

/**
 * Whether the edge is a staging road (playtest 4, P4-10; R3's open item): a platform built for a
 * hop, a ramp truck with a gap right past its lip, such as the Seven Mile's turn-off and way back.
 * Its edges guide rather than wall (riders/index.ts, barrierContact), and so does the short
 * connector that leads onto it, so a rider who holds right all the way in keeps the speed the hop
 * needs. Pack data, not a name: any road with that truck-then-gap shape is one.
 */
export function stagingGuideAt(config: SimConfig, edge: number): boolean {
  let known = stagings.get(config);
  if (!known) {
    known = new Map();
    stagings.set(config, known);
  }
  let guided = known.get(edge);
  if (guided === undefined) {
    guided = isStaging(config, edge) || leadsOntoStaging(config, edge);
    known.set(edge, guided);
  }
  return guided;
}

function isStaging(config: SimConfig, edge: number): boolean {
  const features = config.road.edges[edge]?.features ?? [];
  return features.some(
    (t) =>
      t.kind === 'rampTruck' &&
      present(config, t) &&
      features.some((g) => g.kind === 'gap' && g.s0 >= t.s1 && g.s0 - t.s1 <= STAGING_GAP_AFTER_LIP_M),
  );
}

function leadsOntoStaging(config: SimConfig, edge: number): boolean {
  const e = config.road.edges[edge];
  if (!e || e.length > STAGING_APPROACH_M) return false;
  return config.road
    .nextEdges(edge, 'to')
    .some((l) => config.route.allows(l.edge) && l.entersAt === 'from' && isStaging(config, l.edge));
}

function num(f: BakedFeature, key: string, fallback: number): number {
  const v = f.params?.[key];
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : fallback;
}

/** The boostPad whose box holds (s, d) on the edge, or null. */
export function boostPadAt(config: SimConfig, edge: number, s: number, d: number): BakedFeature | null {
  const features = config.road.edges[edge]?.features ?? [];
  for (const f of features) {
    if (f.s0 > s) break; // sorted by s0
    if (f.kind === 'boostPad' && s <= f.s1 && d >= f.d0 && d <= f.d1 && present(config, f)) return f;
  }
  return null;
}

/** A pad's boost: the speed it adds and how long it lasts. */
export function boostOf(f: BakedFeature): { mps: number; holdS: number } {
  return { mps: num(f, 'boostMps', BOOST_DEFAULT_MPS), holdS: num(f, 'holdS', BOOST_DEFAULT_HOLD_S) };
}

/** The moving decks this tick, as parked-truck boxes (see the header). */
export interface MovingDecks {
  /** Where each stands as the tick starts. */
  readonly now: readonly BakedFeature[];
  /** Where each stands as the tick ends: one step of its travel on. */
  readonly next: readonly BakedFeature[];
}

/** No moving decks: nearly every race, every tick. */
export const NO_DECKS: MovingDecks = { now: [], next: [] };

/** A moving deck as a parked truck's box, its foot `after` seconds on from where the registry has it. */
function deckFeature(d: SimMovingDeck, after: number): BakedFeature {
  const foot = d.s0 + d.dir * d.speedMps * after;
  const total = d.rampLengthM + d.bodyM;
  return {
    kind: 'rampTruck',
    id: `moving:${d.vehicle}`,
    s0: d.dir === 1 ? foot : foot - total,
    s1: d.dir === 1 ? foot + total : foot,
    d0: Math.min(d.d0, d.d1),
    d1: Math.max(d.d0, d.d1),
    params: {
      rampLengthM: d.rampLengthM,
      lipHeightM: d.lipHeightM,
      moving: true,
      edge: d.edge,
      facing: d.dir,
      speedMps: d.speedMps,
    },
  };
}

/**
 * The moving decks the riding model reads this tick: the registry sim/modifiers published at the end
 * of the last one (`systemState(world, MOVING_DECKS_KEY)`), at `now` and one `dt` on. The same
 * boxes (and so the same identities) serve every query of one rider's step.
 */
export function movingDecks(world: World, dt: number): MovingDecks {
  const live = (world.systems[MOVING_DECKS_KEY] as SimMovingDecks | undefined)?.live;
  if (!live || live.length === 0) return NO_DECKS;
  return { now: live.map((d) => deckFeature(d, 0)), next: live.map((d) => deckFeature(d, dt)) };
}

/** The way a truck faces along its edge: 1 toward increasing s (every parked truck), or a moving one's travel. */
function facingOf(f: BakedFeature): 1 | -1 {
  return f.params?.['facing'] === -1 ? -1 : 1;
}

/** How far along a truck from its ramp's foot the point s is, m (negative behind the foot). */
function intoOf(f: BakedFeature, s: number): number {
  return facingOf(f) === -1 ? f.s1 - s : s - f.s0;
}

/** A truck's speed along its edge, m/s (0 for a parked one). */
function truckSpeedOf(f: BakedFeature): number {
  const v = f.params?.['speedMps'];
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/** Whether a moving deck stands on the edge (a parked truck is on its own edge's feature list). */
function onEdge(f: BakedFeature, edge: number): boolean {
  return f.params?.['edge'] === edge;
}

/** How far along a truck its body starts (the top-deck car's rear), from its ramp's foot, m. */
function bodyIntoOf(f: BakedFeature): number {
  const { run } = rampTruckShape(f);
  return run + (TRUCK_PLATFORM_M * run) / RAMP_TRUCK_LENGTH_M;
}

/** The top of a rampTruck's body above the road: the top-deck car's roof. */
export function truckBodyTop(f: BakedFeature): number {
  const { lip } = rampTruckShape(f);
  return lip + (TRUCK_BODY_ABOVE_LIP_M * lip) / RAMP_TRUCK_LIP_M;
}

/**
 * A rampTruck's body (the top-deck car and the cab) as a box on its edge, m: from where it starts past
 * the lip platform to the truck's front, its whole width (sim/riders/supports.ts lands riders on its top).
 */
export function truckBodyBox(f: BakedFeature): { s0: number; s1: number; d0: number; d1: number } {
  const into = bodyIntoOf(f);
  return facingOf(f) === -1
    ? { s0: f.s0, s1: f.s1 - into, d0: f.d0, d1: f.d1 }
    : { s0: f.s0 + into, s1: f.s1, d0: f.d0, d1: f.d1 };
}

/** A truck's velocity along its edge's +s, m/s: 0 for a parked one, a moving deck's travel. */
export function truckVelocityS(f: BakedFeature): number {
  return truckSpeedOf(f) * facingOf(f);
}

/**
 * A rampTruck's height at a point of its box: the ramp from 0 at its foot to the lip height at the
 * lip, the lip platform, then the body's top (solid, not a deck anyone rides).
 */
function deckOf(f: BakedFeature, s: number): number {
  const { run, lip } = rampTruckShape(f);
  const into = intoOf(f, s);
  if (into < run) return (lip * into) / run;
  return into < bodyIntoOf(f) ? lip : truckBodyTop(f);
}

/**
 * Height of a ramp truck above the road at (edge, s, d); 0 off every truck. Over a truck's body it
 * is the body's top; with `bodies: false` the body counts as 0 (what an airborne rider may land on).
 * `moving` is the tick's moving decks (`movingDecks`), checked beside the edge's parked trucks.
 */
export function deckHeight(
  config: SimConfig,
  edge: number,
  s: number,
  d: number,
  opts: { bodies?: boolean; moving?: readonly BakedFeature[] } = {},
): number {
  const features = config.road.edges[edge]?.features ?? [];
  let h = 0;
  for (const f of features) {
    if (f.s0 > s) break;
    if (f.kind !== 'rampTruck' || s > f.s1 || d < f.d0 || d > f.d1 || !present(config, f)) continue;
    if (opts.bodies === false && intoOf(f, s) >= bodyIntoOf(f)) continue;
    const deck = deckOf(f, s);
    if (deck > h) h = deck;
  }
  for (const f of opts.moving ?? []) {
    if (!onEdge(f, edge) || s < f.s0 || s > f.s1 || d < f.d0 || d > f.d1) continue;
    if (opts.bodies === false && intoOf(f, s) >= bodyIntoOf(f)) continue;
    const deck = deckOf(f, s);
    if (deck > h) h = deck;
  }
  return h;
}

/** The rampTruck (or moving deck, from `moving`) whose body holds (s, d), or null. */
export function truckBodyAt(
  config: SimConfig,
  edge: number,
  s: number,
  d: number,
  moving: readonly BakedFeature[] = [],
): BakedFeature | null {
  const f = rampTruckAt(config, edge, s, d, moving);
  return f && intoOf(f, s) >= bodyIntoOf(f) ? f : null;
}

/**
 * The slowest a rider can leave a rampTruck's lip and clear its body, landing on the road past its
 * front (s1): v² = g·x² / (2·cos²θ·(lip + x·tanθ)), x from the lip to the front, θ the ramp's angle.
 * For a moving deck this is the speed over the deck, in the truck's own frame (see `clearsBody`).
 */
export function truckClearMps(f: BakedFeature, gravity: number): number {
  const { run, lip } = rampTruckShape(f);
  const x = Math.max(0, f.s1 - f.s0 - run);
  const tan = lip / run;
  const cos2 = 1 / (1 + tan * tan);
  return Math.sqrt((gravity * x * x) / (2 * cos2 * (lip + x * tan)));
}

/** The truck's speed along a rider's heading `dir`, m/s: negative when they meet head on. */
function truckAlong(f: BakedFeature, dir: 1 | -1): number {
  return truckSpeedOf(f) * facingOf(f) * dir;
}

/**
 * Whether a rider going `speed` along its heading `dir` (along the edge) is fast enough over a truck
 * to clear its body. A parked truck wants `truckClearMps`; a moving one wants that much more than
 * the truck's own speed along the rider's heading, so a rider barely faster than the truck, or one
 * riding into its front, never clears it.
 */
export function clearsBody(f: BakedFeature, speed: number, dir: 1 | -1, gravity: number): boolean {
  const along = truckAlong(f, dir);
  return along >= 0 && speed - along >= truckClearMps(f, gravity);
}

/**
 * How fast a rider closes on a truck along its heading, m/s: the whole speed for a parked truck, the
 * speed relative to it for a moving one. The impact a collision with its body carries.
 */
export function truckClosingMps(f: BakedFeature, speed: number, dir: 1 | -1): number {
  return Math.max(0, speed - truckAlong(f, dir));
}

/**
 * Solid road hazards (the pitch deck's #12, run W-U: the ferry deck's parked pickups and coffee cart,
 * the clear-cut's stumps and log piles, the festival's chainsaw bears). A `hazard` feature whose
 * `params.solid` is true is a box a riding rider cannot pass through: from s0 to s1 and d0 to d1,
 * `params.heightM` tall (when absent, its object's drawn height, core HAZARD_OBJECT_HEIGHT_M, else
 * HAZARD_DEFAULT_HEIGHT_M; the hitbox audit's contract). The bike meets it with its own capsule
 * (sim/riders/furniture.ts; playtest 4: the same contact, and the same closing-speed rule, as the
 * street furniture). `params.object` names what it is (a `pickup`, a `stump`...) for the events and for
 * render, which draws it. Hazards belong off the lanes (the verge bands): traffic, the rival AI and the
 * tumble do not see them, and the road lint refuses one over a lane. A hazard with no `solid` is what it
 * was before: data nothing in the sim reads.
 */
export const HAZARD_DEFAULT_HEIGHT_M = HAZARD_FALLBACK_HEIGHT_M;
/** The bike's reach beside a ramp truck: half its width across, m (riders' `truckSideContact`). */
export const HAZARD_REACH_D_M = 0.5;

/** Whether a feature is a solid hazard. */
export function isSolidHazard(f: BakedFeature): boolean {
  return f.kind === 'hazard' && f.params?.['solid'] === true;
}

/**
 * Solid hazards that are light (playtest 4, "solid but forgiving": light or breakable things are knocked
 * aside with a wobble, heavy fixed things are solid by closing speed): the festival's barricades, boards on
 * legs like the set pieces' sawhorse, which a rider rides through. [default]
 */
export const LIGHT_HAZARD_OBJECTS: readonly string[] = ['barricade'];

/** Whether a solid hazard is light (ridden through with a wobble, never a crash). */
export function isLightHazard(f: BakedFeature): boolean {
  return LIGHT_HAZARD_OBJECTS.includes(hazardObject(f));
}

/** A solid hazard's height above the road, m. */
export function hazardTop(f: BakedFeature): number {
  const o = f.params?.['object'];
  return num(f, 'heightM', hazardHeightM(typeof o === 'string' && o ? o : undefined, undefined));
}

/** What a solid hazard is (its `params.object`), or `hazard`. */
export function hazardObject(f: BakedFeature): string {
  const o = f.params?.['object'];
  return typeof o === 'string' && o ? o : 'hazard';
}

/** A solid hazard as the contact sees it (sim/riders/furniture.ts): its footprint in the road frame. */
export interface HazardPiece {
  feature: BakedFeature;
  shape: FurnitureShape;
  /** A key no other solid hazard of the network has (1 and up). */
  key: number;
}

/** A road-aligned box from s0..s1 and d0..d1 as a footprint. */
export function boxShape(s0: number, s1: number, d0: number, d1: number): FurnitureShape {
  const hu = Math.abs(s1 - s0) / 2;
  const hv = Math.abs(d1 - d0) / 2;
  return { s: (s0 + s1) / 2, d: (d0 + d1) / 2, r: 0, hu, hv, us: 1, ud: 0, reachS: hu, reachD: hv };
}

const hazardPieces = new WeakMap<SimConfig, (readonly HazardPiece[])[]>();

/**
 * The solid parts of the live road set pieces (a lane vote's gantry post), as sim/modifiers publishes them
 * for the tick the riders step next (the maintainer, 2026-10-06: "a road race in a physical world with honest
 * edges"; nothing drawn is a ghost). Each is a solid hazard of one edge for as long as its piece is live, met
 * by the one rule for heavy fixed things exactly as the road's own. The registry is made with the first part
 * and never otherwise, so a race with none hashes as before.
 */
export const PIECE_SOLIDS_KEY = 'pieceSolids';
export interface PieceSolid {
  edge: number;
  /** A key no other solid hazard has (sim/modifiers: past every road hazard's). */
  key: number;
  feature: BakedFeature;
}
export interface PieceSolids {
  live: PieceSolid[];
}

/**
 * The solid hazards on an edge whose box reaches within `reach` of s (playtest 4: met by the same
 * contact as the street furniture, sim/riders/furniture.ts, its box exactly as the hitbox audit holds it).
 * With `world`, the live set pieces' solid parts on it too.
 */
export function solidHazardsNear(
  config: SimConfig,
  edge: number,
  s: number,
  reach: number,
  world?: World,
): HazardPiece[] {
  let byEdge = hazardPieces.get(config);
  if (!byEdge) hazardPieces.set(config, (byEdge = []));
  let list = byEdge[edge];
  if (!list) {
    list = (config.road.edges[edge]?.features ?? [])
      .filter(isSolidHazard)
      .map((f, i) => ({ feature: f, shape: boxShape(f.s0, f.s1, f.d0, f.d1), key: edge * 65536 + i + 1 }));
    byEdge[edge] = list;
  }
  const near = list.filter((p) => Math.abs(p.shape.s - s) <= reach + p.shape.reachS);
  const pieces = (world?.systems[PIECE_SOLIDS_KEY] as PieceSolids | undefined)?.live;
  if (!pieces || pieces.length === 0) return near;
  for (const p of pieces) {
    if (p.edge !== edge) continue;
    const f = p.feature;
    const shape = boxShape(f.s0, f.s1, f.d0, f.d1);
    if (Math.abs(shape.s - s) <= reach + shape.reachS) near.push({ feature: f, shape, key: p.key });
  }
  return near;
}

/** The rampTruck (or moving deck, from `moving`) whose box holds (s, d), or null. */
export function rampTruckAt(
  config: SimConfig,
  edge: number,
  s: number,
  d: number,
  moving: readonly BakedFeature[] = [],
): BakedFeature | null {
  const features = config.road.edges[edge]?.features ?? [];
  for (const f of features) {
    if (f.s0 > s) break;
    if (f.kind === 'rampTruck' && s <= f.s1 && d >= f.d0 && d <= f.d1 && present(config, f)) return f;
  }
  for (const f of moving) {
    if (onEdge(f, edge) && s >= f.s0 && s <= f.s1 && d >= f.d0 && d <= f.d1) return f;
  }
  return null;
}
