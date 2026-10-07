// Combat: the system's step (sim/combat), the code only a running race needs. It loads after the first
// screen, in the sim's step chunk (src/sim/late.ts; scripts/sim-chunk.mjs SIM_STEPS_TEST), and a race waits for
// it. ./index.ts keeps the system's state, its init, its tuning and what a snapshot reads (the menu's grid).
import { type EntityId, clamp, sin, nextFloat } from '../../core';
import { riderState, outPastEdge, riderLimits } from '../riders';
import { parkedBike } from '../tumble';
import { InputFlag, type SimConfig, type SimWeaponDef, type TakedownKind } from '../types';
import { type Mover, type World, emit, setSlowmo } from '../world';
import {
  aim,
  relative,
  BUMP_REACH_M,
  KICK_ID,
  weaponById,
  EPS,
  behaviourOf,
  PUNCH_ID,
  isLaw,
  SPENT,
  STOWED_H,
  candidates,
  STRAIGHT_KICK_D_M,
  isRiding,
  inReachHeight,
  CRASH_WEAPON_AHEAD_M,
  spawnPickup,
  takePickup,
  combatState,
  BUMP_AFTER_TICKS,
  type CombatState,
  type ActivePhase,
  type Flight,
} from './index';

const SIDE_BITS = InputFlag.attackSideLeft | InputFlag.attackSideRight;

/** The attacker/target total-mass ratio is clamped to this range before it scales a shove. */
const MASS_RATIO_MIN = 0.5;

const MASS_RATIO_MAX = 2;

/** hitImpulse = (data damage + peak shove m/s) / this, capped at 1. */
const HIT_IMPULSE_FULL = 40;

/** A rider picks up a weapon within this box: |Δs| ≤ 1 m (a tick at top speed is 0.63 m), |Δd| ≤ 1.5 m. */
export const PICKUP_S_M = 1;

export const PICKUP_D_M = 1.5;

/** Squared ground distance past which a rider is surely outside a pickup's box (6 m, m²). */
const PICKUP_NEAR_M2 = 36;

/** Riders higher than this above the road (mid-jump) fly over a pickup. */
const PICKUP_MAX_H = 1.5;

/** pickupHolder of a thrown weapon in the air (W-T): nobody holds it and nobody can pick it up. */
export const THROWN = -3;

/** A thrown weapon hits a rider within this box around it: |Δs| ≤ 1.2 m, |Δd| ≤ 0.9 m. [default] */
export const THROW_HIT_S_M = 1.2;

export const THROW_HIT_D_M = 0.9;

/** A thrown weapon can be snatched in its wind-up only from this close, m (its reach is its range). */
export const THROW_SNATCH_M = 1.6;

/** A thrown weapon leaves the hand this high, comes down to THROW_END_H and arcs THROW_ARC_M over. */
const THROW_START_H = 1.2;

const THROW_END_H = 0.2;

const THROW_ARC_M = 0.6;

function isPlayer(config: SimConfig, m: Mover): boolean {
  return config.riders[m.riderIndex]?.controller.kind === 'player';
}

function sideFlag(flags: number): number {
  const left = (flags & InputFlag.attackSideLeft) !== 0;
  const right = (flags & InputFlag.attackSideRight) !== 0;
  return left === right ? 0 : left ? -1 : 1;
}

/** Both side flags with the kick: the straight kick (playtest 2's directional kick). */
function straightFlag(flags: number): boolean {
  const both = InputFlag.attackSideLeft | InputFlag.attackSideRight;
  return (flags & InputFlag.kick) !== 0 && (flags & both) === both;
}

/**
 * An attack with no target yet aims again (playtest 4, the audit's F2): an auto-sided one picks the
 * nearest rider and his side once he is in the box, a forced side keeps its side and picks a target
 * on it, and the straight kick looks ahead again.
 */
function reAim(world: World, config: SimConfig, st: CombatState, a: Mover): void {
  if ((st.targetId[a.id] ?? -1) >= 0) return;
  const straight = st.straight[a.id] === true;
  const aimed = aim(world, config, a, straight ? 0 : (st.side[a.id] ?? 0), straight);
  st.targetId[a.id] = aimed.target;
  st.side[a.id] = aimed.side;
}

/** A kept press's flags, updated by this tick's: the kick sticks once asked for, the latest side wins. */
function keepFlags(kept: number, now: number): number {
  const sides = (now & SIDE_BITS) !== 0 ? now & SIDE_BITS : kept & SIDE_BITS;
  return ((kept | now) & InputFlag.kick) | sides;
}

/**
 * Keeps a player's press (the stagger queue, the press buffer). A new press replaces the one kept
 * before it (the latest press wins); its kick and side flags then keep updating while it waits.
 */
function keep(st: CombatState, id: EntityId, flags: number): void {
  st.pendingFlags[id] = keepFlags(0, flags);
  st.pending[id] = true;
}

/**
 * Aims an attack from this tick's flags: the straight kick, a forced side, or the auto side. A forced
 * side (a clear side swipe) also lets go of a rider the attack touched on the other side, so the bump
 * rule never lands it there (run A's check, punch item 5: a punch's bump carried into the kick).
 */
function setAim(world: World, config: SimConfig, st: CombatState, a: Mover, flags: number): void {
  const straight = straightFlag(flags);
  const forced = straight ? 0 : sideFlag(flags);
  const aimed = aim(world, config, a, forced, straight);
  st.straight[a.id] = straight;
  st.targetId[a.id] = aimed.target;
  st.side[a.id] = aimed.side;
  const bumped = world.movers[st.touched[a.id] ?? -1];
  if (forced !== 0 && bumped) {
    const rel = relative(config.road, a, bumped, BUMP_REACH_M + 2);
    if (!rel || forced * rel.dd < 0) st.touched[a.id] = -1;
  }
}

function durationOf(w: SimWeaponDef, phase: ActivePhase): number {
  if (phase === 'windup') return w.windupTicks;
  if (phase === 'active') return w.activeTicks;
  return w.recoveryTicks;
}

/** Starts a wind-up; `age` is where it starts (non-zero only for a kick conversion). */
function startAttack(
  world: World,
  st: CombatState,
  a: Mover,
  w: SimWeaponDef,
  cause: number | undefined,
  age = 0,
): void {
  const id = a.id;
  st.phase[id] = 'windup';
  st.weapon[id] = w.contentId;
  st.elapsed[id] = age;
  st.age[id] = age;
  st.calm[id] = 0;
  st.landed[id] = false;
  st.stealCued[id] = false;
  st.sweptSides[id] = 0;
  st.sweepFirst[id] = -1;
  const target = st.targetId[id] ?? -1;
  const extra: { target?: EntityId; causeId?: number } = {};
  if (target >= 0) extra.target = target;
  if (cause !== undefined) extra.causeId = cause;
  const straight = w.contentId === KICK_ID && st.straight[id] === true;
  st.cause[id] = emit(
    world,
    'attackStart',
    id,
    { weapon: w.contentId, side: st.side[id] ?? 1, ...(straight ? { straight } : {}) },
    extra,
  );
}

function endAttack(st: CombatState, id: EntityId): void {
  st.phase[id] = 'idle';
  st.straight[id] = false;
  st.weapon[id] = '';
  st.elapsed[id] = 0;
  st.targetId[id] = -1;
  st.touched[id] = -1;
}

