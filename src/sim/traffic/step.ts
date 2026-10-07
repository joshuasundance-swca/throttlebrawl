// Traffic: the system's step (sim/traffic), the code only a running race needs. It loads after the first
// screen, in the sim's step chunk (src/sim/late.ts; scripts/sim-chunk.mjs SIM_STEPS_TEST), and a race waits for
// it. ./index.ts keeps the system's state, its init, its tuning and what a snapshot reads (the menu's grid).
import { clamp, nextFloat, sin, TAU, cos } from '../../core';
import { sRateFactor } from '../../road';
import {
  supportsOn,
  supportKeyOf,
  supportMotion,
  holdsBike,
  overVehicleTop,
  leaveSupport,
} from '../riders/supports';
import { hoodLaunchContact, wheelieCrashReason } from '../riders/wheelie';
import { type SimTrafficTypeDef, type SimConfig, MOVING_DECKS_KEY, type SimMovingDecks } from '../types';
import { type World, type Mover, vehicleHeightM, emit, riderHitbox } from '../world';
import { closingOnAxis, trafficContactCrashes } from './contact-rule';
import {
  linkAt,
  lanesAt,
  laneCountOnMap,
  laneRunBoundary,
  fromCorridor,
  linkOf,
  riderOnCorridor,
} from './corridor';
import { roadsideClass } from '../roadside';
import { idmAccel } from './idm';
import {
  type KerbBody,
  threatens,
  holdsReturn,
  type DodgeSpots,
  takesVerge,
  vergeOffsetFor,
  KERB_YIELD,
  deepSpot,
  inboardSpot,
  bestSpot,
  softContact,
} from './kerb-yield';
import {
  isKerb,
  CATEGORY,
  hairpinMouth,
  HAIRPIN_WAIT_M,
  typeOf,
  TRAFFIC,
  nearestAnchor,
  laneClear,
  riderViews,
  riderClear,
  spawnCd,
  placeVehicle,
  anchorUs,
  targetCount,
  trySpawn,
  isParked,
  laneEndAhead,
  kerbAhead,
  parkedCd,
  trafficState,
  populate,
  type TrafficState,
  type RiderView,
} from './index';

/** Whether a road-vehicle type changes lanes: its own flag, else its category's default. */
function changesLanes(t: SimTrafficTypeDef): boolean {
  if (isKerb(t)) return false;
  return t.behaviour?.laneChanges ?? CATEGORY[t.category]?.laneChanges ?? false;
}

/**
 * The ground beside the road on the `out` side at u, in corridor terms (T4.1): where the drivable
 * road ends (`edgeCd`, the outermost lane's outer edge, shoulder included) and how wide the verge
 * band past it is (0 where the road's own edge is the edge).
 */
function kerbGround(
  config: SimConfig,
  st: TrafficState,
  u: number,
  out: number,
): { edgeCd: number; vergeW: number } {
  const c = st.corridor;
  const i = linkAt(c, u < 0 ? 0 : u > c.length ? c.length : u);
  const o = c.o[i] ?? 1;
  const off = c.off[i] ?? 0;
  const len = c.len[i] ?? 0;
  const s = clamp(o === 1 ? u - off : off + len - u, 0, len);
  const v = config.road.vergeAt(c.edges[i] ?? 0, s, out * o < 0 ? 'left' : 'right');
  return { edgeCd: v.dInner * o, vergeW: v.widthM };
}

/** Traffic edges aside for a drifting rider within this far of it along the road, m (`traffic.driftRoomM`). */
const DRIFT_ROOM_LOOK_M = 55;

/**
 * A rider slower than this does not hold a vehicle at its hairpin wait line, m/s: it is not coming
 * round the bend. Bridge City (polish H's punch item 5): a deputy waiting on the shoulder inside the
 * reach held two oncoming cars there for the rest of the race, and the riders who came up the road
 * stopped nose to nose with them. Car-following still stops a vehicle behind a rider standing in
 * its lane, and it rounds one who is down. [default]
 */
const HAIRPIN_COMING_MPS = 2;

/**
 * The distance ahead of vehicle k to the line where it waits for riders coming round a hairpin
 * (HAIRPIN_WAIT_M short of its mouth), or Infinity: none coming, or k already past its wait line.
 * A rider standing still is not coming (HAIRPIN_COMING_MPS), so nobody holds it there for good.
 */
function hairpinWait(
  world: World,
  config: SimConfig,
  st: TrafficState,
  riders: readonly RiderView[],
  k: number,
): number {
  const mouth = hairpinMouth(world, config, st, riders, st.u[k] ?? 0, st.dir[k] ?? 1, HAIRPIN_COMING_MPS);
  return mouth - HAIRPIN_WAIT_M > 0 ? mouth - HAIRPIN_WAIT_M : Infinity;
}

/**
 * Moves vehicle k far out of every anchor's window, entering the traffic road from the end
 * behind it, so a vehicle that drove off the end of the traffic road never waits there as a
 * wall. Returns false when the whole road is inside the windows (it then waits at the end).
 */
function park(
  world: World,
  config: SimConfig,
  st: TrafficState,
  anchors: readonly number[],
  k: number,
): boolean {
  const c = st.corridor;
  const dir = (st.dir[k] ?? 1) === 1 ? 1 : -1;
  const t = typeOf(config, st, k);
  const clear = TRAFFIC.windowM + TRAFFIC.despawnMarginM + TRAFFIC.slotStepM;
  let riders: RiderView[] | null = null;
  for (let i = 0; ; i++) {
    const along = TRAFFIC.endMarginM + i * TRAFFIC.slotStepM;
    if (along > c.hi - c.lo - TRAFFIC.endMarginM) return false;
    const u = dir === 1 ? c.lo + along : c.hi - along;
    if (nearestAnchor(anchors, u) <= clear) continue;
    if (lanesAt(config.road, c, u, dir).length === 0) continue;
    if (!laneClear(config, st, u, dir, 0, t, TRAFFIC.spawnGapM, k)) continue;
    riders ??= riderViews(world, config, st);
    const laneCd = lanesAt(config.road, c, u, dir)[0]?.cd ?? 0;
    if (!riderClear(riders, t, u, spawnCd(config, c, t, u, dir, laneCd))) continue;
    const retired = st.retired[k] ?? 0;
    placeVehicle(world, config, { type: st.type[k] ?? 0, u, dir, v0: st.v0[k] ?? t.cruiseMps }, k);
    st.retired[k] = retired;
    st.parks++;
    return true;
  }
}

/**
 * A vehicle that drove off the end of the traffic road: recycle it to a window while its
 * direction is not over its slider's target, else retire it; park whatever is not recycled.
 */
function leaveRoad(world: World, config: SimConfig, st: TrafficState, k: number): void {
  const anchors = anchorUs(world, config, st);
  const dir = (st.dir[k] ?? 1) === 1 ? 1 : -1;
  if (anchors.length > 0 && st.retired[k] === 0) {
    let active = 0;
    for (let j = 0; j < st.id.length; j++) if (st.dir[j] === dir && st.retired[j] === 0) active++;
    const target = targetCount(world, st, anchors, dir);
    if (active > target) st.retired[k] = 1;
    else if (trySpawn(world, config, st, anchors, dir, k)) return;
  }
  park(world, config, st, anchors, k);
}

/**
 * Slots of the vehicles others edge round rather than queue behind: the parked oddities and (W-P)
 * the kerb riders. The common case (none) costs one pass.
 */
function parkedSlots(config: SimConfig, st: TrafficState): number[] {
  const out: number[] = [];
  for (let k = 0; k < st.id.length; k++) {
    const t = config.trafficTypes[st.type[k] ?? -1];
    if (isParked(t) || isKerb(t)) out.push(k);
  }
  return out;
}

/**
 * The nearest parked oddity (or kerb rider) in lane `rank` that vehicle k is coming up on (from
 * TRAFFIC.swerveLookM behind it until k's tail is past its nose), or -1. A kerb rider counts only
 * for a vehicle that is not one itself, and only while k at `kCd` would not clear it side to side.
 */
