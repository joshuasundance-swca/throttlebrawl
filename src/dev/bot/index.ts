// The BotController (docs/architecture.md, "Testing seams"; M1 dev-1): a test player outside the
// sim that reads each tick's snapshot like a human would and writes the input layer's action
// state, once per sim tick. It is not bound by the determinism rules (it runs outside the sim, and
// its inputs are recorded), so plain Math is fine here; the self-test never uses it.
//
// What it does, in priority order:
// - down (Tumble or OnFoot): holds skipRunBack, so the run-back is skipped;
// - airborne: holds the throttle and the bars straight;
// - rides the route: the centre of a travel lane in its direction, or a `shortcut` lane when the
//   road offers one (road-2's ramp shortcut; it takes it once);
// - avoids traffic: a vehicle ahead in its line makes it pick another lane of its own direction,
//   pass in the oncoming lane when that is clear far enough ahead, or brake and follow;
// - fights: with a rival rider (never the cop) ahead on the same road, it pulls alongside at
//   ATTACK_OFFSET_M, matches speed, and presses attack (one press edge) when the rival is inside
//   its window. It gives up on a rival after ENGAGE_LIMIT_TICKS and rests before the next fight.
import type { ActionState } from '../../app';
import type { EntitySnapshot, LaneInfo, RouteQueries, SimSnapshot } from '../../sim/api';

/** Lateral offset the bot holds beside a rival to punch it, m (punch reach |Δd| ≤ 1.4 m). */
export const ATTACK_OFFSET_M = 1.1;
/** The bot's attack window: |Δs| and |Δd| limits in which it presses attack. */
export const ATTACK_WINDOW = { sM: 0.9, dMinM: 0.5, dMaxM: 1.35 } as const;
/** Ticks between the bot's attack presses (a punch cycle is 7 + 5 + 15 = 27 ticks). */
export const ATTACK_REPEAT_TICKS = 32;
/** How far ahead the bot looks for a rival to fight, m. */
export const ENGAGE_RANGE_M = 70;
/** Longest fight with one rival before the bot rides on, and the rest before the next one. */
export const ENGAGE_LIMIT_TICKS = 8 * 60;
export const ENGAGE_REST_TICKS = 5 * 60;
/** Traffic look-ahead in the bot's own line, and the clear distance it wants to pass oncoming. */
const TRAFFIC_LOOKAHEAD_M = 45;
const PASS_CLEAR_M = 160;
/** Half the width the bot keeps clear around its line (half a bike plus margin), m. */
const LINE_HALF_WIDTH_M = 1.3;