/** Advances an attack by `ts` scaled ticks through as many phase ends as that covers. */
function advance(world: World, config: SimConfig, st: CombatState, a: Mover, ts: number): void {
  const id = a.id;
  const w = weaponById(config, st.weapon[id] ?? '');
  if (st.phase[id] === 'idle' || !w) return;
  st.elapsed[id] = (st.elapsed[id] ?? 0) + ts;
  st.age[id] = (st.age[id] ?? 0) + ts;
  for (;;) {
    const phase: ActivePhase = st.phase[id] ?? 'idle';
    if (phase === 'idle') return;
    const dur = durationOf(w, phase);
    const elapsed: number = st.elapsed[id] ?? 0;
    if (elapsed + EPS < dur) return;
    st.elapsed[id] = elapsed - dur;
    if (phase === 'windup') {
      st.phase[id] = 'active';
      // A charged weapon (the taser) spends a charge as the swing goes off.
      if (st.held[id] === w.contentId && w.charges != null) {
        spendUse(st.pickupCharges, st.heldPickup[id] ?? -1, w.charges);
      }
      // A thrown weapon (W-T) leaves the hand now; its flight decides the hit or the miss.
      if (st.held[id] === w.contentId && behaviourOf(w) === 'throw.burst') {
        launch(world, config, st, a, w);
        st.landed[id] = true;
      }
    } else if (phase === 'active') {
      // A bump in the riding phase of the tick the active moment ends still lands (the bump rule).
      if (!st.landed[id] && !landBump(world, config, st, a, w)) {
        const target = st.targetId[id] ?? -1;
        const extra: { target?: EntityId; causeId?: number } = { causeId: st.cause[id] ?? 0 };
        if (target >= 0) extra.target = target;
        // A taser's last charge, fired into thin air: it goes at the end of this swing.
        const left = st.pickupCharges[st.heldPickup[id] ?? -1];
        const spent = st.held[id] === w.contentId && w.charges != null && (left ?? w.charges) <= 0;
        emit(
          world,
          'attackMiss',
          id,
          { weapon: w.contentId, side: st.side[id] ?? 1, ...(spent ? { spent } : {}) },
          extra,
        );
      }
      st.phase[id] = 'recovery';
    } else {
      // A player's attack waits for nothing but its own recovery ([decided] "No wait").
      if (w.cooldownTicks > 0 && !isPlayer(config, a)) {
        st.cooldown[id] = w.cooldownTicks;
        st.cooldownWeapon[id] = w.contentId;
      }
      endAttack(st, id);
      // The swing that spent the last charge is over: the weapon is gone.
      const pid = st.heldPickup[id] ?? -1;
      if (st.held[id] === w.contentId && w.charges != null && (st.pickupCharges[pid] ?? w.charges) <= 0) {
        retire(world, st, a);
      }
      return;
    }
  }
}

/**
 * The weapon a request resolves to: the held weapon (or the punch, bare-handed), or the kick when
 * asked for. A kick still cooling down falls back to the held weapon or the punch.
 */
function resolveWeapon(
  config: SimConfig,
  st: CombatState,
  id: EntityId,
  wantKick: boolean,
): SimWeaponDef | undefined {
  const main = (st.held[id] ? weaponById(config, st.held[id]) : undefined) ?? weaponById(config, PUNCH_ID);
  if (!wantKick) return main;
  const cooling = (st.cooldown[id] ?? 0) > EPS && st.cooldownWeapon[id] === KICK_ID;
  return cooling ? main : (weaponById(config, KICK_ID) ?? main);
}

/** How a hit lands beyond the swing's defaults (W-T: a thrown weapon's hit, a sweep's second side). */
interface LandOptions {
  /** The cause id to carry (a thrown weapon's throw); absent: the attacker's current attack. */
  cause?: number;
  /** Extra `hit` event data. */
  extra?: Record<string, number | string | boolean>;
  /** Whether this hit spends a use of a held breakable (false: a sweep's second side, a throw). */
  spend?: boolean;
}

function land(
  world: World,
  config: SimConfig,
  st: CombatState,
  a: Mover,
  victim: Mover,
  w: SimWeaponDef,
  dd: number,
  opts: LandOptions = {},
): void {
  const riders = riderState(world);
  const id = a.id;
  const vid = victim.id;
  const thrown = opts.cause !== undefined;
  const cause = opts.cause ?? st.cause[id] ?? 0;
  // A thrown weapon's hit belongs to a throw already over, not to whatever its thrower does now.
  if (!thrown) st.landed[id] = true;
  st.calm[id] = 0;
  st.calm[vid] = 0;
  const kick = w.contentId === KICK_ID;
  // A cop's hit on a player lands soft (combat.copOnPlayerScale on its damage, shove and stun):
  // his swing is there to be snatched, and playtest 1 asked that the cop stay as hard as he was.
  const copSoft =
    isLaw(config, a) && isPlayer(config, victim)
      ? clamp(world.params['combat.copOnPlayerScale'] ?? 0.5, 0, 1)
      : 1;
  // Fight stats (playtest 2, "Visible personalities"): the attacker's power, the target's toughness.
  // Only in the player's fights; a rival's power reaches the player by combat.powerOnPlayer.
  const byPlayer = isPlayer(config, a);
  const hitOnPlayer = isPlayer(config, victim) && !byPlayer;
  const power = byPlayer
    ? statOf(config, a, 'power')
    : hitOnPlayer
      ? 1 + (statOf(config, a, 'power') - 1) * clamp(world.params['combat.powerOnPlayer'] ?? 0, 0, 1)
      : 1;
  const toughness = byPlayer || hitOnPlayer ? statOf(config, victim, 'toughness') : 1;
  const climb = hitOnPlayer ? levelClimb(world, config, a) : 1;
  const damage = Math.round(
    (w.damage * damageScale(world, config, a, victim, w) * copSoft * power * climb) / toughness,
  );
  const health = Math.max(0, (riders.health[vid] ?? 0) - damage);
  riders.health[vid] = health;
  // The shove along d, away from the attacker (the attack side when they are level).
  const away = (dd === 0 ? (st.side[id] ?? 1) || 1 : dd < 0 ? -1 : 1) * a.pos.dir;
  // The momentum kick (playtest 1 item 9): a player kicking while steering into the target adds
  // their own sideways speed toward it to the shove, × combat.momentumKickGain, capped. Players
  // only: rivals steer constantly, and with it their pack fights changed enough to halve the
  // grudge holders' swings at the player (playtest 1 item 7: rivals stay as they are).
  const surge = kick && isPlayer(config, a) ? momentum(world, a, away) : 0;
  const fullPeak = shovePeak(world, config, a, victim, w) + surge;
  // A rider's kick on a player shoves less, and any rider's hit on a player wobbles less
  // (combat.onPlayerScale): the kick's lane-wide shove and the wobble are new, and the playtest
  // asked that rivals stay as hard as they were. A punch or the pipe keeps M1's nudge.
  const onPlayer =
    isPlayer(config, victim) && !isPlayer(config, a) ? (world.params['combat.onPlayerScale'] ?? 1) : 1;
  const peak = fullPeak * (kick ? onPlayer : 1) * copSoft;
  // The jolt reads the weapon's data damage, not the knockdown-scaled one, so the feel of each blow
  // stays as it was while rivals go down sooner.
  const hitImpulse = Math.min(1, (w.damage * copSoft + fullPeak * copSoft) / HIT_IMPULSE_FULL);
  const effect = behaviourEffect(world, st, victim, w, copSoft);
  // A breakable held weapon spends one hit (the last one breaks it on this blow); a taser on its
  // last charge goes at the end of this swing. Either way the hit says `spent`.
  const heldSwing = !thrown && opts.spend !== false && st.held[id] === w.contentId;
  const pid = st.heldPickup[id] ?? -1;
  const breaks = heldSwing && w.durabilityHits != null && spendUse(st.pickupHits, pid, w.durabilityHits) <= 0;
  const spent =
    thrown || breaks || (heldSwing && w.charges != null && (st.pickupCharges[pid] ?? w.charges) <= 0);
  const knockTicks = Math.max(1, Math.round((world.params['combat.knockbackDecayS'] ?? 0.4) * 60));
  // The yank (W-T, the chain): the shove turns round and pulls the target toward the attacker, across
  // his line, to combat.yankPastM beyond it. A rival on your right comes out on your left: into the
  // oncoming lane when you ride on that side of him. The shove curve moves peak × ticks / 120 m.
  const yank = behaviourOf(w) === 'melee.yank';
  const yankM = yank ? Math.abs(dd) + Math.max(0, world.params['combat.yankPastM'] ?? 1.2) : 0;
  const resist = clamp(config.riders[victim.riderIndex]?.bike.knockbackResistance ?? 0, 0, 1);
  const yankPeak = ((yankM * 120) / knockTicks) * (1 - resist) * onPlayer * copSoft;
  emit(
    world,
    'hit',
    id,
    {
      weapon: w.contentId,
      damage,
      kick,
      ...(kick && st.straight[id] ? { straight: true } : {}),
      health,
      hitImpulse,
      ...effect,
      ...(yank ? { yank: true, yankM: Math.round((yankPeak * knockTicks * 1000) / 120) / 1000 } : {}),
      ...(spent ? { spent } : {}),
      ...opts.extra,
    },
    { target: vid, causeId: cause },
  );
  if (kick) emit(world, 'kick', id, { weapon: w.contentId }, { target: vid, causeId: cause });

  st.knockPeak[vid] = yank ? -away * yankPeak : away * peak;
  st.knockT[vid] = 0;
  st.knockTicks[vid] = knockTicks;
  // The stagger: no attacks, and the riders phase's wobble (less steering, a shaking bike). A
  // non-player's hit on a player locks his attacks for the wobble he feels (onPlayer), not the data
  // stagger behind it (run A's check, punch item 4), so the attack and the wobble end on one tick.
  const stagger = Math.round((w.staggerTicks * (world.params['combat.staggerScale'] ?? 1)) / toughness);
  const wobble = Math.round(stagger * onPlayer);
  st.stagger[vid] = Math.max(st.stagger[vid] ?? 0, wobble);
  if (wobble > 0) riders.wobble[vid] = Math.max(riders.wobble[vid] ?? 0, wobble);
  st.lastAttackerId[vid] = id;
  st.hitTick[vid] = world.tick;
  if (st.phase[vid] === 'windup') endAttack(st, vid);

  if (health <= 0) {
    endAttack(st, vid);
    emit(world, 'crash', vid, { reason: 'knockedOff', by: id }, { target: id, causeId: cause });
  }
  if (breaks) retire(world, st, a);

  if (isPlayer(config, a) || isPlayer(config, victim)) {
    const ticks = Math.round((w.hitStopMs * (world.params['combat.hitStopScale'] ?? 1) * 60) / 1000);
    if (ticks > 0) {
      if (st.hitStopTicks <= 0) st.resumeTimeScale = world.timeScale;
      st.hitStopTicks = Math.max(st.hitStopTicks, ticks);
      world.timeScale = 0;
    }
  }
}

