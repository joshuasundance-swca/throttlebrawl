import type { SimEvent } from '../../src/sim/api';

/** Count radioed-ahead transitions in one race's append-only event journal. */
export function createRadioedAheadCounter(): (events: readonly SimEvent[]) => number {
  const chasing = new Set<number>();
  let ahead = 0;
  let seen = 0;
  return (events) => {
    for (; seen < events.length; seen++) {
      const e = events[seen];
      if (!e) continue;
      if (e.type !== 'siren') continue;
      if (e.data['on'] !== true) chasing.delete(e.actor);
      else if (e.data['cause'] !== 'roadblock') chasing.add(e.actor);
      else if (chasing.has(e.actor)) ahead++;
    }
    return ahead;
  };
}
