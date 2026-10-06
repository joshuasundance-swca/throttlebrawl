// sim/smash: the roadside smashables (run W-T, the pitch deck's #4 part 2, "the road fights back":
// "lobster-trap stacks ('CATCH OF THE DAY'), mailbox rows ('RETURN TO SENDER') and parking meters
// ('METER EXPIRED') smash ... kick a rival into one for a named takedown in slow motion").
//
// What a race gets [default]:
// - Placement, once, on the first tick (after every system's init, so the road set pieces are
//   already placed and kept clear of): walking the route's main way from the grid, a cluster every
//   `SMASH.spacingM` / `smash.density` metres (jittered ±half), on a side picked at random, standing
//   on the verge band just past the outermost lane (`SMASH.gapM` clear of it) where the band is wide
//   enough for it, on open road: no bridge, barrier, split zone, ramp, pad or truck, no set piece.
//   The kind comes from the region's `smashables` (SimConfig.smashables) by weight, among those whose
//   road tags cover the spot (a kind with no tags stands anywhere). A cluster is one to a few of
//   that kind along the road (a row of mailboxes, a few meters, a table or two). Everything rolls on
//   the sim's own `smash` substream of the race seed, so no other system's rolls move.
// - Contacts, every tick, in the peds phase (after combat, before tumble, so a crash it emits
//   tumbles on the same tick). A riding rider (or one in the air under 0.8 m) whose box meets a
//   standing smashable smashes it (a `smash` event):
//   - knocked into it: the rider took a landed `hit` (a kick, a punch, a swing) from another rider
//     within `SMASH.knockWindowS` (1 s). It goes down: a `crash` with `cause: 'smash'` (combat then
//     credits a `scenery` takedown to whoever hit him, with its slow motion when a player is in
//     it), thrown on toward the prop, and the `smash` event names it (`data.takedown`, actor = the
//     hitter, target = the rider, the crash's causeId);
//   - otherwise it rides through: a wobble (`cause: 'smash'`), a heading kick away from it and a
//     speed scrub by kind, never a crash. A player who does it gains the heat a set-piece prop does.
//   A tumbling body that slides into one smashes it too (no other effect).
// - Smashed ones stay smashed for the race (render draws the wreck). Off when the region lists none,
//   or `smash.density` is 0; a race whose tuning leaves the switch out (every recording made before
//   it) has none, so it replays exactly as before.
// Pure + - * / and core math, plain data, ascending ids: the sim's determinism rules.
import {
  atan2,
  clamp,
  cos,
  createRng,
  nextFloat,
  sin,
  streamSeed,
  type RngState,
  type SmashableKind,
  type TuningParamDecl,
} from '../../core';
import type { RoadPos } from '../../road';
import { addHeat, HEAT } from '../cops';
import type { SetPieceState } from '../modifiers';
import { buildCorridor, toCorridor } from '../traffic';
import { fromCorridor, type Corridor } from '../traffic/corridor';
import { furnitureOn, furnitureOverlaps } from '../riders/furniture';
import { tumbleRecord } from '../tumble';
import type { SimConfig, SimSmashableDef, SmashableSnapshot } from '../types';
import { emit, type Mover, type SimSystem, type World } from '../world';

export const SMASH_DENSITY = 'smash.density';

export const SMASH_TUNING: readonly TuningParamDecl[] = [
  {
    // How many roadside smashables a race puts out, as a scale on SMASH.spacingM's rate. 0 is none.
    // Read as 0 when a race's tuning leaves it out (recordings made before it). [default]
    id: SMASH_DENSITY,
    group: 'traffic',
    label: 'Smashables',
    default: 1,
    min: 0,
    max: 3,
    step: 0.1,
    unit: '×',
    affectsSim: true,
    system: true,
  },
];

