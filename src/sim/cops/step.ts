// The cops: the system's step (sim/cops), the code only a running race needs. It loads after the first
// screen, in the sim's step chunk (src/sim/late.ts; scripts/sim-chunk.mjs SIM_STEPS_TEST), and a race waits for
// it. ./index.ts keeps the system's state, its init, its tuning and what a snapshot reads (the menu's grid).
import { clamp, type EntityId } from '../../core';
import type { RouteBranch } from '../../road';
import { maxYawAt, riderState } from '../riders';
import { combatState, relative } from '../combat';
import { type SimConfig, InputFlag, type SimRiderDef } from '../types';
import { groundUnder } from '../ground';
import {
  keepOff,
  lawBarredZone,
  lawMayTake,
  lawNeverTakes,
  lineOutsideZone,
  STRAY_GAIN,
  STRAY_LATERAL_MPS,
  STRAY_PAST_EDGE_M,
  STRAY_RETURN_MPS,
  wayBack,
  jumpRunUp,
} from '../ai/branches';
import {
  bendSpeed,
  blockerAt,
  FIXED_OFF_ROAD_MPS,
  furnitureSeen,
  lineClear,
  offRoadAmongFixed,
  pathClear,
  seeVehicle,
  type Obstacle,
} from '../ai/sense';
import { droppedBikesSeen } from '../ai/dropped';
import { vehicleInfo } from '../traffic';
import { emit, speedMultiplierOf, type Mover, type World } from '../world';
import {
  defOf,
  distance,
  CHAOS_MEMORY_TICKS,
  isPlayer,
  gapAlongRoute,
  PATROL,
  isDown,
  COP_CHASING,
  tierOf,
  endChase,
  CHAOS_HIT,
  COP_PARKED,
  jitter,
  HEAT,
  addHeat,
  HEAT_MAX,
  COP_DONE,
  routePosAt,
  sideLanes,
  roadblockSpots,
  habitOf,
  relentlessness,
  hp,
  HABIT,
  copsState,
  heatOn,
  clearOfLanes,
  type CopsState,
  HANG_BACK_TICKS,
  MOVE_IN_TICKS,
  CRAWL_MPS,
} from './index';

/** Where he pulls up behind a downed target (well inside the bust radius). */
const PULL_UP_GAP_M = 6;
/**
 * He never rides faster than lets him stop this far behind where his target could stop if it braked
 * as hard as its bike can, braking at STOP_BRAKE_SHARE of his own bike's brakes [default] (the
 * integration skeptic and the road lane's launch report, playtest 1c: with the launch punch he caught
 * up from the lot, and a player who braked hard had him sail past at every brake time from 8 to
 * 25 s, then crawl on along the shoulder).
 */
const STOP_BEHIND_M = 8;
const STOP_BRAKE_SHARE = 0.8;
/**
 * Moving in alongside, he keeps braking room for his full brakes, so beside a target who dabs the
 * brakes (riding in traffic) he stays level, inside his weapon's reach, where his swing (and your
 * steal) can happen. At STOP_BRAKE_SHARE he dropped about a stopping distance back at every dab
 * (some 6 m at 25 m/s, out of the baton's 1.5 m reach), so an armed cop hardly ever swung: the
 * integration skeptic's F2, "steal chances are rare". Carried past a hard stop, he still ends the
 * move-in and waits on the shoulder (below). [default] (the cops polish round, 2026-10-01)
 */
const ALONGSIDE_BRAKE_SHARE = 1;
/** Hanging back: no further back than the follow gap plus this counts as on station. */
const STATION_M = 10;
/** Moving in, he rides this far to the side of his target: inside punch and kick reach. */
const ALONGSIDE_D_M = 1.2;
/** Within this along the road counts as alongside (the auto-target box is 4 m). */
const ALONGSIDE_S_M = 3;
const COAST_DECEL = 0.6; // m/s², the riding model's off-throttle deceleration
const CATCH_UP_NEAR_M = 4;

/** Throttle that holds `v` on the flat in the riding model (the AI uses the same feed-forward). */
function holdThrottle(accel: number, top: number, v: number): number {
  return (accel * ((v * v) / (top * top)) + COAST_DECEL) / (accel + COAST_DECEL);
}

// The cop's eyes on traffic (W-S follow-up, [default] starting numbers). In a San Francisco race
// (seed 7) the cops never looked at the cars and hit them 13 times, one sedan three times.
/** How far ahead he looks at traffic, m. */
const TRAFFIC_SEE_M = 250;
/** Side room he keeps past a vehicle's half width: his own half width plus a margin, m. */
const TRAFFIC_CLEAR_M = 0.8;
/** A vehicle closing within this many seconds (or this many metres) is one to go round or follow. */
const TRAFFIC_BLOCK_S = 3.5;
const TRAFFIC_BLOCK_M = 12;
/** Seconds out an oncoming car closing fast is seen. */
const TRAFFIC_AHEAD_S = 4;
/** Along-road margin past a vehicle's ends within which it counts as alongside, m. */
const TRAFFIC_ALONGSIDE_M = 2.5;
/** Following a vehicle he cannot pass: braking to stop this far behind it, at this rate (m, m/s²). */
const TRAFFIC_FOLLOW_M = 5;
const TRAFFIC_FOLLOW_DECEL = 5;
/** A move across into the oncoming half costs this many metres of extra swerve (a cop takes it). */
const TRAFFIC_ONCOMING_COST_M = 1;
/** He crosses in front of a vehicle he is coming up behind only this many seconds or more out. */
const TRAFFIC_CROSS_S = 1.5;
/** How far ahead (plus 2.5 s of closing) a move across must be clear of traffic, m. */
const TRAFFIC_PATH_M = 15;
/** How far behind him he still sees a piece of street furniture, m (past the alongside rule's reach). */
const FIXED_BEHIND_M = 6;
/** The crawl he keeps boxed in behind a piece of street furniture, m/s (well under the 10 m/s crash line). */
const FIXED_CRAWL_MPS = 3;

/**
 * The vehicles he can see ahead and around, at their real sizes. (Not pedestrians: they keep to the
 * verge, where a cop pulls over, and he never ran one down.)
 */
function trafficSeen(world: World, config: SimConfig, cop: Mover): Obstacle[] {
  const out: Obstacle[] = [];
  for (const other of world.movers) {
    if (other.kind !== 'vehicle' || other.mode !== 'Road') continue;
    const s = seeVehicle(config.road, cop, other, TRAFFIC_SEE_M);
    if (!s) continue;
    const info = vehicleInfo(world, config, other.id);
    out.push({ s, size: { halfLength: (info?.lengthM ?? 4.6) / 2, halfWidth: (info?.widthM ?? 1.9) / 2 } });
  }
  return out;
}

/**
 * Traffic's last word on the cop's line `dWant` and speed `vWant` (W-S follow-up, SF seed 7):
 * - a move across the path of traffic is not worth it: he holds the line he is on;
 * - the nearest vehicle ahead in his line (or in the one he is on) that he would reach within
 *   TRAFFIC_BLOCK_S, he goes round on a side that is clear all the way past it (the cheaper swerve;
 *   the oncoming half costs a little more; across the front of one he is coming up behind only while
 *   it is TRAFFIC_CROSS_S out), easing off until he is across;
 * - with no clear side he follows it, or (an oncoming one) gets out of its way on his own side,
 *   behind whatever is there;
 * - last, he never steers into a vehicle alongside.
 * The solid street furniture counts as traffic that stands still (sim/ai/sense `furnitureSeen`; the live
 * check of #619), except on the way across to a line; on a street lined with it he also keeps to the
 * speed that holds its bends (`bendSpeed`), and off the road among it to a crawl (`offRoadAmongFixed`).
 * `dodging` asks for a brisker swerve.
 */
