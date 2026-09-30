// sim/combat: attacks with real timing windows, auto-target, hits and the crude hit-stop
// (docs/milestones/M1.md, combat-1). Punch and kick are weapon entries like any other
// (packs/base/weapons/punch.json and kick.json); every duration arrives in ticks on SimWeaponDef.
//
// Rules, in brief:
// - An attack starts on the tick its `attack` flag rises (docs/architecture.md, "Movers"): a
//   wind-up, a short active moment, a recovery, and for a weapon with a cooldown (the kick) a
//   cooldown after that. Presses during wind-up, active or recovery are ignored. A kick asked for
//   during its cooldown becomes a punch, so the button never feels dead.
// - Phase timers count scaled time (world.timeScale per tick); only the hit-stop countdown runs
//   on raw ticks, because a countdown scaled by a zero timeScale would never end.
// - Auto-target picks the nearest valid rider in the acquisition box, preferring a non-cop. The
//   side is the sign of the target's lateral offset; the side flags override it during the
//   wind-up (and re-pick the target on that side), never once the active moment has started.
//   A `kick` flag during a punch wind-up converts it into a kick wind-up.
// - The hit test runs only while active, against that weapon's reach box on the chosen side. One
//   hit per attack; no hit by the end of the active moment is an `attackMiss`.
// - A landed hit: damage to health, a stagger (the target cannot start an attack, and its own
//   wind-up is interrupted), sideways knockback away from the attacker, and at zero health a
//   `crash` event (tumble-1 turns it into the tumble). A hit involving a player sets timeScale to
//   0 for hitStopMs × combat.hitStopScale (rival-against-rival hits get none).
// - One cause id per attack: attackStart, hit, kick, attackMiss and the resulting crash share it.
import { clamp, type EntityId, type TuningParamDecl } from '../../core';
import type { RoadNetwork } from '../../road';
import { riderState } from '../riders';
import { InputFlag, type AttackPhase, type SimConfig, type SimWeaponDef } from '../types';
import { emit, systemState, type Mover, type SimSystem, type World } from '../world';

export const COMBAT_TUNING: readonly TuningParamDecl[] = [
  {
    id: 'combat.hitStopScale',
    group: 'combat',
    label: 'Hit-stop',
    default: 1,
    min: 0,
    max: 3,
    step: 0.05,
    unit: '×',
    affectsSim: true,
  },
  {
    id: 'combat.knockbackScale',
    group: 'combat',
    label: 'Knockback',
    default: 1,
    min: 0,
    max: 3,
    step: 0.05,
    unit: '×',
    affectsSim: true,
  },
];

/** The unarmed weapon entries, by content id. */
export const PUNCH_ID = 'base:punch';
export const KICK_ID = 'base:kick';

/** Auto-target acquisition box (M1 starting numbers): |Δs| ≤ 4 m, |Δd| ≤ 3 m. */
export const ACQUIRE_S_M = 4;
export const ACQUIRE_D_M = 3;
/** Knockback speed decays at this rate, 1/s (a kick of 5 m/s slides the target about 1.7 m). */
const KNOCKBACK_DECAY = 3;
/** Tolerance for comparing scaled-time sums against whole-tick durations. */
const EPS = 1e-9;

type ActivePhase = Exclude<AttackPhase, 'cooldown'>;

/** Per-rider plain state, by entity id. */
export interface CombatState {
  phase: ActivePhase[];
  /** Weapon content id of the current attack ('' when idle). */
  weapon: string[];
  /** Scaled ticks spent in the current phase. */
  elapsed: number[];
  /** Attack side in the attacker's frame: +1 right, -1 left. */
  side: number[];
  targetId: EntityId[];
  landed: boolean[];
  /** Cause id shared by every event of the current attack. */
  cause: number[];
  /** Scaled ticks left before the weapon in `cooldownWeapon` may start again. */
  cooldown: number[];
  cooldownWeapon: string[];
  /** Scaled ticks of stagger left. */
  stagger: number[];
  /** Knockback speed along +d, m/s. */
  knockVel: number[];
  lastAttackerId: EntityId[];
  /** Last tick's flags, for press edges. */
  prevFlags: number[];
  /** Raw ticks of hit-stop left, and the timeScale to restore afterwards. */
  hitStopTicks: number;
  resumeTimeScale: number;
}

export function combatState(world: World): CombatState {
  return systemState<CombatState>(world, 'combat', () => ({
    phase: [],
    weapon: [],
    elapsed: [],
    side: [],
    targetId: [],
    landed: [],
    cause: [],
    cooldown: [],
    cooldownWeapon: [],
    stagger: [],
    knockVel: [],
    lastAttackerId: [],
    prevFlags: [],
    hitStopTicks: 0,
    resumeTimeScale: 1,
  }));
}