function parkedAhead(
  config: SimConfig,
  st: TrafficState,
  k: number,
  rank: number,
  parked: readonly number[],
  kCd: number = st.cd[k] ?? 0,
): number {
  const dir = st.dir[k] ?? 1;
  const tk = typeOf(config, st, k);
  const lk = tk.lengthM;
  let best = -1;
  let bestAhead = Infinity;
  for (const j of parked) {
    if (j === k || st.dir[j] !== dir || st.rank[j] !== rank) continue;
    const tj = typeOf(config, st, j);
    if (isKerb(tj)) {
      if (isKerb(tk)) continue;
      if (Math.abs((st.cd[j] ?? 0) - kCd) >= (tk.widthM + tj.widthM) / 2 + TRAFFIC.swerveClearM) continue;
    }
    const ahead = dir * ((st.u[j] ?? 0) - (st.u[k] ?? 0));
    if (ahead > TRAFFIC.swerveLookM || ahead < -(lk + typeOf(config, st, j).lengthM) / 2 - 1) continue;
    if (ahead < bestAhead) {
      bestAhead = ahead;
      best = j;
    }
  }
  return best;
}

/**
 * Rare seeded lane changes, where the vehicle's direction has a second lane with room. A vehicle
 * coming up on a parked oddity in its lane changes out of it (no roll, any category) when the
 * next lane has room, and a random change never moves into a lane with one just ahead.
 */
function laneChanges(world: World, config: SimConfig, st: TrafficState, dt: number): void {
  const chance = TRAFFIC.laneChangePerS * dt;
  const parked = parkedSlots(config, st);
  for (let k = 0; k < st.id.length; k++) {
    st.laneCooldownS[k] = Math.max(0, (st.laneCooldownS[k] ?? 0) - dt);
    const t = typeOf(config, st, k);
    // A lane that ends ahead (W-R): merge inward, one lane at a time, as soon as the next lane has
    // room; no roll, no cooldown, any category. Until then it brakes for the lane's end (move()).
    if (!isParked(t) && !isKerb(t)) {
      const rank = st.rank[k] ?? 0;
      const u = st.u[k] ?? 0;
      const dir = st.dir[k] ?? 1;
      if (rank > 0 && laneEndAhead(st, u, dir, rank, TRAFFIC.mergeLookM) < Infinity) {
        if (laneClear(config, st, u, dir, rank - 1, t, TRAFFIC.mergeClearM, k)) {
          st.rank[k] = rank - 1;
          st.laneCooldownS[k] = TRAFFIC.laneChangeCooldownS;
        }
        continue;
      }
    }
    if (parked.length > 0 && !isParked(t) && !isKerb(t)) {
      const dir = st.dir[k] ?? 1;
      const lanes = lanesAt(config.road, st.corridor, st.u[k] ?? 0, dir);
      const rank = st.rank[k] ?? 0;
      const laneCd = lanes[Math.min(rank, lanes.length - 1)]?.cd ?? st.cd[k] ?? 0;
      if (lanes.length >= 2 && parkedAhead(config, st, k, rank, parked, laneCd) >= 0) {
        const to = rank + 1 < lanes.length ? rank + 1 : rank - 1;
        if (laneClear(config, st, st.u[k] ?? 0, dir, to, t, TRAFFIC.laneChangeClearM, k)) {
          st.rank[k] = to;
          st.laneCooldownS[k] = TRAFFIC.laneChangeCooldownS;
        }
        continue;
      }
    }
    if (!changesLanes(t) || (st.laneCooldownS[k] ?? 0) > 0) continue;
    const dir = st.dir[k] ?? 1;
    const lanes = lanesAt(config.road, st.corridor, st.u[k] ?? 0, dir);
    if (lanes.length < 2) continue;
    if (nextFloat(world.rng.traffic) >= chance) continue;
    const rank = st.rank[k] ?? 0;
    const to =
      rank === 0
        ? 1
        : rank === lanes.length - 1
          ? rank - 1
          : nextFloat(world.rng.traffic) < 0.5
            ? rank - 1
            : rank + 1;
    if (!laneClear(config, st, st.u[k] ?? 0, dir, to, t, TRAFFIC.laneChangeClearM, k)) continue;
    // Never into a lane that ends soon (W-R).
    if (laneEndAhead(st, st.u[k] ?? 0, dir, to, TRAFFIC.mergeLookM) < Infinity) continue;
    const toCd = lanes[to]?.cd ?? st.cd[k] ?? 0;
    if (parked.length > 0 && parkedAhead(config, st, k, to, parked, toCd) >= 0) continue;
    st.rank[k] = to;
    st.laneCooldownS[k] = TRAFFIC.laneChangeCooldownS;
  }
}

/**
 * Kerb riders yield (playtest 3, T4.1; docs/architecture.md, "Traffic"). Each tick, before
 * car-following, every kerb slot in ascending order is checked against every rider view in ascending
 * id order. While a rider threatens a kerb rider (./kerb-yield.ts `threatens`), and for
 * KERB_YIELD.holdS after the last one has passed, the kerb rider dodges to the best spot (`bestSpot`:
 * the verge for any kerb type with room for it (P4-3), the road's edge, or where it is) at KERB_YIELD.mps, slowed to
 * KERB_YIELD.speedScale of its cruise speed (move() reads `yieldUntilS`). Afterwards it returns to
 * its kerb line at KERB_YIELD.returnMps, waiting while a rider within KERB_YIELD.returnBehindM behind
 * it is still in its band. A toppled one (contacts()) counts its lying time down here. With
 * `traffic.kerbYield` absent or 0 nothing is checked and no state changes.
 */
function updateKerbYield(
  world: World,
  config: SimConfig,
  st: TrafficState,
  riders: readonly RiderView[],
  dt: number,
): void {
  const n = st.id.length;
  for (let k = 0; k < n; k++) {
    const left = st.toppleS[k] ?? 0;
    if (left > 0) st.toppleS[k] = left - dt > 1e-6 ? left - dt : 0;
  }
  const look = world.params['traffic.kerbYield'] ?? 0;
  const deepOn = (world.params['traffic.kerbDeep'] ?? 0) >= 0.5;
  if (look <= 0 || riders.length === 0) return;
  for (let k = 0; k < n; k++) {
    const t = typeOf(config, st, k);
    if (!isKerb(t) || roadsideClass(t) === 'solid' || (st.toppleS[k] ?? 0) > 0) continue;
    const dir = st.dir[k] ?? 1;
    const u = st.u[k] ?? 0;
    const halfW = t.widthM / 2;
    const kerb = kerbAhead(config, st, u, dir, halfW);
    if (!kerb) continue;
    const cd = st.cd[k] ?? 0;
    const body: KerbBody = {
      u,
      cd,
      homeCd: kerb.cd,
      dir,
      speed: world.movers[st.id[k] ?? -1]?.speed ?? 0,
      lengthM: t.lengthM,
      widthM: t.widthM,
    };
    const threats: number[] = [];
    let waiting = false;
    for (const r of riders) {
      if (threatens(body, r, TRAFFIC.riderLengthM, TRAFFIC.riderWidthM, look)) threats.push(r.cd);
      else if (holdsReturn(body, r, TRAFFIC.riderWidthM)) waiting = true;
    }
    if (threats.length > 0) {
      const out = kerb.cd < 0 ? -1 : 1;
      const ground = kerbGround(config, st, u, out);
      const spots: DodgeSpots = {
        verge: takesVerge(t, ground.vergeW) ? ground.edgeCd + out * vergeOffsetFor(t.widthM) : null,
        hug: ground.edgeCd - out * (halfW + KERB_YIELD.hugM),
        stay: cd,
        ...(deepOn && roadsideClass(t) === 'dodges'
          ? {
              deep: deepSpot(t, ground.edgeCd, ground.vergeW, out),
              inboard: inboardSpot(cd, threats, t.widthM, TRAFFIC.riderWidthM, out),
            }
          : {}),
      };
      st.yieldCd[k] = bestSpot(spots, threats, t.widthM, TRAFFIC.riderWidthM);
      st.yieldUntilS[k] = st.clockS + KERB_YIELD.holdS;
    } else if (waiting && (st.yieldUntilS[k] ?? 0) > 0 && st.clockS >= (st.yieldUntilS[k] ?? 0)) {
      st.yieldUntilS[k] = st.clockS + 2 * dt;
    }
  }
}