/** What the bot has done so far this race (the browser test and the batch print these). */
export interface BotStats {
  attackPresses: number;
  skipTicks: number;
  shortcutTicks: number;
  /** Ticks the bot saw a `shortcut` lane at its own position. */
  shortcutSeenTicks: number;
  trafficDodges: number;
  engagements: number;
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
    trafficDodges: 0,
    engagements: 0,
  };
  let lastPressTick = -1e9;
  let targetId = -1;
  let engagedSince = 0;
  let restUntil = -1;
  let shortcutDone = false;
  let onShortcut = false;
  let dodging = false;

  /** Is a stretch of road clear of vehicles and riders around lateral `d`, from s0 to s1 ahead? */
  function clearAt(snap: SimSnapshot, me: EntitySnapshot, d: number, s0: number, s1: number): boolean {
    for (const o of snap.entities) {
      if (o.id === me.id || o.kind === 'ped' || o.kind === 'pickup') continue;
      const rel = relative(me, o);
      if (!rel || rel.ds < s0 || rel.ds > s1) continue;
      const width = o.kind === 'vehicle' ? 1.2 : 0.5;
      if (Math.abs(o.road.d - d) < width + LINE_HALF_WIDTH_M) return false;
    }
    return true;
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

  /** The road's rideable span (every drive, shortcut and shoulder lane), for clamping a target d. */
  function span(lanes: readonly LaneInfo[]): { lo: number; hi: number } {
    let lo = Infinity;
    let hi = -Infinity;
    for (const l of lanes) {
      lo = Math.min(lo, l.dCenterM - l.widthM / 2);
      hi = Math.max(hi, l.dCenterM + l.widthM / 2);
    }
    return Number.isFinite(lo) ? { lo: lo + 0.6, hi: hi - 0.6 } : { lo: -3, hi: 3 };
  }

  function pickRival(snap: SimSnapshot, me: EntitySnapshot): EntitySnapshot | null {
    if (snap.tick < restUntil) return null;
    let best: EntitySnapshot | null = null;
    let bestDs = Infinity;
    for (const o of snap.entities) {
      if (o.id === me.id || o.kind !== 'rider' || o.faction !== 'rider' || o.mode !== 'Road') continue;
      const rel = relative(me, o);
      if (!rel || rel.ds < -3 || rel.ds > ENGAGE_RANGE_M) continue;
      // Keep the current target while it stays in range; otherwise the nearest ahead.
      const score = o.id === targetId ? -1 : Math.abs(rel.ds);
      if (score < bestDs) {
        bestDs = score;
        best = o;
      }
    }
    return best;
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
        return;
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

      const bounds = span(lanes);
      let targetD = homeLine(me, lanes);
      let throttle = 1;
      let brake = 0;

      // Fight a rival riding ahead.
      const rival = onShortcut ? null : pickRival(snap, me);
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
          if (rel) {
            // Hold the side the bot is already on (its own frame), if the road has room there.
            const sideFrame = rel.dd > 0 ? -1 : 1;
            const want = rival.road.d + sideFrame * ATTACK_OFFSET_M * dir;
            const other = rival.road.d - sideFrame * ATTACK_OFFSET_M * dir;
            targetD = want >= bounds.lo && want <= bounds.hi ? want : other;
            if (rel.ds < 6) {
              // Match speed so the rival stays alongside.
              const vWant = rival.speed + 0.9 * rel.ds;
              throttle = me.speed < vWant - 0.2 ? 1 : me.speed < vWant + 0.8 ? 0.4 : 0;
              brake = me.speed > vWant + 2 ? 0.6 : 0;
            }
            const inWindow =
              Math.abs(rel.ds) <= ATTACK_WINDOW.sM &&
              Math.abs(rel.dd) >= ATTACK_WINDOW.dMinM &&
              Math.abs(rel.dd) <= ATTACK_WINDOW.dMaxM;
            if (inWindow && snap.tick - lastPressTick >= ATTACK_REPEAT_TICKS) {
              a.attack = true;
              lastPressTick = snap.tick;
              stats.attackPresses++;
            }
          }
        }
      } else {
        targetId = -1;
      }

      // Traffic in the bot's line: another own-direction lane, a pass in the oncoming lane, or follow.
      targetD = clamp(targetD, bounds.lo, bounds.hi);
      if (!clearAt(snap, me, targetD, 0.5, TRAFFIC_LOOKAHEAD_M)) {
        const choices = [
          ...own.map((l) => ({ d: l.dCenterM, reach: TRAFFIC_LOOKAHEAD_M })),
          ...lanes
            .filter((l) => l.kind === 'drive' && l.direction !== dir)
            .map((l) => ({ d: l.dCenterM, reach: PASS_CLEAR_M })),
        ].sort((p, q) => Math.abs(p.d - d) - Math.abs(q.d - d));
        const free = choices.find((c) => clearAt(snap, me, c.d, -4, c.reach));
        if (free) {
          if (!dodging) stats.trafficDodges++;
          dodging = true;
          targetD = free.d;
        } else {
          // Nowhere to go: follow at the blocker's pace.
          throttle = 0;
          brake = 0.5;
        }
      } else {
        dodging = false;
      }

      // Steer toward the target line, with the road's curvature fed forward.
      const lateral = (targetD - d) * dir;
      const kappa = route.kappaAt(edge, s) * dir;
      const steer = 0.35 * lateral - 2.5 * yaw + (kappa * v * v) / 22;
      a.throttle = throttle;
      a.brake = brake;
      a.steer = clamp(steer, -1, 1);
    },
  };
}
