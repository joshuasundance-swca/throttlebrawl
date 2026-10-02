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
// - speed-trap: a cop on the shoulder with a radar on a tripod. A player who passes him faster
//   than `limitMps` (× the speed multiplier) summons him: a chase (cause `speed-trap`). It takes a
//   fielded cop who would otherwise wait in the lot, so it needs one; with none it never fires.
// Every piece puts a warning sign SIGN_LEAD_M ahead of it on its shoulder side.
// People never get hit: anyone a rider bears down on steps out of the way toward the verge.
import { atan2, clamp, cos, nextFloat, sin, type EntityId } from '../../core';
import type { RoadPos } from '../../road';
import { COP_PARKED, copsState } from '../cops';
import { placeVehicle, toCorridor, trafficState, type Corridor } from '../traffic';
import { fromCorridor, lanesAt } from '../traffic/corridor';
import type { PropKind, PropSnapshot, SimConfig, SimModifierDef, SimModifierEffect } from '../types';
import { emit, speedMultiplierOf, systemState, type Mover, type World } from '../world';

/** The pieces this file implements (`set-piece` effects' `piece`). */
export const SET_PIECES = ['roadwork', 'crash-scene', 'parade', 'hay-spill', 'speed-trap'] as const;
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
  placeTries: 16,
  /** Pieces stay inside this share of the route (never on the grid or at the line). */
  minProgress: 0.08,
  maxProgress: 0.94,
  /** Sharpest bend a piece may sit on, 1/m (it must read at speed). */
  maxKappa: 1 / 90,
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
  /** The speed trap's cop (entity id, -1 for none) and whether a player has tripped it. */
  cop: number;
  tripped: number;
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
      return 40;
    default:
      return 12;
  }
}

const AVOID_FEATURES = new Set(['ramp', 'gap', 'rampTruck', 'boostPad', 'copSpawn']);

/** Whether a stretch [u, u + dir·len] (plus the sign lead behind it) can hold a piece. */
function stretchOk(config: SimConfig, c: Corridor, u: number, len: number): boolean {
  const road = config.road;
  const dir = c.routeDir;
  const pos: RoadPos = { edge: 0, s: 0, d: 0, dir: 1 };
  for (let a = -SET_PIECE.signLeadM - 10; a <= len + 10; a += 8) {
    const uu = u + dir * a;
    if (uu < c.lo + 20 || uu > c.hi - 20) return false;
    fromCorridor(c, uu, 0, dir, pos);
    if (!config.route.allows(pos.edge)) return false;
    if (road.branchSideAt(pos.edge, pos.s) !== 0) return false;
    // The sign's run-up needs only to be on the route; the piece itself needs open road.
    if (a < -10) continue;
    if (road.barrierAt(pos.edge, pos.s, 'left') !== null || road.barrierAt(pos.edge, pos.s, 'right') !== null)
      return false;
    if (Math.abs(road.kappaAt(pos.edge, pos.s)) > SET_PIECE.maxKappa) return false;
    if (lanesAt(road, c, uu, dir).length === 0) return false;
    const edge = road.edges[pos.edge];
    if (!edge) return false;
    if (edge.tags.some((t) => t.tag === 'bridge' && pos.s >= t.s0 - 10 && pos.s <= t.s1 + 10)) return false;
    for (const f of edge.features) {
      if (f.s0 > pos.s + 25) break;
      if (AVOID_FEATURES.has(f.kind) && pos.s >= f.s0 - 25 && pos.s <= f.s1 + 25) return false;
    }
  }
  return true;
}

/** Fielded cops still in the lot, the ones the race would not bring out first. */
function trapCop(world: World, taken: readonly number[]): EntityId {
  const cops = copsState(world);
  const free = cops.cops.filter((id) => cops.phase[id] === COP_PARKED && !taken.includes(id));
  return free.find((id) => cops.spawns[id] !== 1) ?? free[0] ?? -1;
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
  const scale = Math.max(0, world.params['modifiers.setPieceChance'] ?? 1);
  // Every modifier rolls, always drawing, so the stream advances the same whatever fires.
  const fired: number[] = [];
  config.modifiers.forEach((m, i) => {
    const roll = nextFloat(rng);
    if (roll < clamp(m.chance * scale, 0, 1) && m.effects.some(isSetPiece)) fired.push(i);
  });
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
  const cops: number[] = [];
  for (const mi of chosen) {
    const m = config.modifiers[mi] as SimModifierDef;
    m.effects.forEach((e, ei) => {
      if (!isSetPiece(e)) return;
      const piece = String(e['piece']);
      let cop = -1;
      if (piece === 'speed-trap') {
        cop = trapCop(world, cops);
        if (cop < 0) return;
      }
      const len = pieceLength(piece, list(e, 'floats').length);
      const lo = Math.max(SET_PIECE.minProgress, m.atProgress[0]);
      const hi = Math.min(SET_PIECE.maxProgress, m.atProgress[1]);
      for (let t = 0; t < SET_PIECE.placeTries; t++) {
        const p = lo + (Math.max(lo, hi) - lo) * nextFloat(rng);
        const u = st.u0 + c.routeDir * p * st.routeLen;
        if (st.pieces.some((q) => Math.abs(q.u - u) < SET_PIECE.spacingM + q.len)) continue;
        if (!stretchOk(config, c, u, len)) continue;
        const lane = lanesAt(config.road, c, u, c.routeDir)[0];
        if (!lane) continue;
        st.pieces.push({
          mod: mi,
          eff: ei,
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
          cop,
          tripped: 0,
        });
        if (cop >= 0) {
          cops.push(cop);
          parkTrapCop(world, config, c, st.pieces[st.pieces.length - 1] as SetPiece);
        }
        return;
      }
    });
  }
}