/** Car-following, then the no-overlap guarantee, then lane-keeping and the mover sync. */
function move(
  world: World,
  config: SimConfig,
  st: TrafficState,
  riders: readonly RiderView[],
  dt: number,
): void {
  const n = st.id.length;
  const c = st.corridor;
  const speeds = st.id.map((id) => world.movers[id]?.speed ?? 0);
  const parked = parkedSlots(config, st);
  updateKerbYield(world, config, st, riders, dt);
  const accel: number[] = [];
  const dodge: boolean[] = [];
  for (let k = 0; k < n; k++) {
    const t = typeOf(config, st, k);
    const dir = st.dir[k] ?? 1;
    const u = st.u[k] ?? 0;
    const cd = st.cd[k] ?? 0;
    let gap = Infinity;
    let vLead = 0;
    const consider = (g: number, v: number) => {
      if (g < gap && g < TRAFFIC.lookaheadM) {
        gap = g;
        vLead = v;
      }
    };
    for (let j = 0; j < n; j++) {
      if (j === k || st.dir[j] !== dir) continue;
      const tj = typeOf(config, st, j);
      // A parked oddity is in the way only while the boxes overlap side to side: edging round it
      // in the same lane (a one-lane road) clears it. So is a kerb rider (W-P), and for a kerb
      // rider so is everyone else: it filters past a queue at the kerb.
      const sideways = Math.abs((st.cd[j] ?? 0) - cd) < (t.widthM + tj.widthM) / 2;
      const loose = isParked(tj) || isKerb(tj) || isKerb(t);
      const sameLane = loose ? sideways : st.rank[j] === st.rank[k] || sideways;
      const ahead = dir * ((st.u[j] ?? 0) - u);
      if (!sameLane || ahead <= 0) continue;
      consider(ahead - (t.lengthM + tj.lengthM) / 2, speeds[j] ?? 0);
    }
    for (const r of riders) {
      if (Math.abs(r.cd - cd) >= (t.widthM + TRAFFIC.riderWidthM) / 2 + 0.3) continue;
      const ahead = dir * (r.u - u);
      if (ahead <= 0) continue;
      const along = r.touchable ? (r.dir === dir ? r.speed : -r.speed) : 0;
      if (along < -1) continue; // riding head-on at it: the car does not dodge, the rider must.
      consider(ahead - (t.lengthM + TRAFFIC.riderLengthM) / 2, Math.max(0, along));
    }
    // The end of its lane (W-R), until it has merged out of it: a stopped obstacle. A merge takes a
    // moment to slide across, so until the car is in its new lane the end of the one it is leaving
    // (one further out) counts too.
    if (!isParked(t) && !isKerb(t)) {
      const rank = st.rank[k] ?? 0;
      let end = laneEndAhead(st, u, dir, rank, TRAFFIC.lookaheadM);
      if (laneCountOnMap(st.laneMap, u, dir) > rank + 1) {
        const own = lanesAt(config.road, c, u, dir)[rank];
        if (own && Math.abs(cd - own.cd) > TRAFFIC.mergeDoneM) {
          end = Math.min(end, laneEndAhead(st, u, dir, rank + 1, TRAFFIC.lookaheadM));
        }
      }
      if (end < Infinity) consider(end - t.lengthM / 2, 0);
    }
    // Hairpin yield (playtest 4): riders coming round a tight bend toward it hold it short of the
    // bend, a stopped obstacle at its wait line.
    if (!isParked(t)) {
      const wait = hairpinWait(world, config, st, riders, k);
      if (wait < Infinity) consider(wait - t.lengthM / 2, 0);
    }
    // A dodging kerb rider (T4.1) slows down while it does.
    const dodging = isKerb(t) && st.clockS < (st.yieldUntilS[k] ?? 0);
    dodge.push(dodging);
    accel.push(idmAccel(speeds[k] ?? 0, (st.v0[k] ?? 0) * (dodging ? KERB_YIELD.speedScale : 1), gap, vLead));
  }
  const nextV: number[] = [];
  for (let k = 0; k < n; k++) {
    // A toppled kerb rider (T4.1) lies still.
    let v = (st.toppleS[k] ?? 0) > 0 ? 0 : Math.max(0, (speeds[k] ?? 0) + (accel[k] ?? 0) * dt);
    if (dodge[k]) {
      // Slowing for the rider takes KERB_YIELD.brakeMps2, not IDM's ever softer approach to a lower
      // cruise speed: about 0.4 s from a bicycle's cruise to 0.6 of it.
      const slow = (st.v0[k] ?? 0) * KERB_YIELD.speedScale;
      v = Math.min(v, Math.max(slow, (speeds[k] ?? 0) - KERB_YIELD.brakeMps2 * dt));
    }
    nextV.push(v);
    st.u[k] = (st.u[k] ?? 0) + (st.dir[k] ?? 1) * v * dt;
  }
  // No two vehicles ever overlap in a lane: walk each lane front to back. Kerb riders (W-P) form a
  // file of their own at the kerb, beside their lane's cars (car-following keeps those apart).
  const lane = st.id.map((_id, k) => (st.rank[k] ?? 0) + (isKerb(typeOf(config, st, k)) ? 0.5 : 0));
  const order = st.id.map((_id, k) => k);
  order.sort(
    (a, b) =>
      (st.dir[a] ?? 0) - (st.dir[b] ?? 0) ||
      (lane[a] ?? 0) - (lane[b] ?? 0) ||
      (st.dir[a] ?? 1) * ((st.u[b] ?? 0) - (st.u[a] ?? 0)) ||
      a - b,
  );
  for (let i = 1; i < order.length; i++) {
    const f = order[i - 1] ?? 0;
    const b = order[i] ?? 0;
    if (st.dir[f] !== st.dir[b] || lane[f] !== lane[b]) continue;
    const tf = typeOf(config, st, f);
    const tb = typeOf(config, st, b);
    if (isParked(tf) || isParked(tb)) {
      // Side by side with a parked oddity is passing it, not overlapping; and nothing shoves one.
      if (Math.abs((st.cd[f] ?? 0) - (st.cd[b] ?? 0)) >= (tf.widthM + tb.widthM) / 2) continue;
      if (isParked(tb)) continue;
    }
    const dir = st.dir[b] ?? 1;
    const room = (tf.lengthM + tb.lengthM) / 2 + 0.3;
    if (dir * ((st.u[f] ?? 0) - (st.u[b] ?? 0)) < room) {
      st.u[b] = (st.u[f] ?? 0) - dir * room;
      nextV[b] = Math.min(nextV[b] ?? 0, nextV[f] ?? 0);
    }
  }
  for (let k = 0; k < n; k++) {
    const dir = st.dir[k] ?? 1;
    let u = st.u[k] ?? 0;
    if (u < c.lo || u > c.hi) {
      u = clamp(u, c.lo, c.hi);
      nextV[k] = 0;
    }
    const tk = typeOf(config, st, k);
    // A road vehicle never rides a stretch with no lane its way (playtest 3, T10.6: an oncoming car
    // that could not stop for the end of its lane rolled into Lombard Street's one-way block and sat
    // there head-on with the cars coming down, for good). It is held at the lane's end, stopped.
    if (!isKerb(tk) && !isParked(tk)) {
      const edge = laneRunBoundary(st.laneMap, u, dir);
      if (edge !== null) {
        u = edge;
        nextV[k] = 0;
      }
    }
    st.u[k] = u;
    const lanes = lanesAt(config.road, c, u, dir);
    const kerb = isKerb(tk) ? kerbAhead(config, st, u, dir, tk.widthM / 2) : null;
    // A kerb rider keeps the outermost lane's rank as lanes come and go along the road.
    if (kerb) st.rank[k] = kerb.rank;
    // Past where its lane ended (W-R: a merge it could not make): it is in the lane that goes on.
    else if (lanes.length > 0 && (st.rank[k] ?? 0) > lanes.length - 1) st.rank[k] = lanes.length - 1;
    const ownLane = lanes[Math.min(st.rank[k] ?? 0, lanes.length - 1)];
    const laneCd = ownLane?.cd ?? st.cd[k] ?? 0;
    let target = kerb ? kerb.cd : laneCd;
    let rate = TRAFFIC.laneChangeMps;
    const weaveM = tk.behaviour?.weaveM ?? 0;
    if (weaveM > 0 && !isParked(tk)) {
      // The weave (W-P): a seeded sine on the world clock, kept inside the kerb span or the lane.
      const swing = weaveM * sin((st.weavePhase[k] ?? 0) + (st.clockS * TAU) / TRAFFIC.weavePeriodS);
      const half = Math.max(0, (ownLane?.width ?? tk.widthM) / 2 - tk.widthM / 2);
      target = kerb
        ? clamp(target + swing, kerb.lo, kerb.hi)
        : clamp(target + swing, laneCd - half, laneCd + half);
    }
    // A kerb rider that is toppled lies where it is; one that is dodging (T4.1) goes to its spot,
    // and afterwards back to its line, slowly.
    let returning = false;
    if (kerb) {
      const until = st.yieldUntilS[k] ?? 0;
      if ((st.toppleS[k] ?? 0) > 0) {
        target = st.cd[k] ?? target;
      } else if (until > 0) {
        if (st.clockS < until) {
          target = st.yieldCd[k] ?? target;
          rate = KERB_YIELD.mps;
        } else {
          returning = true;
          rate = KERB_YIELD.returnMps;
        }
      }
    }
    if (parked.length > 0) {
      if (isParked(tk)) {
        target = parkedCd(laneCd);
      } else {
        // Edge inward round a parked oddity (one lane this way) or a kerb rider (W-P, any lane
        // count: a lane change may be blocked), then back once past it.
        const j = parkedAhead(config, st, k, st.rank[k] ?? 0, parked, target);
        const tj = config.trafficTypes[st.type[j] ?? -1];
        if (j >= 0 && tj && (lanes.length < 2 || isKerb(tj) || isKerb(tk))) {
          const out = laneCd < 0 ? -1 : 1;
          target = (st.cd[j] ?? 0) - out * ((tj.widthM + tk.widthM) / 2 + TRAFFIC.swerveClearM);
          rate = TRAFFIC.swerveMps;
        }
      }
    }
    // A rider stopped at the outer side of the lane (a cop waiting on the shoulder by a speed trap,
    // a rider pulled over): edge inward round them instead of queuing behind them for good (W-P:
    // a camper van waited 40 s behind a speed-trap cop and walled the road). A rider stopped in the
    // middle of the lane (a crash) still stops the traffic behind it (M1 traffic-1).
    if (!isParked(tk)) {
      const r = sideRiderAhead(st, k, riders, tk, target, laneCd, ownLane?.width ?? 2 * TRAFFIC.riderWidthM);
      if (r) {
        const out = laneCd < 0 ? -1 : 1;
        const round = r.cd - out * ((tk.widthM + TRAFFIC.riderWidthM) / 2 + TRAFFIC.swerveClearM);
        target = out > 0 ? Math.min(target, round) : Math.max(target, round);
        rate = TRAFFIC.swerveMps;
      }
      // A rider down in its path (W-Q): round them on the inside, when the oncoming side is clear.
      const down = downRiderAhead(st, k, riders, tk, target);
      if (down && oncomingClear(st, k, down)) {
        const out = laneCd < 0 ? -1 : 1;
        const round = down.cd - out * ((tk.widthM + TRAFFIC.riderWidthM) / 2 + TRAFFIC.swerveClearM);
        target = out > 0 ? Math.min(target, round) : Math.max(target, round);
        rate = TRAFFIC.swerveMps;
      }
    }
    // A drifting rider swings wide: a vehicle near one edges toward its kerb, inside its road.
    const roomM = world.params['traffic.driftRoomM'] ?? 0;
    if (
      roomM > 0 &&
      !isParked(tk) &&
      !kerb &&
      riders.some((r) => r.drifting && Math.abs(r.u - u) < DRIFT_ROOM_LOOK_M)
    ) {
      const out = laneCd < 0 ? -1 : 1;
      const limit = Math.abs(kerbGround(config, st, u, out).edgeCd) - tk.widthM / 2 - 0.1;
      const want = Math.min(Math.abs(laneCd) + roomM, limit);
      if (want > Math.abs(target)) target = out * want;
      rate = TRAFFIC.swerveMps;
    }
    const cd = st.cd[k] ?? 0;
    const step = rate * dt;
    const nextCd = cd + clamp(target - cd, -step, step);
    st.cd[k] = nextCd;
    st.cdMps[k] = dt > 0 ? (nextCd - cd) / dt : 0;
    // Back on its line: the dodge is over.
    if (returning && Math.abs(nextCd - target) <= 0.05) st.yieldUntilS[k] = 0;
    const mover = world.movers[st.id[k] ?? -1];
    if (!mover) continue;
    const v = nextV[k] ?? 0;
    mover.speed = v;
    mover.mode = 'Road';
    mover.h = 0;
    mover.yaw = dt > 0 ? clamp((((nextCd - cd) / dt) * dir) / Math.max(v, 3), -0.3, 0.3) : 0;
    fromCorridor(c, u, nextCd, dir, mover.pos);
  }
}

