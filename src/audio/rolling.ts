// Whether the player's wheels are rolling, for the road's own sounds (the soundscape's rain on the
// ground, a bridge's joints, a bar's open front): riding, on the road or on whatever holds him up there.
// The maintainer, playing on the phone, 2026-10-06: "land on it and ride on it"; "consistent physics and
// gameplay is important here so players know what to expect". A rider on a truck's roof, or a parked
// pickup, rides in `Road` mode, up off the road under him; the snapshot's `grounded` flag (his height over
// the road is 0) is false there, so the sound keys on the mode, not on that flag: riding a support is
// still riding, and only a flight, a tumble or a run on foot silences the road.
import type { EntitySnapshot } from '../sim/api';

/** Rolling: not in the air, not tumbling, not on foot. */
export function rollingOn(me: Pick<EntitySnapshot, 'mode'>): boolean {
  return me.mode !== 'Airborne' && me.mode !== 'Tumble' && me.mode !== 'OnFoot';
}
