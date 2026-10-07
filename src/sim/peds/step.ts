// The pedestrians and animals: the system's step (sim/peds), the code only a running race needs. It loads after the first
// screen, in the sim's step chunk (src/sim/late.ts; scripts/sim-chunk.mjs SIM_STEPS_TEST), and a race waits for
// it. ./index.ts keeps the system's state, its init, its tuning and what a snapshot reads (the menu's grid).
import { cos, sin, clamp, HALF_PI, nextFloat, PI } from '../../core';
import type { RoadNetwork, RoadNeighbour } from '../../road';
import type { SimConfig, SimTrafficTypeDef } from '../types';
import { roadsideClass } from '../roadside';
import { vehicleInfo } from '../traffic';
import { GRAZE_M, trafficContactCrashes } from '../traffic/contact-rule';
import { type Mover, type World, riderHitbox, emit, vehicleHeightM } from '../world';
import {
  roadEdges,
  PEDS,
  pedThreatRangeM,
  PED_PHASE,
  strolls,
  startStroll,
  rollWait,
  onBridgeWalkway,
  offRoadD,
  kindThreatRangeM,
  pedsState,
  type PedsState,
} from './index';

/** W-P: `pedReact` kinds, as numbers in PedsState.reactKind (0 none). */
const REACT_CODE = { jumpBack: 1, fist: 2, film: 3, chase: 4 } as const;

type ReactName = keyof typeof REACT_CODE;

function typeOf(config: SimConfig, st: PedsState, k: number): SimTrafficTypeDef {
  const t = config.trafficTypes[st.type[k] ?? -1];
  if (!t) throw new Error(`peds: pedestrian slot ${k} has no type`);
  return t;
}

function onRoad(road: RoadNetwork, m: Mover, halfW: number): boolean {
  const { lo, hi } = roadEdges(road, m.pos.edge, m.pos.s);
  return m.pos.d + halfW > lo && m.pos.d - halfW < hi;
}

/** Riders who can threaten or touch a pedestrian: on the bike, or sliding in a crash. */
function isThreatRider(m: Mover): boolean {
  return m.kind === 'rider' && (m.mode === 'Road' || m.mode === 'Airborne' || m.mode === 'Tumble');
}

/** How far across an edge end a threat looks for pedestrians, m (beyond any threat range). */
const NEIGHBOUR_RANGE_M = 150;

/**
 * Something a pedestrian keeps clear of, found once per tick: a threatening rider, or a traffic
 * vehicle (cars do not stop for pedestrians, so pedestrians dive from them too), with its box and
 * its edge neighbours.
 */
interface Near {
  m: Mover;
  vehicle: boolean;
  /** W-P: a kerb rider (a bicycle or scooter on the shoulder): people on the verge hop, not dive. */
  kerb: boolean;
  lengthM: number;
  widthM: number;
  nb: readonly RoadNeighbour[];
}

function nearThreats(world: World, config: SimConfig): Near[] {
  const out: Near[] = [];
  const nb = (m: Mover, range = NEIGHBOUR_RANGE_M) => config.road.neighbours(m.pos.edge, m.pos.s, range);
  // With gap acceptance on, riders are looked for as far as the gap check looks (T4.2).
  const riderRange = gapAcceptOn(world) ? Math.max(NEIGHBOUR_RANGE_M, PEDS.gapLookM) : NEIGHBOUR_RANGE_M;
  for (const m of world.movers) {
    if (isThreatRider(m)) {
      out.push({
        m,
        vehicle: false,
        kerb: false,
        lengthM: riderHitbox(config, m.riderIndex).lengthM,
        widthM: riderHitbox(config, m.riderIndex).widthM,
        nb: nb(m, riderRange),
      });
    } else if (m.kind === 'vehicle') {
      const info = vehicleInfo(world, config, m.id);
      if (info)
        out.push({
          m,
          vehicle: true,
          kerb: info.kerb,
          lengthM: info.lengthM,
          widthM: info.widthM,
          nb: nb(m),
        });
    }
  }
  return out;
}

interface Rel {
  /** Metres from the rider to the pedestrian along the road, in the rider's travel direction. */
  ahead: number;
  /** Pedestrian d − rider d, in the rider's edge frame. */
  dd: number;
  /** The rider's d in the pedestrian's edge frame. */
  riderD: number;
  /** −1 when the two edges run opposite ways (d flips between their frames). */
  sign: 1 | -1;
}

/** Where pedestrian `p` is from rider `near`, across one edge end at most; null when out of range. */
function relate(near: Near, p: Mover, range: number): Rel | null {
  const r = near.m;
  let ps = p.pos.s;
  let sign: 1 | -1 = 1;
  if (r.pos.edge !== p.pos.edge) {
    const n = near.nb.find((q) => q.edge === p.pos.edge);
    if (!n) return null;
    ps = n.sOffset + n.sSign * p.pos.s;
    sign = n.sSign;
  }
  const ahead = (ps - r.pos.s) * r.pos.dir;
  if (ahead > range || ahead < -range) return null;
  return { ahead, dd: sign * p.pos.d - r.pos.d, riderD: sign * r.pos.d, sign };
}