/**
 * The nearest rider stopped (under TRAFFIC.sideRiderMps) that vehicle k is coming up on (from
 * TRAFFIC.swerveLookM behind it until k's tail is past it), mostly outside k's lane on the outer
 * side, that k would still touch at `kCd`; null when there is none.
 */
function sideRiderAhead(
  st: TrafficState,
  k: number,
  riders: readonly RiderView[],
  tk: SimTrafficTypeDef,
  kCd: number,
  laneCd: number,
  laneWidth: number,
): RiderView | null {
  const dir = st.dir[k] ?? 1;
  const u = st.u[k] ?? 0;
  const out = laneCd < 0 ? -1 : 1;
  let best: RiderView | null = null;
  let bestAhead = Infinity;
  for (const r of riders) {
    if (r.speed >= TRAFFIC.sideRiderMps) continue;
    // From swerveLookM behind it until k's tail is past it.
    const ahead = dir * (r.u - u);
    if (ahead > TRAFFIC.swerveLookM || ahead < -(tk.lengthM + TRAFFIC.riderLengthM) / 2 - 1) continue;
    // Mostly outside the lane: its middle past the lane's edge less half a rider.
    if (out * (r.cd - laneCd) <= laneWidth / 2 - TRAFFIC.riderWidthM / 2) continue;
    if (Math.abs(r.cd - kCd) >= (tk.widthM + TRAFFIC.riderWidthM) / 2 + TRAFFIC.swerveClearM) continue;
    if (ahead < bestAhead) {
      bestAhead = ahead;
      best = r;
    }
  }
  return best;
}

/**
 * The nearest rider down (tumbling or on foot, under TRAFFIC.sideRiderMps) that vehicle k is coming
 * up on (from TRAFFIC.swerveLookM behind it until k's tail is past it) and would touch at `kCd`;
 * null when there is none (W-Q).
 */
function downRiderAhead(
  st: TrafficState,
  k: number,
  riders: readonly RiderView[],
  tk: SimTrafficTypeDef,
  kCd: number,
): RiderView | null {
  const dir = st.dir[k] ?? 1;
  const u = st.u[k] ?? 0;
  let best: RiderView | null = null;
  let bestAhead = Infinity;
  for (const r of riders) {
    if (!r.down || r.speed >= TRAFFIC.sideRiderMps) continue;
    const ahead = dir * (r.u - u);
    if (ahead > TRAFFIC.swerveLookM || ahead < -(tk.lengthM + TRAFFIC.riderLengthM) / 2 - 1) continue;
    if (Math.abs(r.cd - kCd) >= (tk.widthM + TRAFFIC.riderWidthM) / 2 + TRAFFIC.swerveClearM) continue;
    if (ahead < bestAhead) {
      bestAhead = ahead;
      best = r;
    }
  }
  return best;
}

/**
 * Whether no oncoming vehicle is between vehicle k and TRAFFIC.swerveOncomingClearM past the downed
 * rider, so k may round them over the centre line (W-Q).
 */
