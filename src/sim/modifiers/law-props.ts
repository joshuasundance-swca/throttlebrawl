// The law's own props meet the riders by the one rule (the maintainer, 2026-10-06: "a road race in a physical
// world with honest edges"; docs/content-packs.md, "Contact outcomes: one rule"). sim/cops puts up the END OF
// JURISDICTION sign and each radar trooper's radar (`lawProps`); the polish M live check rode straight through
// the sign at 39.7 m/s with nothing. Each is drawn as the set pieces' sign and radar are (render's EventProps
// draws the kind, whoever put it up), so each has the contact of what it is drawn as, and the boxes
// (`propBoxes`) the hitbox audits already hold to the drawing:
// - the sign (`PROP_CONTACT.sign`, light, "standing"): ridden through with one wobble, a little speed and a
//   heading kick away from it, never a crash, and it stays standing (its post is planted);
// - the radar (`PROP_CONTACT.radar`, light): the same wobble, and the radar is knocked flying and stays down.
// A wobble here is `cause: 'lawProp'`, not a set piece's: the law's own gear costs the rider no heat (a rider
// who rides over the sign that ends the chase is not chased the harder for it).
//
// The phase runs after the riders and the cops (modifiers is last in the tick), and meets in world terms: the
// rider's box in the prop's own frame, so it holds on whatever road the prop stands, not only the route's
// corridor. `modifiers.propContact` switches it with the set pieces' (a race whose tuning leaves it out, every
// recording made before, rides through them as before).
import { clamp, cos, sin } from '../../core';
import { lawPropsStanding } from '../cops';
import { LAW_CONTACT_KEY, lawContactOf, type LawContactState, type RadarKnock } from '../cops/law-knock';
import { LAW_PROP_ID_BASE, type PropSnapshot, type SimConfig } from '../types';
import { emit, riderHitbox, systemState, type Mover, type World } from '../world';
import { PROP_CONTACT, propBoxes, propContactOn, SET_PIECE } from './setpieces';

/** A rider this far from a prop (world metres, flat) is out of every box it has; the cheap cull. */
const REACH_M = 8;

/** The sim's moving state of a rider the prop can meet: on the road or in the air, as a set piece's. */
const meets = (m: Mover) => m.kind === 'rider' && (m.mode === 'Road' || m.mode === 'Airborne');

/**
 * Knocked flying (a light prop, `knock` in setpieces.ts, in world terms): along the rider's way at 0.8 of his
 * speed, aside away from his line, up, and spinning as it falls.
 */
function knocked(
  forward: { x: number; z: number },
  right: { x: number; z: number },
  side: number,
  speed: number,
): RadarKnock {
  const aside = side * (1.5 + 0.12 * speed);
  return {
    dx: 0,
    dz: 0,
    h: 0,
    vx: forward.x * speed * 0.8 + right.x * aside,
    vz: forward.z * speed * 0.8 + right.z * aside,
    vh: 2 + 0.08 * speed,
    tilt: 0,
    spin: 6,
    moving: true,
  };
}

/** A thrown radar's flight: ballistic, then sliding on the ground until it settles (setpieces.ts stepProps). */
function fly(k: RadarKnock, dt: number): void {
  if (!k.moving) return;
  k.vh -= SET_PIECE.gravity * dt;
  k.dx += k.vx * dt;
  k.dz += k.vz * dt;
  k.h += k.vh * dt;
  k.tilt = clamp(k.tilt + k.spin * dt, 0, 1.57);
  if (k.h > 0) return;
  k.h = 0;
  k.vh = k.vh < -1.2 ? -k.vh * 0.3 : 0;
  const f = Math.max(0, 1 - 4 * dt);
  k.vx *= f;
  k.vz *= f;
  if (k.vh === 0 && Math.abs(k.vx) + Math.abs(k.vz) < 0.25) {
    k.vx = 0;
    k.vz = 0;
    k.moving = false;
  }
}