/** T4.2: whether pedestrians check for a gap (`peds.gapAccept`; absent means off). */
function gapAcceptOn(world: World): boolean {
  return (world.params['peds.gapAccept'] ?? 0) >= 0.5;
}

/** W-P: a kind that runs after a passing rider (dogs). */
function chases(t: SimTrafficTypeDef | undefined): boolean {
  return t?.category === 'animal' && t.behaviour?.chases === true && (t.cruiseMps ?? 0) > 0;
}

/** Starts a dive for slot k, away from the riders and cars near it, preferring to land off the road. */
function startDive(
  world: World,
  config: SimConfig,
  st: PedsState,
  k: number,
  threat: Mover,
  bumped: boolean,
  threats: readonly Near[],
): void {
  const p = world.movers[st.id[k] ?? -1];
  if (!p) return;
  const t = typeOf(config, st, k);
  const half = t.widthM / 2;
  const { lo, hi } = roadEdges(config.road, p.pos.edge, p.pos.s);
  // Keep clear of the threat, plus anyone coming who could reach the pedestrian: for each rider or
  // car, the window of time its box passes the pedestrian's s (straight on at its speed), and the
  // stretch of the dive the pedestrian covers in that window. A side scores the smallest
  // side-to-side clearance, box edge to box edge, over those stretches, so a dive that would cross
  // a rider's line as it arrives scores badly even when the landing spot is clear.
  const near: { d: number; halfW: number; t0: number; t1: number; vehicle: boolean }[] = [];
  for (const r of threats) {
    const rel = relate(r, p, pedThreatRangeM(r.m.speed) + 10);
    if (!rel) continue;
    const pass = (r.lengthM + t.lengthM) / 2 + 0.3;
    const v = r.m.speed;
    if (rel.ahead + pass < 0) continue;
    const t0 = v > 0.1 ? Math.max(0, (rel.ahead - pass) / v) : 0;
    const t1 = v > 0.1 ? (rel.ahead + pass) / v : Infinity;
    near.push({ d: rel.riderD, halfW: r.widthM / 2, t0, t1, vehicle: r.vehicle });
  }
  let best = 1;
  let bestScore = -Infinity;
  let bestClearsRiders = false;
  const from = p.pos.d;
  for (const side of [1, -1] as const) {
    const to = from + side * PEDS.diveDistM;
    const at = (time: number) => from + (to - from) * Math.min(1, time / PEDS.diveS);
    let score = Infinity;
    let riderScore = Infinity;
    for (const q of near) {
      const a = at(q.t0);
      const b = at(q.t1);
      const gap =
        q.d < Math.min(a, b) ? Math.min(a, b) - q.d : q.d > Math.max(a, b) ? q.d - Math.max(a, b) : 0;
      score = Math.min(score, gap - q.halfW - half);
      if (!q.vehicle) riderScore = Math.min(riderScore, gap - q.halfW - half);
    }
    if (!Number.isFinite(score)) score = 100;
    if (to - half >= hi || to + half <= lo) score += 0.75;
    // Tie-break: away from the road's centre line.
    if (side === (p.pos.d < 0 ? -1 : 1)) score += 1e-6;
    // Riders first (keys traffic, 2026-10-02): a car or a kerb scooter only knocks a pedestrian
    // over, but a rider must never touch one. So when a pedestrian is squeezed between them, a dive
    // that keeps clear of every rider beats one that does not, whatever the cars; otherwise the
    // score decides, as before.
    const clearsRiders = riderScore > 0;
    if (clearsRiders !== bestClearsRiders ? clearsRiders : score > bestScore) {
      bestScore = score;
      best = side;
      bestClearsRiders = clearsRiders;
    }
  }
  st.phase[k] = PED_PHASE.dive;
  st.timer[k] = PEDS.diveS;
  st.gated[k] = 0;
  st.hurry[k] = 0;
  st.fromD[k] = p.pos.d;
  st.toD[k] = p.pos.d + best * PEDS.diveDistM;
  st.dives++;
  st.chasing[k] = 0;
  st.reactKind[k] = 0;
  // A rider who sends someone diving gets a reaction once they are up (W-P).
  st.scaredBy[k] = threat.kind === 'rider' ? threat.id : -1;
  p.yaw = 0;
  emit(
    world,
    'pedDive',
    p.id,
    {
      side: best,
      kind: t.contentId,
      threatMps: threat.speed,
      rangeM: pedThreatRangeM(threat.speed),
      bumped,
    },
    { target: threat.id },
  );
}

/** Whether a rider's (or car's) box is within `pad` of a pedestrian at d. */
function boxNear(r: Near, p: Mover, t: SimTrafficTypeDef, d: number, pad: number): boolean {
  const gap = sideGap(r, p, t, d, pad);
  return gap !== null && gap < pad;
}

/**
 * Side-to-side clearance, box edge to box edge, between a rider's (or car's) box and a pedestrian
 * at d, when their boxes overlap along the road within `pad`; null when they don't.
 */
