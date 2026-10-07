// The BotController (docs/architecture.md, "Testing seams"; M1 dev-1): a test player outside the
// sim that reads each tick's snapshot like a human would and writes the input layer's action
// state, once per sim tick. It is not bound by the determinism rules (it runs outside the sim, and
// its inputs are recorded), so plain Math is fine here; the self-test never uses it.
//
// What it does, in priority order:
// - down (Tumble or OnFoot): holds skipRunBack, so the run-back is skipped;
// - airborne: holds the throttle and the bars straight;
// - rides the route: the centre of a travel lane in its direction, or a `shortcut` lane when the
//   road offers one; and it takes road-2's ramp shortcut once: in the last SHORTCUT_APPROACH_M
//   before a split zone on the route (`RouteProgress.shortcuts`) it moves into the zone, holds off
//   fights, and follows a car going its way rather than swerve out of the zone; while a car coming
//   the other way is in the zone's line it keeps to its own side and rides on, never stopping in
//   that car's path;
// - avoids traffic: a vehicle ahead in its line makes it pick another lane of its own direction,
//   pass in the oncoming lane when that is clear far enough ahead, or brake and follow (the lanes of
//   its own direction come first, whichever is nearer). Only vehicles count: riders pass through
//   each other in the sim, so a rival (or the cop) in its line is never a reason to brake;
// - back on the bike after a fall, it keeps to the lanes of its own direction for
//   REMOUNT_OWN_SIDE_TICKS: no oncoming pass and no line-up on a rival across the centre line, while
//   it is still getting back up to speed;
// - fights a rival down (dev-4 part 2, so the batch exercises takedowns): with a rival rider (never
//   the cop) near it on the same road, the weakest one in reach first, it pulls alongside at
//   KICK_OFFSET_M on the side that shoves the rival toward danger (a vehicle in the lane next to
//   it, ahead or oncoming), matches speed, and kicks (attack + kick, one press edge, aimed at the
//   rival's side) when the rival will be inside the kick's reach as the wind-up ends. Through the
//   wind-up it steers into the rival, so the momentum kick adds its sideways speed to the shove.
//   It presses again the tick the leg is back (a kick's cycle leaves no room for a punch between
//   two kicks). It gives up on a rival after ENGAGE_LIMIT_TICKS and rests before the next fight,
//   and it stops fighting while its own health is under RETREAT_HEALTH, so it still finishes its
//   races.
import type { ActionState } from '../../app';
import kickPack from '../../../packs/base/weapons/kick.json';
import {
  InputFlag,
  quantizeInput,
  secondsToTicks,
  type EntitySnapshot,
  type LaneInfo,
  type RouteProgress,
  type RouteQueries,
  type SimInput,
  type SimSnapshot,
} from '../../sim/api';

/**
 * The bot's action state as the quantized command the sim steps on, the way input's toSimInput
 * does it (dev/ may not import input/). Headless bot races (the unit test, the in-page attack
 * runs) use it.
 */
export function botInput(a: ActionState): SimInput {
  let flags = 0;
  if (a.attack) flags |= InputFlag.attack;
  if (a.attackSide < 0) flags |= InputFlag.attackSideLeft;
  if (a.attackSide > 0) flags |= InputFlag.attackSideRight;
  if (a.kick) flags |= InputFlag.kick;
  if (a.lookBack) flags |= InputFlag.lookBack;
  if (a.skipRunBack) flags |= InputFlag.skipRunBack;
  return quantizeInput({ steer: a.steer, throttle: a.throttle, brake: a.brake, flags });
}

/** An empty action state (nothing pressed), for headless bot races. */
export function blankActions(): ActionState {
  return {
    throttle: 0,
    brake: 0,
    steer: 0,
    attack: false,
    attackSide: 0,
    kick: false,
    lookBack: false,
    skipRunBack: false,
  };
}

/** Lateral offset the bot holds beside a rival to kick it, m (kick reach |Δd| ≤ 1.7 m). */
export const KICK_OFFSET_M = 1.2;
/**
 * The kick's press window, judged where the rival will be when the kick goes active: |Δs| (from
 * the speed difference over KICK_LEAD_TICKS) and |Δd| limits, inside the kick's 1.0 × 1.7 m reach.
 */