function oncomingClear(st: TrafficState, k: number, r: RiderView): boolean {
  const dir = st.dir[k] ?? 1;
  const u = st.u[k] ?? 0;
  for (let j = 0; j < st.id.length; j++) {
    if (j === k || st.dir[j] === dir || (st.retired[j] ?? 0) !== 0) continue;
    const at = dir * ((st.u[j] ?? 0) - u);
    if (at > -5 && at < dir * (r.u - u) + TRAFFIC.swerveOncomingClearM) return false;
  }
  return true;
}

/**
 * Lane splitting (W-R; interview, 2026-10-02: "lane splitting"): the slot of a vehicle other than k
 * on the rider's other side from k, within nearMissM of it box to box and alongside it (its box
 * within TRAFFIC.splitAlongM of the rider's along the road), either way it is heading; else -1.
 */
function splitPartner(config: SimConfig, st: TrafficState, r: RiderView, k: number): number {
  const T = TRAFFIC;
  const side = (st.cd[k] ?? 0) - r.cd > 0 ? 1 : -1;
  for (let j = 0; j < st.id.length; j++) {
    if (j === k) continue;
    const dcd = (st.cd[j] ?? 0) - r.cd;
    if (dcd * side >= 0) continue;
    const tj = typeOf(config, st, j);
    const gap = (dcd < 0 ? -dcd : dcd) - (tj.widthM + r.widthM) / 2;
    if (gap <= 0 || gap > T.nearMissM) continue;
    const du = (st.u[j] ?? 0) - r.u;
    if ((du < 0 ? -du : du) > (tj.lengthM + r.lengthM) / 2 + T.splitAlongM) continue;
    return j;
  }
  return -1;
}

/** Writes a rider's corridor position back to its road position, inside the drivable width. */
function putRider(world: World, config: SimConfig, st: TrafficState, r: RiderView): boolean {
  const m = world.movers[r.id];
  if (!m) return false;
  if (r.over) return putRiderOver(config, st, m, r);
  const i = linkOf(st.corridor, m.pos.edge);
  const edge = config.road.edges[m.pos.edge];
  const o = st.corridor.o[i] ?? 1;
  let lo = (edge?.dMin ?? -5) + 0.5;
  let hi = (edge?.dMax ?? 5) - 0.5;
  if (o === -1) [lo, hi] = [-hi, -lo];
  const cd = clamp(r.cd, lo, hi);
  const pinned = cd !== r.cd;
  fromCorridor(st.corridor, r.u, cd, r.dir, m.pos);
  r.cd = cd;
  return !pinned;
}

/**
 * putRider for a rider on another road over a corridor road (RiderView.over): the move from where
 * it is to its view's corridor position, as a world offset, made on its own road (s along, d
 * across), its d kept inside that road's drivable width. Then its view is read again.
 */
function putRiderOver(config: SimConfig, st: TrafficState, m: Mover, r: RiderView): boolean {
  const road = config.road;
  const pos = m.pos;
  const to = { edge: 0, s: 0, d: 0, dir: 1 as 1 | -1 };
  fromCorridor(st.corridor, r.u, r.cd, r.dir, to);
  const a = road.toWorld(pos.edge, pos.s, pos.d, 0);
  const b = road.toWorld(to.edge, to.s, to.d, 0);
  const f = road.frameAt(pos.edge, pos.s);
  const ox = b.x - a.x;
  const oz = b.z - a.z;
  const edge = road.edges[pos.edge];
  const d = pos.d - ox * f.tz + oz * f.tx;
  const lo = (edge?.dMin ?? -5) + 0.5;
  const hi = (edge?.dMax ?? 5) - 0.5;
  pos.s += (ox * f.tx + oz * f.tz) * sRateFactor(f.kappa, pos.d);
  pos.d = clamp(d, lo, hi);
  const p = riderOnCorridor(road, st.corridor, pos, TRAFFIC.maxContactH);
  if (p) {
    r.u = p.u;
    r.cd = p.cd;
  }
  return pos.d === d;
}

/**
 * A light kerb rider a rider has clipped topples (T4.1): it lies still for KERB_YIELD.toppleS, moved
 * outward by the overlap `overD` plus KERB_YIELD.topplePushM, kept inside the verge (or the road's
 * edge where there is no verge). Contacts skip it while it lies there.
 */
function toppleKerbRider(world: World, config: SimConfig, st: TrafficState, k: number, overD: number): void {
  const t = typeOf(config, st, k);
  const cd = st.cd[k] ?? 0;
  const out = cd < 0 ? -1 : 1;
  const ground = kerbGround(config, st, st.u[k] ?? 0, out);
  const reach = ground.edgeCd + out * ground.vergeW - out * (t.widthM / 2 + KERB_YIELD.toppleInsetM);
  const target = cd + out * (overD + KERB_YIELD.topplePushM);
  // Never pulled inward by the clamp: a kerb rider already past the verge's edge stays put.
  const next = out > 0 ? Math.max(cd, Math.min(target, reach)) : Math.min(cd, Math.max(target, reach));
  st.cd[k] = next;
  st.toppleS[k] = KERB_YIELD.toppleS;
  // Once it rides on, it goes back to its kerb line at the return pace.
  st.yieldUntilS[k] = st.clockS + 1e-6;
  const mover = world.movers[st.id[k] ?? -1];
  if (!mover) return;
  mover.speed = 0;
  fromCorridor(st.corridor, st.u[k] ?? 0, next, st.dir[k] ?? 1, mover.pos);
}

/** A crash's `wheelieReason` (sim/riders/wheelie.ts `wheelieCrashReason`), or nothing when it has none. */
function wheelieReasonData(reason: string | undefined): { wheelieReason?: string } {
  return reason === undefined ? {} : { wheelieReason: reason };
}

/**
 * Where the vehicle is from the rider as its drawn body sees it (playtest 4, the maintainer,
 * 2026-10-05: "you need to give trucks a wider berth"): the vehicle is a rigid box, along its own
 * heading (the road's tangent at its middle, turned by its yaw), as the render draws it, and the
 * rider's middle is measured in that box's frame, in metres. Corridor coordinates bend with the road
 * and stretch with the offset across it, so on a bend a 16 m log truck's corridor box reached up to
 * half a metre past the truck drawn there: riders crashed into air beside and behind it. Returned in
 * corridor signs (+du: the vehicle is further along u; +dcd: further across), null when either mover
 * is missing. Plain + - * / and the core trig: the sim's determinism rules.
 */
function rigidOffset(
  config: SimConfig,
  v: Mover | undefined,
  rider: Mover,
  dirC: number,
): { du: number; dcd: number } | null {
  if (!v) return null;
  const road = config.road;
  const f = road.frameAt(v.pos.edge, v.pos.s);
  const tx = f.tx * v.pos.dir;
  const tz = f.tz * v.pos.dir;
  const c = cos(v.yaw);
  const sn = sin(v.yaw);
  // Its heading (as tumble/contacts.ts builds a vehicle's box), turned to point along +u.
  const ux = (c * tx - sn * tz) * dirC;
  const uz = (c * tz + sn * tx) * dirC;
  const a = road.toWorld(v.pos.edge, v.pos.s, v.pos.d, 0);
  const b = road.toWorld(rider.pos.edge, rider.pos.s, rider.pos.d, 0);
  const ox = a.x - b.x;
  const oz = a.z - b.z;
  // +cd is +u turned a quarter to its right: (x, z) to (-z, x), as +d is to the tangent.
  return { du: ox * ux + oz * uz, dcd: -ox * uz + oz * ux };
}