function trafficGuard(
  world: World,
  config: SimConfig,
  cop: Mover,
  dWant: number,
  vWant: number,
  dLo: number,
  dHi: number,
): { d: number; v: number; brake: number; dodging: boolean } {
  const pos = cop.pos;
  const v = cop.speed;
  let d = dWant;
  let speed = vWant;
  let brake = 0;
  let dodging = false;
  const seen = trafficSeen(world, config, cop);
  // The solid street furniture in reach (the live check of #619), as the rivals see it (sim/ai/sense
  // `furnitureSeen`): his line must be clear of it, and he goes round one in his way or alongside as
  // round a stopped car (`all`); only moving traffic blocks the way across to a line.
  const fixed = furnitureSeen(world, config, cop, Math.min(TRAFFIC_SEE_M, v * 6 + 40), FIXED_BEHIND_M);
  // A bike left on the road after a crash is solid too (pile-ups; the maintainer, 2026-10-06): kept clear
  // of as the furniture is (`still`), but one on the road never slows him for bends.
  const dropped = droppedBikesSeen(world, config, cop, Math.min(TRAFFIC_SEE_M, v * 6 + 40), FIXED_BEHIND_M);
  const still = dropped.length > 0 ? [...fixed, ...dropped] : fixed;
  const all = still.length > 0 ? [...seen, ...still] : seen;
  if (all.length === 0) return { d, v: speed, brake, dodging };
  if (fixed.length > 0) {
    // A street lined with solid furniture: slow enough to hold its bends (not carried wide onto the
    // sidewalk), and back off it at a crawl when a shove put him there.
    const bike = config.riders[cop.riderIndex]?.bike;
    if (bike) speed = Math.min(speed, bendSpeed(world, config, cop, bike.steerRateMps));
    const edge = config.road.edges[pos.edge];
    if (edge && offRoadAmongFixed(pos.d, edge.dMin, edge.dMax, fixed))
      speed = Math.min(speed, FIXED_OFF_ROAD_MPS);
  }
  const look = clamp(14 + v * 2.2, 14, 90);
  if (
    !pathClear(seen, v, pos.d, d, TRAFFIC_PATH_M, TRAFFIC_CLEAR_M) ||
    (still.length > 0 && !lineClear(still, v, d, TRAFFIC_PATH_M, TRAFFIC_CLEAR_M))
  )
    d = pos.d;
  // Behind a piece of street furniture he never stops: he crawls on, still rolling, so he can steer.
  const follow = (o: Obstacle): number => {
    const room = Math.max(0, o.s.ahead - o.size.halfLength - TRAFFIC_FOLLOW_M);
    const crawl = o.s.mover.id < 0 ? FIXED_CRAWL_MPS : 0;
    return Math.max(crawl, Math.max(0, o.s.vAlong) + Math.sqrt(2 * TRAFFIC_FOLLOW_DECEL * room));
  };
  let slowFor: Obstacle | null = null;
  const blocker =
    blockerAt(all, v, d, look, TRAFFIC_CLEAR_M, TRAFFIC_AHEAD_S) ??
    blockerAt(all, v, pos.d, look * 0.5, TRAFFIC_CLEAR_M, TRAFFIC_AHEAD_S);
  if (blocker) {
    const o = blocker.s;
    const gap = o.ahead - blocker.size.halfLength;
    const closing = v - o.vAlong;
    const ttc = closing > 0.1 ? gap / closing : Infinity;
    if (ttc < TRAFFIC_BLOCK_S || gap < TRAFFIC_BLOCK_M) {
      const od = o.mover.pos.d;
      const w = blocker.size.halfWidth + TRAFFIC_CLEAR_M + 0.4;
      const others = seen.filter((x) => x !== blocker);
      let best: number | null = null;
      let bestCost = Infinity;
      for (const cand of [od - w, od + w, od - w - 1, od + w + 1]) {
        if (cand < dLo || cand > dHi) continue;
        if ((cand - od) * (pos.d - od) < 0 && o.vAlong >= 0 && ttc < TRAFFIC_CROSS_S) continue;
        if (!lineClear(all, v, cand, gap + 20, TRAFFIC_CLEAR_M)) continue;
        if (!pathClear(others, v, pos.d, cand, TRAFFIC_PATH_M, TRAFFIC_CLEAR_M)) continue;
        const oncoming = cand * pos.dir < 0 ? TRAFFIC_ONCOMING_COST_M : 0;
        const cost = Math.abs(cand - pos.d) + 0.5 * Math.abs(cand - dWant) + oncoming;
        if (cost < bestCost) {
          bestCost = cost;
          best = cand;
        }
      }
      if (best !== null) {
        d = best;
        dodging = true;
        // Not across yet and close: ease off until the line opens.
        if (Math.abs(pos.d - best) > w * 0.6 && gap < v * 0.9) {
          speed = Math.min(speed, Math.max(0, o.vAlong) + 3);
          slowFor = blocker;
        }
      } else if (o.vAlong < 0) {
        // Boxed in by an oncoming car: out of its band on his own side, behind whatever is there.
        d = clamp(od + w * pos.dir, dLo, dHi);
        dodging = true;
        const same = all.filter((x) => x.s.vAlong >= 0);
        const there = blockerAt(same, v, d, look, TRAFFIC_CLEAR_M, TRAFFIC_AHEAD_S);
        if (there) {
          speed = Math.min(speed, follow(there));
          slowFor = there;
        }
      } else {
        // Boxed in: follow it, at a speed that stops TRAFFIC_FOLLOW_M behind it.
        speed = Math.min(speed, follow(blocker));
        slowFor = blocker;
        d = pos.d;
      }
    }
  }
  if (slowFor && v > speed) {
    const bike = config.riders[cop.riderIndex]?.bike;
    const room = Math.max(0.5, slowFor.s.ahead - slowFor.size.halfLength - TRAFFIC_FOLLOW_M);
    const target = Math.max(0, slowFor.s.vAlong);
    brake = bike ? (v * v - target * target) / (2 * room * bike.brakeMps2) : 1;
  }
  // Never steer into a vehicle (or a solid piece) alongside: hold at least its clearance from it.
  for (const o of all) {
    const along = o.size.halfLength + TRAFFIC_ALONGSIDE_M;
    if (o.s.ahead > along || o.s.ahead < -along) continue;
    const od = o.s.mover.pos.d;
    const clearance = o.size.halfWidth + TRAFFIC_CLEAR_M;
    if (pos.d >= od) d = Math.max(d, Math.min(od + clearance, dHi));
    else d = Math.min(d, Math.max(od - clearance, dLo));
  }
  return { d, v: speed, brake, dodging };
}