/** What presentation needs about one rider's combat (fed into the snapshot). */
export interface CombatView {
  attackPhase: AttackPhase;
  targetId: EntityId;
  lastAttackerId: EntityId;
}

export function combatView(world: World, id: EntityId): CombatView {
  const st = combatState(world);
  const phase = st.phase[id] ?? 'idle';
  return {
    attackPhase: phase === 'idle' && (st.cooldown[id] ?? 0) > EPS ? 'cooldown' : phase,
    targetId: phase === 'idle' ? -1 : (st.targetId[id] ?? -1),
    lastAttackerId: st.lastAttackerId[id] ?? -1,
  };
}

/** Where `b` is relative to `a`: metres ahead along a's travel, and metres to a's right. */
export function relative(
  road: RoadNetwork,
  a: Mover,
  b: Mover,
  range: number,
): { ds: number; dd: number } | null {
  let bs: number | null = null;
  if (b.pos.edge === a.pos.edge) bs = b.pos.s;
  else {
    for (const n of road.neighbours(a.pos.edge, a.pos.s, range)) {
      if (n.edge === b.pos.edge) {
        bs = b.pos.s + n.sOffset;
        break;
      }
    }
  }
  if (bs === null) return null;
  return { ds: (bs - a.pos.s) * a.pos.dir, dd: (b.pos.d - a.pos.d) * a.pos.dir };
}

function weaponById(config: SimConfig, id: string): SimWeaponDef | undefined {
  return config.weapons.find((w) => w.contentId === id);
}

function isRiding(m: Mover): boolean {
  return m.kind === 'rider' && (m.mode === 'Road' || m.mode === 'Airborne');
}

function isLaw(config: SimConfig, m: Mover): boolean {
  return config.riders[m.riderIndex]?.faction === 'law';
}

function isPlayer(config: SimConfig, m: Mover): boolean {
  return config.riders[m.riderIndex]?.controller.kind === 'player';
}

interface Candidate {
  id: EntityId;
  dd: number;
  dist2: number;
  law: boolean;
}

/**
 * Valid riders inside a box (|Δs| ≤ sM, |Δd| ≤ dM) around `a`, on `side` if it is nonzero.
 * Sorted by preference: non-cops first, then nearest, then lowest id.
 */
function candidates(
  world: World,
  config: SimConfig,
  a: Mover,
  sM: number,
  dM: number,
  side: number,
): Candidate[] {
  const health = riderState(world).health;
  const out: Candidate[] = [];
  for (const b of world.movers) {
    if (b.id === a.id || !isRiding(b) || (health[b.id] ?? 0) <= 0) continue;
    const rel = relative(config.road, a, b, sM + 2);
    if (!rel || Math.abs(rel.ds) > sM || Math.abs(rel.dd) > dM) continue;
    if (side !== 0 && side * rel.dd < 0) continue;
    out.push({ id: b.id, dd: rel.dd, dist2: rel.ds * rel.ds + rel.dd * rel.dd, law: isLaw(config, b) });
  }
  return out.sort((x, y) => Number(x.law) - Number(y.law) || x.dist2 - y.dist2 || x.id - y.id);
}

function sideFlag(flags: number): number {
  const left = (flags & InputFlag.attackSideLeft) !== 0;
  const right = (flags & InputFlag.attackSideRight) !== 0;
  return left === right ? 0 : left ? -1 : 1;
}

/** Picks the auto-target and side for an attacker; `override` is a side flag (0 = none). */
function aim(
  world: World,
  config: SimConfig,
  a: Mover,
  override: number,
): { target: EntityId; side: number } {
  const best = candidates(world, config, a, ACQUIRE_S_M, ACQUIRE_D_M, override)[0];
  if (override !== 0) return { target: best?.id ?? -1, side: override };
  if (!best) return { target: -1, side: 1 };
  return { target: best.id, side: best.dd < 0 ? -1 : 1 };
}

function durationOf(w: SimWeaponDef, phase: ActivePhase): number {
  if (phase === 'windup') return w.windupTicks;
  if (phase === 'active') return w.activeTicks;
  return w.recoveryTicks;
}

function startAttack(
  world: World,
  st: CombatState,
  a: Mover,
  w: SimWeaponDef,
  cause: number | undefined,
): void {
  const id = a.id;
  st.phase[id] = 'windup';
  st.weapon[id] = w.contentId;
  st.elapsed[id] = 0;
  st.landed[id] = false;
  const target = st.targetId[id] ?? -1;
  const extra: { target?: EntityId; causeId?: number } = {};
  if (target >= 0) extra.target = target;
  if (cause !== undefined) extra.causeId = cause;
  st.cause[id] = emit(world, 'attackStart', id, { weapon: w.contentId, side: st.side[id] ?? 1 }, extra);
}