function sideGap(r: Near, p: Mover, t: SimTrafficTypeDef, d: number, pad: number): number | null {
  const rel = relate(r, p, 10);
  if (!rel) return null;
  if (Math.abs(rel.ahead) >= (r.lengthM + t.lengthM) / 2 + pad) return null;
  if (r.m.h - p.h >= vehicleHeightM(t) || p.h - r.m.h >= PEDS.maxContactH) return null;
  const dd = rel.dd + rel.sign * (d - p.pos.d);
  return Math.abs(dd) - (r.widthM + t.widthM) / 2;
}

/**
 * How fast a rider met a heavy pedestrian or animal, classed as a rider meeting a vehicle is (sim/traffic,
 * #552): end on (their boxes overlap less along the road than across it, by `GRAZE_M` or more across) the
 * rider's speed along the road; a graze or a side contact, its speed across it toward the animal. The
 * animal's own walk is slow enough to leave out, m/s.
 */
function pedClosingMps(near: Near, p: Mover, t: SimTrafficTypeDef): number {
  const rel = relate(near, p, 10);
  if (!rel) return 0;
  const r = near.m;
  const overU = (near.lengthM + t.lengthM) / 2 - Math.abs(rel.ahead);
  const overD = (near.widthM + t.widthM) / 2 - Math.abs(rel.dd);
  const endOn = overU < overD && overD >= GRAZE_M;
  if (endOn) return Math.max(0, r.speed * cos(r.yaw) * (rel.ahead >= 0 ? 1 : -1));
  const across = r.pos.dir * r.speed * sin(r.yaw);
  return Math.max(0, across * (rel.dd >= 0 ? 1 : -1));
}

/** Whether a rider is coming at p from just beyond its threat range (the worst-moment gag). */
function riderComing(config: SimConfig, p: Mover, threats: readonly Near[]): boolean {
  for (const near of threats) {
    // The gag plays for the players only: rivals and the cop are not lured into swerving.
    if (near.vehicle || near.m.speed < PEDS.threatMinMps) continue;
    if (config.riders[near.m.riderIndex]?.controller.kind !== 'player') continue;
    const range = pedThreatRangeM(near.m.speed);
    const rel = relate(near, p, range + PEDS.lureLeadMaxM);
    if (rel && rel.ahead >= range + PEDS.lureLeadMinM) return true;
  }
  return false;
}

// ---- T4.2: gap acceptance ----------------------------------------------------------------

/**
 * The refuge of a crossing at (edge, s): the centre line, where the drive lanes' direction flips (the
 * middle of the median when there is one). Null on a one-way road, or where the two directions'
 * lanes are not apart, so a crossing there is one stage.
 */
function refugeD(road: RoadNetwork, edge: number, s: number): number | null {
  const span = (dir: 1 | -1) => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const lane of road.lanesAt(edge, s)) {
      if (lane.kind === 'shoulder' || lane.direction !== dir) continue;
      lo = Math.min(lo, lane.dCenterM - lane.widthM / 2);
      hi = Math.max(hi, lane.dCenterM + lane.widthM / 2);
    }
    return { lo, hi };
  };
  const a = span(1);
  const b = span(-1);
  if (!Number.isFinite(a.lo) || !Number.isFinite(b.lo)) return null;
  if (a.hi <= b.lo) return (a.hi + b.lo) / 2;
  if (b.hi <= a.lo) return (b.hi + a.lo) / 2;
  return null;
}

/**
 * How soon the first rider who counts reaches pedestrian `p`, s, among riders whose lane lies within
 * PEDS.gapLateralM of [dLo, dHi]; Infinity when none does. A rider counts when it is fast enough
 * (PEDS.threatMinMps), ahead within PEDS.gapLookM, not yet past the pedestrian, and not far above it.
 * Cars do not count: they do not stop for people, and the dives from them stay.
 */
function riderArrivalS(
  p: Mover,
  t: SimTrafficTypeDef,
  threats: readonly Near[],
  dLo: number,
  dHi: number,
): number {
  return pressingRider(p, t, threats, dLo, dHi).arrival;
}

/** riderArrivalS, and the pressing rider's d in the pedestrian's frame (NaN when there is none). */
function pressingRider(
  p: Mover,
  t: SimTrafficTypeDef,
  threats: readonly Near[],
  dLo: number,
  dHi: number,
): { arrival: number; d: number } {
  let best = Infinity;
  let d = NaN;
  for (const near of threats) {
    if (near.vehicle) continue;
    const r = near.m;
    if (r.speed < PEDS.threatMinMps || r.h - p.h >= vehicleHeightM(t)) continue;
    const rel = relate(near, p, PEDS.gapLookM);
    if (!rel) continue;
    const half = (near.lengthM + t.lengthM) / 2;
    if (rel.ahead <= -half) continue;
    if (rel.riderD < dLo - PEDS.gapLateralM || rel.riderD > dHi + PEDS.gapLateralM) continue;
    const arrival = Math.max(0, rel.ahead - half) / r.speed;
    if (arrival < best) {
      best = arrival;
      d = rel.riderD;
    }
  }
  return { arrival: best, d };
}