/** [default] starting values, to be tuned on the phone. */
export const SMASH = {
  /** Mean metres between clusters along the route at density 1 (each gap is jittered ±half). */
  spacingM: 150,
  /** Clear of the grid and of the finish line, m of route. */
  startClearM: 140,
  finishClearM: 60,
  /** Clear of a road set piece (its sign lead before, its length and this after), m. */
  setPieceClearM: 200,
  /** Clear of a ramp, a gap, a boost pad, a ramp truck or a cop lot, m. */
  featureClearM: 25,
  /** From the outermost lane's edge to the prop's near side, m: a rider on the lanes never touches one. */
  gapM: 0.9,
  /** Room left past the prop before the band's outer edge, m. */
  edgeRoomM: 0.3,
  /** A rider hit this recently (raw seconds) who meets one is knocked into it: down, and named. */
  knockWindowS: 1.0,
  /** A rider's contact box (traffic's and the set pieces'): half its length and half its width. */
  riderHalfLengthM: 1.0,
  riderHalfWidthM: 0.4,
  /** The knocked rider is thrown on toward the prop, m/s to its side, and up. */
  throwSideMps: 4,
  throwUpMps: 1.5,
  /** Above this height a rider in the air clears them. */
  clearHeightM: 0.8,
  /** Riders are compared with props within this far of a player along the route for the snapshot, m. */
  viewM: 450,
  /** At most this many in one race. */
  maxProps: 400,
};

/**
 * Per kind [default]: the contact box (half along the road, half across; drawn larger than life,
 * render/smashables.ts, so it reads at speed), how many make a cluster and how far apart they stand
 * along the road, and what riding through one costs (the speed kept, the heading kick, radians).
 */
export const KIND_SPEC: Readonly<
  Record<
    SmashableKind,
    {
      halfAlong: number;
      halfAcross: number;
      min: number;
      max: number;
      pitchM: number;
      scrub: number;
      kick: number;
    }
  >
> = {
  'lobster-traps': { halfAlong: 0.9, halfAcross: 0.7, min: 1, max: 2, pitchM: 2.6, scrub: 0.85, kick: 0.2 },
  mailbox: { halfAlong: 0.3, halfAcross: 0.3, min: 3, max: 5, pitchM: 1.6, scrub: 0.96, kick: 0.1 },
  'parking-meter': { halfAlong: 0.2, halfAcross: 0.2, min: 3, max: 4, pitchM: 5.5, scrub: 0.96, kick: 0.12 },
  'pop-up-desk': { halfAlong: 1.0, halfAcross: 0.5, min: 1, max: 1, pitchM: 0, scrub: 0.85, kick: 0.2 },
  'cafe-table': { halfAlong: 0.85, halfAcross: 0.45, min: 2, max: 3, pitchM: 2.4, scrub: 0.9, kick: 0.15 },
  'firewood-stand': { halfAlong: 0.8, halfAcross: 0.55, min: 1, max: 1, pitchM: 0, scrub: 0.85, kick: 0.2 },
};

// Run W-U: nothing stands among a road's solid hazards (the ferry's pickups, the festival's bears),
// and a ferry's deck is no ground for a mailbox row.
const AVOID_FEATURES = new Set(['ramp', 'gap', 'rampTruck', 'boostPad', 'copSpawn', 'hazard']);
const NO_GROUND_TAGS = new Set(['bridge', 'causeway', 'ferry']);

/** One placed smashable. Plain data (it hashes with the world). */
export interface Smashable {
  id: number;
  /** Index into config.smashables. */
  def: number;
  /** Corridor coordinates of its centre. */
  u: number;
  cd: number;
  /** Its foot in the world and its heading, facing the road (fixed: it never moves). */
  x: number;
  y: number;
  z: number;
  heading: number;
  /** The tick it broke, or -1 while it stands; the world velocity of what broke it. */
  smashedTick: number;
  hitVx: number;
  hitVz: number;
}

export interface SmashState {
  rng: RngState;
  /** The route's road chain as one straight coordinate (traffic's corridor, built the same way). */
  corridor: Corridor;
  props: Smashable[];
  /** Per rider entity id: who last landed a hit on him (-1 none), and on which raw tick. */
  struckBy: number[];
  struckTick: number[];
}

/** The race's smashables, or null before they are placed (or in a race with none). */
export function smashState(world: World): SmashState | null {
  return (world.systems['smash'] as SmashState | undefined) ?? null;
}

const densityOf = (world: World): number => Math.max(0, world.params[SMASH_DENSITY] ?? 0);

// ---- placement ----------------------------------------------------------------------------

/** The road tags covering (edge, s) on an edge-side (-1 left, +1 right). */
function tagsAt(config: SimConfig, edge: number, s: number, side: number): string[] {
  const e = config.road.edges[edge];
  if (!e) return [];
  const want = side < 0 ? 'left' : 'right';
  return e.tags
    .filter((t) => s >= t.s0 && s <= t.s1 && (t.side === 'both' || t.side === want))
    .map((t) => t.tag);
}