/** The cop's command for the next tick: close on the target, hold the gap, or pull up beside him. */
export function drive(world: World, config: SimConfig, st: CopsState, cop: Mover, def: SimRiderDef): void {
  const bike = def.bike;
  const pos = cop.pos;
  const v = cop.speed;
  const target = st.phase[cop.id] === COP_CHASING ? world.movers[st.target[cop.id] ?? -1] : undefined;
  const { drive: lane, shoulder } = sideLanes(config, pos);
  // Law with a personality (run W-T): a relentless cop holds closer and moves in sooner as his
  // chasing time ramps; a citations cop has his own spells and rides alongside out of bumping range.
  const habit = habitOf(def);
  const r = relentlessness(world, config, cop.id);
  const cites = habit?.kind === 'citations' ? habit : null;
  const followGap = (world.params['cops.followGapM'] ?? 40) * (1 - HABIT.relentless.gapShare * r);
  const hangTicks = cites
    ? hp(cites, 'hangBackS', HABIT.citations.hangBackS) * 60
    : HANG_BACK_TICKS * (1 - HABIT.relentless.hangShare * r);
  const moveInTicks = cites ? hp(cites, 'alongsideS', HABIT.citations.alongsideS) * 60 : MOVE_IN_TICKS;
  const sideM = cites ? hp(cites, 'sideM', HABIT.citations.sideM) : ALONGSIDE_D_M;

  // Default line: the centre line, the inner edge of his own lane, where traffic in both
  // directions leaves him room to ride through (a cop splitting the lanes).
  let vWant = 0;
  let dWant = lane ? lane.dCenterM - lane.direction * (lane.widthM / 2) : pos.d;
  const shortcutLane = config.road.lanesAt(pos.edge, pos.s).find((l) => l.kind === 'shortcut');
  if (shortcutLane) dWant = shortcutLane.dCenterM;
  // He may stop in a lane only beside his target (a downed one he is busting, or one who has
  // stopped with him alongside) or with the man he busted; anywhere else, only off the lanes.
  let mayStop = false;
  let feedBrake = 0;
  if (target && isDown(target)) {
    const gap = gapAlongRoute(config, cop, target);
    const decel = bike.brakeMps2 * 0.6;
    // Pull up just behind him: the speed from which braking stops the bike in time, with the
    // braking that stopping distance needs fed forward (so he does not sail past).
    const room = gap - PULL_UP_GAP_M;
    vWant = room > 0 ? Math.sqrt(2 * decel * room) : 0;
    if (v > vWant) feedBrake = room > 0.5 ? (v * v - vWant * vWant) / (2 * room * bike.brakeMps2) : 1;
    dWant = target.pos.d;
    mayStop = true;
  } else if (target) {
    const gap = gapAlongRoute(config, cop, target);
    const decel = bike.brakeMps2 * 0.6;
    // Hang back at the follow gap; after a spell on station, move in alongside for a while
    // (so he can be hit, and is there if you fall), then drop back. Either way: close to the
    // goal gap, match his speed, and brake early enough not to overshoot.
    const id = cop.id;
    let spell = st.closingFor[id] ?? 0;
    if (st.closing[id] === 1) {
      if (Math.abs(gap) <= ALONGSIDE_S_M) spell += world.timeScale;
      // Carried past a target who braked hard while he moved in: the move-in is over, and he waits
      // on the shoulder as he does whenever he is ahead (below). Moving in, he steered back at the
      // target from there and never stood still, so he crawled on along the shoulder for good.
      // Out of reach ahead (the man got away, or the cop was knocked off): the move-in is over too,
      // and he hangs back again. Still moving in from 100 to 300 m back, he rode his man's line (a
      // traffic lane) at his pursuit burst into the car ahead, again and again (W-S, SF seed 7).
      if (spell >= moveInTicks || gap < -ALONGSIDE_S_M || gap > followGap + STATION_M) {
        st.closing[id] = 0;
        spell = 0;
      }
    } else {
      if (gap <= followGap + STATION_M) spell += world.timeScale;
      if (spell >= hangTicks) {
        st.closing[id] = 1;
        spell = 0;
      }
    }
    st.closingFor[id] = spell;
    const closing = st.closing[id] === 1;
    const room = gap - (closing ? 0 : followGap);
    vWant = room > 0 ? target.speed + Math.sqrt(2 * decel * room) : target.speed + 0.5 * room;
    // A stopping distance: never faster than he can stop where the target could stop, with that
    // braking fed forward (as the pull-up above), so he cannot sail past. Hanging back, always, and
    // STOP_BEHIND_M short of it; moving in alongside, once the target brakes, and no further than
    // alongside (he rides beside a cruising target, inside a stopping distance by design).
    const targetBraking = (world.inputs[target.id]?.brake ?? 0) > 0;
    if (!closing || targetBraking) {
      const m = speedMultiplierOf(config);
      const m2 = m * m;
      const targetBrake = (defOf(config, target)?.bike.brakeMps2 ?? bike.brakeMps2) * m2;
      const ownBrake = bike.brakeMps2 * m2;
      const short = closing ? -ALONGSIDE_S_M : STOP_BEHIND_M;
      const stopRoom = gap - short + (target.speed * target.speed) / (2 * targetBrake);
      const share = closing ? ALONGSIDE_BRAKE_SHARE : STOP_BRAKE_SHARE;
      const vSafe = stopRoom > 0 ? Math.sqrt(2 * ownBrake * share * stopRoom) : 0;
      if (vWant > vSafe) {
        vWant = vSafe;
        if (v > vSafe) feedBrake = (v * v) / (2 * Math.max(stopRoom, 0.5) * ownBrake);
      }
    }
    mayStop = Math.abs(gap) <= ALONGSIDE_S_M;
    if (closing) {
      const edge = config.road.edges[pos.edge];
      const centre = edge ? (edge.dMin + edge.dMax) / 2 : 0;
      dWant = target.pos.d + (target.pos.d > centre ? -sideM : sideM);
    } else if (gap < -ALONGSIDE_S_M && shoulder) {
      // Ahead of him: ease onto the shoulder and let him come past, then fall in behind.
      dWant = shoulder.dCenterM;
    } else if (gap < 30) dWant = target.pos.d;
  } else if (st.phase[cop.id] === COP_DONE && st.busted.length > 0) {
    // The chase ended in a bust: he stays with the man he busted.
    dWant = pos.d;
    mayStop = true;
  } else if (shoulder) {
    // Nothing to chase: pull onto the shoulder and stop there.
    dWant = shoulder.dCenterM;
  }
  // A heat cop well back closes with a pursuit burst (riders' boost raises his top speed); a
  // relentless one with his own catch-up as he ramps, and a citations one with his, always (run
  // W-T: never in a hurry, always there); the larger of the two.
  let burst = 0;
  const catchUp =
    habit?.kind === 'relentless'
      ? (hp(habit, 'maxScale', HABIT.relentless.maxScale) - 1) * r
      : cites
        ? hp(cites, 'maxScale', HABIT.citations.maxScale) - 1
        : 0;
  if (target && (st.heatCop[cop.id] === 1 || catchUp > 0)) {
    const gap = gapAlongRoute(config, cop, target);
    const heatBurst = st.heatCop[cop.id] === 1 && gap - followGap > HEAT.burstM ? HEAT.catchUpMps : 0;
    // His own catch-up runs until he is near where he wants to be: the follow gap, or alongside
    // while he moves in (a player faster than his own top speed is otherwise out of reach).
    const goal = st.closing[cop.id] === 1 ? ALONGSIDE_S_M : followGap;
    const far = gap - goal > HEAT.burstM;
    const own = catchUp > 0 && (far || (st.closing[cop.id] === 1 && gap - goal > CATCH_UP_NEAR_M));
    burst = Math.max(heatBurst, own ? bike.topSpeedMps * catchUp : 0);
    if (burst > 0) {
      const rs = riderState(world);
      rs.boost[cop.id] = Math.max(rs.boost[cop.id] ?? 0, 2);
      rs.boostMps[cop.id] = burst;
      if (heatBurst > 0 || far) vWant = Math.max(vWant, bike.topSpeedMps + burst);
    }
  }
  const launchLine = jumpRunUp(config, pos);
  if (launchLine !== null && st.phase[cop.id] === COP_CHASING) {
    dWant = launchLine;
    vWant = bike.topSpeedMps;
    feedBrake = 0;
  }
  vWant = clamp(vWant, 0, bike.topSpeedMps + burst);
  // A patrol cop holds his line for his first seconds out, so he never swerves into the player
  // who has just gone by him (he falls in behind once the player is clear).
  const until = st.patrolUntil[cop.id] ?? 0;
  if (until > 0 && st.clock < until - (PATROL.chaseS - PATROL.holdLineS) * 60) dWant = pos.d;
  // Follow a target onto an allowed branch through its actual split, rather than waiting on the
  // highway until the paths rejoin. The ordinary bike and traffic rules still judge the run-up.
  const targetBranch = target ? config.route.branchAt(target.pos.edge) : null;
  const split = targetBranch?.choice;
  if (
    split &&
    split.edge === pos.edge &&
    pos.dir === 1 &&
    pos.s >= split.s0 - 150 &&
    pos.s <= split.s1 &&
    lawMayTake(config, split)
  ) {
    dWant = (split.d0 + split.d1) / 2;
    vWant = bike.topSpeedMps;
    feedBrake = 0;
  }
  // Never stand still in a travel lane: below the crawl, head for the shoulder and keep rolling
  // until he is clear of the lane (traffic never passes a stopped rider in its lane).
  if (!mayStop && vWant < CRAWL_MPS && !clearOfLanes(config, pos)) {
    vWant = Math.min(CRAWL_MPS, bike.topSpeedMps);
    if (shoulder) dWant = shoulder.dCenterM;
  }
  // The law avoids explicitly barred branches (sim/ai/branches.ts): a
  // branch the route bars to them (`aiTake` 0, or a gap with no `aiTake`: sim/ai/branches.ts) is
  // never entered. His line, chasing a man who takes it, keeps out of its split zone, and he rides
  // the main path on to wait where it rejoins. (He does not share the rivals' shortcut roll.)
  // Wave C, G3 (keepOff): a dodge keeps out of it too, and off the side where the branch still
  // overlaps the main road just past the split (traffic's lines are bounded short of both); a shove
  // that puts him there is steered out of hard, below.
  const barred = lawBarredZone(config, pos.edge, pos.s, pos.dir);
  if (barred) dWant = lineOutsideZone(barred, dWant);
  // Traffic has the last word (W-S): round the car ahead in his line, or behind it.
  const edgeNow = config.road.edges[pos.edge];
  const lawNever = (b: RouteBranch): boolean => lawNeverTakes(config, b);
  const keep = keepOff(config, pos, (edgeNow?.dMin ?? -5) + 0.8, (edgeNow?.dMax ?? 5) - 0.8, lawNever);
  const guard = trafficGuard(world, config, cop, dWant, vWant, keep.lo, keep.hi);
  dWant = keep.guarded ? clamp(guard.d, keep.lo, keep.hi) : guard.d;
  if (guard.v < vWant) {
    vWant = guard.v;
    if (v > vWant) feedBrake = Math.max(feedBrake, guard.brake);
    // The pursuit burst's push would carry him past his brakes: it waits until the way is clear.
    if (burst > 0) riderState(world).boost[cop.id] = 0;
  }

  const err = vWant - v;
  let throttle = 0;
  let brake = 0;
  if (vWant <= 0.05 && v < 0.5) brake = 1;
  else if (err >= 0)
    throttle = clamp(holdThrottle(bike.accelMps2, bike.topSpeedMps, vWant) + 0.5 * err, 0, 1);
  else if (err < -0.5) brake = clamp(Math.max(-err * 0.3, feedBrake), 0, 1);

  // Steering: a lateral speed toward dWant, with the road's curvature fed forward (as sim/ai).
  const edge = config.road.edges[pos.edge];
  if (edge) dWant = clamp(dWant, edge.dMin + 0.8, edge.dMax - 0.8);
  const steerScale = world.params['riders.steerScale'] ?? 1;
  // Alongside he holds his line firmly, so a knockback does not keep him out of reach for long.
  // Dodging traffic, he swerves as briskly as a rival does (sim/ai: 5 m/s across).
  let gain = st.closing[cop.id] === 1 || guard.dodging ? 1.6 : 0.8;
  let latMax = guard.dodging ? 5 : 3;
  // The law avoids explicitly barred branches even when shoved onto one (wave C, G3;
  // sim/ai/branches.ts). While the barred branch still overlaps the main road, he brakes
  // to a crawl and rides for that edge, where the road's handover puts him back on the main road; past
  // that point he stops where he is (a cop never turns round), and his chase is over: the heat can
  // send him again from there, as any cop whose chase ended (sendHeatCop puts him on the main road).
  // Shoved toward a barred split, he is steered out of it hard.
  const strayOn = config.route.branchAt(pos.edge);
  if (strayOn && lawNever(strayOn) && edge) {
    const back = wayBack(config, pos);
    dWant = back === 0 ? pos.d : back > 0 ? edge.dMax + STRAY_PAST_EDGE_M : edge.dMin - STRAY_PAST_EDGE_M;
    gain = STRAY_GAIN;
    latMax = STRAY_LATERAL_MPS;
    // A bike turns only as it rolls: on the way back he keeps a crawl, so he gets across.
    const crawl = back !== 0 && v <= STRAY_RETURN_MPS;
    throttle = crawl
      ? clamp(
          holdThrottle(bike.accelMps2, bike.topSpeedMps, STRAY_RETURN_MPS) + 0.5 * (STRAY_RETURN_MPS - v),
          0,
          1,
        )
      : 0;
    brake = crawl ? 0 : 1;
    // A pursuit burst's push would carry him on past his brakes.
    riderState(world).boost[cop.id] = 0;
    if (back === 0 && v < CRAWL_MPS) endChase(world, st, cop.id);
  } else if (keep.pushed) {
    gain = Math.max(gain, STRAY_GAIN);
    latMax = Math.max(latMax, STRAY_LATERAL_MPS);
  }
  const vLat = clamp((dWant - pos.d) * gain, -latMax, latMax) * pos.dir;
  const wantYaw = vLat / Math.max(v, 5);
  const turn = pos.dir * config.road.kappaAt(pos.edge, pos.s) * v + 3 * (wantYaw - cop.yaw);
  const yawTarget = cop.yaw + turn / 4;
  const steer = clamp(yawTarget / maxYawAt(bike.steerRateMps, v, steerScale), -1, 1);
  world.inputs[cop.id] = {
    steer: Math.round(steer * 127),
    throttle: Math.round(throttle * 255),
    brake: Math.round(brake * 255),
    flags: 0,
  };
}