/** A rider's fight stat (stats.toughness or stats.power), 1 when absent, kept to the schema's 0.5–2. */
function statOf(config: SimConfig, m: Mover, stat: 'toughness' | 'power'): number {
  return clamp(config.riders[m.riderIndex]?.[stat] ?? 1, 0.5, 2);
}

/**
 * The career's gentle climb (playtest 3, round 3 "Fights"): a rival's hit on the player times
 * 1 + (its field level's power scale - 1) × combat.levelPowerOnPlayer, kept at or under
 * combat.levelPowerMax. A rider with no level (free play, a cop, the player) or a level of 1 is 1,
 * so those fights and their hash are as they were. Below 1 (a region's first tier) the hit is softer.
 */
function levelClimb(world: World, config: SimConfig, a: Mover): number {
  const level = clamp(config.riders[a.riderIndex]?.levelPower ?? 1, 0.5, 2);
  if (level === 1) return 1;
  const gain = clamp(world.params['combat.levelPowerOnPlayer'] ?? 1, 0, 2);
  const max = clamp(world.params['combat.levelPowerMax'] ?? 1.15, 1, 1.5);
  return Math.min(1 + (level - 1) * gain, max);
}

/**
 * The knockdown scale on a hit's data damage (playtest 2): on a hit a PLAYER lands,
 * combat.unarmedDamageScale for the punch and the kick, combat.weaponDamageScale for a held weapon.
 * A non-player's hit on a player takes combat.onPlayerDamageScale (default 1, the data damage as
 * before: playtest 1 item 7 asked that rivals stay as hard as they were, and the complaint was
 * about knocking THEM down). Rivals' and cops' hits on each other keep their data damage: scaled,
 * the quicker rival-on-rival knock-offs cut a San Francisco player's cop-weapon steals from 8 races
 * in 10 to 4 (tests/sim/cops-steal-chance, minimum 5), and the maintainer's ask was the player's.
 */
function damageScale(world: World, config: SimConfig, a: Mover, victim: Mover, w: SimWeaponDef): number {
  const p = world.params;
  if (!isPlayer(config, a))
    return isPlayer(config, victim) ? Math.max(0, p['combat.onPlayerDamageScale'] ?? 1) : 1;
  return Math.max(
    0,
    w.unarmed ? (p['combat.unarmedDamageScale'] ?? 2) : (p['combat.weaponDamageScale'] ?? 2.5),
  );
}

/**
 * What a weapon's behaviour adds to a landed hit (after the shared swing's damage, before its shove
 * and stagger), returned as extra `hit` event data. The file header lists the behaviours.
 */
function behaviourEffect(
  world: World,
  st: CombatState,
  victim: Mover,
  w: SimWeaponDef,
  scale = 1,
): Record<string, number> {
  const p = world.params;
  const behaviour = behaviourOf(w);
  if (behaviour === 'melee.wrap' || behaviour === 'melee.yank') {
    const before = victim.speed;
    victim.speed = Math.max(0, before - Math.max(0, p['combat.wrapDragMps'] ?? 4));
    return { dragMps: Math.round((before - victim.speed) * 1000) / 1000 };
  }
  if (behaviour === 'taser.stun') {
    const ticks = Math.round((w.stunTicks ?? 0) * Math.max(0, p['combat.stunScale'] ?? 1) * scale);
    if (ticks <= 0) return {};
    const riders = riderState(world);
    st.stagger[victim.id] = Math.max(st.stagger[victim.id] ?? 0, ticks);
    riders.wobble[victim.id] = Math.max(riders.wobble[victim.id] ?? 0, ticks);
    victim.speed *= 1 - clamp(p['combat.stunSpeedLoss'] ?? 0.2, 0, 1) * scale;
    return { stunTicks: ticks };
  }
  return {};
}

/** Spends one use (a charge or a durability hit) of a pickup; returns what is left. */
function spendUse(left: number[], pid: EntityId, full: number): number {
  if (pid < 0) return full;
  const now = Math.max(0, (left[pid] ?? full) - 1);
  left[pid] = now;
  return now;
}

/** A used-up weapon leaves its holder's hand for good; its pickup stays stowed (SPENT). */
function retire(world: World, st: CombatState, holder: Mover): void {
  const pid = st.heldPickup[holder.id] ?? -1;
  st.held[holder.id] = '';
  st.heldPickup[holder.id] = -1;
  const pickup = world.movers[pid];
  if (!pickup) return;
  st.pickupHolder[pid] = SPENT;
  pickup.h = STOWED_H;
}

