// Snapshot-only police pursuit view. Read the existing state without creating it or loading steps.
import type { EntityId } from '../../core';
import type { SimConfig } from '../types';
import type { World } from '../world';
import { COP_CHASING, type CopsState } from './index';

/** Current pursuit intent, including while a chasing cop is down and will remount; otherwise -1. */
export function pursuitTargetOf(world: World, config: SimConfig, copId: EntityId): EntityId {
  const st = world.systems['cops'] as CopsState | undefined;
  const cop = world.movers[copId];
  const def = cop && config.riders[cop.riderIndex];
  if (
    !st ||
    cop?.kind !== 'rider' ||
    def?.faction !== 'law' ||
    def.controller.kind !== 'cop' ||
    st.phase[copId] !== COP_CHASING
  )
    return -1;
  const targetId = st.target[copId] ?? -1;
  const target = world.movers[targetId];
  // Mirror cops' chaseability: a rider on the course who has neither finished nor been busted.
  if (
    target?.kind !== 'rider' ||
    config.route.distanceToFinish(target.pos.edge, target.pos.s) <= 0 ||
    st.busted.includes(targetId)
  )
    return -1;
  return targetId;
}