export const CHAOS_HIT_COP = 2;

export const CHAOS_TAKEDOWN = 3;

/** A hit or kick within this distance of a cop makes its attacker his target. */
export const CHAOS_RADIUS_M = 60;

const CITE_ACROSS_M = 4;

/** The loose ground off the road (sim/ground's surfaces): riding on it is riding off-road. */
const LOOSE_GROUND = new Set(['dirt', 'sand', 'grass', 'gravel']);

/**
 * Whether a rider is off the road (playtest 2's OFF-ROAD answer, "Anywhere with ground"): on the
 * ground, on loose ground (sim/ground's surface under his wheels). [default]
 */
function offRoad(config: SimConfig, m: Mover): boolean {
  const g = groundUnder(config.road, m.pos.edge, m.pos.s, m.pos.d, m.h);
  return g !== null && LOOSE_GROUND.has(g);
}

/** Whether mayhem can summon cops in this race. */
function chaosSummons(config: SimConfig): boolean {
  const c = config.event.cops;
  return !!c && c.mode !== 'none' && (c.chaosSummon || c.mode === 'chaos-summoned');
}

function hasFinished(config: SimConfig, m: Mover): boolean {
  return config.route.distanceToFinish(m.pos.edge, m.pos.s) <= 0;
}

/** Whether a rider can still be chased: on the course, not finished, not already busted. */
function chaseable(config: SimConfig, st: CopsState, m: Mover | undefined): m is Mover {
  return !!m && m.kind === 'rider' && !hasFinished(config, m) && !st.busted.includes(m.id);
}