/** The end of the first stage of a crossing from `from` to `to`: the refuge if it lies between. */
function firstStageEnd(road: RoadNetwork, p: Mover, from: number, to: number): number {
  const refuge = refugeD(road, p.pos.edge, p.pos.s);
  if (refuge === null || Math.abs(from - refuge) < 1e-6) return to;
  return Math.sign(from - refuge) !== Math.sign(to - refuge) ? refuge : to;
}

/** Whether the first stage of a crossing from `from` to `to` is clear of riders, margin included. */
function gapClear(
  config: SimConfig,
  p: Mover,
  t: SimTrafficTypeDef,
  threats: readonly Near[],
  from: number,
  to: number,
): boolean {
  const end = firstStageEnd(config.road, p, from, to);
  const time = Math.abs(end - from) / t.cruiseMps + PEDS.gapMarginS;
  return riderArrivalS(p, t, threats, Math.min(from, end), Math.max(from, end)) >= time;
}

/**
 * One tick of a gap-checked crossing (slot k on the road, walking): the d to walk toward this tick,
 * or null to wait where it stands (at the refuge, until the next stage is clear). A pedestrian caught
 * by a rider sooner than the rest of its stage hurries to the nearer end of the stage: on, or back to
 * where the stage began (the crossing is dropped there; from the refuge it then waits for a gap).
 */
function gatedTarget(
  config: SimConfig,
  st: PedsState,
  k: number,
  p: Mover,
  t: SimTrafficTypeDef,
  threats: readonly Near[],
): number | null {
  const final = st.targetD[k] ?? p.pos.d;
  const from = st.fromD[k] ?? p.pos.d;
  const refuge = refugeD(config.road, p.pos.edge, p.pos.s);
  const crosses = refuge !== null && Math.sign(from - refuge) !== Math.sign(final - refuge);
  const mid = refuge ?? 0;
  if (crosses && Math.abs(p.pos.d - mid) < 1e-6) {
    // At the refuge: the next stage must be clear before it leaves.
    st.hurry[k] = 0;
    return gapClear(config, p, t, threats, mid, final) ? final : null;
  }
  const before = crosses && Math.sign(p.pos.d - mid) === Math.sign(from - mid);
  const end = before ? mid : final;
  if (st.hurry[k] !== 1) {
    const left = Math.abs(end - p.pos.d);
    const { arrival, d: riderD } = pressingRider(
      p,
      t,
      threats,
      Math.min(p.pos.d, end),
      Math.max(p.pos.d, end),
    );
    if (arrival < left / t.cruiseMps) {
      st.hurry[k] = 1;
      const fast = t.cruiseMps * PEDS.hurryScale;
      const start = before || !crosses ? from : mid;
      // The end that keeps clear of the rider's lane (the dive's side band) wins; failing that, the
      // end with more time to spare, like the dive's clearance score; the way on on a tie.
      const band = (PEDS.riderWidthM + t.widthM) / 2 + PEDS.lateralM;
      const clearOn = Math.abs(end - riderD) >= band;
      const clearBack = Math.abs(start - riderD) >= band;
      const back =
        clearOn !== clearBack
          ? clearBack
          : arrival - Math.abs(p.pos.d - start) / fast > arrival - left / fast;
      if (back) {
        st.gated[k] = 0;
        st.targetD[k] = start;
        return start;
      }
    }
  }
  return end;
}

/** The lured pedestrian walks to the kerb, `PEDS.fakeOutM` outside the road edge, and stops there. */
function startFakeOut(config: SimConfig, st: PedsState, k: number, p: Mover, t: SimTrafficTypeDef): void {
  const side = p.pos.d < 0 ? -1 : 1;
  const { lo, hi } = roadEdges(config.road, p.pos.edge, p.pos.s);
  const spot = (side > 0 ? hi : -lo) + PEDS.fakeOutM + t.widthM / 2;
  st.lure[k] = 0;
  st.phase[k] = PED_PHASE.fake;
  st.timer[k] = PEDS.fakeOutHoldS;
  st.targetD[k] = side * Math.min(spot, Math.abs(p.pos.d));
}

/**
 * The fake-out (the worst-moment gag): walk to the kerb, stop facing the road, and stay until no
 * rider is coming (or the hold runs out). The close pass hops it back as the rider goes by.
 */
function fakeOut(
  world: World,
  config: SimConfig,
  st: PedsState,
  k: number,
  p: Mover,
  t: SimTrafficTypeDef,
  dt: number,
  threats: readonly Near[],
): void {
  const target = st.targetD[k] ?? p.pos.d;
  const step = clamp(target - p.pos.d, -t.cruiseMps * dt, t.cruiseMps * dt);
  p.pos.d += step;
  if (Math.abs(target - p.pos.d) > 1e-6) {
    p.speed = Math.abs(step) / Math.max(dt, 1e-9);
    p.yaw = (step >= 0 ? 1 : -1) * HALF_PI;
    return;
  }
  p.pos.d = target;
  p.speed = 0;
  p.yaw = (p.pos.d < 0 ? 1 : -1) * HALF_PI;
  const { lo, hi } = roadEdges(config.road, p.pos.edge, p.pos.s);
  if ((st.timer[k] ?? 0) <= 0 || riderArrivalS(p, t, threats, lo, hi) === Infinity) {
    resume(world, st, k, t);
  }
}

