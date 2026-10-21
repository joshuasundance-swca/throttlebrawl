import type { SimEvent } from '../../src/sim/api';

/** Furniture falls awaiting combat's delayed takedown credit. */
export function furnitureCredits() {
  const pending = new Map<string, number>();
  const expire = (tick: number): void => {
    for (const [key, crashTick] of pending) if (tick > crashTick + 1) pending.delete(key);
  };
  return {
    crash(event: SimEvent): void {
      expire(event.tick);
      if (event.type !== 'crash' || event.causeId === undefined) return;
      pending.set(`${event.actor}:${event.causeId}`, event.tick);
    },
    take(event: SimEvent): boolean {
      expire(event.tick);
      if (event.type !== 'takedown' || event.target === undefined || event.causeId === undefined)
        return false;
      const key = `${event.target}:${event.causeId}`;
      const crashTick = pending.get(key);
      if (crashTick === undefined || event.tick !== crashTick + 1) return false;
      pending.delete(key);
      return true;
    },
  };
}