function pickTarget(world: World, config: SimConfig, st: CopsState, cop: Mover): EntityId {
  // Chaos nearby this tick (combat ran earlier in the tick): the attacker becomes the target.
  for (const e of world.events) {
    if (e.type !== 'hit' && e.type !== 'kick') continue;
    const attacker = world.movers[e.actor];
    if (!attacker || attacker.id === cop.id || defOf(config, attacker)?.faction === 'law') continue;
    if (distance(config, cop, attacker) <= CHAOS_RADIUS_M) {
      st.target[cop.id] = attacker.id;
      st.chaosUntil[cop.id] = st.clock + CHAOS_MEMORY_TICKS;
    }
  }
  const current = world.movers[st.target[cop.id] ?? -1];
  if ((st.chaosUntil[cop.id] ?? 0) > st.clock && chaseable(config, st, current)) return current.id;
  st.chaosUntil[cop.id] = 0;
  // Otherwise the nearest player still in the race.
  let best: EntityId = -1;
  let bestGap = Infinity;
  for (const m of world.movers) {
    if (!isPlayer(config, m) || !chaseable(config, st, m)) continue;
    const gap = Math.abs(gapAlongRoute(config, cop, m));
    if (gap < bestGap) {
      bestGap = gap;
      best = m.id;
    }
  }
  return best;
}

/**
 * The nearest player short of a parked patrol cop: how far short along the route (m; negative once
 * past him, and only down to -PATROL.pullOutM; Infinity when no player is that close) and how fast
 * he rides.
 */
function patrolGap(
  world: World,
  config: SimConfig,
  st: CopsState,
  cop: Mover,
): { gap: number; speed: number; id: EntityId } {
  let gap = Infinity;
  let speed = 0;
  let id: EntityId = -1;
  for (const m of world.movers) {
    if (!isPlayer(config, m) || !chaseable(config, st, m)) continue;
    const g = gapAlongRoute(config, m, cop);
    if (g >= -PATROL.pullOutM && g < gap) {
      gap = g;
      speed = m.speed;
      id = m.id;
    }
  }
  return { gap, speed, id };
}

/**
 * When the siren sounds and when he pulls out, in scaled ticks of the cops clock. The time to the
 * pull-out is `cops.spawnDelayS` ÷ the difficulty's cop frequency (never, at frequency 0), but
 * never shorter than the siren lead; the siren sounds the lead before it.
 */
export function copTiming(world: World, config: SimConfig): { sirenTicks: number; pullOutTicks: number } {
  const frequency = config.difficulty.copFrequency;
  const delayTicks = frequency > 0 ? ((world.params['cops.spawnDelayS'] ?? 20) * 60) / frequency : Infinity;
  const leadTicks = Math.max(0, world.params['cops.sirenLeadS'] ?? 3) * 60;
  const pullOutTicks =
    config.event.kind === 'cop-escape' && frequency > 0 ? leadTicks : Math.max(delayTicks, leadTicks);
  return { sirenTicks: pullOutTicks - leadTicks, pullOutTicks };
}

/**
 * The knockdown-only bust's collar: this tick's takedowns (combat credits them before this phase)
 * whose actor is a cop and whose target is a player; riding again frees him.
 */
function noteCollars(world: World, config: SimConfig, st: CopsState): void {
  for (const e of world.events) {
    if (e.type !== 'takedown' || e.target === undefined || !st.cops.includes(e.actor)) continue;
    const m = world.movers[e.target];
    if (m && isPlayer(config, m) && isDown(m)) st.collar[m.id] = e.actor;
  }
  for (const m of world.movers) if (!isDown(m) && (st.collar[m.id] ?? -1) >= 0) st.collar[m.id] = -1;
}

/** Players down near an upright, spawned cop build up dwell; a full dwell is a bust. */
function checkBusts(world: World, config: SimConfig, st: CopsState): void {
  const radiusScale = world.params['cops.bustRadiusScale'] ?? 1;
  const dwellScale = world.params['cops.bustDwellScale'] ?? 1;
  const knockdownOnly = (world.params['cops.bustKnockdownOnly'] ?? 1) >= 0.5;
  noteCollars(world, config, st);
  for (const m of world.movers) {
    if (!isPlayer(config, m) || st.busted.includes(m.id)) continue;
    let by: Mover | undefined;
    const collar = st.collar[m.id] ?? -1;
    if (isDown(m) && (!knockdownOnly || collar >= 0)) {
      for (const id of st.cops) {
        if (knockdownOnly && id !== collar) continue;
        const cop = world.movers[id];
        const law = defOf(config, cop)?.law;
        if (!cop || !law || cop.mode !== 'Road' || st.phase[id] !== COP_CHASING) continue;
        if (distance(config, cop, m) <= law.bustRadiusM * radiusScale) {
          by = cop;
          break;
        }
      }
    }
    if (!by) {
      st.dwell[m.id] = 0;
      continue;
    }
    const dwell = (st.dwell[m.id] ?? 0) + world.timeScale;
    st.dwell[m.id] = dwell;
    const law = defOf(config, by)?.law;
    if (!law || dwell < law.bustDwellS * dwellScale * 60 - 1e-9) continue;
    st.busted.push(m.id);
    // The fine grows with the tier (cops-3). An event seam only: career-1 charges it.
    const tier = tierOf(config);
    const fineCash = Math.round(
      law.fineCash * (1 + (tier - 1) * Math.max(0, world.params['cops.fineTierScale'] ?? 0.5)),
    );
    emit(
      world,
      'bust',
      by.id,
      { fineCash, tier, fineBaseCash: law.fineCash, dwellTicks: dwell },
      { target: m.id },
    );
    endChase(world, st, by.id);
  }
}

/**
 * The hidden chaos meter (cops-3): this tick's hits and takedowns with a player in them fill it,
 * it drains with time, and a full meter summons the next cop still in the lot.
 */
function stepChaos(world: World, config: SimConfig, st: CopsState): void {
  const player = (id: EntityId | undefined) => {
    const m = world.movers[id ?? -1];
    return !!m && isPlayer(config, m);
  };
  const law = (id: EntityId | undefined) => defOf(config, world.movers[id ?? -1])?.faction === 'law';
  let add = 0;
  for (const e of world.events) {
    if (e.type === 'hit' && !law(e.actor) && (player(e.actor) || player(e.target))) {
      add += CHAOS_HIT + (law(e.target) ? CHAOS_HIT_COP : 0);
    } else if (e.type === 'takedown' && player(e.actor)) add += CHAOS_TAKEDOWN;
  }
  const decay = Math.max(0, world.params['cops.chaosDecayPerS'] ?? 0.1) * (world.timeScale / 60);
  st.chaos = Math.max(0, st.chaos - decay) + add;
  if (st.chaos < st.chaosAt) return;
  const next = st.cops.find((id) => st.phase[id] === COP_PARKED && st.spawns[id] !== 1);
  if (next === undefined) {
    st.chaos = st.chaosAt; // nobody left to summon: the meter stays full
    return;
  }
  st.chaos -= st.chaosAt;
  st.spawns[next] = 1;
  st.summonAt[next] = st.clock;
  st.cause[next] = 'chaos';
  const mix = config.event.cops;
  st.chaosAt = Math.max(1, (world.params['cops.chaosSummonAt'] ?? 10) * jitter(world, mix?.randomness ?? 0));
}