export const KICK_WINDOW = { sM: 0.8, dMinM: 0.5, dMaxM: 1.65 } as const;
/**
 * The kick's wind-up, ticks: the bot leads its press by it. Both kick numbers come from the kick
 * weapon's own file (packs/base/weapons/kick.json), the way the sim reads them (content ticks =
 * max(1, round(seconds x 60))), so a retune of the kick moves the bot with it.
 */
export const KICK_LEAD_TICKS = secondsToTicks(kickPack.windupS);
/**
 * Ticks between kick presses: the kick's whole cycle (wind-up, active, recovery), the hit-stop a
 * landed kick freezes the sim for, and 2 ticks of margin. A player's kick waits for nothing but the
 * leg's return (the cooldown is the rivals' only), so the bot presses again the tick the leg is back.
 */
export const KICK_REPEAT_TICKS =
  secondsToTicks(kickPack.windupS) +
  secondsToTicks(kickPack.activeS) +
  secondsToTicks(kickPack.recoveryS) +
  Math.round((kickPack.hitStopMs * 60) / 1000) +
  2;
/** How far ahead (and behind) the bot looks for a rival to fight, m. */
export const ENGAGE_RANGE_M = 70;
const ENGAGE_BEHIND_M = 40;
/** A rival's health counts this many metres per point when the bot picks whom to fight. */
const WEAK_PULL_M_PER_HP = 0.25;
/** Longest fight with one rival before the bot rides on, and the rest before the next one. */
export const ENGAGE_LIMIT_TICKS = 14 * 60;
export const ENGAGE_REST_TICKS = 4 * 60;
/** Below this health the bot rides on rather than fight, so it keeps finishing its races. */
export const RETREAT_HEALTH = 35;
/** The lateral gap a hurt bot keeps from a rival beside it, m (past the kick's 1.7 m reach). */
const RETREAT_GAP_M = 3.5;
/** The bot's steering gain on its lateral error while lining up a kick (0.35 when riding). */
const FIGHT_STEER_GAIN = 0.6;
/**
 * Danger beside a rival, for the kick side: a vehicle from DANGER_BEHIND_M behind to
 * DANGER_AHEAD_M ahead of the rival (along the bot's travel), between DANGER_NEAR_M and
 * DANGER_FAR_M to one side of it, is where a kick should send it.
 */
const DANGER_AHEAD_M = 45;
const DANGER_BEHIND_M = 5;
const DANGER_NEAR_M = 1;
const DANGER_FAR_M = 6;
/** Traffic look-ahead in the bot's own line, and the clear distance it wants to pass oncoming. */
const TRAFFIC_LOOKAHEAD_M = 45;
const PASS_CLEAR_M = 160;
/** Half the width the bot keeps clear around its line (half a bike plus margin), m. */
const LINE_HALF_WIDTH_M = 1.3;
/**
 * Following a car in its line: the gap at which the bot wants to be stopped, and the gap over which
 * it eases up to the car's pace from there, m. The gap is centre to centre, so it clears half the
 * longest vehicle (an 11 m bus) and half the bike with room to spare. At 4 m it stopped about a
 * metre off a sedan's bumper, and on main 30ed3db the San Francisco career's meter race left it
 * pinned in a stopped queue for the rest of the race (720 s of a 368 s limit); at 9 m it was not.
 */
const FOLLOW_STOP_M = 9;
const FOLLOW_EASE_M = 16;
/** How far before a split zone the bot starts moving into it, m. */
export const SHORTCUT_APPROACH_M = 150;
/** The bot's line in a split zone: this far into the zone from its inner edge, m. */
const SHORTCUT_LINE_IN_M = 0.9;
/**
 * After a remount the bot keeps to its own side of the road for this long, ticks: from a walking
 * pace it takes about 3.7 s (220 ticks) to get back to cruise, and a pass or a line-up on a rival
 * across the centre line, in front of cars closing at 25 m/s, spends all of that in the oncoming
 * lanes (playtest 4, run C's live check: 2 of 8 remounts, 191 and 217 of the next 240 ticks).
 */
export const REMOUNT_OWN_SIDE_TICKS = 300;

type ShortcutZone = RouteProgress['shortcuts'][number];