/** Whether the road at (edge, s) is open road a prop may stand beside (on the given edge-side). */
function openRoad(config: SimConfig, pos: RoadPos, side: number): boolean {
  const road = config.road;
  if (!config.route.allows(pos.edge)) return false;
  if (road.branchSideAt(pos.edge, pos.s) !== 0) return false;
  if (road.barrierAt(pos.edge, pos.s, side < 0 ? 'left' : 'right') !== null) return false;
  const edge = road.edges[pos.edge];
  if (!edge) return false;
  const clear = SMASH.featureClearM;
  if (edge.tags.some((t) => NO_GROUND_TAGS.has(t.tag) && pos.s >= t.s0 - clear && pos.s <= t.s1 + clear))
    return false;
  for (const f of edge.features) {
    if (f.s0 > pos.s + clear) break;
    if (AVOID_FEATURES.has(f.kind) && pos.s >= f.s0 - clear && pos.s <= f.s1 + clear) return false;
  }
  return true;
}

/**
 * The corridor cd of a prop's centre at u on a corridor side (`cdSide` ±1), or null when the verge
 * there is too narrow or the road is not open. Also returns the edge-side's world facing.
 */
function spotAt(
  config: SimConfig,
  c: Corridor,
  u: number,
  cdSide: number,
  halfAcross: number,
  pos: RoadPos,
): number | null {
  fromCorridor(c, u, 0, c.routeDir, pos);
  const o = orientationAt(c, u);
  const side = cdSide * o; // edge-side: -1 left, +1 right
  if (!openRoad(config, pos, side)) return null;
  const v = config.road.vergeAt(pos.edge, pos.s, side < 0 ? 'left' : 'right');
  const need = SMASH.gapM + 2 * halfAcross + SMASH.edgeRoomM;
  if (!(v.widthM >= need)) return null;
  const d = v.dInner + side * (SMASH.gapM + halfAcross);
  return d * o;
}

/** The corridor link's orientation at u (+1 or -1). */
function orientationAt(c: Corridor, u: number): number {
  let i = 0;
  while (i < c.edges.length - 1 && u >= (c.off[i + 1] ?? Infinity)) i++;
  return c.o[i] ?? 1;
}

/** Places the race's smashables (once, on the first tick it is on). */
export function placeSmashables(world: World, config: SimConfig): SmashState {
  const st: SmashState = {
    rng: createRng(streamSeed(config.seed, 'smash')),
    corridor: buildCorridor(config),
    props: [],
    struckBy: world.movers.map(() => -1),
    struckTick: world.movers.map(() => -1),
  };
  world.systems['smash'] = st;
  const defs = config.smashables ?? [];
  const c = st.corridor;
  const density = densityOf(world);
  if (defs.length === 0 || density <= 0 || c.edges.length === 0) return st;
  const route = config.route;
  const dir = c.routeDir;
  const startPos: RoadPos = { edge: route.start.edge, s: route.start.s, d: 0, dir: 1 };
  const i0 = c.edges.indexOf(startPos.edge);
  if (i0 < 0) return st;
  const o0 = c.o[i0] ?? 1;
  const u0 = (c.off[i0] ?? 0) + (o0 === 1 ? startPos.s : (c.len[i0] ?? 0) - startPos.s);
  const routeLen = Math.max(0, dir === 1 ? c.hi - u0 : u0 - c.lo);
  // The road set pieces (placed at init), read without creating their state in a race with none.
  const pieces = (world.systems['setPieces'] as SetPieceState | undefined)?.pieces ?? [];
  const rng = st.rng;
  const pos: RoadPos = { edge: 0, s: 0, d: 0, dir: 1 };
  const probe: RoadPos = { edge: 0, s: 0, d: 0, dir: 1 };
  const spacing = SMASH.spacingM / density;
  let along = SMASH.startClearM;
  while (st.props.length < SMASH.maxProps) {
    // Every cluster slot draws the same four rolls, placed or not, so the stream stays aligned.
    along += spacing * (0.5 + nextFloat(rng));
    const sideRoll = nextFloat(rng);
    const defRoll = nextFloat(rng);
    const countRoll = nextFloat(rng);
    if (along > routeLen - SMASH.finishClearM) break;
    const u = u0 + dir * along;
    const near = pieces.some((p) => {
      const rel = dir * (u - p.u);
      return rel > -SMASH.setPieceClearM && rel < p.len + SMASH.setPieceClearM;
    });
    if (near) continue;
    for (const cdSide of sideRoll < 0.5 ? [-1, 1] : [1, -1]) {
      fromCorridor(c, u, 0, dir, pos);
      const o = orientationAt(c, u);
      const tags = tagsAt(config, pos.edge, pos.s, cdSide * o);
      const ok = defs.flatMap((d, i) =>
        d.weight > 0 && (d.tags.length === 0 || d.tags.some((t) => tags.includes(t))) ? [i] : [],
      );
      if (ok.length === 0) continue;
      const chosen = pickByRoll(defRoll, defs, ok);
      const def = defs[chosen];
      if (!def) continue;
      const spec = KIND_SPEC[def.kind];
      const count = spec.min + Math.floor(countRoll * (spec.max - spec.min + 1));
      const placed: Smashable[] = [];
      for (let k = 0; k < count; k++) {
        const uk = u + dir * k * spec.pitchM;
        const cd = spotAt(config, c, uk, cdSide, spec.halfAcross, pos);
        if (cd === null) break;
        // Never in the street's furniture (playtest 4, road/furniture.ts: a hydrant, a lamp, a tree).
        if (furnitureOn(world.params)) {
          fromCorridor(c, uk, cd, c.routeDir, probe);
          if (furnitureOverlaps(config, probe.edge, probe.s, probe.d, spec.halfAlong, spec.halfAcross)) break;
        }
        placed.push(at(config, c, st.props.length + placed.length + 1, chosen, uk, cd));
      }
      if (placed.length === 0) continue;
      st.props.push(...placed.slice(0, SMASH.maxProps - st.props.length));
      break;
    }
  }
  return st;
}