/** Whether a player rides the wrong way in a travel lane (his centre in a lane of the other way). */
function wrongWay(config: SimConfig, m: Mover): boolean {
  if (m.mode !== 'Road' || m.h > 0.5 || m.speed < HEAT.wrongWayMinMps) return false;
  for (const l of config.road.lanesAt(m.pos.edge, m.pos.s)) {
    if (l.kind !== 'drive' || Math.abs(m.pos.d - l.dCenterM) > l.widthM / 2) continue;
    if (l.direction !== m.pos.dir) return true;
  }
  return false;
}

/**
 * Playtest 2's heat meter, each tick: this tick's chaos raises each player's heat, calm cools it,
 * and a new tier sends its cops (or, cooled to nothing, the heat cops give up).
 */
function stepHeat(world: World, config: SimConfig, st: CopsState): void {
  const law = (id: EntityId | undefined) => defOf(config, world.movers[id ?? -1])?.faction === 'law';
  const dt = world.timeScale / 60;
  for (const e of world.events) {
    const actor = world.movers[e.actor];
    if (!actor || !isPlayer(config, actor)) continue;
    if (e.type === 'hit') addHeat(world, config, e.actor, HEAT.hit + (law(e.target) ? HEAT.hitCop : 0));
    else if (e.type === 'takedown')
      addHeat(world, config, e.actor, HEAT.takedown + (law(e.target) ? HEAT.takedownCop : 0));
    else if (e.type === 'wobble' && e.data['cause'] === 'setPiece')
      addHeat(world, config, e.actor, HEAT.smash);
  }
  for (const m of world.movers) {
    if (!isPlayer(config, m)) continue;
    const id = m.id;
    if (wrongWay(config, m)) addHeat(world, config, id, HEAT.wrongWayPerS * dt);
    let heat = st.heat[id] ?? 0;
    if (heat > 0 && st.clock - (st.heatAt[id] ?? 0) >= HEAT.calmS * 60) {
      const near = st.cops.some((c) => {
        const cop = world.movers[c];
        return st.heatCop[c] === 1 && st.target[c] === id && !!cop && distance(config, cop, m) <= HEAT.nearM;
      });
      const rate =
        Math.max(0, world.params['cops.heatDecayPerS'] ?? 2.5) *
        (near ? HEAT.nearScale : offRoad(config, m) ? HEAT.offRoadScale : 1);
      heat = Math.max(0, heat - rate * dt);
      st.heat[id] = heat;
    }
    const from = st.heatTier[id] ?? 0;
    let tier = from;
    while (tier < HEAT.tiers.length && heat >= (HEAT.tiers[tier] ?? Infinity)) tier++;
    while (tier > 0 && heat < (HEAT.tiers[tier - 1] ?? 0) - HEAT.hysteresis) tier--;
    const chased = st.cops.some((c) => st.heatCop[c] === 1 && st.target[c] === id);
    const lost = heat <= 0 && (chased || (st.heatSent[id] ?? 0) > 0);
    if (lost) {
      tier = 0;
      st.heatSent[id] = 0;
      st.heatLost[id] = 1;
      for (const c of st.cops) {
        if (st.heatCop[c] !== 1) continue;
        if (liftBlock(world, st, c)) continue;
        st.heatCop[c] = 0;
        endChase(world, st, c);
      }
    }
    if (tier !== from || lost) {
      st.heatTier[id] = tier;
      emit(world, 'heat', id, { tier, from, heat: heat / HEAT_MAX, lost });
    }
    // A new tier sends its cops, once until he loses them: one, then a pair, then the roadblock.
    const sent = st.heatSent[id] ?? 0;
    if (tier > sent) {
      for (let t = sent + 1; t <= tier; t++) {
        if (t >= 3) {
          sendRoadblock(world, config, st, m);
          continue;
        }
        const want = t === 1 ? 1 : 2;
        for (let k = 0; k < want; k++) sendHeatCop(world, config, st, m, k, t);
      }
      st.heatSent[id] = tier;
    }
  }
}

/** Whether a cop can be sent for the heat: waiting in the lot, or done with an earlier chase. */
function heatReserve(world: World, st: CopsState, id: EntityId): boolean {
  const cop = world.movers[id];
  // A cop whose pursuit budget is spent (run W-T) is never sent again.
  if (!cop || cop.mode !== 'Road' || st.heatCop[id] === 1 || st.broke[id] === 1) return false;
  if (st.phase[id] === COP_DONE) return true;
  return (
    st.phase[id] === COP_PARKED &&
    st.spawns[id] !== 1 &&
    st.sirenOn[id] !== 1 &&
    (st.patrolAt[id] ?? -1) < 0 &&
    (st.summonAt[id] ?? -1) < 0
  );
}

/**
 * Puts a heat cop on the road HEAT.behindM (and k x HEAT.pairGapM more) behind the player along
 * the route, in the route-forward lane at the player's speed, siren on, chasing him. None free, or
 * the player too near the start: nobody comes.
 */
function sendHeatCop(
  world: World,
  config: SimConfig,
  st: CopsState,
  player: Mover,
  k: number,
  tier: number,
): void {
  const id = st.cops.find((c) => heatReserve(world, st, c));
  const cop = id === undefined ? undefined : world.movers[id];
  if (id === undefined || !cop) return;
  const at = config.route.progressAt(player.pos.edge, player.pos.s) - HEAT.behindM - k * HEAT.pairGapM;
  const pos = at > 20 ? routePosAt(config, at) : null;
  if (!pos) return;
  const { drive: lane } = sideLanes(config, pos);
  cop.pos = { ...pos, d: lane ? lane.dCenterM : 0 };
  cop.speed = Math.min(player.speed, defOf(config, cop)?.bike.topSpeedMps ?? player.speed);
  cop.yaw = 0;
  cop.h = 0;
  st.phase[id] = COP_CHASING;
  st.spawns[id] = 1;
  st.sirenOn[id] = 1;
  st.heatCop[id] = 1;
  st.cause[id] = 'heat';
  st.patrolAt[id] = -1;
  st.patrolUntil[id] = 0;
  st.target[id] = player.id;
  st.closing[id] = 0;
  st.closingFor[id] = 0;
  emit(world, 'siren', id, { on: true, cause: 'heat', tier });
}

/**
 * Lifts a roadblock cop's block (he stands down: siren off, chase over, he pulls onto the shoulder).
 * False when he is not in a roadblock.
 */
function liftBlock(world: World, st: CopsState, id: EntityId): boolean {
  if ((st.blockAt[id] ?? -1) < 0) return false;
  st.blockAt[id] = -1;
  st.heatCop[id] = 0;
  st.target[id] = -1;
  if (st.phase[id] === COP_PARKED) {
    st.phase[id] = COP_DONE;
    emit(world, 'siren', id, { on: false });
  } else endChase(world, st, id);
  return true;
}

