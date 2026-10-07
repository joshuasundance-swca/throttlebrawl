// What a rival or a cop sees of the bikes left on the road after a crash (pile-ups; the maintainer,
// 2026-10-06: "Pile ups are fun lol"). A dropped bike is solid by closing speed (sim/riders,
// `droppedBikeContact`), so the rival AI and the cops keep their lines clear of it as of the other solid
// things they see (sim/ai/sense): each bike is an obstacle that stands still. Pure functions of sim state.
import type { SimConfig } from '../types';
import type { TumbleState } from '../tumble';
import { PARKED_BIKE_HALF_LENGTH_M, PARKED_BIKE_HALF_WIDTH_M, pileUpsOn } from '../riders/furniture';
import type { Mover, World } from '../world';
import type { Obstacle } from './sense';

/**
 * The dropped bikes a rider sees: each bike standing while its rider runs back to it (sim/tumble parks it
 * at the hand-back), on the rider's edge or one joined to it, from `behind` metres back to `ahead`
 * metres on, as an obstacle that stands still: its footprint's half length along the road and half width
 * across it, moving at 0. None while the pile-up rule is off (a dropped bike is ridden through then), and
 * never the rider's own. Tumble's state is read, not imported (it imports the riding model, which this
 * module's callers sit beside). The bike's stand-in mover never moves and is in no world: only its
 * `pos.d` is read (its id is -1).
 */
export function droppedBikesSeen(
  world: World,
  config: SimConfig,
  me: Mover,
  ahead: number,
  behind: number,
): Obstacle[] {
  if (!pileUpsOn(world.params)) return [];
  const records = (world.systems['tumble'] as Pick<TumbleState, 'records'> | undefined)?.records;
  if (!records) return [];
  const pos = me.pos;
  const lo = pos.dir > 0 ? pos.s - behind : pos.s - ahead;
  const hi = pos.dir > 0 ? pos.s + ahead : pos.s + behind;
  const out: Obstacle[] = [];
  const joins = [
    { edge: pos.edge, sOffset: 0, sSign: 1 as const, dOffset: 0 },
    ...config.road.neighbours(pos.edge, pos.s, Math.max(ahead, behind)),
  ];
  for (let id = 0; id < records.length; id++) {
    const bike = records[id]?.parked;
    if (id === me.id || !bike) continue;
    // In our edge's frame: ours = sOffset + sSign * theirs; our d = sSign * theirs + dOffset.
    const join = joins.find((j) => j.edge === bike.edge);
    if (!join) continue;
    const s = join.sOffset + join.sSign * bike.s;
    if (s + PARKED_BIKE_HALF_LENGTH_M < lo || s - PARKED_BIKE_HALF_LENGTH_M > hi) continue;
    const d = join.sSign * bike.d + join.dOffset;
    const stand: Mover = {
      id: -1,
      kind: 'pickup',
      mode: 'Road',
      pos: { edge: pos.edge, s, d, dir: pos.dir },
      h: 0,
      yaw: 0,
      speed: 0,
      riderIndex: -1,
    };
    out.push({
      s: { mover: stand, ahead: (s - pos.s) * pos.dir, dd: d - pos.d, vAlong: 0 },
      size: { halfLength: PARKED_BIKE_HALF_LENGTH_M, halfWidth: PARKED_BIKE_HALF_WIDTH_M },
    });
  }
  return out;
}
