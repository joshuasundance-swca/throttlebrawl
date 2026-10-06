// Rider-against-rider contact (playtest 1 item 6, [decided] 2026-09-30: "riders clip through each
// other → solid bumps plus shoving"). After every rider has moved, each pair of riding bikes on the
// same edge is checked as two road-aligned boxes. An overlap is pushed apart at once along its
// shallower axis, split by mass, so riders never end the riding phase overlapped.
// - A bump (a new contact closing at BUMP_CLOSING_MPS or more): both get a sideways shove away from
//   each other (at least SIDE_SHOVE_MPS, or the sideways speed they closed at) that decays over
//   about half a second, and both wobble. A player can bump a rival toward traffic or the shoulder
//   this way. A rub (closing slower, as riders in a pack do) only eases the two apart.
// - Nose to tail: the speeds merge along the road (no bounce), and the same sideways shove glances
//   the two apart, so a rider who runs into another's back slides past instead of being held
//   behind it.
// Each bump emits `wobble` with `cause: 'rider'`, actor the rider, target the other, and
// `data.closingMps`, once per new contact. Shoves and their decay follow the lower-overall-speed multiplier (speed × m,
// decay × m²). Combat's kick knockback is its own sideways motion (sim/combat); a kicked rider who
// lands on another is separated here on the next riding phase.
import { clamp, cos, sin } from '../../core';
import type { SimConfig } from '../types';
import { emit, speedMultiplierOf, type Mover, type World } from '../world';

/** Half a bike's length, for rider contact, m [default]. */
export const RIDER_HALF_LENGTH_M = 1;
/**
 * Half a bike's width for rider contact, m [default]: 0.8 m across, under sim/ai's 0.9 m rider
 * clearance and 1.1 m fight offset, so a rival holding either rides alongside without touching.
 */
export const RIDER_CONTACT_HALF_WIDTH_M = 0.4;
/**
 * Closing speed from which a contact is a bump (both wobble, one event each) rather than a rub,
 * m/s [default]. Riders rubbing shoulders in a pack close slower than this; a rider steering into
 * another (up to the bike's steer rate, 5.5 m/s) or riding into its back closes faster.
 */
export const BUMP_CLOSING_MPS = 1.5;
/** The least sideways shove a bump gives each rider (equal masses), m/s [default]. */
export const SIDE_SHOVE_MPS = 3;
/** The sideways shove a rub gives each rider (equal masses), m/s [default]: about 8 cm. */
export const RUB_SHOVE_MPS = 1;
/** How fast a shove dies away, m/s² [default]: 3 m/s is gone in 0.5 s, after about 0.75 m. */
export const SHOVE_DECAY_MPS2 = 6;

/** What the riding model lends the contact pass (kept here as plain arguments, no import cycle). */
export interface ContactState {
  wobble: number[];
  /** Sideways shove speed along +d, m/s. */
  shove: number[];
  /** Last tick each pair (by "lowId-highId") was in contact, so one contact emits one event. */
  contactTick: Record<string, number>;
}

export interface ContactRules {
  wobbleTicks: number;
  /** The drivable limits for a rider's centre at its d (the barrier rule's, the verge's off-road). */
  limits(config: SimConfig, edge: number, s: number, d: number): { lo: number; hi: number };
  /**
   * Two riders this far apart in height (or more) pass over each other (supports: one riding a truck's
   * roof, one on the road below it); absent, any height meets, as before.
   */
  heightGapM?: number;
}

/**
 * A rider on its bike stands this tall, m: the crash tumble's rider box (sim/tumble/contacts.ts), and
 * the height gap at which two riders pass over each other [default].
 */
export const RIDER_BODY_HEIGHT_M = 1.6;

function massOf(config: SimConfig, m: Mover): number {
  const def = config.riders[m.riderIndex];
  return def ? def.massKg + def.bike.massKg : 1;
}

function moveD(config: SimConfig, rules: ContactRules, m: Mover, by: number): number {
  const { lo, hi } = rules.limits(config, m.pos.edge, m.pos.s, m.pos.d);
  const before = m.pos.d;
  m.pos.d = clamp(before + by, lo, hi);
  return m.pos.d - before;
}

/** Speed along +s, m/s. */
const alongS = (m: Mover) => m.pos.dir * m.speed * cos(m.yaw);
/** Speed along +d, m/s. */
const acrossD = (m: Mover) => m.pos.dir * m.speed * sin(m.yaw);

function bump(
  world: World,
  st: ContactState,
  rules: ContactRules,
  m: Mover,
  other: Mover,
  closingMps: number,
): void {
  st.wobble[m.id] = rules.wobbleTicks;
  emit(world, 'wobble', m.id, { cause: 'rider', speed: m.speed, closingMps }, { target: other.id });
}

/**
 * A new contact: shoves a toward −side and b toward +side across the road (the lighter one
 * harder). A bump (closing at BUMP_CLOSING_MPS or more) shoves at least SIDE_SHOVE_MPS, or the
 * sideways speed they closed at, and wobbles both; a rub only eases them apart.
 */