/**
 * Whether a cop can be moved to a roadblock: any heat reserve, or a patrol cop still waiting dark,
 * and either way out of the player's sight.
 */
function blockReserve(world: World, config: SimConfig, st: CopsState, id: EntityId, player: Mover): boolean {
  const cop = world.movers[id];
  if (!cop || cop.mode !== 'Road' || st.broke[id] === 1 || (st.blockAt[id] ?? -1) >= 0) return false;
  if (distance(config, cop, player) < HEAT.roadblockHideM) return false;
  // Run W-T: a cop chasing him from out of sight behind is radioed ahead (the file header).
  if (
    st.phase[id] === COP_CHASING &&
    st.target[id] === player.id &&
    gapAlongRoute(config, cop, player) >= HEAT.roadblockHideM
  )
    return true;
  if (st.heatCop[id] === 1) return false;
  if (heatReserve(world, st, id)) return true;
  return (
    st.phase[id] === COP_PARKED &&
    (st.patrolAt[id] ?? -1) >= 0 &&
    st.sirenOn[id] !== 1 &&
    (st.summonAt[id] ?? -1) < 0
  );
}

/** Tier 3: the roadblock up the road, from the cops out of the player's sight (none free: nothing). */
function sendRoadblock(world: World, config: SimConfig, st: CopsState, player: Mover): void {
  const where = roadblockSpots(config, config.route.progressAt(player.pos.edge, player.pos.s));
  if (!where) return;
  for (const spot of where.spots) {
    const id = st.cops.find((c) => blockReserve(world, config, st, c, player));
    const cop = id === undefined ? undefined : world.movers[id];
    if (id === undefined || !cop) return;
    cop.pos = spot;
    cop.speed = 0;
    cop.yaw = 0;
    cop.h = 0;
    st.phase[id] = COP_PARKED;
    st.spawns[id] = 1;
    st.sirenOn[id] = 1;
    st.heatCop[id] = 1;
    st.cause[id] = 'roadblock';
    st.patrolAt[id] = -1;
    st.patrolUntil[id] = 0;
    st.target[id] = player.id;
    st.closing[id] = 0;
    st.closingFor[id] = 0;
    st.blockAt[id] = where.at;
    st.blockUntil[id] = st.clock + HEAT.roadblockS * 60;
    emit(world, 'siren', id, { on: true, cause: 'roadblock', tier: 3 });
  }
}

/**
 * An armed cop's attack press for the next tick: within his weapon's reach of the rider he chases
 * (who is riding), idle, and not swung for cops.swingEveryS. Unarmed cops never press.
 */
function copSwing(world: World, config: SimConfig, st: CopsState, cop: Mover): boolean {
  const combat = combatState(world);
  const held = combat.held[cop.id];
  if (!held || st.phase[cop.id] !== COP_CHASING || combat.phase[cop.id] !== 'idle') return false;
  if (st.clock < (st.swingAt[cop.id] ?? 0)) return false;
  const target = world.movers[st.target[cop.id] ?? -1];
  const w = config.weapons.find((x) => x.contentId === held);
  if (!target || !w || target.mode !== 'Road') return false;
  const rel = relative(config.road, cop, target, w.reachSM + 2);
  if (!rel || Math.abs(rel.ds) > w.reachSM || Math.abs(rel.dd) > w.reachDM) return false;
  st.swingAt[cop.id] = st.clock + Math.max(0.5, world.params['cops.swingEveryS'] ?? 6) * 60;
  return true;
}

/**
 * The END OF JURISDICTION sign, each tick (before the heat meter): a player riding over it toward
 * the finish for the first time, with heat or a cop on him, has his heat set to nothing and every
 * cop on him who is not a heat cop pulls over (the heat meter then drops its own: "LOST 'EM").
 */
function stepJurisdiction(world: World, config: SimConfig, st: CopsState): void {
  if (st.lineAt < 0) return;
  for (const m of world.movers) {
    if (!isPlayer(config, m)) continue;
    const id = m.id;
    const now = config.route.progressAt(m.pos.edge, m.pos.s);
    const before = st.lastProgress[id] ?? now;
    st.lastProgress[id] = now;
    if (st.crossed[id] === 1 || !(before < st.lineAt && now >= st.lineAt) || now - before > 50) continue;
    st.crossed[id] = 1;
    const heat = st.heat[id] ?? 0;
    const on = st.cops.filter((c) => st.phase[c] === COP_CHASING && st.target[c] === id);
    if (heat <= 0 && on.length === 0) continue;
    let speaker: EntityId = id;
    let nearest = Infinity;
    for (const c of on) {
      const cop = world.movers[c];
      const dist = cop ? distance(config, cop, m) : Infinity;
      if (dist < nearest) {
        nearest = dist;
        speaker = c;
      }
      if (st.heatCop[c] !== 1) endChase(world, st, c);
    }
    st.heat[id] = 0;
    st.heatAt[id] = st.clock;
    emit(world, 'law', speaker, { kind: 'jurisdiction', heatBefore: heat / HEAT_MAX }, { target: id });
  }
}

/**
 * The habits, each tick after the phases (run W-T): chasing time for the relentless and the budget
 * cops (with the relentless levels, and a spent budget pulling him over), the citations cop's book,
 * and the bill at a player's finish.
 */
function stepHabits(world: World, config: SimConfig, st: CopsState): void {
  for (const id of st.cops) {
    const cop = world.movers[id];
    const h = habitOf(defOf(config, cop));
    if (!cop || !h || st.phase[id] !== COP_CHASING) continue;
    const target = world.movers[st.target[id] ?? -1];
    if (!target) continue;
    const chased = (st.chasedFor[id] ?? 0) + world.timeScale;
    st.chasedFor[id] = chased;
    if (h.kind === 'relentless') {
      const r = relentlessness(world, config, id);
      const level = r >= 1 ? 2 : r >= 0.5 ? 1 : 0;
      if (level > (st.level[id] ?? 0)) {
        st.level[id] = level;
        emit(world, 'law', id, { kind: 'relentless', level }, { target: target.id });
      }
    } else if (h.kind === 'budget') {
      const budgetS = hp(h, 'budgetS', HABIT.budget.budgetS);
      if (chased >= budgetS * 60 - 1e-9) {
        st.broke[id] = 1;
        emit(world, 'law', id, { kind: 'budgetOut', budgetS }, { target: target.id });
        if (!liftBlock(world, st, id)) endChase(world, st, id);
      }
    } else if (h.kind === 'citations' && target.mode === 'Road' && isPlayer(config, target)) {
      const rel = relative(config.road, cop, target, CITE_ACROSS_M + 10);
      const along = hp(h, 'alongsideM', HABIT.citations.alongsideM);
      if (!rel || Math.abs(rel.ds) > along || Math.abs(rel.dd) > CITE_ACROSS_M) continue;
      const every = Math.max(0.5, hp(h, 'everyS', HABIT.citations.everyS)) * 60;
      const ticks = (st.citeTicks[id] ?? 0) + world.timeScale;
      if (ticks < every - 1e-9) {
        st.citeTicks[id] = ticks;
        continue;
      }
      st.citeTicks[id] = ticks - every;
      const cashEach = Math.round(hp(h, 'cashEach', HABIT.citations.cashEach));
      const count = (st.cites[id] ?? 0) + 1;
      st.cites[id] = count;
      const totalCash = (st.owed[target.id] ?? 0) + cashEach;
      st.owed[target.id] = totalCash;
      st.owedCount[target.id] = (st.owedCount[target.id] ?? 0) + 1;
      emit(world, 'law', id, { kind: 'citation', count, cashEach, totalCash }, { target: target.id });
    }
  }
  // The bill: a player who finishes owing citations is billed once, by the cop who wrote the most.
  for (const m of world.movers) {
    if (!isPlayer(config, m) || (st.owedCount[m.id] ?? 0) === 0 || st.billed[m.id] === 1) continue;
    if (!hasFinished(config, m)) continue;
    st.billed[m.id] = 1;
    let by: EntityId = st.cops[0] ?? m.id;
    for (const c of st.cops) if ((st.cites[c] ?? 0) > (st.cites[by] ?? 0)) by = c;
    const data = { kind: 'bill', count: st.owedCount[m.id] ?? 0, totalCash: st.owed[m.id] ?? 0 };
    emit(world, 'law', by, data, { target: m.id });
  }
}

