import type { MoverMode, SimEvent } from '../../src/sim/api';
import { furnitureCredits } from './furniture-credit';

/** Actual riding-to-tumble falls, separately from contacts with an already fallen body. */
export function firstFallAccounting() {
  const pending = furnitureCredits();
  const seen = new Set<number>();
  let tick = -1;
  let falls = 0;
  let credited = 0;
  return {
    crash(event: SimEvent, before: MoverMode | undefined, after: MoverMode | undefined): void {
      if (event.type !== 'crash') return;
      if (before === undefined || after === undefined)
        throw new Error(
          `Cannot classify rider ${event.actor} crash at tick ${event.tick}: missing snapshot mode`,
        );
      if (event.tick !== tick) {
        tick = event.tick;
        seen.clear();
      }
      if (
        event.data['contact'] === 'tumble' ||
        (before !== 'Road' && before !== 'Airborne') ||
        after !== 'Tumble' ||
        seen.has(event.actor)
      )
        return;
      seen.add(event.actor);
      falls++;
      pending.crash(event);
    },
    credit(event: SimEvent): void {
      if (pending.take(event)) credited++;
    },
    totals(): { firstFalls: number; creditedFirstFalls: number; uncreditedFirstFalls: number } {
      return { firstFalls: falls, creditedFirstFalls: credited, uncreditedFirstFalls: falls - credited };
    },
  };
}