/**
 * The sweep (W-T, the campaign sign): one swing looks for a rider on each side through its whole
 * active moment, right side first, and lands once on each it finds (never twice on one rider). Each
 * is shoved away from the attacker; only the first landing spends a use of a breakable.
 */
function sweepTest(world: World, config: SimConfig, st: CombatState, a: Mover, w: SimWeaponDef): void {
  const id = a.id;
  for (const [side, bit] of [
    [1, 1],
    [-1, 2],
  ] as const) {
    const swept = st.sweptSides[id] ?? 0;
    if ((swept & bit) !== 0 || st.weapon[id] !== w.contentId || st.phase[id] !== 'active') continue;
    const first = st.sweepFirst[id] ?? -1;
    const inReach = candidates(world, config, a, w.reachSM, w.reachDM, side).filter((c) => c.id !== first);
    const pick = inReach.find((c) => c.id === st.targetId[id]) ?? inReach[0];
    const victim = pick ? world.movers[pick.id] : undefined;
    if (!pick || !victim) continue;
    st.sweptSides[id] = swept | bit;
    if (first < 0) st.sweepFirst[id] = pick.id;
    land(world, config, st, a, victim, w, pick.dd, { extra: { sweep: true }, spend: first < 0 });
  }
}

function hitTest(world: World, config: SimConfig, st: CombatState, a: Mover): void {
  const id = a.id;
  const w = weaponById(config, st.weapon[id] ?? '');
  if (w && st.phase[id] === 'active' && behaviourOf(w) === 'melee.sweep' && !w.unarmed) {
    sweepTest(world, config, st, a, w);
    return;
  }
  if (!w || st.phase[id] !== 'active' || st.landed[id]) return;
  // The straight kick reaches forward (combat.straightKickReachM) in its narrow box, either side.
  const inReach =
    w.contentId === KICK_ID && st.straight[id]
      ? candidates(
          world,
          config,
          a,
          w.reachSM,
          STRAIGHT_KICK_D_M,
          0,
          world.params['combat.straightKickReachM'] ?? 2,
        )
      : candidates(world, config, a, w.reachSM, w.reachDM, st.side[id] ?? 1);
  const pick = inReach.find((c) => c.id === st.targetId[id]) ?? inReach[0];
  const victim = pick ? world.movers[pick.id] : undefined;
  if (pick && victim) land(world, config, st, a, victim, w, pick.dd);
  else landBump(world, config, st, a, w);
}

/**
 * The bump rule: a rider this attack touched stays in its reach while he is within BUMP_REACH_M
 * along and across; lands on him and returns true, or returns false.
 */
function landBump(world: World, config: SimConfig, st: CombatState, a: Mover, w: SimWeaponDef): boolean {
  const bumped = world.movers[st.touched[a.id] ?? -1];
  if (!bumped || !isRiding(bumped) || (riderState(world).health[bumped.id] ?? 0) <= 0) return false;
  if (!inReachHeight(world, a, bumped)) return false;
  const rel = relative(config.road, a, bumped, BUMP_REACH_M + 2);
  if (!rel || Math.abs(rel.ds) > BUMP_REACH_M || Math.abs(rel.dd) > BUMP_REACH_M) return false;
  land(world, config, st, a, bumped, w, rel.dd);
  return true;
}

/**
 * The rider a player's attack touched from tick `since` to this one (the riding phase's contact,
 * which ran before this phase), or -1: the attack's target first, else a rider on its side (any
 * side when it has none; the rider ahead for the straight kick).
 */
function touchedSince(world: World, config: SimConfig, st: CombatState, a: Mover, since: number): EntityId {
  const contact = riderState(world).contactTick ?? {};
  const target = st.targetId[a.id] ?? -1;
  const side = st.side[a.id] ?? 0;
  let found = -1;
  for (const o of world.movers) {
    if (o.id === a.id || !isRiding(o)) continue;
    const key = a.id < o.id ? `${a.id}-${o.id}` : `${o.id}-${a.id}`;
    const at = contact[key];
    if (at === undefined || at < since || at > world.tick) continue;
    if (o.id === target) return o.id;
    if (found >= 0 || target >= 0) continue;
    const rel = relative(config.road, a, o, BUMP_REACH_M + 2);
    if (!rel) continue;
    const onSide = st.straight[a.id] ? rel.ds > 0 : side === 0 || side * rel.dd >= 0;
    if (onSide) found = o.id;
  }
  return found;
}

function totalMass(config: SimConfig, m: Mover): number {
  const def = config.riders[m.riderIndex];
  return def ? def.massKg + def.bike.massKg : 1;
}

/** A landed hit's peak shove speed, m/s (unsigned): the file header gives the formula. */
function shovePeak(world: World, config: SimConfig, a: Mover, victim: Mover, w: SimWeaponDef): number {
  const p = world.params;
  const kickScale = w.contentId === KICK_ID ? (p['combat.kickShoveScale'] ?? 1) : 1;
  const ratio = clamp(totalMass(config, a) / totalMass(config, victim), MASS_RATIO_MIN, MASS_RATIO_MAX);
  const power = config.riders[a.riderIndex]?.bike.hitPowerScale ?? 1;
  const resist = clamp(config.riders[victim.riderIndex]?.bike.knockbackResistance ?? 0, 0, 1);
  const peak = w.knockbackMps * (p['combat.knockbackScale'] ?? 1) * kickScale * ratio * power * (1 - resist);
  return Math.max(0, peak);
}

function endShove(st: CombatState, id: EntityId): void {
  st.knockPeak[id] = 0;
  st.knockT[id] = 0;
}

/**
 * Moves shoved riders sideways by `ts` scaled ticks of their shove curve (speed peak·(1 − t/N)
 * over N ticks, integrated exactly, so the distance does not depend on the time scale) and keeps
 * them inside the drivable limits; reaching a limit ends the shove.
 */
function slide(world: World, config: SimConfig, st: CombatState, ts: number): void {
  for (const m of world.movers) {
    const peak = st.knockPeak[m.id] ?? 0;
    if (peak === 0) continue;
    if (!isRiding(m)) {
      endShove(st, m.id);
      continue;
    }
    if (ts <= 0) continue;
    const n = st.knockTicks[m.id] ?? 1;
    const t0 = st.knockT[m.id] ?? 0;
    const t1 = Math.min(n, t0 + ts);
    const d = m.pos.d + (peak / 60) * (t1 - t0 - (t1 * t1 - t0 * t0) / (2 * n));
    // The riders' limits: the lanes' edges, or the verge's with off-road on (run W-R), so a kick
    // can send a rider onto the verge and never snaps one riding there back onto the road.
    // A rider out past its road's edge in the air (over the barrier) has no edge to stop at.
    const { lo, hi } = outPastEdge(world, m.id)
      ? { lo: -Infinity, hi: Infinity }
      : riderLimits(world, config, m.pos.edge, m.pos.s, m.pos.d);
    m.pos.d = clamp(d, lo, hi);
    st.knockT[m.id] = t1;
    if (m.pos.d !== d || t1 >= n - EPS) endShove(st, m.id);
  }
}

/** Whether another riding rider is within `rangeM` of `m` along the road (either way). */
function riderNear(world: World, config: SimConfig, m: Mover, rangeM: number): boolean {
  for (const o of world.movers) {
    if (o.id === m.id || !isRiding(o)) continue;
    const rel = relative(config.road, m, o, rangeM + 2);
    if (rel && Math.abs(rel.ds) <= rangeM) return true;
  }
  return false;
}