// ---- W-P: life that reacts ---------------------------------------------------------------

/** Back to what slot k does when nothing is happening: strolling the verge, or waiting. */
function resume(world: World, st: PedsState, k: number, t: SimTrafficTypeDef): void {
  const p = world.movers[st.id[k] ?? -1];
  if (!p) return;
  st.chasing[k] = 0;
  st.reactKind[k] = 0;
  if (strolls(t)) {
    const lo = st.zoneS0[k] ?? p.pos.s;
    const hi = st.zoneS1[k] ?? p.pos.s;
    // Toward the further end of its zone.
    startStroll(world, st, k, hi - p.pos.s > p.pos.s - lo ? 1 : -1, t);
    if (st.phase[k] === PED_PHASE.along) return;
  }
  st.phase[k] = PED_PHASE.loiter;
  st.timer[k] = rollWait(world);
  st.lure[k] = nextFloat(world.rng.peds) < PEDS.lureChance && roadsideClass(t) === 'dodges' ? 1 : 0;
  p.speed = 0;
  p.yaw = (p.pos.d < 0 ? 1 : -1) * HALF_PI;
}

/** Emits a `pedReact` from slot k at rider `riderId`, held for `seconds` (scaled). */
function emitReact(
  world: World,
  config: SimConfig,
  st: PedsState,
  k: number,
  kind: ReactName,
  riderId: number,
  seconds: number,
): void {
  const p = world.movers[st.id[k] ?? -1];
  if (!p) return;
  st.reacts++;
  st.reactKind[k] = REACT_CODE[kind];
  st.reactCooldownS[k] = PEDS.reactCooldownS;
  const t = config.trafficTypes[st.type[k] ?? -1];
  emit(
    world,
    'pedReact',
    p.id,
    { kind, ticks: Math.round(seconds * 60), who: t?.contentId ?? '' },
    { target: riderId },
  );
}

/** A fist or a phone for slot k (people only), facing the road; false when it is not a person. */
function startGesture(world: World, config: SimConfig, st: PedsState, k: number, riderId: number): boolean {
  const t = config.trafficTypes[st.type[k] ?? -1];
  const p = world.movers[st.id[k] ?? -1];
  if (!p || t?.category !== 'pedestrian') return false;
  const kind: ReactName = nextFloat(world.rng.peds) < PEDS.fistShare ? 'fist' : 'film';
  st.phase[k] = PED_PHASE.react;
  st.timer[k] = PEDS.reactHoldS;
  p.speed = 0;
  p.yaw = (p.pos.d < 0 ? 1 : -1) * HALF_PI;
  emitReact(world, config, st, k, kind, riderId, PEDS.reactHoldS);
  return true;
}

/** Someone a rider scared reacts once on their feet, by a seeded roll. True when they do. */
function scaredReaction(world: World, config: SimConfig, st: PedsState, k: number): boolean {
  const rider = st.scaredBy[k] ?? -1;
  st.scaredBy[k] = -1;
  if (rider < 0) return false;
  const t = config.trafficTypes[st.type[k] ?? -1];
  if (t?.category !== 'pedestrian') return false;
  if (nextFloat(world.rng.peds) >= PEDS.scaredReactChance) return false;
  return startGesture(world, config, st, k, rider);
}

/** The hop back from the kerb: slot k jumps PEDS.hopDistM further from the road. */
function startHop(world: World, config: SimConfig, st: PedsState, k: number, riderId: number): void {
  const p = world.movers[st.id[k] ?? -1];
  if (!p) return;
  const out = p.pos.d < 0 ? -1 : 1;
  st.phase[k] = PED_PHASE.hop;
  st.timer[k] = PEDS.hopS;
  st.fromD[k] = p.pos.d;
  st.toD[k] = p.pos.d + out * PEDS.hopDistM;
  st.scaredBy[k] = riderId;
  st.chasing[k] = 0;
  p.yaw = (p.pos.d < 0 ? 1 : -1) * HALF_PI;
  emitReact(world, config, st, k, 'jumpBack', riderId, PEDS.hopS);
}

/**
 * A dog runs after a rider (W-P): along the verge in the rider's travel direction, at its own
 * pace, for PEDS.chaseS, inside its zone; `way` is that direction in the dog's edge frame.
 */
function startChase(
  world: World,
  config: SimConfig,
  st: PedsState,
  k: number,
  t: SimTrafficTypeDef,
  way: number,
  riderId: number,
): void {
  const p = world.movers[st.id[k] ?? -1];
  if (!p) return;
  st.homeS[k] = p.pos.s;
  const lo = st.zoneS0[k] ?? p.pos.s;
  const hi = st.zoneS1[k] ?? p.pos.s;
  st.phase[k] = PED_PHASE.along;
  st.chasing[k] = 1;
  st.alongMps[k] = t.cruiseMps;
  st.targetS[k] = clamp(p.pos.s + way * t.cruiseMps * PEDS.chaseS, lo, hi);
  emitReact(world, config, st, k, 'chase', riderId, PEDS.chaseS);
}