/** Moves the speed trap's cop from the lot to the trap's shoulder, where he waits for a speeder. */
function parkTrapCop(world: World, config: SimConfig, c: Corridor, p: SetPiece): void {
  const cop = world.movers[p.cop];
  if (!cop) return;
  const pos: RoadPos = { edge: 0, s: 0, d: 0, dir: 1 };
  fromCorridor(c, p.u, shoulderCd(config, c, p, p.u, 0.2), c.routeDir, pos);
  cop.pos = pos;
  cop.speed = 0;
  cop.yaw = 0;
  cop.h = 0;
  copsState(world).spawns[p.cop] = 0;
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
    ...spec,
  };
  st.props.push(prop);
  return prop;
}

/**
 * Places a vehicle `along` metres route-forward of the piece's start; its entity id, or -1. A
 * parked one stands on the verge, its inner side just outside the drivable width.
 */
function placeOn(
  world: World,
  config: SimConfig,
  c: Corridor,
  p: SetPiece,
  contentId: string,
  along: number,
  moving: boolean,
): number {
  const type = typeIndex(config, contentId);
  if (type < 0) return -1;
  const t = config.trafficTypes[type];
  const v0 = moving ? (t && t.cruiseMps > 0 ? t.cruiseMps : SET_PIECE.hayTruckMps) : 0;
  const dir = c.routeDir === 1 ? 1 : -1;
  const tr = trafficState(world);
  const slot = placeVehicle(world, config, { type, u: p.u + dir * along, dir, rank: 0, v0, speed: v0 });
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
  // The warning sign, on the shoulder side, ahead of everything.
  addProp(st, index, {
    kind: 'sign',
    variant: theme || p.piece,
    label: str(e, 'signText', ''),
    u: at(-SET_PIECE.signLeadM),
    cd: shoulderCd(config, c, p, at(-SET_PIECE.signLeadM), 1.2),
  });
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
      // No cop to bring out (a hand-built config): the radar stands alone, a person holding it.
      if (p.cop < 0)
        addProp(st, index, {
          kind: 'person',
          variant: 'cop-radar',
          u: at(0),
          cd: shoulderCd(config, c, p, at(0), 0.6),
        });
      break;
    }
    default:
      break;
  }
  emit(world, 'modifierStart', -1, { id: m.contentId, kind: m.kind, piece: p.piece });
}

function end(world: World, config: SimConfig, st: SetPieceState, index: number): void {
  const p = st.pieces[index];
  const m = p && config.modifiers[p.mod];
  if (!p || !m) return;
  p.phase = 2;
  st.props = st.props.filter((q) => q.piece !== index);
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
    if (p.phase === 2) return;
    // Route-forward position of each racer relative to the piece's start.
    const rel = racers.map((r) => dir * (r.u - p.u));
    if (p.phase === 0) {
      if (rel.some((d) => d >= -SET_PIECE.activateM && d <= p.len)) goLive(world, config, st, i);
      else return;
    }
    // The end of the piece: its own length, or wherever the hay truck has got to.
    let endAlong = p.len;
    for (const q of st.props) if (q.piece === i) endAlong = Math.max(endAlong, dir * (q.u - p.u));
    if (over || (rel.length > 0 && rel.every((d) => d > endAlong + SET_PIECE.endPastM))) {
      end(world, config, st, i);
      return;
    }
    pinVehicles(world, p);
    if (p.piece === 'hay-spill') stepHay(world, config, st, p, i, racers);
    if (p.piece === 'speed-trap') stepTrap(world, config, p, riders);
  });
  stepProps(world, config, st, riders, dt);
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
  if (p.tripped || p.cop < 0) return;
  const cops = copsState(world);
  if (cops.phase[p.cop] !== COP_PARKED) return;
  const dir = trafficState(world).corridor.routeDir;
  const limit =
    num(effectOf(config, p) ?? { kind: '' }, 'limitMps', SET_PIECE.trapLimitMps) * speedMultiplierOf(config);
  for (const r of riders) {
    if (!r.player || r.m.mode !== 'Road') continue;
    const past = dir * (r.u - p.u);
    // Crossing his position this tick (within one tick's travel), going faster than the limit.
    if (past < 0 || past > r.m.speed * (world.timeScale / 60) + 0.5 || r.m.speed <= limit) continue;
    p.tripped = 1;
    cops.spawns[p.cop] = 1;
    cops.summonAt[p.cop] = cops.clock;
    cops.cause[p.cop] = 'speed-trap';
    return;
  }
}

/** A prop's half extents along and across the road, for contacts (0: not touchable). */
function extent(kind: PropKind): [number, number] {
  switch (kind) {
    case 'cone':
      return [0.25, 0.25];
    case 'flare':
      return [0.12, 0.12];
    case 'barricade':
      return [0.3, 0.9];
    case 'hayBale':
      return [0.55, 0.45];
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
    };
  });
}