function shoveApart(
  world: World,
  config: SimConfig,
  st: ContactState,
  rules: ContactRules,
  pair: { a: Mover; b: Mover; side: 1 | -1; shareA: number; shareB: number; closing: number },
): void {
  const { a, b, side, shareA, shareB, closing } = pair;
  const m = speedMultiplierOf(config);
  const hard = closing >= BUMP_CLOSING_MPS * m;
  const across = Math.max(0, (acrossD(a) - acrossD(b)) * side);
  const base = hard ? Math.max(SIDE_SHOVE_MPS * m, across) : RUB_SHOVE_MPS * m;
  st.shove[a.id] = -side * base * 2 * shareA;
  st.shove[b.id] = side * base * 2 * shareB;
  if (!hard) return;
  bump(world, st, rules, a, b, closing);
  bump(world, st, rules, b, a, closing);
}

/** Moves a rider along its edge, kept on the edge (a push never carries it across a junction). */
function moveS(config: SimConfig, m: Mover, by: number): number {
  const length = config.road.edges[m.pos.edge]?.length ?? m.pos.s;
  const before = m.pos.s;
  m.pos.s = clamp(before + by, 0, length);
  return m.pos.s - before;
}

function resolvePair(
  world: World,
  config: SimConfig,
  st: ContactState,
  rules: ContactRules,
  a: Mover,
  b: Mover,
): void {
  const ds = b.pos.s - a.pos.s;
  const dd = b.pos.d - a.pos.d;
  const penS = 2 * RIDER_HALF_LENGTH_M - Math.abs(ds);
  const penD = 2 * RIDER_CONTACT_HALF_WIDTH_M - Math.abs(dd);
  if (penS <= 0 || penD <= 0) return;
  const key = `${a.id}-${b.id}`;
  const fresh = st.contactTick[key] !== world.tick - 1;
  st.contactTick[key] = world.tick;
  const ma = massOf(config, a);
  const mb = massOf(config, b);
  const shareA = mb / (ma + mb); // the lighter rider moves more
  const shareB = ma / (ma + mb);
  // b is on the +d side; a dead-level pair splits by id order (b to +d).
  const side = dd >= 0 ? 1 : -1;
  let closing: number;

  if (penD / (2 * RIDER_CONTACT_HALF_WIDTH_M) <= penS / (2 * RIDER_HALF_LENGTH_M)) {
    // Side by side: push apart across the road.
    closing = Math.max(0, (acrossD(a) - acrossD(b)) * side);
    const movedA = moveD(config, rules, a, -side * penD * shareA);
    moveD(config, rules, b, side * (penD - Math.abs(movedA)));
  } else {
    // Nose to tail: push apart along the road, then merge the speeds along it (no bounce).
    const ahead = ds >= 0 ? 1 : -1; // b is ahead of a along +s
    const movedA = moveS(config, a, -ahead * penS * shareA);
    moveS(config, b, ahead * (penS - Math.abs(movedA)));
    const va = alongS(a);
    const vb = alongS(b);
    closing = Math.max(0, (va - vb) * ahead);
    if (closing > 0 && a.pos.dir === b.pos.dir) {
      const common = (ma * va + mb * vb) / (ma + mb);
      for (const r of [a, b]) {
        const c = cos(r.yaw);
        r.speed = Math.max(0, (common * r.pos.dir) / (c > 0.2 ? c : 0.2));
      }
    }
  }
  if (fresh) shoveApart(world, config, st, rules, { a, b, side, shareA, shareB, closing });
}

/** Resolves every overlapping pair of riding bikes, in id order (deterministic). */
export function riderContacts(world: World, config: SimConfig, st: ContactState, rules: ContactRules): void {
  const riding: Mover[] = [];
  for (const m of world.movers)
    if (m.kind === 'rider' && m.riderIndex >= 0 && m.mode === 'Road') riding.push(m);
  for (let i = 0; i < riding.length; i++) {
    for (let j = i + 1; j < riding.length; j++) {
      const a = riding[i];
      const b = riding[j];
      if (!a || !b || a.pos.edge !== b.pos.edge) continue;
      if (a.mode !== 'Road' || b.mode !== 'Road') continue; // one crashed on an earlier pair
      if (rules.heightGapM !== undefined && Math.abs(a.h - b.h) >= rules.heightGapM) continue;
      resolvePair(world, config, st, rules, a, b);
    }
  }
}

/** Moves a rider by its shove and lets the shove die away (scaled time); the barrier rule follows. */
export function applyShove(config: SimConfig, st: ContactState, m: Mover, dt: number): void {
  const v = st.shove[m.id] ?? 0;
  if (v === 0) return;
  m.pos.d += v * dt;
  const m1 = speedMultiplierOf(config);
  const decay = SHOVE_DECAY_MPS2 * m1 * m1 * dt;
  st.shove[m.id] = Math.abs(v) <= decay ? 0 : v - (v > 0 ? decay : -decay);
}