/**
 * One tick along the verge for slot k (a stroll, a chase or the trot back): at its own pace
 * toward targetS, at the off-road distance it keeps, never onto a bridge walkway if it is an
 * animal. At the end: a chaser trots home, a stroller turns round, anyone else waits.
 */
function walkAlong(
  world: World,
  config: SimConfig,
  st: PedsState,
  k: number,
  p: Mover,
  t: SimTrafficTypeDef,
  dt: number,
): void {
  const road = config.road;
  const target = st.targetS[k] ?? p.pos.s;
  const pace = st.alongMps[k] ?? t.cruiseMps;
  const step = clamp(target - p.pos.s, -pace * dt, pace * dt);
  const next = p.pos.s + step;
  const blocked = t.category === 'animal' && onBridgeWalkway(road, p.pos.edge, next);
  if (!blocked && step !== 0) {
    p.pos.s = next;
    const side = p.pos.d < 0 ? -1 : 1;
    p.pos.d = offRoadD(road, p.pos.edge, next, side, t.widthM / 2, st.homeD[k] ?? p.pos.d);
    p.speed = Math.abs(step) / Math.max(dt, 1e-9);
    p.yaw = step > 0 ? 0 : PI;
  }
  if (!blocked && Math.abs(target - p.pos.s) > 1e-6) return;
  p.speed = 0;
  if (st.chasing[k] === 1) {
    // The chase is over: trot back to where it was.
    st.chasing[k] = 0;
    st.targetS[k] = st.homeS[k] ?? p.pos.s;
    st.alongMps[k] = t.cruiseMps * PEDS.trotBack;
    st.reactKind[k] = 0;
    return;
  }
  if (strolls(t)) {
    const lo = (st.zoneS0[k] ?? p.pos.s) + PEDS.strollEndM;
    const hi = (st.zoneS1[k] ?? p.pos.s) - PEDS.strollEndM;
    const back = target >= (lo + hi) / 2 ? lo : hi;
    if (Math.abs(back - p.pos.s) > 1e-6 && hi > lo) {
      st.targetS[k] = back;
      st.alongMps[k] = t.cruiseMps;
      return;
    }
  }
  resume(world, st, k, t);
}

/**
 * A close pass (W-P): a rider (or a kerb rider) going by beside slot k, outside the dive band, or
 * a kerb rider inside it while k is off the road. Dogs give chase; people hop back when it is
 * close, else maybe shake a fist or film. Nothing while k is busy, on the road or cooling down.
 */
function closePass(
  world: World,
  config: SimConfig,
  st: PedsState,
  k: number,
  threats: readonly Near[],
  dt: number,
): void {
  st.reactCooldownS[k] = Math.max(0, (st.reactCooldownS[k] ?? 0) - dt);
  const phase = st.phase[k];
  if (
    phase !== PED_PHASE.loiter &&
    phase !== PED_PHASE.along &&
    phase !== PED_PHASE.react &&
    phase !== PED_PHASE.fake
  ) {
    return;
  }
  if ((st.reactCooldownS[k] ?? 0) > 0 || st.chasing[k] === 1) return;
  const p = world.movers[st.id[k] ?? -1];
  const t = config.trafficTypes[st.type[k] ?? -1];
  if (!p || !t || onRoad(config.road, p, t.widthM / 2)) return;
  const dog = chases(t);
  for (const near of threats) {
    const r = near.m;
    if (near.vehicle && !near.kerb) continue;
    const minMps = near.kerb ? PEDS.threatMinMps : dog ? PEDS.chaseMinMps : PEDS.reactMinMps;
    if (r.speed < minMps || r.h - p.h >= vehicleHeightM(t)) continue;
    const rel = relate(near, p, 30);
    if (!rel) continue;
    // Beside it now: their boxes overlap along the road (plus a metre).
    if (Math.abs(rel.ahead) > (near.lengthM + t.lengthM) / 2 + 1) continue;
    const band = (near.widthM + t.widthM) / 2 + PEDS.lateralM;
    const side = Math.abs(rel.dd);
    if (dog) {
      if (near.vehicle || side >= PEDS.chaseLateralM + band) continue;
      startChase(world, config, st, k, t, rel.sign * r.pos.dir, r.id);
      return;
    }
    if (t.category !== 'pedestrian') continue;
    if (near.kerb) {
      if (side >= band) continue;
      startHop(world, config, st, k, r.id);
      return;
    }
    if (side < band || side >= band + PEDS.reactLateralM) continue;
    if (side < band + PEDS.hopBandM) {
      startHop(world, config, st, k, r.id);
      return;
    }
    st.reactCooldownS[k] = PEDS.reactCooldownS;
    if (phase !== PED_PHASE.react && nextFloat(world.rng.peds) < PEDS.passReactChance) {
      startGesture(world, config, st, k, r.id);
    }
    return;
  }
}