/** The route's split zones, when the route is a full RouteProgress (it is, in the game). */
function zonesOf(route: RouteQueries): readonly ShortcutZone[] {
  return 'shortcuts' in route ? (route as RouteProgress).shortcuts : [];
}

/** A zone on this edge that the bot is approaching or inside, in its travel direction. */
function approaching(z: ShortcutZone, edge: number, s: number, dir: 1 | -1): boolean {
  if (z.edge !== edge) return false;
  return dir > 0
    ? s >= z.s0 - SHORTCUT_APPROACH_M && s <= z.s1
    : s <= z.s1 + SHORTCUT_APPROACH_M && s >= z.s0;
}

/** The line to hold through a zone: just inside its inner edge (the edge nearer the centre line). */
function zoneLine(z: ShortcutZone): number {
  const inner = Math.abs(z.d0) <= Math.abs(z.d1) ? z.d0 : z.d1;
  const outer = inner === z.d0 ? z.d1 : z.d0;
  return inner + Math.sign(outer - inner) * Math.min(SHORTCUT_LINE_IN_M, Math.abs(outer - inner) / 2);
}

/**
 * Does a zone's line run through lanes that go the other way (a cut that leaves from the oncoming
 * side, Bridge City's)? The lanes are those at the zone's start.
 */
function crossesOncoming(z: ShortcutZone, route: RouteQueries, dir: 1 | -1): boolean {
  const line = zoneLine(z);
  const lane = route
    .lanesAt(z.edge, z.s0)
    .find(
      (l) => (l.kind === 'drive' || l.kind === 'shoulder') && Math.abs(line - l.dCenterM) <= l.widthM / 2,
    );
  return lane !== undefined && lane.direction === -dir;
}

/** What the bot has done so far this race (the browser test and the batch print these). */
export interface BotStats {
  attackPresses: number;
  skipTicks: number;
  shortcutTicks: number;
  /** Ticks the bot saw a `shortcut` lane at its own position. */
  shortcutSeenTicks: number;
  /** Ticks the bot spent moving into a split zone that leads onto a shortcut (road-2). */
  shortcutApproachTicks: number;
  trafficDodges: number;
  engagements: number;
  /** Kick presses (attack with the kick flag), a subset of attackPresses. */
  kickPresses: number;
  /** Kick presses aimed to shove the rival toward a vehicle beside it. */
  dangerKicks: number;
}