/** The riders inside one of the prop's boxes now (`owner`, a rider that is its own, left out), by the one rule's test. */
function ridersIn(world: World, config: SimConfig, p: PropSnapshot, owner: number): Mover[] {
  const boxes = propBoxes(p.kind, p.variant);
  const fx = -sin(p.heading);
  const fz = -cos(p.heading);
  const rx = cos(p.heading);
  const rz = -sin(p.heading);
  const out: Mover[] = [];
  for (const m of world.movers) {
    if (!meets(m) || m.id === owner) continue;
    const w = config.road.toWorld(m.pos.edge, m.pos.s, m.pos.d, m.h);
    const dx = w.x - p.x;
    const dz = w.z - p.z;
    if (dx * dx + dz * dz > REACH_M * REACH_M) continue;
    // The rider in the prop's frame: along the way it faces, across to its right, and up over its foot.
    const along = dx * fx + dz * fz;
    const across = dx * rx + dz * rz;
    const h = w.y - p.y;
    const box = riderHitbox(config, m.riderIndex);
    for (const b of boxes) {
      if (b.solid || h >= b.top || h + SET_PIECE.riderTallM <= b.bottom) continue;
      if (Math.abs(along - b.along) > b.hu + box.lengthM / 2) continue;
      if (Math.abs(across - b.across) > b.hd + box.widthM / 2) continue;
      out.push(m);
      break;
    }
  }
  return out;
}

/**
 * Each tick, the law's props against the riders: a rider newly inside a prop's boxes meets it (a wobble, a
 * little speed, a heading kick away from it; the radar is knocked flying and, once down, is met no more).
 */
export function stepLawProps(world: World, config: SimConfig): void {
  if (!propContactOn(world.params)) return;
  const props = lawPropsStanding(world, config);
  let state = lawContactOf(world);
  const dt = world.timeScale / 60;
  if (state) for (const k of Object.values(state.radar)) fly(k, dt);
  for (const p of props) {
    const key = String(p.id);
    if (PROP_CONTACT[p.kind] !== 'standing' && PROP_CONTACT[p.kind] !== 'light') continue;
    // A radar on the ground is a fallen one: nothing of it stands to be met.
    if (state?.radar[key]) continue;
    // His own radar is the trooper's, standing beside it (he is not a rider who meets it).
    const owner = p.kind === 'radar' ? p.id - LAW_PROP_ID_BASE - 1 : -1;
    const inside = ridersIn(world, config, p, owner);
    const was = state?.touching[key] ?? [];
    if (inside.length === 0 && was.length === 0) continue;
    state ??= systemState<LawContactState>(world, LAW_CONTACT_KEY, () => ({ touching: {}, radar: {} }));
    state.touching[key] = inside.map((m) => m.id);
    for (const m of inside) {
      if (was.includes(m.id)) continue;
      meet(world, config, state, p, m);
      if (state.radar[key]) break;
    }
  }
}

/** A rider meets a law prop: the light prop's wobble, and a radar flies. */
function meet(world: World, config: SimConfig, state: LawContactState, p: PropSnapshot, m: Mover): void {
  const f = config.road.frameAt(m.pos.edge, m.pos.s);
  const fx = f.tx * m.pos.dir;
  const fz = f.tz * m.pos.dir;
  // His right in the world (the model's -z is forward, +x right); the prop is on it if the offset points that way.
  const rx = -fz;
  const rz = fx;
  const w = config.road.toWorld(m.pos.edge, m.pos.s, m.pos.d, 0);
  const onRight = (p.x - w.x) * rx + (p.z - w.z) * rz > 0;
  if (p.kind === 'radar') {
    // Thrown away from his line, to the side it stands on (the prop's own right is +1).
    const pr = { x: cos(p.heading), z: -sin(p.heading) };
    const side = (w.x - p.x) * pr.x + (w.z - p.z) * pr.z <= 0 ? 1 : -1;
    state.radar[String(p.id)] = knocked({ x: fx, z: fz }, pr, side, m.speed);
  }
  m.speed *= SET_PIECE.barricadeScrub;
  // A positive yaw turns right (toward the prop if it stands on his right): kicked the other way.
  m.yaw = clamp(m.yaw + (onRight ? -1 : 1) * SET_PIECE.wobbleKickRad, -1.2, 1.2);
  emit(world, 'wobble', m.id, { cause: 'lawProp', prop: p.kind, piece: p.piece });
}