function endAttack(st: CombatState, id: EntityId): void {
  st.phase[id] = 'idle';
  st.weapon[id] = '';
  st.elapsed[id] = 0;
  st.targetId[id] = -1;
}

/** Advances an attack by `ts` scaled ticks through as many phase ends as that covers. */
function advance(world: World, config: SimConfig, st: CombatState, a: Mover, ts: number): void {
  const id = a.id;
  const w = weaponById(config, st.weapon[id] ?? '');
  if (st.phase[id] === 'idle' || !w) return;
  st.elapsed[id] = (st.elapsed[id] ?? 0) + ts;
  for (;;) {
    const phase: ActivePhase = st.phase[id] ?? 'idle';
    if (phase === 'idle') return;
    const dur = durationOf(w, phase);
    const elapsed: number = st.elapsed[id] ?? 0;
    if (elapsed + EPS < dur) return;
    st.elapsed[id] = elapsed - dur;
    if (phase === 'windup') {
      st.phase[id] = 'active';
    } else if (phase === 'active') {
      if (!st.landed[id]) {
        const target = st.targetId[id] ?? -1;
        const extra: { target?: EntityId; causeId?: number } = { causeId: st.cause[id] ?? 0 };
        if (target >= 0) extra.target = target;
        emit(world, 'attackMiss', id, { weapon: w.contentId, side: st.side[id] ?? 1 }, extra);
      }
      st.phase[id] = 'recovery';
    } else {
      if (w.cooldownTicks > 0) {
        st.cooldown[id] = w.cooldownTicks;
        st.cooldownWeapon[id] = w.contentId;
      }
      endAttack(st, id);
      return;
    }
  }
}

/** The weapon a request resolves to: a weapon still cooling down falls back to the punch. */
function resolveWeapon(
  config: SimConfig,
  st: CombatState,
  id: EntityId,
  wantKick: boolean,
): SimWeaponDef | undefined {
  const punch = weaponById(config, PUNCH_ID);
  if (!wantKick) return punch;
  const cooling = (st.cooldown[id] ?? 0) > EPS && st.cooldownWeapon[id] === KICK_ID;
  return cooling ? punch : (weaponById(config, KICK_ID) ?? punch);
}

function land(
  world: World,
  config: SimConfig,
  st: CombatState,
  a: Mover,
  victim: Mover,
  w: SimWeaponDef,
  dd: number,
): void {
  const riders = riderState(world);
  const id = a.id;
  const vid = victim.id;
  const cause = st.cause[id] ?? 0;
  st.landed[id] = true;
  const kick = w.contentId === KICK_ID;
  const health = Math.max(0, (riders.health[vid] ?? 0) - w.damage);
  riders.health[vid] = health;
  emit(
    world,
    'hit',
    id,
    { weapon: w.contentId, damage: w.damage, kick, health },
    { target: vid, causeId: cause },
  );
  if (kick) emit(world, 'kick', id, { weapon: w.contentId }, { target: vid, causeId: cause });

  // Knockback along d, away from the attacker (the attack side when they are level).
  const away = (dd === 0 ? (st.side[id] ?? 1) : dd < 0 ? -1 : 1) * a.pos.dir;
  st.knockVel[vid] = away * w.knockbackMps * (world.params['combat.knockbackScale'] ?? 1);
  st.stagger[vid] = Math.max(st.stagger[vid] ?? 0, w.staggerTicks);
  st.lastAttackerId[vid] = id;
  if (st.phase[vid] === 'windup') endAttack(st, vid);

  if (health <= 0) {
    endAttack(st, vid);
    emit(world, 'crash', vid, { reason: 'knockedOff', by: id }, { target: id, causeId: cause });
  }

  if (isPlayer(config, a) || isPlayer(config, victim)) {
    const ticks = Math.round((w.hitStopMs * (world.params['combat.hitStopScale'] ?? 1) * 60) / 1000);
    if (ticks > 0) {
      if (st.hitStopTicks <= 0) st.resumeTimeScale = world.timeScale;
      st.hitStopTicks = Math.max(st.hitStopTicks, ticks);
      world.timeScale = 0;
    }
  }
}