/** The weighted pick for a roll in [0, 1). */
function pickByRoll(roll: number, defs: readonly SimSmashableDef[], ok: readonly number[]): number {
  const total = ok.reduce((a, i) => a + Math.max(0, defs[i]?.weight ?? 0), 0);
  let r = roll * total;
  for (const i of ok) {
    r -= Math.max(0, defs[i]?.weight ?? 0);
    if (r < 0) return i;
  }
  return ok[ok.length - 1] ?? -1;
}

/** A standing smashable at corridor (u, cd), its world foot and its heading toward the road. */
function at(config: SimConfig, c: Corridor, id: number, def: number, u: number, cd: number): Smashable {
  const pos: RoadPos = { edge: 0, s: 0, d: 0, dir: 1 };
  fromCorridor(c, u, cd, c.routeDir, pos);
  const road = config.road;
  const w = road.toWorld(pos.edge, pos.s, pos.d, 0);
  const f = road.frameAt(pos.edge, pos.s);
  // Facing the road: forward is toward the centre line, -sign(d) along the road's +d direction
  // (-tz, tx); the snapshot's heading is atan2(-fx, -fz), as for entities.
  const sg = pos.d < 0 ? -1 : 1;
  const fx = sg * f.tz;
  const fz = -sg * f.tx;
  return {
    id,
    def,
    u,
    cd,
    x: w.x,
    y: w.y,
    z: w.z,
    heading: atan2(-fx, -fz),
    smashedTick: -1,
    hitVx: 0,
    hitVz: 0,
  };
}

// ---- contacts -----------------------------------------------------------------------------

/** A rider's world velocity (x, z): its tumbling body's, or its speed along its heading. */
function velocityOf(world: World, config: SimConfig, m: Mover): [number, number] {
  if (m.mode === 'Tumble') {
    const r = tumbleRecord(world, m.id);
    return r ? [r.rider.vx, r.rider.vz] : [0, 0];
  }
  const f = config.road.frameAt(m.pos.edge, m.pos.s);
  const tx = f.tx * m.pos.dir;
  const tz = f.tz * m.pos.dir;
  const cy = cos(m.yaw);
  const sy = sin(m.yaw);
  return [(cy * tx - sy * tz) * m.speed, (cy * tz + sy * tx) * m.speed];
}

/** Breaks a smashable: the tick, and the world velocity it is hit with (its debris flies that way). */
function smashIt(q: Smashable, tick: number, v: readonly [number, number]): void {
  q.smashedTick = tick;
  q.hitVx = v[0];
  q.hitVz = v[1];
}

