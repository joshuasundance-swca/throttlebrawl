// world.lastEvents (M2 combat-4 contract): a system early in the tick order reads what every phase
// emitted last tick, including the phases after its own.
import { describe, expect, it } from 'vitest';
import { harnessConfig } from '../combat/harness.test-util';
import type { SimEvent } from '../types';
import { createWorld, emit, orderSystems, stepWorld, TICK_ORDER, worldHash, type SimSystem } from './index';

const config = () => harnessConfig([]);

describe('world.lastEvents', () => {
  it('holds every phase’s events of the previous tick while the next one steps, and is empty before the first', () => {
    const cfg = config();
    const world = createWorld(cfg);
    const seenByCombat: (readonly SimEvent[])[] = [];
    const systems = orderSystems(
      TICK_ORDER.map((name): SimSystem => ({
        name,
        init() {},
        step(w) {
          // combat runs before traffic: it records what it can see, traffic emits after it.
          if (name === 'combat') seenByCombat.push(w.lastEvents);
          if (name === 'traffic') emit(w, 'crash', 0, { cause: 'traffic' });
        },
      })),
    );
    expect(world.lastEvents).toEqual([]);
    const first = stepWorld(world, cfg, systems, []);
    stepWorld(world, cfg, systems, []);
    expect(seenByCombat[0]).toEqual([]);
    expect(seenByCombat[1]).toEqual(first);
    expect(seenByCombat[1]?.map((e) => [e.tick, e.type])).toEqual([[0, 'crash']]);
  });

  it('is not part of the state hash (it is derived from the last step, like `events`)', () => {
    const cfg = config();
    const a = createWorld(cfg);
    const b = createWorld(cfg);
    b.lastEvents = [{ tick: 0, type: 'crash', actor: 0, data: {} }];
    expect(worldHash(a)).toBe(worldHash(b));
  });
});