/**
 * Out-of-combat recovery: whole points into a player's health once they have been calm long
 * enough, clear of other riders. Players only: the product spec's "back off until your energy is
 * restored" is the player's, and rivals and the cop keep M1's durability. Both limits came from
 * the fighting dev bot's cop busts on the 50-seed batch: 9 with no recovery, 14 when everyone
 * healed, 15 when the player healed while still riding in the pack.
 */
function recover(world: World, config: SimConfig, st: CombatState, ts: number): void {
  const health = riderState(world).health;
  const delay = Math.round((world.params['combat.regenDelayS'] ?? 5) * 60);
  const rate = world.params['combat.regenPerS'] ?? 3;
  const clearM = world.params['combat.regenClearM'] ?? 15;
  for (const m of world.movers) {
    if (m.kind !== 'rider' || !isPlayer(config, m)) continue;
    // Backing off counts only once no other riding rider is within clearM along the road.
    if (clearM > 0 && isRiding(m) && riderNear(world, config, m, clearM)) st.calm[m.id] = 0;
    const calm = (st.calm[m.id] ?? 0) + ts;
    st.calm[m.id] = calm;
    const max = config.riders[m.riderIndex]?.healthMax ?? 0;
    const hp = health[m.id] ?? 0;
    if (!isRiding(m) || hp <= 0 || hp >= max || calm + EPS < delay) {
      st.regenAcc[m.id] = 0;
      continue;
    }
    let acc = (st.regenAcc[m.id] ?? 0) + rate * ts;
    const whole = Math.floor((acc + EPS) / 60);
    acc -= whole * 60;
    st.regenAcc[m.id] = acc;
    if (whole > 0) health[m.id] = Math.min(max, hp + whole);
  }
}

/**
 * The momentum kick's extra shove speed, m/s: the kicker's sideways speed along d toward the
 * target (`away` is the shove's d sign), × combat.momentumKickGain, capped at
 * combat.momentumKickMaxMps. Steering away adds nothing.
 */
function momentum(world: World, a: Mover, away: number): number {
  const toward = a.pos.dir * a.speed * sin(a.yaw) * away;
  const gain = world.params['combat.momentumKickGain'] ?? 1;
  const max = world.params['combat.momentumKickMaxMps'] ?? 8;
  return clamp(gain * Math.max(0, toward), 0, Math.max(0, max));
}

// ---- Takedowns and the slow motion (M2 combat-4) ---------------------------------------------

/** How a fall counts: the finishing hit, a moving hazard, or anything else in the way. */
function takedownKind(data: Readonly<Record<string, unknown>>): TakedownKind {
  if (data['reason'] === 'knockedOff') return 'health';
  const cause = data['cause'];
  return cause === 'traffic' || cause === 'ped' || cause === 'tumble' ? 'traffic' : 'scenery';
}

/**
 * Credits last tick's falls (world.lastEvents: every phase's crashes, traffic's and tumble's
 * included, which run after this one). A rider's first crash of a fall is a takedown for its
 * lastAttackerId when that rider's hit landed within combat.takedownWindowS (raw ticks, from the
 * hit to the crash). A crash whose data.contact is `tumble` (a body already down touching a car)
 * never counts. The takedown carries the crash's causeId, one tick after the crash.
 */
function creditTakedowns(world: World, config: SimConfig, st: CombatState): void {
  for (const m of world.movers) {
    if (m.kind !== 'rider' || !isRiding(m)) continue;
    st.downSeen[m.id] = false;
    st.fallBy[m.id] = -1;
    st.fallChain[m.id] = 0;
  }
  const window = Math.round((world.params['combat.takedownWindowS'] ?? 2) * 60);
  for (const e of world.lastEvents) {
    if (e.type !== 'crash' || e.data['contact'] === 'tumble') continue;
    const victim = world.movers[e.actor];
    if (!victim || victim.kind !== 'rider' || isRiding(victim) || st.downSeen[victim.id]) continue;
    st.downSeen[victim.id] = true;
    let by = st.lastAttackerId[victim.id] ?? -1;
    const hitAt = st.hitTick[victim.id] ?? -1;
    let chain = 1;
    // A knock-off another system made and named its rider for (the riders' landing hit, the pitch
    // deck's #13): that rider is credited, as for combat's own finishing hit.
    const knocker = e.data['reason'] === 'knockedOff' ? (e.target ?? -1) : -1;
    if (knocker >= 0 && knocker !== victim.id && world.movers[knocker]?.kind === 'rider') by = knocker;
    else if (by < 0 || by === victim.id || hitAt < 0 || e.tick - hitAt > window) {
      // Domino credit: knocked off by a flying body whose own fall someone was credited with.
      const body = e.data['cause'] === 'tumble' ? (e.target ?? -1) : -1;
      by = body >= 0 ? (st.fallBy[body] ?? -1) : -1;
      if (by < 0 || by === victim.id) continue;
      chain = (st.fallChain[body] ?? 1) + 1;
    }
    st.fallBy[victim.id] = by;
    st.fallChain[victim.id] = chain;
    const kind = chain > 1 ? 'traffic' : takedownKind(e.data);
    st.takedowns[by] = (st.takedowns[by] ?? 0) + 1;
    const extra: { target: EntityId; causeId?: number } = { target: victim.id };
    if (e.causeId !== undefined) extra.causeId = e.causeId;
    const cause = emit(world, 'takedown', by, chain > 1 ? { kind, domino: chain } : { kind }, extra);
    const attacker = world.movers[by];
    const playerInvolved = isPlayer(config, victim) || (attacker !== undefined && isPlayer(config, attacker));
    if (kind !== 'health' && playerInvolved && config.slowMo) startSlowmo(world, st, by, victim.id, cause);
  }
}

/**
 * The in-flow slow motion on a big, player-involved takedown: combat.slowmoScale for
 * combat.slowmoS of raw ticks, unless one started within combat.slowmoCooldownS. It starts on the
 * takedown's tick, after this phase's own step time was taken, so every phase sees the same count
 * of slow ticks. During a hit-stop it takes over the scale the hit-stop restores.
 */
function startSlowmo(world: World, st: CombatState, actor: EntityId, target: EntityId, cause: number): void {
  const sm = st.slowmo;
  const cooldown = Math.round((world.params['combat.slowmoCooldownS'] ?? 8) * 60);
  if (world.facts.slowmo.remainingTicks > 0) return;
  if (sm.startTick >= 0 && world.tick - sm.startTick < cooldown) return;
  const ticks = Math.max(1, Math.round((world.params['combat.slowmoS'] ?? 0.8) * 60));
  const scale = world.params['combat.slowmoScale'] ?? 0.3;
  st.slowmo = { actor, target, cause, resume: 1, startTick: world.tick };
  if (st.hitStopTicks > 0) {
    st.slowmo.resume = st.resumeTimeScale;
    st.resumeTimeScale = scale;
  } else {
    st.slowmo.resume = world.timeScale;
    world.timeScale = scale;
  }
  setSlowmo(world, ticks);
  emit(world, 'slowmoStart', actor, { ticks, timeScale: scale }, { target, causeId: cause });
}

/** Counts the slow motion down on ticks the world moved, and ends it (restoring the scale). */
function stepSlowmo(world: World, st: CombatState, frozenAtStart: boolean): void {
  const left = world.facts.slowmo.remainingTicks;
  const sm = st.slowmo;
  if (left <= 0 || frozenAtStart || sm.startTick === world.tick) return;
  setSlowmo(world, left - 1);
  if (left - 1 > 0) return;
  // A hit-stop that began this tick restores the scale the slow motion leaves behind.
  if (st.hitStopTicks > 0) st.resumeTimeScale = sm.resume;
  else world.timeScale = sm.resume;
  emit(world, 'slowmoEnd', sm.actor, {}, { target: sm.target, causeId: sm.cause });
}