/** Walks, waits, dives and lie-downs: one tick of movement for slot k. */
function move(
  world: World,
  config: SimConfig,
  st: PedsState,
  k: number,
  dt: number,
  threats: readonly Near[],
): void {
  const p = world.movers[st.id[k] ?? -1];
  if (!p) return;
  const t = typeOf(config, st, k);
  const half = t.widthM / 2;
  st.timer[k] = (st.timer[k] ?? 0) - dt;
  const phase = st.phase[k];
  if (phase === PED_PHASE.dive) {
    const u = clamp(1 - (st.timer[k] ?? 0) / PEDS.diveS, 0, 1);
    const from = st.fromD[k] ?? p.pos.d;
    const to = st.toD[k] ?? p.pos.d;
    p.pos.d = from + (to - from) * u;
    p.h = 4 * PEDS.diveHeightM * u * (1 - u);
    p.speed = dt > 0 ? PEDS.diveDistM / PEDS.diveS : 0;
    if (u >= 1) {
      p.h = 0;
      p.speed = 0;
      st.phase[k] = PED_PHASE.down;
      st.timer[k] = PEDS.downS;
    }
    return;
  }
  if (phase === PED_PHASE.down) {
    if ((st.timer[k] ?? 0) > 0) return;
    // Up again: off the road first, to the nearer side; then wait (or loiter) there.
    if (onRoad(config.road, p, half)) {
      const { lo, hi } = roadEdges(config.road, p.pos.edge, p.pos.s);
      const side = hi - p.pos.d < p.pos.d - lo ? 1 : -1;
      st.targetD[k] = offRoadD(config.road, p.pos.edge, p.pos.s, side, half);
      st.phase[k] = PED_PHASE.walk;
    } else if (!scaredReaction(world, config, st, k)) {
      resume(world, st, k, t);
    }
    return;
  }
  if (phase === PED_PHASE.hop) {
    // The hop back from the kerb (W-P): a short arc outward, then a fist or a phone, or carry on.
    const u = clamp(1 - (st.timer[k] ?? 0) / PEDS.hopS, 0, 1);
    const from = st.fromD[k] ?? p.pos.d;
    const to = st.toD[k] ?? p.pos.d;
    p.pos.d = from + (to - from) * u;
    p.h = 4 * PEDS.hopHeightM * u * (1 - u);
    p.speed = dt > 0 ? Math.abs(to - from) / PEDS.hopS : 0;
    if (u >= 1) {
      p.h = 0;
      p.speed = 0;
      if (!scaredReaction(world, config, st, k)) resume(world, st, k, t);
    }
    return;
  }
  if (phase === PED_PHASE.react) {
    // A fist or a phone held up at the road (W-P), then back to what they were doing.
    p.speed = 0;
    if ((st.timer[k] ?? 0) > 0) return;
    st.reactKind[k] = 0;
    resume(world, st, k, t);
    return;
  }
  if (phase === PED_PHASE.along) {
    walkAlong(world, config, st, k, p, t, dt);
    return;
  }
  if (phase === PED_PHASE.fake) {
    fakeOut(world, config, st, k, p, t, dt, threats);
    return;
  }
  if (phase === PED_PHASE.loiter) {
    p.speed = 0;
    if (st.crosses[k] !== 1) return;
    const gap = gapAcceptOn(world);
    // T4.2: the worst-moment gag is a fake-out at the kerb, never a step onto the road.
    if (gap && st.lure[k] === 1 && !onRoad(config.road, p, half) && riderComing(config, p, threats)) {
      startFakeOut(config, st, k, p, t);
      return;
    }
    if ((st.timer[k] ?? 0) > 0 && (gap || !(st.lure[k] === 1 && riderComing(config, p, threats)))) return;
    const home = st.homeD[k] ?? p.pos.d;
    const far = st.farD[k] ?? p.pos.d;
    const goal = Math.abs(p.pos.d - home) < Math.abs(p.pos.d - far) ? far : home;
    if (gap) {
      // T4.2: wait for a gap in the first stage (from the refuge, the same).
      if (!gapClear(config, p, t, threats, p.pos.d, goal)) return;
      st.gated[k] = 1;
      st.hurry[k] = 0;
      st.fromD[k] = p.pos.d;
    }
    st.targetD[k] = goal;
    st.phase[k] = PED_PHASE.walk;
  }
  // Walking across the road, at the kind's own pace. A walker waits for a rider or car in the way.
  // A gap-checked crossing (T4.2) walks one stage at a time and may hurry.
  let stageEnd: number | null = null;
  if (st.gated[k] === 1) {
    stageEnd = gatedTarget(config, st, k, p, t, threats);
    if (stageEnd === null) {
      p.speed = 0;
      return;
    }
  }
  const final = st.targetD[k] ?? p.pos.d;
  const target = stageEnd ?? final;
  const pace = t.cruiseMps * (st.hurry[k] === 1 ? PEDS.hurryScale : 1);
  const step = clamp(target - p.pos.d, -pace * dt, pace * dt);
  const next = p.pos.d + step;
  // Blocked only by a step that closes in on someone: a stopped rider beside a pedestrian never
  // pins them, because stepping away is always allowed.
  let blocked = false;
  for (const r of threats) {
    const after = sideGap(r, p, t, next, PEDS.walkClearM);
    if (after === null || after >= PEDS.walkClearM) continue;
    const now = sideGap(r, p, t, p.pos.d, PEDS.walkClearM);
    if (now === null || after < now) {
      blocked = true;
      break;
    }
  }
  p.speed = blocked ? 0 : Math.abs(step) / Math.max(dt, 1e-9);
  if (!blocked) p.pos.d = next;
  p.yaw = (step >= 0 ? 1 : -1) * HALF_PI;
  if (Math.abs(target - p.pos.d) < 1e-6) {
    p.pos.d = target;
    p.speed = 0;
    st.hurry[k] = 0;
    // T4.2: the refuge ends a stage, not the crossing; the next stage is checked on the next tick.
    if (target !== final) return;
    st.gated[k] = 0;
    // A stroller who walked off the road after a dive strolls on (W-P).
    if (strolls(t)) {
      resume(world, st, k, t);
      return;
    }
    st.phase[k] = PED_PHASE.loiter;
    st.timer[k] = rollWait(world);
    st.lure[k] = nextFloat(world.rng.peds) < PEDS.lureChance && roadsideClass(t) === 'dodges' ? 1 : 0;
    p.yaw = (p.pos.d < 0 ? 1 : -1) * HALF_PI;
  }
}

