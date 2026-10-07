// What the law's own props (sim/cops `lawProps`) keep of the riders who met them, read by the snapshot. A
// leaf with no imports from the cops system, so sim/modifiers (which steps the contact, law-props.ts) and
// sim/cops (which draws the props) can both read it without an import cycle.
//
// Made with the first contact and never otherwise, so a race nobody touches a sign or a radar in hashes as
// before (the same rule as the set pieces' solids registry).
import type { World } from '../world';

export const LAW_CONTACT_KEY = 'lawContact';

/** A radar the riders knocked: how far it has been thrown from where it stood, m, and how it is flying. */
export interface RadarKnock {
  dx: number;
  dz: number;
  /** Height over where it stood, m. */
  h: number;
  vx: number;
  vz: number;
  vh: number;
  tilt: number;
  spin: number;
  moving: boolean;
}

export interface LawContactState {
  /** By law prop id: the riders inside its boxes last tick (one touch is one contact, not one a tick). */
  touching: Record<string, number[]>;
  /** By radar prop id: the radar a rider knocked flying (it stays down, and is met no more). */
  radar: Record<string, RadarKnock>;
}

/** The contact state if any rider has touched a law prop yet; else undefined. */
export function lawContactOf(world: World): LawContactState | undefined {
  return world.systems[LAW_CONTACT_KEY] as LawContactState | undefined;
}