/** Steps the smashables: places them on the first tick they are on, then riders' contacts. */
export function stepSmashables(world: World, config: SimConfig): void {
  let st = smashState(world);
  if (!st) {
    if ((config.smashables?.length ?? 0) === 0 || densityOf(world) <= 0) return;
    st = placeSmashables(world, config);
  }
  if (st.props.length === 0) return;
  // Hits landed earlier this tick (combat runs before this phase): who knocked whom, and when.
  for (const e of world.events) {
    if (e.type !== 'hit' || e.target === undefined || e.target === e.actor) continue;
    st.struckBy[e.target] = e.actor;
    st.struckTick[e.target] = world.tick;
  }
  const defs = config.smashables ?? [];
  const c = st.corridor;
  const window = Math.round(SMASH.knockWindowS * 60);
  for (const m of world.movers) {
    if (m.kind !== 'rider') continue;
    const riding = m.mode === 'Road' || m.mode === 'Airborne';
    if ((!riding && m.mode !== 'Tumble') || m.h > SMASH.clearHeightM) continue;
    const at = toCorridor(c, m.pos);
    if (!at) continue;
    let down = !riding;
    for (const q of st.props) {
      if (q.smashedTick >= 0) continue;
      const def = defs[q.def];
      if (!def) continue;
      const spec = KIND_SPEC[def.kind];
      if (
        Math.abs(at.u - q.u) > spec.halfAlong + SMASH.riderHalfLengthM ||
        Math.abs(at.cd - q.cd) > spec.halfAcross + SMASH.riderHalfWidthM
      )
        continue;
      smashIt(q, world.tick, velocityOf(world, config, m));
      const toward = q.cd >= at.cd ? 1 : -1; // the prop's side, in corridor cd
      const by = st.struckBy[m.id] ?? -1;
      const struckAt = st.struckTick[m.id] ?? -1;
      const base = { prop: q.id, kind: def.kind, name: def.name };
      if (!down && by >= 0 && by !== m.id && struckAt >= 0 && world.tick - struckAt <= window) {
        // Knocked into it: down, thrown on toward it, and the takedown is named.
        down = true;
        const cause = emit(world, 'crash', m.id, {
          cause: 'smash',
          object: def.kind,
          sideMps: toward * at.dir * SMASH.throwSideMps,
          upMps: SMASH.throwUpMps,
        });
        emit(world, 'smash', by, { ...base, takedown: true }, { target: m.id, causeId: cause });
        continue;
      }
      if (!down) {
        // Ridden through: it costs a little speed and a wobble away from it, never a crash.
        m.speed *= spec.scrub;
        m.yaw = clamp(m.yaw - toward * at.dir * spec.kick, -1.2, 1.2);
        emit(world, 'wobble', m.id, { cause: 'smash', object: def.kind });
        addHeat(world, config, m.id, HEAT.smash);
      }
      emit(world, 'smash', m.id, { ...base, takedown: false });
    }
  }
}

// ---- snapshot and wiring ------------------------------------------------------------------

/** The smashables within SMASH.viewM of a player along the route (of any rider when none), for render. */
export function smashSnapshots(world: World, config: SimConfig): SmashableSnapshot[] {
  const st = smashState(world);
  if (!st || st.props.length === 0) return [];
  const c = st.corridor;
  const defs = config.smashables ?? [];
  const riders = world.movers.filter((m) => m.kind === 'rider');
  const players = riders.filter((m) => config.riders[m.riderIndex]?.controller.kind === 'player');
  const near: number[] = [];
  for (const m of players.length > 0 ? players : riders) {
    const at = toCorridor(c, m.pos);
    if (at) near.push(at.u);
  }
  const out: SmashableSnapshot[] = [];
  for (const q of st.props) {
    if (near.length > 0 && !near.some((u) => Math.abs(u - q.u) <= SMASH.viewM)) continue;
    const def = defs[q.def];
    if (!def) continue;
    out.push({
      id: q.id,
      kind: def.kind,
      name: def.name,
      x: q.x,
      y: q.y,
      z: q.z,
      heading: q.heading,
      smashedTick: q.smashedTick,
      hitVx: q.hitVx,
      hitVz: q.hitVz,
    });
  }
  return out;
}

/**
 * The peds phase with the smashables stepped after the pedestrians: after combat (a hit this tick
 * counts) and before tumble (a crash this tick tumbles on it), with no new phase in the tick order.
 */
export function withSmashables(peds: SimSystem): SimSystem {
  return {
    name: peds.name,
    init: (world, config) => peds.init(world, config),
    step(world, config) {
      peds.step(world, config);
      stepSmashables(world, config);
    },
  };
}