/** A roadside weapon by roadsideWeight from the `combat` stream (one draw), or null when none. */
function drawRoadside(world: World, config: SimConfig): SimWeaponDef | null {
  const pool = config.weapons.filter((w) => !w.unarmed && Math.max(0, w.roadsideWeight ?? 1) > 0);
  const total = pool.reduce((sum, w) => sum + Math.max(0, w.roadsideWeight ?? 1), 0);
  let r = nextFloat(world.rng.combat) * total;
  if (total <= 0) return null;
  return pool.find((w) => (r -= Math.max(0, w.roadsideWeight ?? 1)) < 0) ?? pool[pool.length - 1] ?? null;
}

/**
 * Last tick's player get-ups (tumble runs after this phase): with combat.crashWeaponChance, and only
 * for a player with empty hands, a roadside weapon by the parked bike. Two draws per player get-up,
 * always (the chance, then the weapon), so the stream stays aligned whatever the outcome.
 */
function crashWeapons(world: World, config: SimConfig, st: CombatState): void {
  const chance = clamp(world.params['combat.crashWeaponChance'] ?? 0.3, 0, 1);
  for (const e of world.lastEvents) {
    if (e.type !== 'getUp') continue;
    const m = world.movers[e.actor];
    if (!m || m.kind !== 'rider' || !isPlayer(config, m)) continue;
    const roll = nextFloat(world.rng.combat);
    const w = drawRoadside(world, config);
    const bike = parkedBike(world, m.id);
    if (!w || !bike || roll >= chance || st.held[m.id]) continue;
    const spot = { ...bike };
    config.road.advance(Object.assign(spot, { s: spot.s + CRASH_WEAPON_AHEAD_M * spot.dir }));
    spawnPickup(world, w.contentId, spot);
  }
}

// ---- Thrown weapons (W-T, `throw.burst`: Kevin's briefcase) ---------------------------------

/**
 * The throw: the held weapon leaves the hand as its own pickup entity, at THROW_START_H, moving
 * along the road at the thrower's speed plus combat.throwSpeedMps. It is aimed at the nearest
 * rider ahead within the weapon's reach box (reach.sM ahead, reach.dM either side; the current
 * target first), drifting across to his d by the time it would close the gap; with nobody there
 * it flies straight. It flies for reach.sM / throw speed and comes down at THROW_END_H.
 */
function launch(world: World, config: SimConfig, st: CombatState, a: Mover, w: SimWeaponDef): void {
  const id = a.id;
  const pid = st.heldPickup[id] ?? -1;
  const pickup = world.movers[pid];
  st.held[id] = '';
  st.heldPickup[id] = -1;
  if (!pickup) return;
  const throwMps = Math.max(1, world.params['combat.throwSpeedMps'] ?? 16);
  const ahead = candidates(world, config, a, 0, w.reachDM, 0, w.reachSM);
  const aim = ahead.find((c) => c.id === st.targetId[id]) ?? ahead[0];
  const victim = aim ? world.movers[aim.id] : undefined;
  const rel = victim ? relative(config.road, a, victim, w.reachSM + 2) : null;
  const dTo = rel ? a.pos.d + rel.dd * a.pos.dir : a.pos.d;
  const reachTicks = rel ? Math.max(1, (Math.max(0, rel.ds) / throwMps) * 60) : 1;
  pickup.pos.edge = a.pos.edge;
  pickup.pos.s = a.pos.s;
  pickup.pos.d = a.pos.d;
  pickup.pos.dir = a.pos.dir;
  pickup.h = THROW_START_H;
  pickup.speed = a.speed + throwMps;
  st.pickupHolder[pid] = THROWN;
  st.flights.push({
    pickup: pid,
    by: id,
    cause: st.cause[id] ?? 0,
    weapon: w.contentId,
    speed: pickup.speed,
    dTo,
    dStep: Math.abs(dTo - a.pos.d) / reachTicks,
    age: 0,
    ticks: Math.max(6, Math.round((w.reachSM / throwMps) * 60)),
  });
  // The release (the `throw` event): the thrower's hands are empty from this tick.
  const extra: { target?: EntityId; causeId: number } = { causeId: st.cause[id] ?? 0 };
  if (victim) extra.target = victim.id;
  emit(world, 'throw', id, { weapon: w.contentId, pickup: pid }, extra);
}

/** Where a thrown weapon bursts, in world metres (render's paperwork), rounded to centimetres. */
function burstAt(config: SimConfig, m: Mover): { burstX: number; burstY: number; burstZ: number } {
  const p = config.road.toWorld(m.pos.edge, m.pos.s, m.pos.d, Math.max(0, m.h));
  const cm = (v: number) => Math.round(v * 100) / 100;
  return { burstX: cm(p.x), burstY: cm(p.y), burstZ: cm(p.z) };
}

/**
 * Moves thrown weapons by `ts` scaled ticks (none during a hit-stop). The first riding rider other
 * than the thrower inside the THROW_HIT box takes the hit (the nearest, then the lowest id), and the
 * weapon bursts (`hit` with `thrown`, `burst` and the burst point); one that flies its length, or
 * off the end of the road, bursts where it lands (`attackMiss`, the same data). Either way it is
 * gone for the race (SPENT), and both events carry the throw's cause id.
 */
function flyPass(world: World, config: SimConfig, st: CombatState, ts: number): void {
  if (ts <= 0 || st.flights.length === 0) return;
  const health = riderState(world).health;
  const left: Flight[] = [];
  for (const f of st.flights) {
    const pickup = world.movers[f.pickup];
    const thrower = world.movers[f.by];
    const w = weaponById(config, f.weapon);
    if (!pickup || !thrower || !w) continue;
    f.age += ts;
    pickup.pos.s += pickup.pos.dir * f.speed * (ts / 60);
    const end = config.road.advance(pickup.pos);
    const step = f.dStep * ts;
    pickup.pos.d += clamp(f.dTo - pickup.pos.d, -step, step);
    const u = clamp(f.age / f.ticks, 0, 1);
    pickup.h = THROW_START_H + (THROW_END_H - THROW_START_H) * u + 4 * THROW_ARC_M * u * (1 - u);
    let best: { m: Mover; dd: number; dist2: number } | null = null;
    for (const m of world.movers) {
      if (m.id === f.by || !isRiding(m) || (health[m.id] ?? 0) <= 0) continue;
      const rel = relative(config.road, pickup, m, THROW_HIT_S_M + 2);
      if (!rel || Math.abs(rel.ds) > THROW_HIT_S_M || Math.abs(rel.dd) > THROW_HIT_D_M) continue;
      const dist2 = rel.ds * rel.ds + rel.dd * rel.dd;
      if (!best || dist2 < best.dist2) best = { m, dd: rel.dd, dist2 };
    }
    if (best) {
      // The shove goes away from the thrower's side of the target.
      const side = relative(config.road, thrower, best.m, w.reachSM + 4);
      const dd = side && side.dd !== 0 ? side.dd : best.dd;
      const extra = { thrown: true, burst: true, ...burstAt(config, pickup) };
      land(world, config, st, thrower, best.m, w, dd, { cause: f.cause, extra });
      bury(st, pickup);
      continue;
    }
    if (u >= 1 - EPS || end === 'deadEnd') {
      const data = {
        weapon: f.weapon,
        side: 1,
        thrown: true,
        burst: true,
        spent: true,
        ...burstAt(config, pickup),
      };
      emit(world, 'attackMiss', f.by, data, { causeId: f.cause });
      bury(st, pickup);
      continue;
    }
    left.push(f);
  }
  st.flights = left;
}