export function copsStep(world: World, config: SimConfig): void {
  const st = copsState(world);
  if (st.cops.length === 0) return;
  const { sirenTicks, pullOutTicks } = copTiming(world, config);
  const leadTicks = pullOutTicks - sirenTicks;
  if (chaosSummons(config)) stepChaos(world, config, st);
  stepJurisdiction(world, config, st);
  if (heatOn(config)) stepHeat(world, config, st);
  const maxActive = Math.max(1, Math.round(world.params['cops.maxActive'] ?? 2));
  // Chasing, or parked with the siren going: each holds one of the maxActive places.
  let active = st.cops.filter(
    (id) =>
      st.heatCop[id] !== 1 &&
      (st.phase[id] === COP_CHASING || (st.phase[id] === COP_PARKED && st.sirenOn[id] === 1)),
  ).length;
  for (const id of st.cops) {
    const cop = world.movers[id];
    const def = defOf(config, cop);
    if (!cop || !def) continue;
    const patrolling = (st.patrolAt[id] ?? -1) >= 0 && (st.summonAt[id] ?? -1) < 0;
    if (st.phase[id] === COP_PARKED && (st.blockAt[id] ?? -1) >= 0) {
      // The roadblock: he stands in the lane until his man is past him, then chases him; it
      // lifts when its time is up (he pulls onto the shoulder).
      const target = world.movers[st.target[id] ?? -1];
      if (st.clock >= (st.blockUntil[id] ?? 0) || !chaseable(config, st, target)) liftBlock(world, st, id);
      else if (gapAlongRoute(config, target, cop) <= 0) {
        st.phase[id] = COP_CHASING;
        st.blockAt[id] = -1;
      }
    } else if (st.phase[id] === COP_PARKED && st.spawns[id] === 1 && patrolling) {
      // Playtest 2's patrol: he lights up as a player comes near, and pulls out as he arrives.
      // He wakes PATROL.wakeM short, or earlier for a fast rider, so the siren still sounds the
      // full siren lead (and a second more) before he pulls out.
      const { gap, speed, id: who } = patrolGap(world, config, st, cop);
      const h = habitOf(def);
      const radar = h?.kind === 'radar' && (st.radarAt[id] ?? -1) >= 0 ? h : null;
      const wakeAt = radar ? hp(radar, 'rangeM', HABIT.radar.rangeM) : PATROL.wakeM;
      const wake = Math.max(wakeAt, PATROL.pullOutM + speed * (leadTicks / 60 + 1));
      // Run W-T: a radar trooper at his bridge reads each player once as he comes in range, and
      // wakes only for one over the limit; one under it rides by.
      let lightsUp = true;
      if (radar) {
        if (who >= 0 && gap >= 0 && gap <= wake && st.radarSeen[id] !== who) {
          const limitMps = hp(radar, 'limitMps', HABIT.radar.limitMps);
          const over = speed > limitMps;
          st.radarSeen[id] = who;
          st.radarOver[id] = over ? 1 : 0;
          emit(world, 'law', id, { kind: 'radar', mps: speed, limitMps, over }, { target: who });
          if (over) addHeat(world, config, who, HABIT.radar.heat);
        }
        lightsUp = st.radarOver[id] === 1;
      }
      if (lightsUp && st.sirenOn[id] !== 1 && gap <= wake && active < maxActive) {
        st.sirenOn[id] = 1;
        active++;
        emit(world, 'siren', id, { on: true, cause: 'patrol' });
      }
      // He pulls out as the player draws level (then he comes alongside), or when one has stopped
      // close by.
      if (st.sirenOn[id] === 1 && (gap <= 0 || (gap <= PATROL.pullOutM && speed < PATROL.stoppedMps))) {
        st.phase[id] = COP_CHASING;
        st.patrolUntil[id] = st.clock + PATROL.chaseS * 60;
      }
    } else if (st.phase[id] === COP_PARKED && st.spawns[id] === 1) {
      // A summoned cop goes from his summons; the others at the base time plus their wave gap.
      const summoned = st.summonAt[id] ?? -1;
      const out = summoned >= 0 ? summoned + leadTicks : pullOutTicks + (st.extraTicks[id] ?? 0);
      if (st.sirenOn[id] !== 1 && st.clock >= out - leadTicks) {
        if (active >= maxActive) {
          // No place free: he waits in the lot, and his timing slides with the clock (the lead holds).
          if (summoned >= 0) st.summonAt[id] = summoned + world.timeScale;
          else st.extraTicks[id] = (st.extraTicks[id] ?? 0) + world.timeScale;
        } else {
          st.sirenOn[id] = 1;
          active++;
          const cause = st.cause[id] ?? '';
          emit(world, 'siren', id, cause ? { on: true, cause } : { on: true });
        }
      }
      if (st.sirenOn[id] === 1 && st.clock >= out) st.phase[id] = COP_CHASING;
    }
    if (st.phase[id] === COP_CHASING) {
      const before = st.target[id];
      st.target[id] = pickTarget(world, config, st, cop);
      if (st.target[id] !== before) {
        st.closing[id] = 0; // a new target: hang back first
        st.closingFor[id] = 0;
      }
      if (st.target[id] === -1) endChase(world, st, id);
      // A patrol chase runs out (unless his man is down: then he stays for the bust).
      const until = st.patrolUntil[id] ?? 0;
      const target = world.movers[st.target[id] ?? -1];
      if (until > 0 && st.clock >= until && !(target && isDown(target))) endChase(world, st, id);
    }
  }
  stepHabits(world, config, st);
  checkBusts(world, config, st);
  // Commands for the next tick. A cop who is down (knocked off) is left to sim/tumble.
  for (const id of st.cops) {
    const cop = world.movers[id];
    const def = defOf(config, cop);
    if (!cop || !def || cop.mode !== 'Road') continue;
    // A parked patrol cop shoved into a lane (riders bump: playtest 1 item 6) rolls back onto the
    // shoulder, as one with nobody to chase does; a stopped rider in a lane jams the traffic.
    if (st.phase[id] === COP_PARKED && (st.patrolAt[id] ?? -1) >= 0 && !clearOfLanes(config, cop.pos))
      drive(world, config, st, cop, def);
    else if (st.phase[id] === COP_PARKED) world.inputs[id] = { steer: 0, throttle: 0, brake: 255, flags: 0 };
    else {
      drive(world, config, st, cop, def);
      const input = world.inputs[id];
      if (input && copSwing(world, config, st, cop)) input.flags |= InputFlag.attack;
    }
  }
  st.clock += world.timeScale;
}