/**
 * Wobbles, crashes and near misses between riders and vehicles (M1 traffic-1, reshaped by
 * playtest 1, 2026-09-30: "hitting cars feels bouncy", and playtest 4, 2026-10-05: "low speeds
 * should wobble not crash, accounting for biker speed and traffic speed"). A first contact is
 * classed by how the boxes met, and decided by ONE rule (./contact-rule.ts): its closing speed along
 * the contact's normal, from both bodies' velocities, against `traffic.solidHitMps`:
 * - **end-on** (they were not side by side last tick, so the rider met the car's front or tail, or
 *   it met the rider's), overlapping sideways by at least `grazeM` (`hit` `frontal` or `rear`): the
 *   closing speed along the road. A crash is a solid hit: the rider goes down (the tumble hand-off)
 *   and the collision is inelastic, the rider left at the car's speed along the road (0 for a
 *   head-on), just touching it, never thrown back;
 * - a **side brush** or a **graze** (end-on but barely overlapping): the closing speed across the
 *   road. A crash scrubs the speed.
 * Below the line it is a wobble with the speed scrub, pushed just clear of the car, whatever the
 * vehicle (a truck too) and however shaky the rider already is.
 * A close, fast pass with no contact fires `nearMiss`. A ghost (startTrafficGhost: back on the bike
 * moments ago) touches nothing.
 * Playtest 3: a vehicle with its ramp down (a live moving deck, SimMovingDeck) is the riders' to
 * meet, by the deck rules, so traffic skips it; and a first contact a wheelie turns into a hood
 * launch (sim/riders/wheelie.ts) is neither a crash nor a wobble, and a crash a wheelie did not turn
 * into a launch says why in one word (`data.wheelieReason`, P4-2). With `traffic.kerbSoft`, a first
 * contact with a light kerb rider (T4.1) is always a wobble with `data.kerb`, and at
 * KERB_YIELD.toppleMinMps closing or more the cyclist topples (toppleKerbRider) and is skipped
 * until it has lain still for KERB_YIELD.toppleS.
 * Heights (the hitbox audit, 2026-10-06; docs/content-packs.md, "Heights and hitboxes"): the boxes
 * meet only where the rider is below the vehicle's height (vehicleHeightM), on the road or in the
 * air, and the rider's box is its own (riderHitbox). In the air, by the same one rule:
 * - **onto the roof** (it was above the top last tick, and is in less deep from above than from any
 *   side; `hit` `top`): the closing speed is how fast it was falling. A crash starts the tumble on
 *   the roof; a wobble rides the roof (held at its top, never sunk into the car) until it drops off
 *   past an end or a side;
 * - **into a side or an end** below the top: classed and pushed out as on the road.
 * Both carry `data.air`. A light kerb rider has no roof: coming down on one is its soft contact
 * (`hit` `top`, `kerb`), never a crash and never ridden on (the live check of #619).
 * A rider a wheelie's hood or trunk launch threw off a car flies clear of
 * that car (the launch starts 1 m up, under its roof) until it is back on the road or clear of it.
 * The near miss stays a riding rider's (`touchable`).
 */