function hitTest(world: World, config: SimConfig, st: CombatState, a: Mover): void {
  const id = a.id;
  const w = weaponById(config, st.weapon[id] ?? '');
  if (!w || st.phase[id] !== 'active' || st.landed[id]) return;
  const inReach = candidates(world, config, a, w.reachSM, w.reachDM, st.side[id] ?? 1);
  const pick = inReach.find((c) => c.id === st.targetId[id]) ?? inReach[0];
  const victim = pick ? world.movers[pick.id] : undefined;
  if (pick && victim) land(world, config, st, a, victim, w, pick.dd);
}

/** Moves knocked-back riders sideways (scaled time) and keeps them on the drivable width. */
function slide(world: World, config: SimConfig, st: CombatState, dt: number): void {
  for (const m of world.movers) {
    const v = st.knockVel[m.id] ?? 0;
    if (v === 0) continue;
    if (!isRiding(m)) {
      st.knockVel[m.id] = 0;
      continue;
    }
    if (dt <= 0) continue;
    const edge = config.road.edges[m.pos.edge];
    const d = m.pos.d + v * dt;
    const lo = edge ? edge.dMin + 0.5 : d;
    const hi = edge ? edge.dMax - 0.5 : d;
    m.pos.d = clamp(d, lo, hi);
    const decayed = v * (1 - KNOCKBACK_DECAY * dt);
    st.knockVel[m.id] = m.pos.d !== d || Math.abs(decayed) < 0.05 ? 0 : decayed;
  }
}

export const combatSystem: SimSystem = {
  name: 'combat',
  init(world: World, config: SimConfig) {
    const st = combatState(world);
    const riders = riderState(world);
    for (const m of world.movers) {
      const def = config.riders[m.riderIndex];
      if (m.kind !== 'rider' || !def) continue;
      riders.health[m.id] ??= def.healthMax;
      st.phase[m.id] = 'idle';
      st.weapon[m.id] = '';
      st.elapsed[m.id] = 0;
      st.side[m.id] = 1;
      st.targetId[m.id] = -1;
      st.landed[m.id] = false;
      st.cause[m.id] = 0;
      st.cooldown[m.id] = 0;
      st.cooldownWeapon[m.id] = '';
      st.stagger[m.id] = 0;
      st.knockVel[m.id] = 0;
      st.lastAttackerId[m.id] = -1;
      st.prevFlags[m.id] = 0;
    }
  },
  step(world: World, config: SimConfig) {
    const st = combatState(world);
    const frozenAtStart = st.hitStopTicks > 0;
    const ts = world.timeScale;
    slide(world, config, st, ts / 60);
    const health = riderState(world).health;

    for (const a of world.movers) {
      if (a.kind !== 'rider') continue;
      const id = a.id;
      const flags = world.inputs[id]?.flags ?? 0;
      const pressed = (flags & ~(st.prevFlags[id] ?? 0) & InputFlag.attack) !== 0;
      st.prevFlags[id] = flags;
      st.cooldown[id] = Math.max(0, (st.cooldown[id] ?? 0) - ts);
      st.stagger[id] = Math.max(0, (st.stagger[id] ?? 0) - ts);

      if (!isRiding(a) || (health[id] ?? 0) <= 0) {
        if (st.phase[id] !== 'idle') endAttack(st, id);
        continue;
      }
      advance(world, config, st, a, ts);

      const wantKick = (flags & InputFlag.kick) !== 0;
      const override = sideFlag(flags);
      if (st.phase[id] === 'idle') {
        if (pressed && (st.stagger[id] ?? 0) <= EPS) {
          const w = resolveWeapon(config, st, id, wantKick);
          if (w) {
            const aimed = aim(world, config, a, override);
            st.targetId[id] = aimed.target;
            st.side[id] = aimed.side;
            startAttack(world, st, a, w, undefined);
          }
        }
      } else if (st.phase[id] === 'windup') {
        // The side and kick flags may still change the attack until the active moment starts.
        if (override !== 0 && override !== st.side[id]) {
          const aimed = aim(world, config, a, override);
          st.targetId[id] = aimed.target;
          st.side[id] = aimed.side;
        }
        if (wantKick && st.weapon[id] === PUNCH_ID) {
          const kick = resolveWeapon(config, st, id, true);
          if (kick && kick.contentId === KICK_ID) startAttack(world, st, a, kick, st.cause[id]);
        }
      }
      hitTest(world, config, st, a);
    }

    // The hit-stop counts raw ticks, starting the tick after it began, so riders (which move
    // before combat) and combat's own knockback both hold still for exactly its length.
    if (frozenAtStart) {
      st.hitStopTicks--;
      if (st.hitStopTicks <= 0) {
        st.hitStopTicks = 0;
        world.timeScale = st.resumeTimeScale;
      }
    }
  },
};