export interface BotController {
  /**
   * Writes this tick's actions for the player rider `playerId`, from the tick's snapshot and the
   * route. `actions` arrives neutral (the input layer's empty action state).
   */
  drive(snap: SimSnapshot, playerId: number, route: RouteQueries, actions: ActionState): void;
  stats(): BotStats;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** A lane is one the bot may ride in its travel direction. */
const rideable = (l: LaneInfo, dir: 1 | -1) =>
  l.direction === dir && (l.kind === 'drive' || l.kind === 'shortcut');

/** Where `o` is relative to `me` on the same edge: metres ahead along travel, metres to the right. */
function relative(me: EntitySnapshot, o: EntitySnapshot): { ds: number; dd: number } | null {
  if (o.road.edge !== me.road.edge) return null;
  const dir = me.road.dir;
  return { ds: (o.road.s - me.road.s) * dir, dd: (o.road.d - me.road.d) * dir };
}

export function createBot(): BotController {
  const stats: BotStats = {
    attackPresses: 0,
    skipTicks: 0,
    shortcutTicks: 0,
    shortcutSeenTicks: 0,
    shortcutApproachTicks: 0,
    trafficDodges: 0,
    engagements: 0,
    kickPresses: 0,
    dangerKicks: 0,
  };
  let lastKickTick = -1e9;
  /** The road-frame d direction the current kick shoves the target (+1 or -1). */
  let kickShove = 0;
  let targetId = -1;
  let engagedSince = 0;
  let restUntil = -1;
  let shortcutDone = false;
  let onShortcut = false;
  let dodging = false;
  /** Was the bot down (tumbling or on foot) on its last tick? */
  let wasDown = false;
  /** The tick until which a remounted bot keeps to its own side (see REMOUNT_OWN_SIDE_TICKS). */
  let ownSideUntil = -1;

  /**
   * The nearest vehicle around lateral `d`, from s0 to s1 ahead, or null when that stretch is clear.
   * With `onlyDir`, only vehicles travelling that way along the road count.
   */
  function blockerAt(
    snap: SimSnapshot,
    me: EntitySnapshot,
    d: number,
    s0: number,
    s1: number,
    onlyDir?: 1 | -1,
  ): { o: EntitySnapshot; ds: number } | null {
    let best: { o: EntitySnapshot; ds: number } | null = null;
    for (const o of snap.entities) {
      // Only traffic blocks a line: riders (rivals, the cop) and pedestrians never collide with it.
      if (o.kind !== 'vehicle') continue;
      if (onlyDir !== undefined && o.road.dir !== onlyDir) continue;
      const rel = relative(me, o);
      if (!rel || rel.ds < s0 || rel.ds > s1) continue;
      if (Math.abs(o.road.d - d) >= 1.2 + LINE_HALF_WIDTH_M) continue;
      if (!best || rel.ds < best.ds) best = { o, ds: rel.ds };
    }
    return best;
  }

  const clearAt = (
    snap: SimSnapshot,
    me: EntitySnapshot,
    d: number,
    s0: number,
    s1: number,
    onlyDir?: 1 | -1,
  ): boolean => blockerAt(snap, me, d, s0, s1, onlyDir) === null;

  /**
   * Following the vehicle in its line around `d`: the throttle and brake that hold the bot to that
   * vehicle's pace along the bot's way, easing to a stop as the gap closes to FOLLOW_STOP_M. A car
   * going its way that pulls away is followed off a standstill: braking whatever the car did held a
   * stopped bot still for good behind a moving queue (dense traffic on Bridge City, the never-stuck
   * lane: 941 ticks stopped in the oncoming lane, both lanes of its own way flowing at 9 m/s). A car
   * coming the other way is not a pace to follow: the bot stops for it.
   */
  function follow(snap: SimSnapshot, me: EntitySnapshot, d: number): { throttle: number; brake: number } {
    const lead = blockerAt(snap, me, d, 0.5, TRAFFIC_LOOKAHEAD_M);
    if (!lead) return { throttle: 1, brake: 0 };
    const pace = lead.o.road.dir === me.road.dir ? lead.o.speed : 0;
    const want = pace * clamp((lead.ds - FOLLOW_STOP_M) / FOLLOW_EASE_M, 0, 1);
    return { throttle: me.speed < want - 0.5 ? 1 : 0, brake: me.speed > want + 1 ? 0.5 : 0 };
  }

  /** The lane the bot rides: a shortcut lane while it has not taken one, else the nearest drive lane. */
  function homeLine(me: EntitySnapshot, lanes: readonly LaneInfo[]): number {
    const own = lanes.filter((l) => rideable(l, me.road.dir));
    const shortcut = own.find((l) => l.kind === 'shortcut');
    if (shortcut && !shortcutDone) return shortcut.dCenterM;
    const drive = own.filter((l) => l.kind === 'drive');
    const pool = drive.length > 0 ? drive : own;
    let best = pool[0]?.dCenterM ?? lanes[0]?.dCenterM ?? 0;
    for (const l of pool)
      if (Math.abs(l.dCenterM - me.road.d) < Math.abs(best - me.road.d)) best = l.dCenterM;
    return best;
  }

  /**
   * The road's rideable span (every drive, shortcut and shoulder lane, or only those of the bot's
   * own direction when `ownSide`), for clamping a target d.
   */
  function span(lanes: readonly LaneInfo[], ownSide?: 1 | -1): { lo: number; hi: number } {
    let lo = Infinity;
    let hi = -Infinity;
    for (const l of lanes) {
      if (ownSide !== undefined && l.direction !== ownSide) continue;
      lo = Math.min(lo, l.dCenterM - l.widthM / 2);
      hi = Math.max(hi, l.dCenterM + l.widthM / 2);
    }
    return Number.isFinite(lo) ? { lo: lo + 0.6, hi: hi - 0.6 } : { lo: -3, hi: 3 };
  }

  function pickRival(snap: SimSnapshot, me: EntitySnapshot): EntitySnapshot | null {
    if (snap.tick < restUntil || me.health < RETREAT_HEALTH) return null;
    let best: EntitySnapshot | null = null;
    let bestScore = Infinity;
    for (const o of snap.entities) {
      if (o.id === me.id || o.kind !== 'rider' || o.faction !== 'rider' || o.mode !== 'Road') continue;
      if (o.health <= 0) continue;
      const rel = relative(me, o);
      if (!rel || rel.ds < -ENGAGE_BEHIND_M || rel.ds > ENGAGE_RANGE_M) continue;
      // Keep the current target while it stays in range; otherwise the nearest, weighted toward
      // the weakest (fewest kicks to finish).
      const score = o.id === targetId ? -1 : Math.abs(rel.ds) + WEAK_PULL_M_PER_HP * o.health;
      if (score < bestScore) {
        bestScore = score;
        best = o;
      }
    }
    return best;
  }

  /** The nearest riding rival (not the cop) within reach of a kick soon: |Δs| < 10 m, |Δd| < 3 m. */
  function nearestRider(snap: SimSnapshot, me: EntitySnapshot): EntitySnapshot | null {
    let best: EntitySnapshot | null = null;
    let bestDs = Infinity;
    for (const o of snap.entities) {
      if (o.id === me.id || o.kind !== 'rider' || o.faction !== 'rider' || o.mode !== 'Road') continue;
      const rel = relative(me, o);
      if (!rel || Math.abs(rel.ds) >= 10 || Math.abs(rel.dd) >= 3) continue;
      if (Math.abs(rel.ds) < bestDs) {
        bestDs = Math.abs(rel.ds);
        best = o;
      }
    }
    return best;
  }

  /**
   * How close the nearest vehicle beside `rival` is on the side `shove` (road-frame d sign), as a
   * 0..1 score (0: none in the danger box). The box runs DANGER_BEHIND_M behind to DANGER_AHEAD_M
   * ahead of the rival along the bot's travel, DANGER_NEAR_M to DANGER_FAR_M to that side.
   */
  function danger(snap: SimSnapshot, me: EntitySnapshot, rival: EntitySnapshot, shove: number): number {
    let best = 0;
    for (const o of snap.entities) {
      if (o.kind !== 'vehicle' || o.road.edge !== rival.road.edge) continue;
      const ahead = (o.road.s - rival.road.s) * me.road.dir;
      if (ahead < -DANGER_BEHIND_M || ahead > DANGER_AHEAD_M) continue;
      const side = (o.road.d - rival.road.d) * shove;
      if (side < DANGER_NEAR_M || side > DANGER_FAR_M) continue;
      best = Math.max(best, 1 - Math.max(0, ahead) / (DANGER_AHEAD_M + 1));
    }
    return best;
  }

  /**
   * The road-frame d direction to kick `rival` toward: toward the more dangerous side, else the
   * side the bot already shoves from, unless the bot's spot for that is off the rideable span.
   */
  function shoveSide(
    snap: SimSnapshot,
    me: EntitySnapshot,
    rival: EntitySnapshot,
    bounds: { lo: number; hi: number },
  ): { shove: number; danger: boolean } {
    const plus = danger(snap, me, rival, 1);
    const minus = danger(snap, me, rival, -1);
    const current = rival.road.d >= me.road.d ? 1 : -1;
    const fits = (shove: number) => {
      const spot = rival.road.d - shove * KICK_OFFSET_M;
      return spot >= bounds.lo && spot <= bounds.hi;
    };
    if (plus !== minus) {
      const shove = plus > minus ? 1 : -1;
      if (fits(shove)) return { shove, danger: true };
    }
    return { shove: fits(current) ? current : -current, danger: false };
  }

  return {
    stats: () => ({ ...stats }),
    drive(snap, playerId, route, a) {
      const me = snap.entities[playerId];
      if (!me) return;
      // Down: skip the run-back.
      if (me.mode === 'Tumble' || me.mode === 'OnFoot') {
        a.skipRunBack = true;
        stats.skipTicks++;
        targetId = -1;
        wasDown = true;
        return;
      }
      if (wasDown) {
        // Back on the bike, at the spot it fell. A cut that leaves across the oncoming lanes, and
        // that it fell in the approach to, is given up: it would ride into those lanes from a
        // walking pace, in front of traffic closing at 25 m/s (the head-on crashes after each
        // remount in playtest 4's respawn lane). A cut on its own side, or one further on, stays on.
        wasDown = false;
        ownSideUntil = snap.tick + REMOUNT_OWN_SIDE_TICKS;
        const near = zonesOf(route).find((z) => approaching(z, me.road.edge, me.road.s, me.road.dir));
        if (near && crossesOncoming(near, route, me.road.dir)) shortcutDone = true;
      }
      if (me.mode === 'Airborne' || !me.grounded) {
        a.throttle = 1;
        return;
      }
      const { edge, s, d, dir, yaw } = me.road;
      const v = Math.max(me.speed, 5);
      const lanes = route.lanesAt(edge, s);
      const own = lanes.filter((l) => rideable(l, dir));
      const inShortcut = own.some((l) => l.kind === 'shortcut' && Math.abs(d - l.dCenterM) <= l.widthM / 2);
      if (own.some((l) => l.kind === 'shortcut')) stats.shortcutSeenTicks++;
      if (inShortcut) stats.shortcutTicks++;
      if (onShortcut && !inShortcut) shortcutDone = true;
      onShortcut = inShortcut;

      // A remounted bot keeps to the lanes of its own direction (fights and passes included), if
      // the road has any at this spot.
      const ownSide = snap.tick < ownSideUntil && own.length > 0;
      const bounds = span(lanes, ownSide ? dir : undefined);
      let targetD = homeLine(me, lanes);
      let throttle = 1;
      let brake = 0;

      // road-2's ramp shortcut: a split zone ahead on this edge, not yet taken. Not while a vehicle
      // coming the other way is in the zone's line (Bridge City's cut leaves across the oncoming
      // lanes): following it means stopping in its path, at full lock across the centre line, where
      // the cars coming down the road stop for the bot in turn (polish H's punch item 5: 4,000+ ticks
      // on Broadway). It rides on, on its own side, and goes for the zone once the line is clear.
      const zoneAhead = shortcutDone ? undefined : zonesOf(route).find((z) => approaching(z, edge, s, dir));
      const zone =
        zoneAhead && clearAt(snap, me, zoneLine(zoneAhead), 0.5, TRAFFIC_LOOKAHEAD_M, -dir as 1 | -1)
          ? zoneAhead
          : undefined;
      if (zone) {
        stats.shortcutApproachTicks++;
        targetD = zoneLine(zone);
      }

      // Fight a rival riding ahead. While committed to the shortcut (lining up for it, or on it) the
      // bot keeps its line and speed, and only swings at a rival already inside its window.
      const committed = onShortcut || zone !== undefined;
      const rival = pickRival(snap, me);
      let fighting = false;
      if (rival) {
        if (rival.id !== targetId) {
          targetId = rival.id;
          engagedSince = snap.tick;
          stats.engagements++;
        }
        if (snap.tick - engagedSince > ENGAGE_LIMIT_TICKS) {
          restUntil = snap.tick + ENGAGE_REST_TICKS;
          targetId = -1;
        } else {
          const rel = relative(me, rival);
          const sinceKick = snap.tick - lastKickTick;
          const windingUp = sinceKick <= KICK_LEAD_TICKS;
          if (rel && !committed) {
            fighting = true;
            if (windingUp && kickShove !== 0) {
              // The momentum kick: steer into the rival through the wind-up, so the bot's own
              // sideways speed adds to the shove (combat's momentumKickGain).
              targetD = rival.road.d - kickShove * 0.2;
            } else {
              // Line up on the side that kicks the rival toward danger, or hold the current side.
              const { shove } = shoveSide(snap, me, rival, bounds);
              targetD = rival.road.d - shove * KICK_OFFSET_M;
            }
          }
          if (rel) {
            if (rel.ds < 6 && !committed) {
              // Match speed so the rival stays alongside.
              const vWant = rival.speed + 0.9 * rel.ds;
              throttle = me.speed < vWant - 0.2 ? 1 : me.speed < vWant + 0.8 ? 0.4 : 0;
              brake = me.speed > vWant + 2 ? 0.6 : 0;
            }
            // Where the rival will be along the road when a kick pressed now goes active.
            const dsAtActive = rel.ds + ((rival.speed - me.speed) * KICK_LEAD_TICKS) / 60;
            const kickable =
              Math.abs(dsAtActive) <= KICK_WINDOW.sM &&
              Math.abs(rel.dd) >= KICK_WINDOW.dMinM &&
              Math.abs(rel.dd) <= KICK_WINDOW.dMaxM;
            if (kickable && sinceKick >= KICK_REPEAT_TICKS) {
              const aim = shoveSide(snap, me, rival, bounds);
              a.attack = true;
              a.kick = true;
              a.attackSide = rel.dd > 0 ? 1 : -1;
              lastKickTick = snap.tick;
              kickShove = rival.road.d >= d ? 1 : -1;
              stats.attackPresses++;
              stats.kickPresses++;
              if (aim.danger && aim.shove === kickShove) stats.dangerKicks++;
            }
            // Hold the kick flag through the wind-up, so the attack stays a kick.
            if (windingUp && !a.attack) a.kick = true;
          }
        }
      } else {
        targetId = -1;
        // Hurt: keep clear of a rival beside it, so it is not kicked off while it rides on.
        const threat = me.health < RETREAT_HEALTH && !committed ? nearestRider(snap, me) : null;
        if (threat) targetD = threat.road.d - (threat.road.d >= d ? 1 : -1) * RETREAT_GAP_M;
      }

      // Traffic in the bot's line: another own-direction lane, a pass in the oncoming lane, or follow.
      targetD = clamp(targetD, bounds.lo, bounds.hi);
      if (zone && !clearAt(snap, me, targetD, 0.5, TRAFFIC_LOOKAHEAD_M)) {
        // Committed to the zone: follow the car rather than swerve out of it.
        ({ throttle, brake } = follow(snap, me, targetD));
      } else if (!clearAt(snap, me, targetD, 0.5, TRAFFIC_LOOKAHEAD_M)) {
        // Another lane of its own direction first (nearest first); the oncoming lane only when none
        // is free, so a car ahead does not put it across the centre line while a lane on its own
        // side is open.
        const byNearest = (p: { d: number }, q: { d: number }) => Math.abs(p.d - d) - Math.abs(q.d - d);
        const ownChoices = own.map((l) => ({ d: l.dCenterM, reach: TRAFFIC_LOOKAHEAD_M })).sort(byNearest);
        const passChoices = (ownSide ? [] : lanes)
          .filter((l) => l.kind === 'drive' && l.direction !== dir)
          .map((l) => ({ d: l.dCenterM, reach: PASS_CLEAR_M }))
          .sort(byNearest);
        const free = [...ownChoices, ...passChoices].find((c) => clearAt(snap, me, c.d, -4, c.reach));
        if (free) {
          if (!dodging) stats.trafficDodges++;
          dodging = true;
          targetD = free.d;
        } else {
          // Nowhere to go: follow at the blocker's pace.
          ({ throttle, brake } = follow(snap, me, targetD));
        }
      } else {
        dodging = false;
      }

      // Steer toward the target line, with the road's curvature fed forward.
      const lateral = (targetD - d) * dir;
      const kappa = route.kappaAt(edge, s) * dir;
      const gain = fighting ? FIGHT_STEER_GAIN : 0.35;
      const steer = gain * lateral - 2.5 * yaw + (kappa * v * v) / 22;
      a.throttle = throttle;
      a.brake = brake;
      a.steer = clamp(steer, -1, 1);
    },
  };
}

/** The skeleton's throttle-only lane follower (app-1), kept for lanes whose scenario tests use it. */
export interface StubBot {
  drive(me: EntitySnapshot, route: RouteQueries, actions: ActionState): void;
}

export function createStubBot(): StubBot {
  return {
    drive(me, route, a) {
      const { edge, s, d, dir, yaw } = me.road;
      const v = Math.max(me.speed, 5);
      const lanes = route.lanesAt(edge, s);
      const lane = lanes.find((l) => l.kind === 'drive' && l.direction === dir) ?? lanes[0];
      const lateral = ((lane?.dCenterM ?? 0) - d) * dir;
      const kappa = route.kappaAt(edge, s) * dir;
      a.throttle = 1;
      a.brake = 0;
      a.steer = clamp(0.35 * lateral - 2.5 * yaw + (kappa * v * v) / 22, -1, 1);
    },
  };
}