function contacts(world: World, config: SimConfig, st: TrafficState, riders: RiderView[], dt: number): void {
  const T = TRAFFIC;
  const closingMin = world.params['traffic.nearMissClosingMps'] ?? T.nearMissClosingMps;
  const decks = (world.systems[MOVING_DECKS_KEY] as SimMovingDecks | undefined)?.live ?? [];
  const kerbSoft = (world.params['traffic.kerbSoft'] ?? 0) > 0;
  const supports = supportsOn(world);
  for (const r of riders) {
    st.unstableS[r.id] = Math.max(0, (st.unstableS[r.id] ?? 0) - dt);
    st.lastRel[r.id] ??= st.id.map(() => 0);
    const rel = st.lastRel[r.id] ?? [];
    const m = world.movers[r.id];
    if (!m) continue;
    if (!r.airborne) st.launchedOff[r.id] = -1;
    // Its height above the road a tick ago, from its vertical speed (a roof is met from above).
    const hBefore = r.h - riderVyMps(world, r.id) * dt;
    // Supports (sim/riders/supports.ts): a rider standing on a vehicle's roof is the riders' to move on
    // it, as a moving deck's rider is, and traffic skips that vehicle; the rider's own motion is over
    // its support, so through the world it is that plus the support's velocity.
    const own = supportKeyOf(world, r.id);
    const ownVid = own.startsWith('v:') ? Number(own.slice(2)) : -1;
    const mo = supportMotion(world, r.id);
    const carried = mo ? { along: mo.va, across: mo.vc } : null;
    // The rider's velocity in corridor terms: along the road from its speed and heading; across it
    // from its heading plus a kick's or a hit's shove still sliding it sideways (the corridor runs
    // with the rider's road when r.dir equals its pos.dir, against it otherwise).
    const riderU =
      mo && carried ? r.dir * (mo.vr * cos(m.yaw) + carried.along) : r.dir * m.speed * cos(m.yaw);
    const riderCross =
      mo && carried
        ? r.dir * (mo.vr * sin(m.yaw) + carried.across) + r.dir * m.pos.dir * shoveDMps(world, r.id)
        : r.dir * m.speed * sin(m.yaw) + r.dir * m.pos.dir * shoveDMps(world, r.id);
    for (let k = 0; k < st.id.length; k++) {
      const vid = st.id[k] ?? -1;
      const t = typeOf(config, st, k);
      let du = (st.u[k] ?? 0) - r.u;
      let dcd = (st.cd[k] ?? 0) - r.cd;
      if (
        Math.abs(du) < (t.lengthM + r.lengthM) / 2 + T.rigidNearM &&
        Math.abs(dcd) < (t.widthM + r.widthM) / 2 + T.rigidNearM
      ) {
        const rigid = rigidOffset(config, world.movers[vid], m, st.dir[k] ?? 1);
        if (rigid) {
          du = rigid.du;
          dcd = rigid.dcd;
        }
      }
      const overU = (t.lengthM + r.lengthM) / 2 - Math.abs(du);
      const overD = (t.widthM + r.widthM) / 2 - Math.abs(dcd);
      const ahead = r.dir * du;
      const prev = rel[k] ?? 0;
      rel[k] = ahead === 0 ? -1e-9 : ahead;
      if ((!r.touchable && !r.airborne) || isDeckVehicle(decks, vid) || vid === ownVid) continue;
      // A ghost, back on the bike moments ago (playtest 4), passes straight through: no contact, no
      // push, and no near miss either (nothing was risked).
      if (r.ghost) continue;
      // A toppled kerb rider (T4.1) lies on the ground: riders pass it by, and it can't be hit again.
      if ((st.toppleS[k] ?? 0) > 0) continue;
      const apart = overU < -1 || overD < -0.5;
      if (st.contactWith[r.id] === vid && apart) st.contactWith[r.id] = -1;
      // Thrown off this car by a wheelie: clear of it until back on the road or apart from it.
      if (st.launchedOff[r.id] === vid) {
        if (!apart) continue;
        st.launchedOff[r.id] = -1;
      }
      const top = vehicleHeightM(t);
      if (overU > 0 && overD > 0 && r.h < top) {
        const vDir = st.dir[k] ?? 1;
        const vSpeed = world.movers[vid]?.speed ?? 0;
        // The vehicle's velocity along the rider's direction, and how fast they came together.
        const vAlong = vDir === r.dir ? vSpeed : -vSpeed;
        let solid = false;
        let soft = false;
        // Met at a top's edge from above: end on or from the side, by the shorter overlap (it was over the
        // top, so last tick's side-by-side test does not say how it came in); null otherwise.
        let edgeEndOn: boolean | null = null;
        // Over its roof a tick ago (in the air): it came down onto it, or it is riding the roof.
        const fromAbove = r.airborne && hBefore >= top - 1e-6;
        // A light kerb rider has no roof (the live check of #619): coming down on one is the soft
        // contact below, as from any other direction, never a car's roof (never a crash, never ridden on).
        const kerbLight = kerbSoft && isKerb(t) && softContact(t);
        // Supports (the maintainer, 2026-10-06): a roof that holds the bike is ground, and the riders land
        // the rider on it (sim/riders/supports.ts). A smaller top is an obstacle met from above: the one
        // rule, the fall speed (below).
        const holdsTop =
          supports && !kerbLight && holdsBike(t.lengthM, t.widthM, { lengthM: r.lengthM, widthM: r.widthM });
        if (holdsTop && st.contactWith[r.id] !== vid && fromAbove) {
          // One rule decides (the live check of 2026-10-07): the riders' own, the rider's middle over the
          // top. On it (the vehicle moved under him as traffic stepped, so the riders' step missed him),
          // he is held at its top, still falling as he was, and landed on next tick. With his box over its
          // end but his middle past it, he is off its edge and falls, never held in the air while gravity
          // builds (it held him for up to 2 s, then dropped him at 32 m/s from 3.25 m).
          if (overVehicleTop(world, config, m, vid)) {
            holdAtTop(world, config, m, top);
            continue;
          }
          // Come down past its edge (a rider who has just ridden off its top included: it is solid to him
          // again at once, the live check of 2026-10-07). Moving into it, he meets its end below its top: the contact below, by the
          // closing speed, on the side the shorter overlap says. Level with it or falling behind, the edge
          // tips the overhanging bike off: he slides clear of it the short way, his speed and his fall as
          // they were, with no contact.
          const endOn = overU < overD;
          const into = endOn
            ? closingOnAxis(riderU, vDir * vSpeed, du)
            : closingOnAxis(riderCross, st.cdMps[k] ?? 0, dcd);
          if (into <= 0) {
            let clear = false;
            if (!endOn) {
              r.cd += (dcd > 0 ? -1 : 1) * (overD + 0.02);
              clear = putRider(world, config, st, r);
            }
            if (!clear) {
              r.u -= (du > 0 ? 1 : -1) * (overU + 0.02);
              putRider(world, config, st, r);
            }
            config.road.advance(m.pos);
            rel[k] = r.dir * ((st.u[k] ?? 0) - r.u) || -1e-9;
            continue;
          }
          edgeEndOn = endOn;
        } else if (
          !holdsTop &&
          !kerbLight &&
          st.contactWith[r.id] !== vid &&
          fromAbove &&
          top - r.h <= Math.min(overU, overD)
        ) {
          st.contactWith[r.id] = vid;
          const crashed = roofContact(world, config, st, r, m, { t, vid, top, dcd, hold: !supports });
          // Under the line, with supports, it wobbles off the top: pushed clear below, falling on.
          if (!supports || crashed) continue;
        } else if (!kerbLight && st.contactWith[r.id] === vid && fromAbove && !supports) {
          // Still over the roof after a wobble on it: held at its top, never sunk into the car.
          onRoof(world, config, m, top);
          continue;
        }
        if (st.contactWith[r.id] !== vid) {
          st.contactWith[r.id] = vid;
          // Side by side last tick (their boxes overlapped along the road): it came in from the side.
          const halfLen = (t.lengthM + r.lengthM) / 2;
          const endOn = edgeEndOn ?? (prev === 0 ? overU < overD : Math.abs(prev) >= halfLen);
          const front = du * r.dir > 0;
          const graze = endOn && overD < T.grazeM;
          const oncoming = vDir !== r.dir;
          // The closing speed (playtest 4, ./contact-rule.ts): how fast the two came together along
          // the contact's normal, from both bodies' velocities in corridor terms. End on, along the
          // road (rear-ending, rear-ended, head-on); a side brush or a graze, across it (the rider's
          // heading off the road's line, the car's lane change or swerve).
          const closing =
            endOn && !graze
              ? closingOnAxis(riderU, vDir * vSpeed, du)
              : closingOnAxis(riderCross, st.cdMps[k] ?? 0, dcd);
          const hood = {
            rider: r.id,
            vehicle: vid,
            type: t,
            endOn,
            graze,
            front,
            oncoming,
            closingMps: closing,
          };
          if (hoodLaunchContact(world, config, hood)) {
            st.launchedOff[r.id] = vid;
            continue;
          }
          const hit =
            kerbLight && fromAbove ? 'top' : graze ? 'graze' : endOn ? (front ? 'frontal' : 'rear') : 'side';
          if (kerbLight) {
            // Soft contact (T4.1): the rider only wobbles, even when it is still unstable from an
            // earlier wobble, and a hard enough clip topples the cyclist. A toppled cyclist is moved
            // clear, so the rider is neither pushed out of its box nor slowed to its speed; a slow
            // brush (a scooter against a cop standing at the kerb) is resolved as any nudge is. How
            // hard the clip was is the speed difference along the road, as T4.1 tuned it.
            const clip = Math.abs(m.speed - vAlong);
            soft = clip >= KERB_YIELD.toppleMinMps;
            m.speed *= KERB_YIELD.bumpScrub;
            const away = dcd > 0 ? -1 : 1;
            m.yaw = clamp(m.yaw + away * r.dir * KERB_YIELD.bumpKickRad, -1.2, 1.2);
            st.unstableS[r.id] = T.unstableS;
            emit(
              world,
              'wobble',
              r.id,
              {
                cause: 'traffic',
                hazard: t.hazard,
                vehicle: t.contentId,
                contact: 'wobble',
                hit,
                impactMps: clip,
                kerb: true,
                ...(r.airborne ? { air: true } : {}),
                ...(soft ? { toppleS: KERB_YIELD.toppleS } : {}),
              },
              { target: vid },
            );
            if (soft) toppleKerbRider(world, config, st, k, overD);
          } else {
            // The one rule (playtest 4): the closing speed alone decides, whatever the vehicle and
            // however shaky the rider already is. An end-on crash is inelastic (`solid`).
            const crash = trafficContactCrashes(world.params, closing);
            solid = crash && endOn && !graze;
            const data = {
              cause: 'traffic',
              hazard: t.hazard,
              vehicle: t.contentId,
              contact: crash ? 'crash' : 'wobble',
              hit,
              impactMps: closing,
              ...(r.airborne ? { air: true } : {}),
              // A rider in a wheelie who crashed instead of launching is told why, in one word.
              ...(crash ? wheelieReasonData(wheelieCrashReason(world, hood)) : {}),
            };
            if (solid) {
              // Inelastic: the rider ends at the vehicle's speed along the road, never bounced back. A
              // rider on a support leaves it for the world's frame, that speed (sim/riders/supports.ts).
              m.speed = Math.max(0, vAlong);
              if (mo) leaveSupport(world, r.id);
              emit(world, 'crash', r.id, data, { target: vid });
            } else if (crash) {
              m.speed *= T.crashScrub;
              emit(world, 'crash', r.id, data, { target: vid });
            } else {
              m.speed *= T.wobbleScrub;
              const away = dcd > 0 ? -1 : 1;
              m.yaw = clamp(m.yaw + away * r.dir * T.wobbleKickRad, -1.2, 1.2);
              st.unstableS[r.id] = T.unstableS;
              emit(world, 'wobble', r.id, data, { target: vid });
            }
          }
        }
        if (soft) {
          rel[k] = r.dir * ((st.u[k] ?? 0) - r.u) || -1e-9;
          continue;
        }
        // Push the rider just out of the vehicle's box: back along the road for a solid hit;
        // sideways for a head-on brush or a side swipe; backward (and down to its speed) for a nudge.
        const lateral = !solid && (vDir !== r.dir || overD < overU);
        let resolved = false;
        if (lateral) {
          r.cd += (dcd > 0 ? -1 : 1) * (overD + 0.02);
          resolved = putRider(world, config, st, r);
        }
        if (!resolved) {
          r.u -= (du > 0 ? 1 : -1) * (overU + 0.02);
          putRider(world, config, st, r);
          // Into its tail: slow to its speed. Hit from behind: shoved up to its speed.
          // (A rider on a support moves over it: its speed is not the world's, and is left as it is.)
          if (vDir === r.dir && !mo) m.speed = du > 0 ? Math.min(m.speed, vSpeed) : Math.max(m.speed, vSpeed);
        }
        config.road.advance(m.pos);
        rel[k] = r.dir * ((st.u[k] ?? 0) - r.u) || -1e-9;
        continue;
      }
      // Near miss (M2 traffic-3): the rider passed the vehicle (it went from ahead to behind),
      // within about 1 m sideways, untouched, at a closing speed of at least the slider's, so
      // crawling past a parked car never scores. Riding, not flying past.
      // (A rider up on a support threads no traffic.)
      if (!r.touchable || own !== '') continue;
      if (
        prev > 0 &&
        ahead <= 0 &&
        prev < 20 &&
        ahead > -20 &&
        st.contactWith[r.id] !== vid &&
        m.speed >= T.nearMissMinMps
      ) {
        const clearance = -overD;
        const vSpeed = world.movers[vid]?.speed ?? 0;
        const closing = m.speed - ((st.dir[k] ?? 1) === r.dir ? vSpeed : -vSpeed);
        if (clearance > 0 && clearance <= T.nearMissM && closing >= closingMin) {
          // Threading between this vehicle and another just as close on the other side (W-R).
          const split = splitPartner(config, st, r, k) >= 0;
          emit(
            world,
            'nearMiss',
            r.id,
            {
              clearanceM: clearance,
              oncoming: (st.dir[k] ?? 1) !== r.dir,
              vehicle: t.contentId,
              closingMps: closing,
              ...(split ? { split: true } : {}),
            },
            { target: vid },
          );
        }
      }
    }
  }
}