/** A burst thrown weapon is gone for the race: stowed out of sight, never picked up again. */
function bury(st: CombatState, pickup: Mover): void {
  st.pickupHolder[pickup.id] = SPENT;
  pickup.h = STOWED_H;
  pickup.speed = 0;
}

/** Puts a held weapon back on the road where its holder is. */
function dropWeapon(world: World, config: SimConfig, st: CombatState, holder: Mover): void {
  const pid = st.heldPickup[holder.id] ?? -1;
  // A taser whose last charge went off in the swing the wreck cut short is spent, not dropped.
  const w = weaponById(config, st.held[holder.id] ?? '');
  if (w?.charges != null && (st.pickupCharges[pid] ?? w.charges) <= 0) {
    retire(world, st, holder);
    return;
  }
  const pickup = world.movers[pid];
  st.held[holder.id] = '';
  st.heldPickup[holder.id] = -1;
  if (!pickup) return;
  st.pickupHolder[pid] = -1;
  const edge = config.road.edges[holder.pos.edge];
  pickup.pos.edge = holder.pos.edge;
  pickup.pos.s = edge ? clamp(holder.pos.s, 0, edge.length) : holder.pos.s;
  pickup.pos.d = edge ? clamp(holder.pos.d, edge.dMin + 0.5, edge.dMax - 0.5) : holder.pos.d;
  pickup.pos.dir = holder.pos.dir;
  pickup.h = 0;
}

/** Whether a rider may take a weapon now: riding, conscious, empty-handed, and not a cop. */
function canTake(world: World, config: SimConfig, st: CombatState, m: Mover): boolean {
  return isRiding(m) && (riderState(world).health[m.id] ?? 0) > 0 && !st.held[m.id] && !isLaw(config, m);
}

/**
 * Whether a rider may steal now: riding, conscious and not a cop. Full hands are fine: the thief
 * drops what he holds and takes the swung weapon (the W-O polish run, [default]).
 */
function canSteal(world: World, config: SimConfig, m: Mover): boolean {
  return isRiding(m) && (riderState(world).health[m.id] ?? 0) > 0 && !isLaw(config, m);
}

/** Whether `holder` is winding up its held weapon (not a kick it switched to). */
function swingingHeld(st: CombatState, holder: Mover): boolean {
  const id = holder.id;
  return st.phase[id] === 'windup' && !!st.held[id] && st.weapon[id] === st.held[id];
}

/**
 * The steal pass, before any attack advances this tick. `pressed` marks the riders whose attack
 * press rose this tick; a steal consumes the thief's press. The wind-up's age this tick is its
 * elapsed scaled time plus this tick's timeScale: on tick T + k of a wind-up started on tick T,
 * it is k at timeScale 1.
 */
function stealPass(world: World, config: SimConfig, st: CombatState, pressed: boolean[], ts: number): void {
  for (const thief of world.movers) {
    if (thief.kind !== 'rider' || !pressed[thief.id]) continue;
    if (st.phase[thief.id] !== 'idle' || (st.stagger[thief.id] ?? 0) > EPS) continue;
    if (!canSteal(world, config, thief)) continue;
    let best: { holder: Mover; mine: boolean; dist2: number } | null = null;
    for (const holder of world.movers) {
      if (holder.id === thief.id || holder.kind !== 'rider' || !isRiding(holder)) continue;
      if (!swingingHeld(st, holder) || !inReachHeight(world, holder, thief)) continue;
      const w = weaponById(config, st.held[holder.id] ?? '');
      if (!w?.steal) continue;
      const age = (st.elapsed[holder.id] ?? 0) + ts;
      if (age + EPS < w.steal.startTick || age - EPS > w.steal.endTick) continue;
      // The thief must be where the weapon is going: inside the holder's reach box, either side. A
      // thrown weapon's reach is its throw range, so its snatch box stays at arm's length (W-T).
      const thrownW = behaviourOf(w) === 'throw.burst';
      const boxS = thrownW ? Math.min(w.reachSM, THROW_SNATCH_M) : w.reachSM;
      const boxD = thrownW ? Math.min(w.reachDM, THROW_SNATCH_M) : w.reachDM;
      const rel = relative(config.road, holder, thief, boxS + 2);
      if (!rel || Math.abs(rel.ds) > boxS || Math.abs(rel.dd) > boxD) continue;
      const mine = st.targetId[holder.id] === thief.id;
      const dist2 = rel.ds * rel.ds + rel.dd * rel.dd;
      if (!best || (mine && !best.mine) || (mine === best.mine && dist2 < best.dist2)) {
        best = { holder, mine, dist2 };
      }
    }
    if (!best) continue;
    const hid = best.holder.id;
    const weapon = st.held[hid] ?? '';
    const age = (st.elapsed[hid] ?? 0) + ts;
    const cause = st.cause[hid] ?? 0;
    const pickup = world.movers[st.heldPickup[hid] ?? -1];
    st.held[hid] = '';
    st.heldPickup[hid] = -1;
    endAttack(st, hid);
    // Full hands: the thief lets go of his own weapon where he is (it lies on the road again).
    const dropped = st.held[thief.id] ?? '';
    if (dropped) dropWeapon(world, config, st, thief);
    if (pickup) takePickup(st, thief, pickup);
    else st.held[thief.id] = weapon;
    pressed[thief.id] = false;
    const data: Record<string, string | number> = {
      weapon,
      source: 'steal',
      windupTick: Math.round(age * 1000) / 1000,
    };
    if (dropped) data['dropped'] = dropped;
    emit(world, 'weaponGrab', thief.id, data, { target: hid, causeId: cause });
  }
}

/** Emits the steal cue once per attack, on the tick a held weapon's wind-up reaches its window. */
function stealCue(world: World, config: SimConfig, st: CombatState, a: Mover): void {
  const id = a.id;
  if (st.stealCued[id] || !swingingHeld(st, a)) return;
  const w = weaponById(config, st.held[id] ?? '');
  if (!w?.steal || (st.elapsed[id] ?? 0) + EPS < w.steal.startTick) return;
  st.stealCued[id] = true;
  const extra: { target?: EntityId; causeId?: number } = { causeId: st.cause[id] ?? 0 };
  const target = st.targetId[id] ?? -1;
  if (target >= 0) extra.target = target;
  const ticks = w.steal.endTick - w.steal.startTick + 1;
  emit(world, 'stealWindow', id, { weapon: w.contentId, ticks }, extra);
}

