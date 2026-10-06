// The one rule for a rider meeting a vehicle (playtest 4; the maintainer, 2026-10-05: "low speeds
// should wobble not crash, accounting for biker speed and traffic speed"). Every rider-versus-vehicle
// contact (traffic's cars and trucks in ./index.ts contacts(), and the ramp trucks and parked
// pickups sim/riders meets as solid boxes) decides wobble or crash here, by the CLOSING speed: how
// fast the two came together along the contact's normal, from both bodies' real velocities. At or
// above `traffic.solidHitMps` it is a crash; below it, a wobble. One rule and one tuning key for every
// geometry: rear-ending a car, a car rear-ending the rider, a side swipe, a head-on, a parked or
// stopped vehicle. A leaf module (no imports), so sim/riders reads it without an import cycle.
//
// Deliberate exceptions, kept: a wheelie into a car's back launches instead (sim/riders/wheelie.ts,
// #525), a light kerb rider is always soft (`traffic.kerbSoft`, ./kerb-yield.ts: the cyclist topples),
// and a rider up on a ramp truck's deck riding into its body is thrown off at any speed (sim/riders,
// truckContact: never stuck on the deck).

/** The tuning key: the closing speed from which a rider meeting a vehicle crashes, m/s. */
export const TRAFFIC_HIT_KEY = 'traffic.solidHitMps';

/**
 * Its starting value, m/s [default]. Picked from measurement (playtest 4; 60 seeded career races over
 * the three regions, the bot riding): a rider back on the bike rolls at 8 m/s (`tumble.remountMps`),
 * and five of the seven crashes on the first tick after a remount closed at 7.8 to 8.2 m/s, so the
 * line clears them with room; it keeps 271 of the 303 frontal traffic crashes of those races (their
 * median closing speed was 42 m/s). It was 6 m/s for end-on hits only, while trucks, and any touch
 * while still wobbling, crashed at any speed.
 */
export const TRAFFIC_HIT_DEFAULT_MPS = 10;

/**
 * An end-on contact overlapping sideways by less than this is a graze, m: it meets the corner, so its
 * closing speed is taken across the road, like a side brush's. Traffic's (./index.ts, `TRAFFIC.grazeM`)
 * and the people's (sim/peds). The street furniture and the solid road hazards take the bike's half
 * width instead (sim/riders/furniture.ts `SOLID_GRAZE_M`: square on only in the bike's own line).
 */
export const GRAZE_M = 0.3;

/** The crash line in force: the tuning value, else the default. */
export function trafficHitMps(params: Readonly<Record<string, number>>): number {
  const v = params[TRAFFIC_HIT_KEY];
  return v !== undefined && Number.isFinite(v) ? v : TRAFFIC_HIT_DEFAULT_MPS;
}

/** The one rule: a contact with this closing speed (m/s, along its normal) is a crash. */
export function trafficContactCrashes(params: Readonly<Record<string, number>>, closingMps: number): boolean {
  return closingMps >= trafficHitMps(params);
}

/**
 * How fast two bodies close along one axis: the rider's and the vehicle's velocity components on it,
 * and `toward`, the sign of the vehicle's offset from the rider on that axis. 0 when they are not
 * closing (moving apart, or level).
 */
export function closingOnAxis(riderV: number, vehicleV: number, toward: number): number {
  const c = (riderV - vehicleV) * (toward > 0 ? 1 : toward < 0 ? -1 : 0);
  return c > 0 ? c : 0;
}