/**
 * A first contact from above, onto a vehicle's roof (contacts(), heights): the one rule with the
 * closing speed straight down, how fast the rider was falling (a vehicle has no vertical speed).
 * A crash puts the rider on the roof and starts the tumble there, its speed scrubbed as any crash's;
 * a wobble puts it on the roof with the wobble's scrub and heading kick, and it rides the roof until
 * it drops off. `hit` `top`, `air` true. With supports (`hold` false: the roof is too small to hold
 * the bike, a scooter's or a cyclist's), a wobble does not stay on it: contacts() pushes the rider clear
 * and the flight goes on. Returns true on a crash.
 */
function roofContact(
  world: World,
  config: SimConfig,
  st: TrafficState,
  r: RiderView,
  m: Mover,
  v: { t: SimTrafficTypeDef; vid: number; top: number; dcd: number; hold: boolean },
): boolean {
  const { t, vid, top, dcd } = v;
  const closing = Math.max(0, -riderVyMps(world, r.id));
  const crash = trafficContactCrashes(world.params, closing);
  const data = {
    cause: 'traffic',
    hazard: t.hazard,
    vehicle: t.contentId,
    contact: crash ? 'crash' : 'wobble',
    hit: 'top',
    impactMps: closing,
    air: true,
  };
  if (crash || v.hold) onRoof(world, config, m, top);
  if (crash) {
    m.speed *= TRAFFIC.crashScrub;
    emit(world, 'crash', r.id, data, { target: vid });
    return true;
  }
  m.speed *= TRAFFIC.wobbleScrub;
  const away = dcd > 0 ? -1 : 1;
  m.yaw = clamp(m.yaw + away * r.dir * TRAFFIC.wobbleKickRad, -1.2, 1.2);
  st.unstableS[r.id] = TRAFFIC.unstableS;
  emit(world, 'wobble', r.id, data, { target: vid });
  return false;
}

/**
 * Supports: a rider coming down onto a roof that holds its bike, which the riders' step did not land it
 * on (the vehicle moved under it as traffic stepped): held at the roof's height, still falling as it
 * was, so the riders land it on the roof next tick (sim/riders/supports.ts) by the landing's own rules.
 */
function holdAtTop(world: World, config: SimConfig, m: Mover, top: number): void {
  const rs = world.systems['riders'] as { yAbs?: number[] } | undefined;
  m.h = top;
  const pos = m.pos;
  if (rs?.yAbs) rs.yAbs[m.id] = config.road.surfaceHeight(pos.edge, pos.s, pos.d) + top;
}

/**
 * Puts a rider in the air on a roof `top` high: at that height above its road (the riders' flight
 * state, read and written by name as sim/riders/wheelie writes it), falling no faster than 0.
 */
function onRoof(world: World, config: SimConfig, m: Mover, top: number): void {
  const rs = world.systems['riders'] as { yAbs?: number[]; vy?: number[] } | undefined;
  m.h = top;
  const pos = m.pos;
  if (rs?.yAbs) rs.yAbs[m.id] = config.road.surfaceHeight(pos.edge, pos.s, pos.d) + top;
  if (rs?.vy) rs.vy[m.id] = Math.max(0, rs.vy[m.id] ?? 0);
}

/** A rider's vertical speed in the air (sim/riders' flight state, read by name), m/s; 0 without one. */
function riderVyMps(world: World, id: number): number {
  const rs = world.systems['riders'] as { vy?: number[] } | undefined;
  return rs?.vy?.[id] ?? 0;
}

/**
 * A rider's sideways shove from a hit or a kick still in progress, m/s along +d (sim/combat's curve:
 * peak × (1 − t/N), header of sim/combat). Read from combat's state by name, as sim/riders/wheelie
 * reads the riders', so traffic does not import combat (combat imports tumble, which imports traffic).
 */
function shoveDMps(world: World, id: number): number {
  const c = world.systems['combat'] as
    { knockPeak?: number[]; knockT?: number[]; knockTicks?: number[] } | undefined;
  const peak = c?.knockPeak?.[id] ?? 0;
  if (peak === 0) return 0;
  const n = c?.knockTicks?.[id] ?? 1;
  const t = c?.knockT?.[id] ?? 0;
  return t >= n ? 0 : peak * (1 - t / n);
}

/**
 * Whether a rider's box is within TRAFFIC.ghostClearM of any vehicle's (a live moving deck aside: the
 * riders' to meet), in corridor terms; false off the traffic road or above it.
 */
function nearVehicle(
  config: SimConfig,
  st: TrafficState,
  m: Mover,
  decks: readonly { vehicle: number }[],
): boolean {
  if (m.h > TRAFFIC.maxContactH) return false;
  const p = riderOnCorridor(config.road, st.corridor, m.pos, TRAFFIC.maxContactH);
  if (!p) return false;
  const T = TRAFFIC;
  const box = riderHitbox(config, m.riderIndex);
  for (let k = 0; k < st.id.length; k++) {
    if (isDeckVehicle(decks, st.id[k] ?? -1)) continue;
    const t = typeOf(config, st, k);
    const overU = (t.lengthM + box.lengthM) / 2 - Math.abs((st.u[k] ?? 0) - p.u);
    const overD = (t.widthM + box.widthM) / 2 - Math.abs((st.cd[k] ?? 0) - p.cd);
    if (overU > -T.ghostClearM && overD > -T.ghostClearM) return true;
  }
  return false;
}

/**
 * Counts each ghost down (scaled ticks, so a hit-stop holds it) and ends it once its minimum is over
 * and the rider is clear of every vehicle, or at its hard cap (playtest 4). Before contacts(), so a
 * ghost that ends this tick is already solid there.
 */
function stepGhosts(world: World, config: SimConfig, st: TrafficState): void {
  const decks = (world.systems[MOVING_DECKS_KEY] as SimMovingDecks | undefined)?.live ?? [];
  const ts = world.timeScale;
  for (const m of world.movers) {
    if (m.kind !== 'rider' || !((st.ghostCapT[m.id] ?? 0) > 0)) continue;
    const left = Math.max(0, (st.ghostT[m.id] ?? 0) - ts);
    const cap = Math.max(0, (st.ghostCapT[m.id] ?? 0) - ts);
    st.ghostT[m.id] = left;
    st.ghostCapT[m.id] = cap;
    // Down again (a rival knocked it off): a ghost no more.
    const down = m.mode === 'Tumble' || m.mode === 'OnFoot';
    const over = down || cap <= 0 || (left <= 0 && !(m.mode === 'Road' && nearVehicle(config, st, m, decks)));
    if (over) {
      st.ghostT[m.id] = 0;
      st.ghostCapT[m.id] = 0;
    }
  }
}

/** Whether a vehicle has a live moving deck this tick (playtest 3's moving ramp trucks). */
function isDeckVehicle(decks: readonly { vehicle: number }[], vid: number): boolean {
  for (const d of decks) if (d.vehicle === vid) return true;
  return false;
}

export function trafficStep(world: World, config: SimConfig): void {
  const st = trafficState(world);
  if (st.types.length === 0 && st.id.length === 0) return;
  const dt = world.timeScale / 60;
  st.clockS += dt;
  if (world.tick % TRAFFIC.populateEveryTicks === 0) populate(world, config, st);
  laneChanges(world, config, st, dt);
  move(world, config, st, riderViews(world, config, st), dt);
  for (let k = 0; k < st.id.length; k++) {
    const u = st.u[k] ?? 0;
    if ((st.dir[k] === 1 && u >= st.corridor.hi) || (st.dir[k] === -1 && u <= st.corridor.lo))
      leaveRoad(world, config, st, k);
  }
  stepGhosts(world, config, st);
  contacts(world, config, st, riderViews(world, config, st, Infinity), dt);
}