/** Wrecked holders drop their weapon; then empty-handed riders pick up what lies on the road. */
function pickupPass(world: World, config: SimConfig, st: CombatState): void {
  const health = riderState(world).health;
  for (const m of world.movers) {
    // A cop keeps his weapon through a wreck (holstered): you get it only by snatching it mid-swing.
    if (m.kind === 'rider' && isLaw(config, m)) continue;
    if (m.kind === 'rider' && st.held[m.id] && (!isRiding(m) || (health[m.id] ?? 0) <= 0)) {
      dropWeapon(world, config, st, m);
    }
  }
  // Who could take one this tick, with their ground points: a cheap world-distance check skips the
  // road-frame test (relative(), which walks junction neighbours) for every pickup far away. W-Q laid
  // one every 500 m, and without this the batch's race step ran about 25 % slower.
  const takers: { m: Mover; x: number; z: number }[] = [];
  for (const m of world.movers) {
    if (m.kind !== 'rider' || m.h > PICKUP_MAX_H || !canTake(world, config, st, m)) continue;
    const w = config.road.toWorld(m.pos.edge, m.pos.s, m.pos.d, 0);
    takers.push({ m, x: w.x, z: w.z });
  }
  if (takers.length === 0) return;
  for (const pid of st.pickups) {
    const pickup = world.movers[pid];
    if (!pickup || (st.pickupHolder[pid] ?? -1) !== -1) continue;
    const at = config.road.toWorld(pickup.pos.edge, pickup.pos.s, pickup.pos.d, 0);
    let best: { rider: Mover; dist2: number } | null = null;
    for (const { m, x, z } of takers) {
      // Took one earlier this tick: one weapon per hand, the other stays on the road.
      if (st.held[m.id]) continue;
      if ((x - at.x) * (x - at.x) + (z - at.z) * (z - at.z) > PICKUP_NEAR_M2) continue;
      const rel = relative(config.road, m, pickup, PICKUP_S_M + 2);
      if (!rel || Math.abs(rel.ds) > PICKUP_S_M || Math.abs(rel.dd) > PICKUP_D_M) continue;
      const dist2 = rel.ds * rel.ds + rel.dd * rel.dd;
      if (!best || dist2 < best.dist2) best = { rider: m, dist2 };
    }
    if (!best) continue;
    const weapon = st.pickupWeapon[pid] ?? '';
    takePickup(st, best.rider, pickup);
    emit(world, 'weaponGrab', best.rider.id, { weapon, source: 'road' }, { target: pid });
  }
}

/**
 * The kick flag on an attack that is not a kick: converts it while it is in its wind-up, or while
 * it is inside the kick-conversion window (keeping its age); the file header has the rule.
 */
function convertToKick(world: World, config: SimConfig, st: CombatState, a: Mover, flags: number): boolean {
  const id = a.id;
  const age = st.age[id] ?? 0;
  const window = Math.round(((world.params['combat.kickConvertMs'] ?? 250) * 60) / 1000);
  const early = age <= window + EPS;
  if (!early && st.phase[id] !== 'windup') return false;
  const kick = resolveWeapon(config, st, id, true);
  if (!kick || kick.contentId !== KICK_ID) return false;
  const carried = early ? Math.min(age, Math.max(0, kick.windupTicks - 1)) : 0;
  // A swipe that asks for the straight kick re-aims the converted kick at the rider ahead.
  if (straightFlag(flags)) setAim(world, config, st, a, flags);
  startAttack(world, st, a, kick, st.cause[id], carried);
  return true;
}

export function combatStep(world: World, config: SimConfig): void {
  const st = combatState(world);
  const frozenAtStart = st.hitStopTicks > 0;
  const ts = world.timeScale;
  // Last tick's falls first: a takedown (and its slow motion, from the phases after this one).
  creditTakedowns(world, config, st);
  crashWeapons(world, config, st);
  slide(world, config, st, ts);
  const health = riderState(world).health;

  // Press edges first, for everyone, so the steal pass sees every thief before any attack moves.
  const pressed: boolean[] = [];
  for (const a of world.movers) {
    if (a.kind !== 'rider') continue;
    const flags = world.inputs[a.id]?.flags ?? 0;
    pressed[a.id] = (flags & ~(st.prevFlags[a.id] ?? 0) & InputFlag.attack) !== 0;
    st.prevFlags[a.id] = flags;
    st.cooldown[a.id] = Math.max(0, (st.cooldown[a.id] ?? 0) - ts);
    st.stagger[a.id] = Math.max(0, (st.stagger[a.id] ?? 0) - ts);
  }
  stealPass(world, config, st, pressed, ts);

  for (const a of world.movers) {
    if (a.kind !== 'rider') continue;
    const id = a.id;
    const flags = world.inputs[id]?.flags ?? 0;

    if (!isRiding(a) || (health[id] ?? 0) <= 0) {
      if (st.phase[id] !== 'idle') endAttack(st, id);
      st.pending[id] = false;
      st.pendingFlags[id] = 0;
      continue;
    }
    const player = isPlayer(config, a);
    // The bump rule: remember the rider a player's attack touched in this tick's riding phase,
    // while it was winding up or out (his target, once touched, stays the one).
    if (player && (st.phase[id] === 'windup' || st.phase[id] === 'active') && !st.landed[id]) {
      const touched = touchedSince(world, config, st, a, world.tick);
      const was = st.touched[id] ?? -1;
      if (touched >= 0 && (was < 0 || was !== st.targetId[id])) st.touched[id] = touched;
    }
    advance(world, config, st, a, ts);
    stealCue(world, config, st, a);

    const wantKick = (flags & InputFlag.kick) !== 0;
    const override = sideFlag(flags);
    if (st.phase[id] === 'idle') {
      const staggered = (st.stagger[id] ?? 0) > EPS;
      // A player's press while staggered is kept and starts the attack as the stagger ends
      // (combat-3). AI controllers press again when they want to, so theirs is dropped as in M1.
      if (pressed[id] && staggered && player) keep(st, id, flags);
      if ((pressed[id] || st.pending[id]) && !staggered) {
        // A kept press starts with its own kick and side flags, updated by this tick's.
        const f = st.pending[id]
          ? (flags & ~(InputFlag.kick | SIDE_BITS)) | keepFlags(st.pendingFlags[id] ?? 0, flags)
          : flags;
        st.pending[id] = false;
        st.pendingFlags[id] = 0;
        const w = resolveWeapon(config, st, id, (f & InputFlag.kick) !== 0);
        if (w) {
          setAim(world, config, st, a, w.contentId === KICK_ID ? f : f & ~InputFlag.kick);
          // The bump rule reaches back: a bump just before a player's press is this attack's own.
          st.touched[id] = player ? touchedSince(world, config, st, a, world.tick - BUMP_AFTER_TICKS) : -1;
          startAttack(world, st, a, w, undefined);
        }
      }
    } else if (st.phase[id] === 'windup') {
      // The side and kick flags may still change the attack until the active moment starts: a
      // new forced side, or the straight kick asked for on a kick's wind-up.
      const straightNow = st.weapon[id] === KICK_ID && straightFlag(flags);
      if (straightNow && !st.straight[id]) setAim(world, config, st, a, flags);
      else if (override !== 0 && (override !== st.side[id] || st.straight[id])) {
        setAim(
          world,
          config,
          st,
          a,
          flags & ~(override < 0 ? InputFlag.attackSideRight : InputFlag.attackSideLeft),
        );
      } else reAim(world, config, st, a);
    }
    const converted =
      st.phase[id] !== 'idle' &&
      wantKick &&
      st.weapon[id] !== KICK_ID &&
      convertToKick(world, config, st, a, flags);
    // The press buffer: a player's press anywhere in a recovery (one the kick conversion did not
    // take) is kept; a kept press keeps reading the kick and side flags.
    if (pressed[id] && player && !converted && st.phase[id] === 'recovery') keep(st, id, flags);
    else if (st.pending[id]) st.pendingFlags[id] = keepFlags(st.pendingFlags[id] ?? 0, flags);
    hitTest(world, config, st, a);
  }
  flyPass(world, config, st, ts);
  pickupPass(world, config, st);
  recover(world, config, st, ts);

  // The hit-stop counts raw ticks, starting the tick after it began, so riders (which move
  // before combat) and combat's own knockback both hold still for exactly its length.
  if (frozenAtStart) {
    st.hitStopTicks--;
    if (st.hitStopTicks <= 0) {
      st.hitStopTicks = 0;
      world.timeScale = st.resumeTimeScale;
    }
  }
  // The slow motion's raw ticks run only on ticks the world moved (a hit-stop pauses them).
  stepSlowmo(world, st, frozenAtStart);
}