/**
 * Contacts first (someone already on top of a pedestrian knocks them over), then the threat check:
 * a rider or car inside pedThreatRangeM(its speed) ahead and inside the side band.
 */
function react(
  world: World,
  config: SimConfig,
  st: PedsState,
  k: number,
  threats: readonly Near[],
  dt: number,
): void {
  const p = world.movers[st.id[k] ?? -1];
  if (!p) return;
  const t = typeOf(config, st, k);
  // Contacts: counted once per toucher, and never expected.
  let touching: Near | null = null;
  for (const r of threats) {
    if (boxNear(r, p, t, p.pos.d, 0)) {
      touching = r;
      break;
    }
  }
  if (!touching) {
    st.touching[k] = -1;
  } else if (st.touching[k] !== touching.m.id) {
    st.touching[k] = touching.m.id;
    if (touching.vehicle) {
      st.vehicleContacts++;
    } else {
      st.contacts++;
      // Contact is soft for a `dodges` kind (src/sim/roadside.ts). For a heavy mover that could not get out
      // of the way (`yields`, `solid`), the one rule for meeting a heavy thing decides (playtest 4, "solid but
      // forgiving"; sim/traffic/contact-rule.ts): its closing speed, a crash at `traffic.solidHitMps` or
      // more, else a wobble. It was a crash at any speed.
      if (roadsideClass(t) !== 'dodges') {
        const closing = pedClosingMps(touching, p, t);
        const data = { cause: 'ped', hazard: 'big', kind: t.contentId, impactMps: closing };
        if (trafficContactCrashes(world.params, closing))
          emit(world, 'crash', touching.m.id, data, { target: p.id });
        else emit(world, 'wobble', touching.m.id, data, { target: p.id });
      }
    }
    if (st.phase[k] !== PED_PHASE.dive && roadsideClass(t) !== 'solid') {
      startDive(world, config, st, k, touching.m, true, threats);
    }
  }
  if (st.phase[k] === PED_PHASE.dive) return;
  let threat: Mover | null = null;
  let closest = Infinity;
  // A kerb rider on the shoulder never reaches someone on the verge: they hop back (closePass).
  const verge = !onRoad(config.road, p, t.widthM / 2);
  for (const near of threats) {
    const r = near.m;
    if (near.kerb && verge) continue;
    if (r.speed < PEDS.threatMinMps || r.h - p.h >= vehicleHeightM(t)) continue;
    const rel = relate(near, p, kindThreatRangeM(world, t, r.speed));
    const band = (near.widthM + t.widthM) / 2 + PEDS.lateralM;
    // A crash can throw a tumbling body backward along the road, against its travel direction (a
    // head-on wipeout), so a tumble threatens both ways (found in the integration round: seed 23's
    // rival, thrown back at 20 m/s, landed on a fisherman who read him as already past).
    const behind = r.mode === 'Tumble' ? -Infinity : -PEDS.threatBehindM;
    if (!rel || rel.ahead < behind || Math.abs(rel.dd) >= band) continue;
    if (Math.abs(rel.ahead) < closest) {
      closest = Math.abs(rel.ahead);
      threat = r;
    }
  }
  // A `solid` kind stands where it is (src/sim/roadside.ts); it is not even startled.
  if (roadsideClass(t) === 'solid') return;
  if (threat) startDive(world, config, st, k, threat, false, threats);
  else closePass(world, config, st, k, threats, dt);
}

export function pedsStep(world: World, config: SimConfig): void {
  const st = pedsState(world);
  if (st.id.length === 0) return;
  const dt = world.timeScale / 60;
  const threats = nearThreats(world, config);
  for (let k = 0; k < st.id.length; k++) {
    move(world, config, st, k, dt, threats);
    react(world, config, st, k, threats, dt);
  }
}
